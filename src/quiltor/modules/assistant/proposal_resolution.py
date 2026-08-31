"""Server-owned resolve-before-create processing for assistant proposals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from quiltor.domain.story_world.resolve_before_create import (
    EnsureDecision,
    build_resolution_context,
    ensure_element,
    ensure_presence,
    ensure_relationship,
    ensure_timeline_moment,
)
from quiltor.modules.assistant.audit import validate_proposals
from quiltor.modules.assistant.contract import required_proposal_kinds
from quiltor.modules.assistant.relationship_appearance import (
    legacy_domain_style,
    normalize_relationship_appearance,
)


@dataclass(frozen=True)
class ProposalResolutionResult:
    proposals: list[dict[str, Any]]
    satisfied_kinds: frozenset[str]
    decisions: tuple[EnsureDecision, ...]
    clarification: dict[str, Any] | None
    discarded: int


_PROFILE_KEYS = ("alter", "rolle", "aussehen", "herkunft", "stimme", "notizen")


def _clean_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    return value[:limit]


def _clean_aliases(value: Any) -> list[dict[str, str]] | None:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 16:
        return None
    aliases: list[dict[str, str]] = []
    normalized: set[str] = set()
    for item in value:
        raw = item.get("alias") if isinstance(item, dict) else item
        if not isinstance(raw, str):
            return None
        alias = raw.strip()[:160]
        key = " ".join(alias.casefold().split())
        if not alias or key in normalized:
            continue
        normalized.add(key)
        aliases.append({"alias": alias, "source": "assistant"})
    return aliases


def _element_candidate(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    name = _clean_text(value.get("name"), 160)
    if name is None or not name.strip():
        return None
    candidate: dict[str, Any] = {"name": name}
    if isinstance(value.get("type"), str):
        candidate["type"] = value["type"]
    for key, limit in (("label", 160), ("sub", 1000)):
        cleaned = _clean_text(value.get(key), limit)
        if cleaned is not None:
            candidate[key] = cleaned
    profile = value.get("profile")
    if isinstance(profile, dict):
        candidate["profile"] = {
            key: str(profile[key])[:4000]
            for key in _PROFILE_KEYS
            if isinstance(profile.get(key), str)
        }
    elif profile is not None:
        candidate["profile"] = {"notizen": str(profile)[:4000]}
    aliases = _clean_aliases(value.get("aliases"))
    if aliases is None:
        return None
    if "aliases" in value:
        candidate["aliases"] = aliases
    return candidate


def _moment_candidate(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    title = _clean_text(value.get("title"), 160)
    if title is None or not title.strip():
        return None
    candidate = {"title": title}
    for key, limit in (("date", 20), ("note", 1000)):
        cleaned = _clean_text(value.get(key), limit)
        if cleaned is not None:
            candidate[key] = cleaned
    return candidate


def _relationship_candidate(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    source, target = value.get("from"), value.get("to")
    if not isinstance(source, str) or not isinstance(target, str):
        return None
    if type(value.get("directed", False)) is not bool:
        return None
    appearance = normalize_relationship_appearance(value, defaults=True)
    if appearance is None:
        return None
    label = _clean_text(value.get("label", ""), 160)
    if label is None:
        return None
    return {
        "from": source,
        "to": target,
        "label": label,
        "directed": value.get("directed", False),
        **appearance,
    }


def _domain_relationship_candidate(value: dict[str, Any]) -> dict[str, Any]:
    """Adapt a v2 assistant candidate to the still-v1 domain resolver boundary."""

    return {
        key: value[key] for key in ("from", "to", "label", "directed") if key in value
    } | {"style": legacy_domain_style(value)}


def _presence_candidate(value: dict[str, Any]) -> dict[str, Any] | None:
    element_id, place_id = value.get("elementId"), value.get("placeId")
    if not isinstance(element_id, str) or not isinstance(place_id, str):
        return None
    candidate = {"elementId": element_id, "placeId": place_id}
    if isinstance(value.get("momentId"), str):
        candidate["momentId"] = value["momentId"]
    return candidate


def _safe_non_ensure(value: dict[str, Any]) -> dict[str, Any] | None:
    kind = value.get("kind")
    if kind == "update_element":
        patch = value.get("patch")
        if not isinstance(patch, dict):
            return None
        clean_patch: dict[str, Any] = {}
        for key, limit in (("name", 160), ("label", 160), ("sub", 1000)):
            cleaned = _clean_text(patch.get(key), limit)
            if cleaned is not None:
                clean_patch[key] = cleaned
        profile = patch.get("profile")
        if isinstance(profile, dict):
            clean_patch["profile"] = {
                key: str(profile[key])[:4000]
                for key in _PROFILE_KEYS
                if isinstance(profile.get(key), str)
            }
        aliases = _clean_aliases(patch.get("aliases"))
        if aliases is None:
            return None
        if "aliases" in patch:
            clean_patch["aliases"] = aliases
        return {
            "kind": kind,
            "elementId": value.get("elementId"),
            "patch": clean_patch,
        }
    if kind == "set_relationship_at_moment":
        patch = value.get("patch")
        if not isinstance(patch, dict):
            return None
        clean_patch: dict[str, Any] = {}
        label = _clean_text(patch.get("label"), 160)
        if label is not None:
            clean_patch["label"] = label
        for key in ("active", "directed"):
            if type(patch.get(key)) is bool:
                clean_patch[key] = patch[key]
        appearance = normalize_relationship_appearance(patch)
        if appearance is None:
            return None
        clean_patch.update(appearance)
        return {
            "kind": kind,
            "relationshipId": value.get("relationshipId"),
            "momentId": value.get("momentId"),
            "patch": clean_patch,
        }
    if kind == "mark_deceased":
        return {
            "kind": kind,
            "elementId": value.get("elementId"),
            "momentId": value.get("momentId"),
        }
    if kind == "arrange_elements":
        return {
            "kind": kind,
            "strategy": "grid" if value.get("strategy") == "grid" else "thematic",
        }
    return None


def _clarification_candidates(
    figures: dict[str, Any], candidate_ids: tuple[str, ...]
) -> list[dict[str, str]]:
    nodes = {
        str(item.get("id")): {
            "id": str(item.get("id")),
            "name": str(item.get("name") or item.get("id")),
            "kind": str(item.get("type") or "person"),
        }
        for item in figures.get("nodes") or []
        if isinstance(item, dict) and item.get("id")
    }
    moments = {
        str(item.get("id")): {
            "id": str(item.get("id")),
            "name": str(item.get("title") or item.get("id")),
            "kind": "timeline_moment",
        }
        for item in figures.get("timeline") or []
        if isinstance(item, dict) and item.get("id")
    }
    edges = {
        str(item.get("id")): {
            "id": str(item.get("id")),
            "name": str(item.get("label") or f"{item.get('from', '?')} → {item.get('to', '?')}"),
            "kind": "relationship",
        }
        for item in figures.get("edges") or []
        if isinstance(item, dict) and item.get("id")
    }
    presence = {
        str(item.get("id")): {
            "id": str(item.get("id")),
            "name": f"{item.get('elementId', '?')} @ {item.get('placeId', '?')}",
            "kind": "presence",
        }
        for item in figures.get("presence") or []
        if isinstance(item, dict) and item.get("id")
    }
    by_id = {**presence, **edges, **moments, **nodes}
    return [
        by_id.get(item, {"id": item, "name": item, "kind": "world_element"})
        for item in candidate_ids
    ][:8]


def decision_trace(decision: EnsureDecision) -> dict[str, Any]:
    proof = decision.proof
    return {
        "step": "resolve_before_create",
        "operation": decision.operation,
        "outcome": decision.outcome,
        "operationSatisfied": decision.operation_satisfied,
        "resolvedId": decision.resolved_id,
        "proof": {
            "checked": proof.checked,
            "status": proof.status,
            "mention": proof.mention,
            "candidateIds": list(proof.candidate_ids),
            "worldRevision": proof.world_revision,
        },
    }


def _element_update(decision: EnsureDecision, candidate: dict[str, Any]) -> dict[str, Any] | None:
    if decision.resolved_id is None:
        return None
    patch = {
        key: candidate[key] for key in ("label", "sub", "profile", "aliases") if key in candidate
    }
    if not patch:
        return None
    return {"kind": "update_element", "elementId": decision.resolved_id, "patch": patch}


def resolve_proposals(
    value: Any,
    figures: dict[str, Any],
    question: str = "",
    *,
    world_revision: int = 0,
) -> ProposalResolutionResult:
    """Resolve every create-like proposal against persisted and earlier staged state."""

    if not isinstance(value, list):
        return ProposalResolutionResult([], frozenset(), (), None, 0)
    required = required_proposal_kinds(question)
    accepted: list[dict[str, Any]] = []
    satisfied: set[str] = set()
    decisions: list[EnsureDecision] = []
    staged_elements: list[dict[str, Any]] = []
    staged_relationships: list[dict[str, Any]] = []
    staged_moments: list[dict[str, Any]] = []
    staged_presence: list[dict[str, Any]] = []
    seen_temporary: set[str] = set()
    resolved_temporary_elements: dict[str, str] = {}
    resolved_temporary_moments: dict[str, str] = {}
    discarded = max(0, len(value) - 20)

    for index, raw in enumerate(value[:20]):
        if not isinstance(raw, dict):
            discarded += 1
            continue
        kind = raw.get("kind")
        if required and kind not in required:
            discarded += 1
            continue
        context = build_resolution_context(
            figures,
            world_revision,
            staged_elements=staged_elements,
            staged_relationships=staged_relationships,
            staged_moments=staged_moments,
            staged_presence=staged_presence,
        )
        decision: EnsureDecision | None = None
        proposal: dict[str, Any] | None = None

        if kind == "create_element":
            temp_id = raw.get("tempId")
            candidate = _element_candidate(raw.get("element"))
            if (
                not isinstance(temp_id, str)
                or not temp_id.startswith("new:")
                or temp_id in seen_temporary
                or candidate is None
            ):
                discarded += 1
                continue
            seen_temporary.add(temp_id)
            decision = ensure_element(context, candidate)
            if decision.resolved_id is not None:
                resolved_temporary_elements[temp_id] = decision.resolved_id
            if decision.outcome == "create" and decision.canonical is not None:
                resolved_temporary_elements[temp_id] = temp_id
                proposal = {
                    "kind": kind,
                    "tempId": temp_id,
                    "element": _element_candidate(decision.canonical),
                }
            elif decision.outcome == "update":
                proposal = _element_update(decision, candidate)
                satisfied.add(kind)
        elif kind == "create_timeline_moment":
            temp_id = raw.get("tempId")
            candidate = _moment_candidate(raw.get("moment"))
            if (
                not isinstance(temp_id, str)
                or not temp_id.startswith("new:")
                or temp_id in seen_temporary
                or candidate is None
            ):
                discarded += 1
                continue
            seen_temporary.add(temp_id)
            decision = ensure_timeline_moment(context, candidate)
            if decision.resolved_id is not None:
                resolved_temporary_moments[temp_id] = decision.resolved_id
            if decision.outcome == "create" and decision.canonical is not None:
                resolved_temporary_moments[temp_id] = temp_id
                proposal = {
                    "kind": kind,
                    "tempId": temp_id,
                    "moment": _moment_candidate(decision.canonical),
                }
        elif kind == "create_relationship":
            candidate = _relationship_candidate(raw.get("relationship"))
            if candidate is None:
                discarded += 1
                continue
            candidate["from"] = resolved_temporary_elements.get(
                candidate["from"], candidate["from"]
            )
            candidate["to"] = resolved_temporary_elements.get(candidate["to"], candidate["to"])
            decision = ensure_relationship(context, _domain_relationship_candidate(candidate))
            if decision.outcome == "create" and decision.canonical is not None:
                proposal = {
                    "kind": kind,
                    "relationship": _relationship_candidate(
                        {
                            **decision.canonical,
                            **{
                                key: candidate[key]
                                for key in ("lineStyle", "relationshipKind", "color")
                            },
                        }
                    ),
                }
        elif kind == "set_presence":
            candidate = _presence_candidate(raw)
            if candidate is None:
                discarded += 1
                continue
            candidate["elementId"] = resolved_temporary_elements.get(
                candidate["elementId"], candidate["elementId"]
            )
            candidate["placeId"] = resolved_temporary_elements.get(
                candidate["placeId"], candidate["placeId"]
            )
            if "momentId" in candidate:
                candidate["momentId"] = resolved_temporary_moments.get(
                    candidate["momentId"], candidate["momentId"]
                )
            decision = ensure_presence(context, candidate)
            if decision.outcome in {"create", "update"} and decision.canonical is not None:
                canonical = _presence_candidate(decision.canonical)
                proposal = {"kind": kind, **canonical} if canonical is not None else None
        else:
            safe = _safe_non_ensure(raw)
            if safe is not None:
                for key in ("elementId",):
                    if isinstance(safe.get(key), str):
                        safe[key] = resolved_temporary_elements.get(safe[key], safe[key])
                if isinstance(safe.get("momentId"), str):
                    safe["momentId"] = resolved_temporary_moments.get(
                        safe["momentId"], safe["momentId"]
                    )
            valid = validate_proposals([safe] if safe else [], context.story_world, question)
            if valid:
                proposal = valid[0]

        if decision is not None:
            decisions.append(decision)
            if decision.outcome == "ambiguous":
                candidates = _clarification_candidates(
                    context.story_world, decision.proof.candidate_ids
                )
                return ProposalResolutionResult(
                    [],
                    frozenset(satisfied),
                    tuple(decisions),
                    {"candidates": candidates},
                    discarded + 1,
                )
            if decision.operation_satisfied or decision.outcome == "update":
                satisfied.add(str(kind))
            if decision.outcome == "invalid":
                discarded += 1
                continue

        if proposal is None or any(value is None for value in proposal.values()):
            if decision is None or decision.outcome not in {"existing", "unchanged", "update"}:
                discarded += 1
            continue
        valid = validate_proposals([proposal], context.story_world, "")
        if not valid and proposal.get("kind") != "update_element":
            discarded += 1
            continue
        proposal = valid[0] if valid else proposal
        accepted.append(proposal)
        satisfied.add(str(kind))
        output_kind = proposal.get("kind")
        if output_kind == "create_element":
            staged_elements.append(proposal)
        elif output_kind == "create_timeline_moment":
            staged_moments.append(proposal)
        elif output_kind == "create_relationship":
            staged_relationships.append(
                {"id": f"new:relationship:{index}", **proposal["relationship"]}
            )
        elif output_kind == "set_presence":
            staged_presence.append({"id": f"new:presence:{index}", **proposal})
        elif output_kind == "update_element" and decision and decision.canonical:
            staged_elements.append(decision.canonical)

    return ProposalResolutionResult(
        accepted,
        frozenset(satisfied),
        tuple(decisions),
        None,
        discarded,
    )


__all__ = [
    "ProposalResolutionResult",
    "decision_trace",
    "resolve_proposals",
]
