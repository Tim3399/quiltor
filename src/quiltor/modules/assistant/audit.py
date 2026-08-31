"""World-consistency checks: structural validation of relationships/timeline/presence
(validate_world, presence_consistency_issues) and proposal-shape validation before a
model-generated proposal is ever surfaced to the user (validate_proposals)."""

from __future__ import annotations

import re
from typing import Any

from quiltor.domain.story_world.entity_resolution import resolve_entity
from quiltor.domain.story_world.integrity import (
    presence_consistency_issues,
    validate_world,
)
from quiltor.modules.assistant.contract import _normal, required_proposal_kinds
from quiltor.modules.assistant.entity_references import resolved_entity_id
from quiltor.modules.assistant.relationship_appearance import normalize_relationship_appearance


def audit_message(audit: dict[str, Any], contract: dict[str, Any]) -> str:
    inspected = audit["inspected"]
    prefix = (
        f"Strukturell vollständig geprüft: {inspected['relationships']} Beziehungen mit "
        f"{inspected['relationshipStates']} Zeitständen, {inspected['elements']} Elemente, "
        f"{inspected['timelineMoments']} Zeitpunkte und "
        f"{inspected['presenceEntries']} Anwesenheits-Einträge."
    )
    if audit["issues"]:
        return prefix + " Gefunden: " + "; ".join(audit["issues"]) + ". Es wurde nichts geändert."
    return (
        prefix
        + " Keine technischen Widersprüche gefunden. Ob Richtung und Beschriftung inhaltlich "
        "zur Geschichte passen, ist damit nicht geprüft; dafür müssen konkrete "
        "Manuskriptstellen als Belege ausgewertet werden."
    )


