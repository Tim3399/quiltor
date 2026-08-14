"""World-consistency checks: structural validation of relationships/timeline/presence
(validate_world, presence_consistency_issues) and proposal-shape validation before a
model-generated proposal is ever surfaced to the user (validate_proposals)."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from backend.assistant.contract import _normal, required_proposal_kinds
from backend.knowledge import moment_order


def _moment_date_diff_days(from_date: Any, to_date: Any) -> int | None:
    """Port of src/features/figures/date.ts's momentDateDiffDays -- same ISO-date parsing,
    same rounding. Kept as a small standalone duplicate rather than shared across the
    JS/Python boundary (per the plan: ~10 lines, not worth a cross-language dependency)."""
    if not from_date or not to_date:
        return None
    try:
        start, end = datetime.strptime(str(from_date), "%Y-%m-%d"), datetime.strptime(str(to_date), "%Y-%m-%d")
    except ValueError:
        return None
    return (end - start).days


def _figure_journey_stops(figure: dict[str, Any], presence: list[dict[str, Any]], timeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Port of src/features/figures/presence.ts's figureJourney: this figure's presence
    entries in timeline order, collapsed to only the stops where the place actually changes."""
    died_id = figure.get("diedMomentId")
    death_index = moment_order(timeline, died_id) if died_id else float("inf")
    stops = []
    for entry in presence:
        if entry.get("elementId") != figure.get("id"):
            continue
        index = moment_order(timeline, entry.get("momentId"))
        if index < -1 or index > death_index:
            continue
        stops.append({"placeId": entry.get("placeId"), "momentId": entry.get("momentId"), "index": index})
    stops.sort(key=lambda stop: stop["index"])
    return [stop for i, stop in enumerate(stops) if i == 0 or stop["placeId"] != stops[i - 1]["placeId"]]


# Each issue is tracked as (fallback German text, frontend translation key, key params) so
# validate_world/presence_consistency_issues can keep returning plain strings (used for
# logging, agentTrace, and existing test assertions) while audit_reply() below hands the
# same findings to the frontend as translatable messageItems -- see
# src/language/{de,en}/assistant.ts's issue* keys, the single source of truth for the text
# a user actually sees.
def _issue(text: str, key: str, **params: Any) -> tuple[str, str, dict[str, Any]]:
    return text, key, params


