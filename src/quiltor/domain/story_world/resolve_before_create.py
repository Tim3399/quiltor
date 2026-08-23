"""Authoritative, idempotent decisions made before story-world creation.

The public mappings returned by the application layer are audit receipts.  They are
deliberately not accepted back as authority: code which applies a proposal must keep
the in-process decision, check its revision, or resolve again against the current
world.  This prevents model supplied ``checked`` or ``status`` fields from bypassing
the server-side decision.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any, Literal

from quiltor.domain.story_world.entity_resolution import normalize_entity_name, resolve_entity

ResolutionProofStatus = Literal["not_found", "resolved", "ambiguous", "invalid"]
EnsureOperation = Literal["element", "relationship", "timeline_moment", "presence", "alias"]
EnsureOutcome = Literal["create", "existing", "update", "unchanged", "ambiguous", "invalid"]

ENTITY_TYPES = frozenset({"person", "tier", "ort", "organisation", "objekt", "konzept"})
ALIAS_SOURCES = frozenset({"manual", "manuscript", "assistant", "import"})
RELATIONSHIP_STYLES = frozenset({"solid", "dashed", "blood", "gold"})
TIME_PRECISIONS = frozenset({"day", "month", "year"})
MAX_SAFE_WORLD_REVISION = 9_007_199_254_740_991
_PROOF_AUTHORITY = object()


class StaleResolutionProof(RuntimeError):
    """Raised when an authoritative decision targets an older/newer world state."""

    def __init__(self, checked_revision: int, current_revision: int) -> None:
        self.checked_revision = checked_revision
        self.current_revision = current_revision
        super().__init__(
            f"resolution checked world revision {checked_revision}, current revision is "
            f"{current_revision}"
        )


@dataclass(frozen=True)
class ResolutionProof:
    """Server-owned evidence that a resolution check actually ran."""

    checked: Literal[True]
    status: ResolutionProofStatus
    mention: str
    candidate_ids: tuple[str, ...]
    world_revision: int
    _authority: object = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.checked is not True or self._authority is not _PROOF_AUTHORITY:
            raise TypeError("resolution proofs can only be created by the domain resolver")


@dataclass(frozen=True)
class EnsureDecision:
    """One conservative create/update/no-op decision for a single logical object."""

    operation: EnsureOperation
    outcome: EnsureOutcome
    operation_satisfied: bool
    resolved_id: str | None
    canonical: dict[str, Any] | None
    proof: ResolutionProof


@dataclass(frozen=True)
class WorldResolutionContext:
    """A private snapshot of persisted and already-staged story-world objects."""

    story_world: dict[str, Any]
    world_revision: int

    def __post_init__(self) -> None:
        _require_revision(self.world_revision)
        if not isinstance(self.story_world, dict):
            raise TypeError("story_world must be a mapping snapshot")


def _require_revision(value: Any) -> int:
    if type(value) is not int or value < 0 or value > MAX_SAFE_WORLD_REVISION:
        raise ValueError("world_revision must be a non-negative safe integer")
    return value


def _stable_id(value: Mapping[str, Any]) -> str | None:
    for key in ("id", "tempId"):
        identifier = value.get(key)
        if isinstance(identifier, str) and identifier.strip():
            return identifier.strip()
    return None


def _unwrap_staged(value: Mapping[str, Any], nested_key: str | None) -> dict[str, Any]:
    if nested_key and isinstance(value.get(nested_key), Mapping):
        unwrapped = deepcopy(dict(value[nested_key]))
        if "tempId" not in unwrapped and isinstance(value.get("tempId"), str):
            unwrapped["tempId"] = value["tempId"]
        return unwrapped
    return deepcopy(dict(value))


def _synthetic_staged_id(collection: str, item: Mapping[str, Any]) -> str | None:
    """Give model proposal kinds without tempIds a stable, server-owned identity."""

    if collection == "relationships":
        source, target = item.get("from"), item.get("to")
        directed = item.get("gerichtet", item.get("directed", False))
        if not isinstance(source, str) or not isinstance(target, str) or type(directed) is not bool:
            return None
        endpoints = (source, target) if directed else tuple(sorted((source, target)))
        identity: Any = {"endpoints": endpoints, "directed": directed}
    elif collection == "presence":
        element = item.get("elementId")
        moment = item.get("momentId")
        if not isinstance(element, str) or (moment is not None and not isinstance(moment, str)):
            return None
        identity = {"elementId": element, "momentId": moment}
    else:
        return None
    encoded = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = sha256(encoded.encode("utf-8")).hexdigest()[:20]
    return f"staged:{collection}:{digest}"


def _normalized_staged(
    values: Sequence[Mapping[str, Any]],
    *,
    nested_key: str | None,
    collection: str,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for value in values:
        if not isinstance(value, Mapping):
            raise TypeError(f"staged {collection} entries must be mappings")
        item = _unwrap_staged(value, nested_key)
        identifier = _stable_id(item) or _synthetic_staged_id(collection, item)
        if identifier is None:
            raise ValueError(f"staged {collection} entries need a stable id or tempId")
        item["id"] = identifier
        if collection == "elements":
            aliases = item.get("aliases")
            if isinstance(aliases, list):
                item["aliases"] = [
                    {"alias": alias, "source": "assistant"}
                    if isinstance(alias, str)
                    else deepcopy(alias)
                    for alias in aliases
                ]
        if collection == "relationships" and "gerichtet" not in item:
            item["gerichtet"] = item.get("directed", False)
        normalized.append(item)
    return normalized


def _merge_collection(
    current: Any,
    staged: Sequence[Mapping[str, Any]],
    *,
    nested_key: str | None,
    collection: str,
) -> list[Any]:
    if current is None:
        existing: list[Any] = []
    elif isinstance(current, list):
        existing = deepcopy(current)
    else:
        raise TypeError(f"story_world {collection} must be a list")
    positions = {
        item["id"]: index
        for index, item in enumerate(existing)
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    for item in _normalized_staged(
        staged,
        nested_key=nested_key,
        collection=collection,
    ):
        identifier = item["id"]
        if identifier in positions:
            existing[positions[identifier]] = item
        else:
            positions[identifier] = len(existing)
            existing.append(item)
    return existing


def build_resolution_context(
    story_world: Mapping[str, Any],
    world_revision: int,
    *,
    staged_elements: Sequence[Mapping[str, Any]] = (),
    staged_relationships: Sequence[Mapping[str, Any]] = (),
    staged_moments: Sequence[Mapping[str, Any]] = (),
    staged_presence: Sequence[Mapping[str, Any]] = (),
) -> WorldResolutionContext:
    """Copy a world and fold accepted earlier proposals into its resolver view."""

    _require_revision(world_revision)
    if not isinstance(story_world, Mapping):
        raise TypeError("story_world must be a mapping")
    snapshot = deepcopy(dict(story_world))
    snapshot["nodes"] = _merge_collection(
        snapshot.get("nodes"),
        staged_elements,
        nested_key="element",
        collection="elements",
    )
    snapshot["edges"] = _merge_collection(
        snapshot.get("edges"),
        staged_relationships,
        nested_key="relationship",
        collection="relationships",
    )
    snapshot["timeline"] = _merge_collection(
        snapshot.get("timeline"),
        staged_moments,
        nested_key="moment",
        collection="moments",
    )
    snapshot["presence"] = _merge_collection(
        snapshot.get("presence"),
        staged_presence,
        nested_key=None,
        collection="presence",
    )
    return WorldResolutionContext(snapshot, world_revision)


def _proof(
    context: WorldResolutionContext,
    status: ResolutionProofStatus,
    mention: Any,
    candidate_ids: Sequence[Any] = (),
) -> ResolutionProof:
    return ResolutionProof(
        checked=True,
        status=status,
        mention=mention if isinstance(mention, str) else "",
        candidate_ids=tuple(
            sorted(
                {
                    identifier
                    for identifier in candidate_ids
                    if isinstance(identifier, str) and identifier
                }
            )
        ),
        world_revision=context.world_revision,
        _authority=_PROOF_AUTHORITY,
    )


def _decision(
    context: WorldResolutionContext,
    operation: EnsureOperation,
    outcome: EnsureOutcome,
    mention: Any,
    *,
    status: ResolutionProofStatus,
    candidate_ids: Sequence[Any] = (),
    resolved_id: str | None = None,
    canonical: dict[str, Any] | None = None,
    operation_satisfied: bool | None = None,
) -> EnsureDecision:
    satisfied = outcome in {"existing", "unchanged"}
    return EnsureDecision(
        operation=operation,
        outcome=outcome,
        operation_satisfied=satisfied if operation_satisfied is None else operation_satisfied,
        resolved_id=resolved_id,
        canonical=deepcopy(canonical),
        proof=_proof(context, status, mention, candidate_ids),
    )


def _mapping(value: Any) -> dict[str, Any] | None:
    return deepcopy(dict(value)) if isinstance(value, Mapping) else None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _resolution_candidate_ids(result: Any) -> list[str]:
    return [candidate.element_id for candidate in result.candidates]


def _node(context: WorldResolutionContext, identifier: str) -> dict[str, Any] | None:
    return next(
        (
            deepcopy(node)
            for node in context.story_world.get("nodes") or []
            if isinstance(node, dict) and node.get("id") == identifier
        ),
        None,
    )


def _alias_records(value: Any) -> tuple[list[str], list[dict[str, str]]] | None:
    if value is None:
        return [], []
    if not isinstance(value, list):
        return None
    aliases: list[str] = []
    records: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, str):
            alias = item
            source = "manual"
        elif isinstance(item, Mapping):
            alias = item.get("alias")
            source = item.get("source", "manual")
        else:
            alias = None
            source = None
        cleaned = _text(alias)
        if cleaned is None or not isinstance(source, str) or source not in ALIAS_SOURCES:
            return None
        aliases.append(cleaned)
        records.append({"alias": cleaned, "source": source})
    return aliases, records


def _candidate_changed(
    existing: Mapping[str, Any], candidate: Mapping[str, Any], keys: Sequence[str]
) -> bool:
    return any(key in candidate and candidate[key] != existing.get(key) for key in keys)


def ensure_element(
    context: WorldResolutionContext,
    candidate: Mapping[str, Any],
    *,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> EnsureDecision:
    """Decide whether an element candidate creates, updates, or reuses identity."""

    value = _mapping(candidate)
    name = _text(value.get("name")) if value is not None else None
    mention = name or ""
    entity_type = value.get("type") if value is not None else None
    alias_records = _alias_records(value.get("aliases")) if value is not None else None
    if (
        value is None
        or name is None
        or alias_records is None
        or (
            entity_type is not None
            and (not isinstance(entity_type, str) or entity_type not in ENTITY_TYPES)
        )
    ):
        return _decision(context, "element", "invalid", mention, status="invalid")
    aliases, canonical_aliases = alias_records

    results = [
        resolve_entity(
            context.story_world,
            surface,
            entity_type=entity_type,
            context_ids=context_ids,
            vocabulary=vocabulary,
        )
        for surface in (name, *aliases)
    ]
    candidate_ids = [
        identifier for result in results for identifier in _resolution_candidate_ids(result)
    ]
    resolved_ids = {
        result.resolved_id
        for result in results
        if result.status == "resolved" and result.resolved_id is not None
    }
    if any(result.status == "ambiguous" for result in results) or len(resolved_ids) > 1:
        return _decision(
            context,
            "element",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=candidate_ids,
        )
    value["name"] = name
    if entity_type is not None:
        value["type"] = entity_type
    if "aliases" in value:
        value["aliases"] = canonical_aliases
    if not resolved_ids:
        value.setdefault("type", "person")
        return _decision(
            context,
            "element",
            "create",
            mention,
            status="not_found",
            canonical=value,
        )

    resolved_id = next(iter(resolved_ids))
    existing = _node(context, resolved_id)
    if existing is None:
        return _decision(context, "element", "invalid", mention, status="invalid")
    mutable = ("label", "sub", "profile", "accent", "dash", "pinned")
    if _candidate_changed(existing, value, mutable):
        canonical = {**existing, **{key: value[key] for key in mutable if key in value}}
        return _decision(
            context,
            "element",
            "update",
            mention,
            status="resolved",
            candidate_ids=candidate_ids,
            resolved_id=resolved_id,
            canonical=canonical,
        )
    return _decision(
        context,
        "element",
        "existing",
        mention,
        status="resolved",
        candidate_ids=candidate_ids,
        resolved_id=resolved_id,
        canonical=existing,
    )


def _resolved_reference(
    context: WorldResolutionContext,
    value: Any,
    *,
    entity_type: str | None = None,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> Any:
    return resolve_entity(
        context.story_world,
        value if isinstance(value, str) else "",
        entity_type=entity_type,
        context_ids=context_ids,
        vocabulary=vocabulary,
    )


def _directed(value: Mapping[str, Any]) -> bool | None:
    supplied = [value[key] for key in ("directed", "gerichtet") if key in value]
    if any(type(item) is not bool for item in supplied):
        return None
    if len(supplied) == 2 and supplied[0] != supplied[1]:
        return None
    return supplied[0] if supplied else False


def _edge_directed(edge: Mapping[str, Any]) -> bool:
    return bool(edge.get("gerichtet", edge.get("directed", False)))


def _same_edge(edge: Mapping[str, Any], source: str, target: str, directed: bool) -> bool:
    if _edge_directed(edge) != directed:
        return False
    if directed:
        return edge.get("from") == source and edge.get("to") == target
    return {edge.get("from"), edge.get("to")} == {source, target}


def ensure_relationship(
    context: WorldResolutionContext,
    candidate: Mapping[str, Any],
    *,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> EnsureDecision:
    """Resolve both endpoints and ensure one logical directed/undirected edge."""

    value = _mapping(candidate)
    source_value = value.get("from") if value is not None else None
    target_value = value.get("to") if value is not None else None
    mention = (
        f"{source_value} -> {target_value}"
        if isinstance(source_value, str) and isinstance(target_value, str)
        else ""
    )
    directed = _directed(value) if value is not None else None
    if (
        value is None
        or not _text(source_value)
        or not _text(target_value)
        or directed is None
        or ("label" in value and not isinstance(value["label"], str))
        or not isinstance(value.get("style", "solid"), str)
        or value.get("style", "solid") not in RELATIONSHIP_STYLES
    ):
        return _decision(context, "relationship", "invalid", mention, status="invalid")
    source = _resolved_reference(
        context,
        source_value,
        context_ids=context_ids,
        vocabulary=vocabulary,
    )
    target = _resolved_reference(
        context,
        target_value,
        context_ids=context_ids,
        vocabulary=vocabulary,
    )
    candidates = [*_resolution_candidate_ids(source), *_resolution_candidate_ids(target)]
    if source.status == "ambiguous" or target.status == "ambiguous":
        return _decision(
            context,
            "relationship",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=candidates,
        )
    if source.status != "resolved" or target.status != "resolved":
        return _decision(
            context,
            "relationship",
            "invalid",
            mention,
            status="invalid",
            candidate_ids=candidates,
        )
    source_id, target_id = source.resolved_id, target.resolved_id
    if source_id is None or target_id is None or source_id == target_id:
        return _decision(
            context,
            "relationship",
            "invalid",
            mention,
            status="invalid",
            candidate_ids=candidates,
        )
    canonical = deepcopy(value)
    canonical.pop("gerichtet", None)
    canonical.update(
        {
            "from": source_id,
            "to": target_id,
            "directed": directed,
            "label": value.get("label", ""),
            "style": value.get("style", "solid"),
        }
    )
    matches = [
        edge
        for edge in context.story_world.get("edges") or []
        if isinstance(edge, dict) and _same_edge(edge, source_id, target_id, directed)
    ]
    edge_ids = [edge.get("id") for edge in matches]
    if not matches:
        return _decision(
            context,
            "relationship",
            "create",
            mention,
            status="not_found",
            canonical=canonical,
        )
    if len(matches) > 1:
        return _decision(
            context,
            "relationship",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=edge_ids,
        )
    existing, resolved_id = deepcopy(matches[0]), matches[0].get("id")
    if not isinstance(resolved_id, str) or not resolved_id:
        return _decision(context, "relationship", "invalid", mention, status="invalid")
    changed = ("label" in value and value["label"] != existing.get("label", "")) or (
        "style" in value and value["style"] != existing.get("style", "solid")
    )
    existing_canonical = {
        **existing,
        "from": source_id,
        "to": target_id,
        "directed": directed,
    }
    existing_canonical.pop("gerichtet", None)
    if changed:
        existing_canonical.update(
            {key: canonical[key] for key in ("label", "style") if key in value}
        )
    return _decision(
        context,
        "relationship",
        "update" if changed else "unchanged",
        mention,
        status="resolved",
        candidate_ids=[resolved_id],
        resolved_id=resolved_id,
        canonical=existing_canonical,
    )


def _valid_moment_candidate(value: Mapping[str, Any]) -> bool:
    if "date" in value and not isinstance(value["date"], str):
        return False
    if "note" in value and not isinstance(value["note"], str):
        return False
    for key in ("time", "endTime"):
        if key in value and (
            type(value[key]) is not int or abs(value[key]) > MAX_SAFE_WORLD_REVISION
        ):
            return False
    if "endTime" in value and "time" in value and value["endTime"] < value["time"]:
        return False
    if "precision" in value and (
        not isinstance(value["precision"], str) or value["precision"] not in TIME_PRECISIONS
    ):
        return False
    return "endPrecision" not in value or (
        isinstance(value["endPrecision"], str) and value["endPrecision"] in TIME_PRECISIONS
    )


def _moment_identity_match(moment: Mapping[str, Any], candidate: Mapping[str, Any]) -> bool:
    if normalize_entity_name(moment.get("title")) != normalize_entity_name(candidate.get("title")):
        return False
    if "time" in candidate:
        return moment.get("time") == candidate["time"]
    date = candidate.get("date")
    if isinstance(date, str) and date.strip():
        return isinstance(moment.get("date"), str) and moment["date"].strip() == date.strip()
    return True


def ensure_timeline_moment(
    context: WorldResolutionContext,
    candidate: Mapping[str, Any],
) -> EnsureDecision:
    """Ensure a moment by exact id or conservative title/time/date identity."""

    value = _mapping(candidate)
    identifier = _stable_id(value) if value is not None else None
    title = _text(value.get("title")) if value is not None else None
    mention = title or identifier or ""
    if value is None or not _valid_moment_candidate(value):
        return _decision(context, "timeline_moment", "invalid", mention, status="invalid")
    moments = [item for item in context.story_world.get("timeline") or [] if isinstance(item, dict)]
    if identifier is not None:
        exact = [item for item in moments if item.get("id") == identifier]
        if exact:
            existing = deepcopy(exact[0])
            changed = _candidate_changed(
                existing,
                value,
                ("title", "date", "note", "time", "endTime", "precision", "endPrecision"),
            )
            canonical = {**existing, **value, "id": identifier}
            return _decision(
                context,
                "timeline_moment",
                "update" if changed else "unchanged",
                mention,
                status="resolved",
                candidate_ids=[identifier],
                resolved_id=identifier,
                canonical=canonical,
            )
        if title is None:
            return _decision(context, "timeline_moment", "invalid", mention, status="invalid")
    if title is None:
        return _decision(context, "timeline_moment", "invalid", mention, status="invalid")
    value["title"] = title
    matches = [moment for moment in moments if _moment_identity_match(moment, value)]
    moment_ids = [moment.get("id") for moment in matches]
    if not matches:
        return _decision(
            context,
            "timeline_moment",
            "create",
            mention,
            status="not_found",
            canonical=value,
        )
    if len(matches) > 1:
        return _decision(
            context,
            "timeline_moment",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=moment_ids,
        )
    existing, resolved_id = deepcopy(matches[0]), matches[0].get("id")
    if not isinstance(resolved_id, str) or not resolved_id:
        return _decision(context, "timeline_moment", "invalid", mention, status="invalid")
    mutable = ("note", "endTime", "precision", "endPrecision")
    changed = _candidate_changed(existing, value, mutable)
    canonical = {**existing, **{key: value[key] for key in mutable if key in value}}
    return _decision(
        context,
        "timeline_moment",
        "update" if changed else "unchanged",
        mention,
        status="resolved",
        candidate_ids=[resolved_id],
        resolved_id=resolved_id,
        canonical=canonical,
    )


def _moment_exists(context: WorldResolutionContext, identifier: str) -> bool:
    return any(
        isinstance(moment, dict) and moment.get("id") == identifier
        for moment in context.story_world.get("timeline") or []
    )


def ensure_presence(
    context: WorldResolutionContext,
    candidate: Mapping[str, Any],
    *,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> EnsureDecision:
    """Ensure the unique presence row for an element at an optional moment."""

    value = _mapping(candidate)
    raw_element = value.get("elementId") if value is not None else None
    raw_place = value.get("placeId") if value is not None else None
    raw_moment = value.get("momentId") if value is not None else None
    mention = (
        f"{raw_element} @ {raw_place}" + (f" [{raw_moment}]" if raw_moment else "")
        if isinstance(raw_element, str) and isinstance(raw_place, str)
        else ""
    )
    if (
        value is None
        or not _text(raw_element)
        or not _text(raw_place)
        or (raw_moment is not None and not _text(raw_moment))
    ):
        return _decision(context, "presence", "invalid", mention, status="invalid")
    element = _resolved_reference(
        context,
        raw_element,
        context_ids=context_ids,
        vocabulary=vocabulary,
    )
    place = _resolved_reference(
        context,
        raw_place,
        entity_type="ort",
        context_ids=context_ids,
        vocabulary=vocabulary,
    )
    candidates = [*_resolution_candidate_ids(element), *_resolution_candidate_ids(place)]
    if element.status == "ambiguous" or place.status == "ambiguous":
        return _decision(
            context,
            "presence",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=candidates,
        )
    if (
        element.status != "resolved"
        or place.status != "resolved"
        or (raw_moment is not None and not _moment_exists(context, raw_moment))
    ):
        return _decision(
            context,
            "presence",
            "invalid",
            mention,
            status="invalid",
            candidate_ids=candidates,
        )
    element_id, place_id = element.resolved_id, place.resolved_id
    if element_id is None or place_id is None:
        return _decision(context, "presence", "invalid", mention, status="invalid")
    canonical = {"elementId": element_id, "placeId": place_id}
    if raw_moment is not None:
        canonical["momentId"] = raw_moment
    matches = [
        item
        for item in context.story_world.get("presence") or []
        if isinstance(item, dict)
        and item.get("elementId") == element_id
        and item.get("momentId") == raw_moment
    ]
    presence_ids = [item.get("id") for item in matches]
    if not matches:
        return _decision(
            context,
            "presence",
            "create",
            mention,
            status="not_found",
            canonical=canonical,
        )
    if len(matches) > 1:
        return _decision(
            context,
            "presence",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=presence_ids,
        )
    existing, resolved_id = deepcopy(matches[0]), matches[0].get("id")
    if not isinstance(resolved_id, str) or not resolved_id:
        return _decision(context, "presence", "invalid", mention, status="invalid")
    changed = existing.get("placeId") != place_id
    canonical = {**existing, **canonical, "id": resolved_id}
    return _decision(
        context,
        "presence",
        "update" if changed else "unchanged",
        mention,
        status="resolved",
        candidate_ids=[resolved_id],
        resolved_id=resolved_id,
        canonical=canonical,
    )


def ensure_alias(
    context: WorldResolutionContext,
    candidate: Mapping[str, Any],
    *,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> EnsureDecision:
    """Ensure one alias while refusing collisions with another entity identity."""

    value = _mapping(candidate)
    raw_owner = value.get("elementId") if value is not None else None
    alias = _text(value.get("alias")) if value is not None else None
    source = value.get("source", "manual") if value is not None else None
    mention = alias or ""
    if (
        value is None
        or not _text(raw_owner)
        or alias is None
        or not isinstance(source, str)
        or source not in ALIAS_SOURCES
    ):
        return _decision(context, "alias", "invalid", mention, status="invalid")
    owner = _resolved_reference(
        context,
        raw_owner,
        context_ids=context_ids,
        vocabulary=vocabulary,
    )
    owner_candidates = _resolution_candidate_ids(owner)
    if owner.status == "ambiguous":
        return _decision(
            context,
            "alias",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=owner_candidates,
        )
    if owner.status != "resolved" or owner.resolved_id is None:
        return _decision(
            context,
            "alias",
            "invalid",
            mention,
            status="invalid",
            candidate_ids=owner_candidates,
        )
    owner_node = _node(context, owner.resolved_id)
    if owner_node is None:
        return _decision(context, "alias", "invalid", mention, status="invalid")
    alias_result = _resolved_reference(
        context,
        alias,
        entity_type=owner_node.get("type", "person"),
        context_ids=context_ids,
        vocabulary=vocabulary,
    )
    alias_candidates = _resolution_candidate_ids(alias_result)
    canonical = {"elementId": owner.resolved_id, "alias": alias, "source": source}
    if alias_result.status == "not_found":
        return _decision(
            context,
            "alias",
            "create",
            mention,
            status="not_found",
            canonical=canonical,
        )
    if alias_result.status == "ambiguous":
        return _decision(
            context,
            "alias",
            "ambiguous",
            mention,
            status="ambiguous",
            candidate_ids=alias_candidates,
            canonical=canonical,
        )
    resolved_id = alias_result.resolved_id
    if resolved_id == owner.resolved_id:
        return _decision(
            context,
            "alias",
            "unchanged",
            mention,
            status="resolved",
            candidate_ids=alias_candidates,
            resolved_id=resolved_id,
            canonical=canonical,
        )
    return _decision(
        context,
        "alias",
        "existing",
        mention,
        status="resolved",
        candidate_ids=alias_candidates,
        resolved_id=resolved_id,
        canonical=canonical,
        operation_satisfied=False,
    )


def require_current_world_revision(proof: ResolutionProof, current_world_revision: int) -> None:
    """Reject forged receipts and decisions made against a stale world snapshot."""

    if not isinstance(proof, ResolutionProof) or proof._authority is not _PROOF_AUTHORITY:
        raise TypeError("an authoritative in-process resolution proof is required")
    current = _require_revision(current_world_revision)
    if proof.world_revision != current:
        raise StaleResolutionProof(proof.world_revision, current)


__all__ = [
    "EnsureDecision",
    "EnsureOperation",
    "EnsureOutcome",
    "ResolutionProof",
    "ResolutionProofStatus",
    "StaleResolutionProof",
    "WorldResolutionContext",
    "build_resolution_context",
    "ensure_alias",
    "ensure_element",
    "ensure_presence",
    "ensure_relationship",
    "ensure_timeline_moment",
    "require_current_world_revision",
]