def audit_reply(audit: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    """Same content as audit_message(), plus the messageKey/messageParams/messageItems
    triple the frontend needs to render it in the interface language (see
    packages/client/src/modules/assistant/AssistantDrawer.tsx's resolveAssistantMessage)."""
    inspected = audit["inspected"]
    params = {
        "relationships": inspected["relationships"],
        "relationshipStates": inspected["relationshipStates"],
        "elements": inspected["elements"],
        "timelineMoments": inspected["timelineMoments"],
        "presenceEntries": inspected["presenceEntries"],
    }
    if audit["issues"]:
        return {
            "message": audit_message(audit, contract),
            "messageKey": "auditFoundIssues",
            "messageParams": params,
            "messageItems": audit["issueItems"],
        }
    return {
        "message": audit_message(audit, contract),
        "messageKey": "auditNoIssues",
        "messageParams": params,
    }


def validate_proposals(
    value: Any, figures: dict[str, Any], question: str = ""
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    allowed = {
        "create_element",
        "update_element",
        "create_timeline_moment",
        "create_relationship",
        "set_relationship_at_moment",
        "mark_deceased",
        "arrange_elements",
        "set_presence",
    }
    known_elements = {node.get("id") for node in figures.get("nodes") or []}
    known_moments = {moment.get("id") for moment in figures.get("timeline") or []}
    known_relationships = {edge.get("id") for edge in figures.get("edges") or []}
    existing_names = {_normal(node.get("name")) for node in figures.get("nodes") or []}
    existing_moments = {
        (_normal(moment.get("title")), _normal(moment.get("date")))
        for moment in figures.get("timeline") or []
    }
    temporary_element_types = {
        proposal.get("tempId"): (proposal.get("element") or {}).get("type", "person")
        for proposal in value
        if isinstance(proposal, dict)
        and proposal.get("kind") == "create_element"
        and isinstance(proposal.get("tempId"), str)
        and proposal["tempId"].startswith("new:")
        and isinstance(proposal.get("element"), dict)
    }
    temporary_elements = set(temporary_element_types)
    temporary_moments = {
        proposal.get("tempId")
        for proposal in value
        if isinstance(proposal, dict)
        and proposal.get("kind") == "create_timeline_moment"
        and isinstance(proposal.get("tempId"), str)
        and proposal["tempId"].startswith("new:")
    }
    seen_temporary: set[str] = set()
    result = []
    required = required_proposal_kinds(question)
    for proposal in value[:20]:
        if not isinstance(proposal, dict) or proposal.get("kind") not in allowed:
            continue
        kind = proposal["kind"]
        if required and kind not in required:
            continue
        if required_proposal_kinds(question) == {"arrange_elements"} and kind != "arrange_elements":
            continue
        if kind == "arrange_elements":
            proposal = {
                "kind": "arrange_elements",
                "strategy": "thematic" if proposal.get("strategy") != "grid" else "grid",
            }
        if kind in {"create_element", "create_timeline_moment"}:
            temp = proposal.get("tempId")
            if not isinstance(temp, str) or not temp.startswith("new:") or temp in seen_temporary:
                continue
            seen_temporary.add(temp)
            if kind == "create_element":
                element = proposal.get("element")
                if not isinstance(element, dict) or not str(element.get("name", "")).strip():
                    continue
                if (
                    len(str(element.get("name", ""))) > 160
                    or len(str(element.get("label", ""))) > 160
                    or len(str(element.get("sub", ""))) > 1000
                ):
                    continue
                resolution = resolve_entity(
                    figures,
                    str(element.get("name", "")),
                    entity_type=(
                        str(element["type"]) if isinstance(element.get("type"), str) else None
                    ),
                )
                if (
                    _normal(element.get("name")) in existing_names
                    or resolution.status != "not_found"
                ):
                    continue
                if not isinstance(element.get("profile"), dict):
                    element["profile"] = {"notizen": str(element.get("profile") or "")}
                age = re.search(r"\b(\d{1,3})\s*(?:jahre?|years?)\b", question, re.IGNORECASE)
                if age and not element["profile"].get("alter"):
                    element["profile"]["alter"] = age.group(1)
            else:
                moment_value = proposal.get("moment")
                if (
                    not isinstance(moment_value, dict)
                    or not str(moment_value.get("title", "")).strip()
                    or len(str(moment_value.get("title", ""))) > 160
                    or len(str(moment_value.get("date", ""))) > 20
                    or len(str(moment_value.get("note", ""))) > 1000
                ):
                    continue
                if (
                    _normal(moment_value.get("title")),
                    _normal(moment_value.get("date")),
                ) in existing_moments:
                    continue
        elif kind == "update_element":
            element_id = resolved_entity_id(figures, proposal.get("elementId"))
            if element_id is None or not isinstance(proposal.get("patch"), dict):
                continue
            patch = proposal["patch"]
            clean_patch = {
                key: str(patch[key])[:limit]
                for key, limit in (("name", 160), ("label", 160), ("sub", 1000))
                if isinstance(patch.get(key), str)
            }
            if isinstance(patch.get("profile"), dict):
                clean_patch["profile"] = {
                    key: str(patch["profile"][key])[:4000]
                    for key in ("alter", "rolle", "aussehen", "herkunft", "stimme", "notizen")
                    if isinstance(patch["profile"].get(key), str)
                }
            if not clean_patch:
                continue
            proposal = {"kind": kind, "elementId": element_id, "patch": clean_patch}
        elif kind == "set_relationship_at_moment":
            if (
                proposal.get("relationshipId") not in known_relationships
                or proposal.get("momentId") not in known_moments | temporary_moments
                or not isinstance(proposal.get("patch"), dict)
            ):
                continue
            raw_patch = proposal["patch"]
            appearance = normalize_relationship_appearance(raw_patch)
            if appearance is None:
                continue
            clean_patch: dict[str, Any] = {}
            if isinstance(raw_patch.get("label"), str):
                clean_patch["label"] = raw_patch["label"][:160]
            for key in ("active", "directed"):
                if type(raw_patch.get(key)) is bool:
                    clean_patch[key] = raw_patch[key]
            clean_patch.update(appearance)
            if not clean_patch:
                continue
            proposal = {
                "kind": kind,
                "relationshipId": proposal["relationshipId"],
                "momentId": proposal["momentId"],
                "patch": clean_patch,
            }
        elif kind == "mark_deceased":
            raw_element_id = proposal.get("elementId")
            element_id = (
                raw_element_id
                if raw_element_id in temporary_elements
                else resolved_entity_id(figures, raw_element_id)
            )
            if (
                element_id is None
                or proposal.get("momentId") not in known_moments | temporary_moments
            ):
                continue
            proposal = {**proposal, "elementId": element_id}
        elif kind == "set_presence":
            raw_element_id, raw_place_id, moment_id = (
                proposal.get("elementId"),
                proposal.get("placeId"),
                proposal.get("momentId"),
            )
            element_id = (
                raw_element_id
                if raw_element_id in temporary_elements
                else resolved_entity_id(figures, raw_element_id)
            )
            place_id = (
                raw_place_id
                if temporary_element_types.get(raw_place_id) == "ort"
                else resolved_entity_id(figures, raw_place_id, entity_type="ort")
            )
            if (
                element_id is None
                or place_id is None
                or (moment_id is not None and moment_id not in known_moments | temporary_moments)
            ):
                continue
            proposal = {
                "kind": kind,
                "elementId": element_id,
                "placeId": place_id,
                **({"momentId": moment_id} if moment_id else {}),
            }
        elif kind == "create_relationship":
            raw_relation = proposal.get("relationship") or {}
            appearance = (
                normalize_relationship_appearance(raw_relation, defaults=True)
                if isinstance(raw_relation, dict)
                else None
            )
            if (
                not isinstance(raw_relation, dict)
                or not isinstance(raw_relation.get("label", ""), str)
                or len(str(raw_relation.get("label", ""))) > 160
                or appearance is None
            ):
                continue
            relation = {
                "from": raw_relation.get("from"),
                "to": raw_relation.get("to"),
                "label": raw_relation.get("label", ""),
                "directed": bool(raw_relation.get("directed")),
                **appearance,
            }
            for endpoint in ("from", "to"):
                endpoint_value = relation.get(endpoint)
                if endpoint_value not in temporary_elements:
                    relation[endpoint] = resolved_entity_id(figures, endpoint_value)
            if (
                relation.get("from") not in known_elements | temporary_elements
                or relation.get("to") not in known_elements | temporary_elements
                or relation.get("from") == relation.get("to")
            ):
                continue
            directed = bool(relation.get("directed"))
            duplicate = any(
                (
                    bool(edge.get("gerichtet")) == directed
                    and (
                        (
                            directed
                            and edge.get("from") == relation.get("from")
                            and edge.get("to") == relation.get("to")
                        )
                        or (
                            not directed
                            and {edge.get("from"), edge.get("to")}
                            == {relation.get("from"), relation.get("to")}
                        )
                    )
                )
                for edge in figures.get("edges") or []
            )
            if duplicate:
                continue
            proposal = {**proposal, "relationship": relation}
        result.append(proposal)
    return result