def _presence_issue_entries(figures: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """Near-term slice of plan item B.1: flag presence entries that imply a figure changed
    places with a same-day or backward date jump -- pure data already structured today
    (PresenceEntry + TimelineMoment.date), no prose-reading or LLM call involved. Silently
    skips any figure/moment pair missing a date (most worlds don't date every moment; that's
    "Dauer unbekannt", not an inconsistency, mirroring stopDateDiff's graceful-degrade)."""
    nodes = figures.get("nodes") or []
    presence = figures.get("presence") or []
    timeline = figures.get("timeline") or []
    moments_by_id = {moment.get("id"): moment for moment in timeline}
    entries: list[tuple[str, str, dict[str, Any]]] = []
    for figure in nodes:
        name = figure.get("name") or figure.get("id")
        stops = _figure_journey_stops(figure, presence, timeline)
        for previous, current in zip(stops, stops[1:]):
            from_date = moments_by_id.get(previous.get("momentId"), {}).get("date")
            to_date = moments_by_id.get(current.get("momentId"), {}).get("date")
            days = _moment_date_diff_days(from_date, to_date)
            if days is None:
                continue
            if days < 0:
                entries.append(_issue(f"{name} wechselt laut Anwesenheit den Ort, aber das Zieldatum liegt vor dem Ausgangsdatum", "issuePresenceBackward", name=name))
            elif days == 0:
                entries.append(_issue(f"{name} wechselt laut Anwesenheit am selben Tag den Ort", "issuePresenceSameDay", name=name))
    return entries


def presence_consistency_issues(figures: dict[str, Any]) -> list[str]:
    return [text for text, _key, _params in _presence_issue_entries(figures)]


def validate_world(figures: dict[str, Any]) -> dict[str, Any]:
    nodes = {node.get("id") for node in figures.get("nodes") or []}
    moments = {moment.get("id") for moment in figures.get("timeline") or []}
    edges = figures.get("edges") or []
    presence = figures.get("presence") or []
    entries: list[tuple[str, str, dict[str, Any]]] = []
    seen: set[tuple[Any, ...]] = set()
    for edge in edges:
        edge_id = edge.get("id")
        if edge.get("from") not in nodes or edge.get("to") not in nodes:
            entries.append(_issue(f"Beziehung {edge_id} hat einen fehlenden Endpunkt", "issueMissingEndpoint", id=edge_id))
        key = (edge.get("from"), edge.get("to")) if edge.get("gerichtet") else tuple(sorted((edge.get("from"), edge.get("to"))))
        duplicate_key = (bool(edge.get("gerichtet")), *key)
        if duplicate_key in seen:
            entries.append(_issue(f"Beziehung {edge_id} ist strukturell doppelt", "issueDuplicateRelationship", id=edge_id))
        seen.add(duplicate_key)
        version_moments: set[Any] = set()
        for version in edge.get("versions") or []:
            moment_id = version.get("momentId")
            if moment_id not in moments:
                entries.append(_issue(f"Beziehung {edge_id} verweist auf einen fehlenden Zeitpunkt {moment_id}", "issueMissingMoment", id=edge_id, momentId=moment_id))
            if moment_id in version_moments:
                entries.append(_issue(f"Beziehung {edge_id} hat mehrere Stände am selben Zeitpunkt {moment_id}", "issueDuplicateMomentState", id=edge_id, momentId=moment_id))
            version_moments.add(moment_id)
    entries.extend(_presence_issue_entries(figures))
    issues = [text for text, _key, _params in entries]
    issue_items = [{"key": key, "params": params} for _text, key, params in entries]
    return {"issues": issues, "issueItems": issue_items, "inspected": {"elements": len(nodes), "relationships": len(edges), "timelineMoments": len(moments), "relationshipStates": sum(len(edge.get("versions") or []) for edge in edges), "presenceEntries": len(presence)}}


def audit_message(audit: dict[str, Any], contract: dict[str, Any]) -> str:
    inspected = audit["inspected"]
    prefix = (f"Strukturell vollständig geprüft: {inspected['relationships']} Beziehungen mit "
              f"{inspected['relationshipStates']} Zeitständen, {inspected['elements']} Elemente, "
              f"{inspected['timelineMoments']} Zeitpunkte und {inspected['presenceEntries']} Anwesenheits-Einträge.")
    if audit["issues"]:
        return prefix + " Gefunden: " + "; ".join(audit["issues"]) + ". Es wurde nichts geändert."
    return prefix + " Keine technischen Widersprüche gefunden. Ob Richtung und Beschriftung inhaltlich zur Geschichte passen, ist damit nicht geprüft; dafür müssen konkrete Manuskriptstellen als Belege ausgewertet werden."


def audit_reply(audit: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    """Same content as audit_message(), plus the messageKey/messageParams/messageItems
    triple the frontend needs to render it in the interface language (see
    src/features/assistant/AssistantDrawer.tsx's resolveAssistantMessage)."""
    inspected = audit["inspected"]
    params = {"relationships": inspected["relationships"], "relationshipStates": inspected["relationshipStates"], "elements": inspected["elements"], "timelineMoments": inspected["timelineMoments"], "presenceEntries": inspected["presenceEntries"]}
    if audit["issues"]:
        return {"message": audit_message(audit, contract), "messageKey": "auditFoundIssues", "messageParams": params, "messageItems": audit["issueItems"]}
    return {"message": audit_message(audit, contract), "messageKey": "auditNoIssues", "messageParams": params}


def validate_proposals(value: Any, figures: dict[str, Any], question: str = "") -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    allowed = {"create_element", "update_element", "create_timeline_moment", "create_relationship", "set_relationship_at_moment", "mark_deceased", "arrange_elements", "set_presence"}
    known_elements = {node.get("id") for node in figures.get("nodes") or []}
    element_aliases = {str(node.get("name", "")).casefold(): node.get("id") for node in figures.get("nodes") or []}
    known_moments = {moment.get("id") for moment in figures.get("timeline") or []}
    known_relationships = {edge.get("id") for edge in figures.get("edges") or []}
    existing_names = {_normal(node.get("name")) for node in figures.get("nodes") or []}
    existing_moments = {(_normal(moment.get("title")), _normal(moment.get("date"))) for moment in figures.get("timeline") or []}
    temporary = {proposal.get("tempId") for proposal in value if isinstance(proposal, dict) and proposal.get("kind") in {"create_element", "create_timeline_moment"} and isinstance(proposal.get("tempId"), str) and proposal["tempId"].startswith("new:")}
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
            proposal = {"kind": "arrange_elements", "strategy": "thematic" if proposal.get("strategy") != "grid" else "grid"}
        if kind in {"create_element", "create_timeline_moment"}:
            temp = proposal.get("tempId")
            if not isinstance(temp, str) or not temp.startswith("new:") or temp in seen_temporary:
                continue
            seen_temporary.add(temp)
            if kind == "create_element":
                element = proposal.get("element")
                if not isinstance(element, dict) or not str(element.get("name", "")).strip():
                    continue
                if len(str(element.get("name", ""))) > 160 or len(str(element.get("label", ""))) > 160 or len(str(element.get("sub", ""))) > 1000:
                    continue
                if _normal(element.get("name")) in existing_names:
                    continue
                if not isinstance(element.get("profile"), dict):
                    element["profile"] = {"notizen": str(element.get("profile") or "")}
                age = re.search(r"\b(\d{1,3})\s*(?:jahre?|years?)\b", question, re.IGNORECASE)
                if age and not element["profile"].get("alter"):
                    element["profile"]["alter"] = age.group(1)
            else:
                moment_value = proposal.get("moment")
                if not isinstance(moment_value, dict) or not str(moment_value.get("title", "")).strip() or len(str(moment_value.get("title", ""))) > 160 or len(str(moment_value.get("date", ""))) > 20 or len(str(moment_value.get("note", ""))) > 1000:
                    continue
                if (_normal(moment_value.get("title")), _normal(moment_value.get("date"))) in existing_moments:
                    continue
        elif kind == "update_element":
            if proposal.get("elementId") not in known_elements or not isinstance(proposal.get("patch"), dict):
                continue
            patch = proposal["patch"]
            clean_patch = {key: str(patch[key])[:limit] for key, limit in (("name", 160), ("label", 160), ("sub", 1000)) if isinstance(patch.get(key), str)}
            if isinstance(patch.get("profile"), dict):
                clean_patch["profile"] = {key: str(patch["profile"][key])[:4000] for key in ("alter", "rolle", "aussehen", "herkunft", "stimme", "notizen") if isinstance(patch["profile"].get(key), str)}
            if not clean_patch:
                continue
            proposal = {"kind": kind, "elementId": proposal["elementId"], "patch": clean_patch}
        elif kind == "set_relationship_at_moment" and (proposal.get("relationshipId") not in known_relationships or proposal.get("momentId") not in known_moments | temporary):
            continue
        elif kind == "mark_deceased" and (proposal.get("elementId") not in known_elements | temporary or proposal.get("momentId") not in known_moments | temporary):
            continue
        elif kind == "set_presence":
            element_id, place_id, moment_id = proposal.get("elementId"), proposal.get("placeId"), proposal.get("momentId")
            places = {node.get("id") for node in figures.get("nodes") or [] if node.get("type") == "ort"}
            if element_id not in known_elements | temporary or place_id not in places | temporary or (moment_id is not None and moment_id not in known_moments | temporary):
                continue
            proposal = {"kind": kind, "elementId": element_id, "placeId": place_id, **({"momentId": moment_id} if moment_id else {})}
        elif kind == "create_relationship":
            relation = proposal.get("relationship") or {}
            if not isinstance(relation, dict) or len(str(relation.get("label", ""))) > 160 or relation.get("style", "solid") not in {"solid", "dashed", "blood", "gold"}:
                continue
            for endpoint in ("from", "to"):
                endpoint_value = relation.get(endpoint)
                if endpoint_value not in known_elements and isinstance(endpoint_value, str) and endpoint_value.casefold() in element_aliases:
                    relation[endpoint] = element_aliases[endpoint_value.casefold()]
            if relation.get("from") not in known_elements | temporary or relation.get("to") not in known_elements | temporary or relation.get("from") == relation.get("to"):
                continue
            directed = bool(relation.get("directed"))
            duplicate = any(
                (bool(edge.get("gerichtet")) == directed and
                 ((directed and edge.get("from") == relation.get("from") and edge.get("to") == relation.get("to")) or
                  (not directed and {edge.get("from"), edge.get("to")} == {relation.get("from"), relation.get("to")})))
                for edge in figures.get("edges") or []
            )
            if duplicate:
                continue
        result.append(proposal)
    return result
