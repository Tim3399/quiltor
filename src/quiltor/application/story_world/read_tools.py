"""Bounded, transport-neutral read tools over immutable world snapshots.

Only the six names in :data:`READ_TOOL_NAMES` are dispatchable.  The service has no
repository, filesystem, network, SQL, mutation, apply, or delete capability.  Hosts
may expose the same catalog to a local model or MCP without copying integrity rules.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any, Literal, Protocol, runtime_checkable

from quiltor.application.story_world.queries import StoryWorldQueries
from quiltor.application.story_world.use_cases import StoryWorldUseCases

ReadToolName = Literal[
    "resolve_entity",
    "get_entity",
    "get_relationships",
    "find_timeline_events",
    "get_world_state",
    "search_manuscript",
]

READ_TOOL_NAMES: tuple[ReadToolName, ...] = (
    "resolve_entity",
    "get_entity",
    "get_relationships",
    "find_timeline_events",
    "get_world_state",
    "search_manuscript",
)
MAX_READ_TOOL_CALLS = 6
MAX_READ_TOOL_OUTPUT_BYTES = 16_384
MAX_RESOLUTION_CANDIDATES = 8
MAX_RESULT_ITEMS = 12
MAX_SEARCH_RESULTS = 8
MAX_CONTEXT_IDS = 12
MAX_VOCABULARY_ITEMS = 32
MAX_CHAPTER_IDS = 32
MAX_ENTITY_ALIASES = 8
MAX_RELATIONSHIP_VERSIONS = 6
MAX_TEXT_LENGTH = 1_400
MAX_IDENTIFIER_LENGTH = 200
MAX_QUERY_LENGTH = 500
MAX_MENTION_LENGTH = 160
MAX_VOCABULARY_LENGTH = 80
MAX_SAFE_REVISION = 9_007_199_254_740_991
ENTITY_TYPES = ("person", "tier", "ort", "organisation", "objekt", "konzept")


class _ReadToolInputError(ValueError):
    pass


@runtime_checkable
class ReadToolExecutor(Protocol):
    """Injection boundary for a future backend-controlled model tool loop."""

    def catalog(self) -> tuple[dict[str, Any], ...]: ...

    def execute(
        self,
        name: str,
        arguments: Mapping[str, Any],
        *,
        manuscript: Mapping[str, Any],
        figures: Mapping[str, Any],
        world_revision: int,
    ) -> dict[str, Any]: ...

    def execute_many(
        self,
        calls: Sequence[Mapping[str, Any]],
        *,
        manuscript: Mapping[str, Any],
        figures: Mapping[str, Any],
        world_revision: int,
    ) -> tuple[dict[str, Any], ...]: ...


def _object_schema(properties: dict[str, Any], required: Sequence[str] = ()) -> dict[str, Any]:
    return {
        "type": "object",
        "required": list(required),
        "additionalProperties": False,
        "properties": deepcopy(properties),
    }


def _text_schema(maximum: int, *, minimum: int = 1) -> dict[str, Any]:
    return {"type": "string", "minLength": minimum, "maxLength": maximum}


def _id_list_schema(maximum: int) -> dict[str, Any]:
    return {
        "type": "array",
        "maxItems": maximum,
        "uniqueItems": True,
        "items": _text_schema(MAX_IDENTIFIER_LENGTH),
    }


def read_tool_catalog() -> tuple[dict[str, Any], ...]:
    """Return fresh strict schemas so callers cannot mutate the canonical catalog."""

    shared = {"maxOutputBytes": MAX_READ_TOOL_OUTPUT_BYTES}
    return (
        {
            "name": "resolve_entity",
            "description": "Resolve one entity id, name, or alias without guessing ties.",
            "inputSchema": _object_schema(
                {
                    "mention": _text_schema(MAX_MENTION_LENGTH),
                    "entityType": {"type": "string", "enum": list(ENTITY_TYPES)},
                    "contextIds": _id_list_schema(MAX_CONTEXT_IDS),
                    "vocabulary": {
                        "type": "array",
                        "maxItems": MAX_VOCABULARY_ITEMS,
                        "uniqueItems": True,
                        "items": _text_schema(MAX_VOCABULARY_LENGTH),
                    },
                },
                ("mention",),
            ),
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {**shared, "maxCandidates": MAX_RESOLUTION_CANDIDATES},
        },
        {
            "name": "get_entity",
            "description": "Read one entity by an already resolved exact canonical id.",
            "inputSchema": _object_schema(
                {"elementId": _text_schema(MAX_IDENTIFIER_LENGTH)},
                ("elementId",),
            ),
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {**shared, "maxAliases": MAX_ENTITY_ALIASES},
        },
        {
            "name": "get_relationships",
            "description": "Read bounded relationships touching one exact entity id.",
            "inputSchema": _object_schema(
                {
                    "elementId": _text_schema(MAX_IDENTIFIER_LENGTH),
                    "otherElementId": _text_schema(MAX_IDENTIFIER_LENGTH),
                    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_RESULT_ITEMS},
                },
                ("elementId",),
            ),
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {
                **shared,
                "maxItems": MAX_RESULT_ITEMS,
                "maxVersionsPerItem": MAX_RELATIONSHIP_VERSIONS,
            },
        },
        {
            "name": "find_timeline_events",
            "description": "Find bounded timeline events by text and optional exact entity id.",
            "inputSchema": _object_schema(
                {
                    "query": _text_schema(MAX_QUERY_LENGTH, minimum=0),
                    "entityId": _text_schema(MAX_IDENTIFIER_LENGTH),
                    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_RESULT_ITEMS},
                }
            ),
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {**shared, "maxItems": MAX_RESULT_ITEMS},
        },
        {
            "name": "get_world_state",
            "description": "Project deterministic world state at one exact timeline moment.",
            "inputSchema": _object_schema(
                {
                    "momentId": _text_schema(MAX_IDENTIFIER_LENGTH),
                    "phase": {"type": "string", "enum": ["before", "at", "after"]},
                    "entityIds": _id_list_schema(MAX_RESULT_ITEMS),
                    "relationshipIds": _id_list_schema(MAX_RESULT_ITEMS),
                },
                ("momentId",),
            ),
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {
                **shared,
                "maxEntities": MAX_RESULT_ITEMS,
                "maxRelationships": MAX_RESULT_ITEMS,
            },
        },
        {
            "name": "search_manuscript",
            "description": "Search bounded manuscript prose and chapter notes.",
            "inputSchema": _object_schema(
                {
                    "query": _text_schema(MAX_QUERY_LENGTH),
                    "chapterIds": _id_list_schema(MAX_CHAPTER_IDS),
                    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_SEARCH_RESULTS},
                },
                ("query",),
            ),
            "readOnly": True,
            "sideEffectFree": True,
            "limits": {**shared, "maxItems": MAX_SEARCH_RESULTS},
        },
    )


def _safe_name(name: Any) -> str:
    return name if isinstance(name, str) and name in READ_TOOL_NAMES else "unknown"


def _valid_revision(value: Any) -> bool:
    return type(value) is int and 0 <= value <= MAX_SAFE_REVISION


def _error(name: Any, revision: int, code: str) -> dict[str, Any]:
    messages = {
        "unknown_tool": "The requested read tool is not available.",
        "invalid_arguments": "The read tool arguments are invalid or exceed their limits.",
        "invalid_snapshot": "The supplied read snapshot is invalid.",
        "not_found": "The requested exact reference was not found.",
        "unavailable": "The requested facts cannot be projected from this snapshot.",
        "too_many_calls": "The read tool call limit was exceeded.",
        "result_too_large": "The bounded read result exceeded its output limit.",
    }
    return {
        "name": _safe_name(name),
        "ok": False,
        "readOnly": True,
        "sideEffectFree": True,
        "worldRevision": revision,
        "error": {"code": code, "message": messages[code]},
    }


def _bounded_envelope(envelope: dict[str, Any], name: str, revision: int) -> dict[str, Any]:
    encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= MAX_READ_TOOL_OUTPUT_BYTES:
        return envelope
    return _error(name, revision, "result_too_large")


def _success(name: str, revision: int, result: Any) -> dict[str, Any]:
    return _bounded_envelope(
        {
            "name": name,
            "ok": True,
            "readOnly": True,
            "sideEffectFree": True,
            "worldRevision": revision,
            "result": result,
        },
        name,
        revision,
    )


def _arguments(
    value: Any, *, allowed: Sequence[str], required: Sequence[str] = ()
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise _ReadToolInputError
    arguments = dict(value)
    if set(arguments) - set(allowed) or any(key not in arguments for key in required):
        raise _ReadToolInputError
    return arguments


def _text(
    arguments: Mapping[str, Any],
    key: str,
    *,
    maximum: int,
    required: bool = False,
    allow_empty: bool = False,
) -> str | None:
    value = arguments.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > maximum:
        raise _ReadToolInputError
    cleaned = value.strip()
    if not cleaned and not allow_empty:
        raise _ReadToolInputError
    return cleaned


def _string_list(
    arguments: Mapping[str, Any],
    key: str,
    *,
    maximum_items: int,
    maximum_length: int = MAX_IDENTIFIER_LENGTH,
) -> tuple[str, ...]:
    value = arguments.get(key, [])
    if (
        not isinstance(value, list)
        or len(value) > maximum_items
        or any(
            not isinstance(item, str) or not item.strip() or len(item) > maximum_length
            for item in value
        )
    ):
        raise _ReadToolInputError
    cleaned = tuple(item.strip() for item in value)
    if len(cleaned) != len(set(cleaned)):
        raise _ReadToolInputError
    return cleaned


def _limit(arguments: Mapping[str, Any], maximum: int, default: int) -> int:
    value = arguments.get("limit", default)
    if type(value) is not int or not 1 <= value <= maximum:
        raise _ReadToolInputError
    return value


def _clipped(value: Any, maximum: int) -> tuple[str, bool]:
    text = value if isinstance(value, str) else str(value or "")
    return text[:maximum], len(text) > maximum


def _entity_view(node: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    result: dict[str, Any] = {}
    truncated = False
    for key, maximum in (
        ("id", MAX_IDENTIFIER_LENGTH),
        ("name", MAX_MENTION_LENGTH),
        ("type", 40),
        ("label", MAX_MENTION_LENGTH),
        ("sub", 1_000),
        ("diedMomentId", MAX_IDENTIFIER_LENGTH),
    ):
        if key in node:
            result[key], clipped = _clipped(node[key], maximum)
            truncated = truncated or clipped
    aliases = node.get("aliases") or []
    alias_views: list[dict[str, str]] = []
    if isinstance(aliases, list):
        truncated = truncated or len(aliases) > MAX_ENTITY_ALIASES
        for item in aliases[:MAX_ENTITY_ALIASES]:
            if not isinstance(item, Mapping):
                continue
            alias, alias_cut = _clipped(item.get("alias"), MAX_MENTION_LENGTH)
            source, source_cut = _clipped(item.get("source", "manual"), 40)
            alias_views.append({"alias": alias, "source": source})
            truncated = truncated or alias_cut or source_cut
    result["aliases"] = alias_views
    profile = node.get("profile")
    if isinstance(profile, Mapping):
        profile_view: dict[str, Any] = {}
        for key in ("alter", "rolle", "aussehen", "herkunft", "stimme", "notizen"):
            if key in profile:
                profile_view[key], clipped = _clipped(profile[key], 1_000)
                truncated = truncated or clipped
        extras = profile.get("extra") or []
        if isinstance(extras, list):
            truncated = truncated or len(extras) > MAX_ENTITY_ALIASES
            profile_view["extra"] = []
            for field in extras[:MAX_ENTITY_ALIASES]:
                if not isinstance(field, Mapping):
                    continue
                label, label_cut = _clipped(field.get("k"), MAX_MENTION_LENGTH)
                content, content_cut = _clipped(field.get("v"), 1_000)
                profile_view["extra"].append({"k": label, "v": content})
                truncated = truncated or label_cut or content_cut
        result["profile"] = profile_view
    return result, truncated


def _relationship_view(edge: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    result: dict[str, Any] = {
        "directed": bool(edge.get("gerichtet", edge.get("directed", False))),
        "active": edge.get("active", True) is not False,
    }
    truncated = False
    for key, maximum in (
        ("id", MAX_IDENTIFIER_LENGTH),
        ("from", MAX_IDENTIFIER_LENGTH),
        ("to", MAX_IDENTIFIER_LENGTH),
        ("label", MAX_MENTION_LENGTH),
        ("style", 40),
    ):
        if key in edge:
            result[key], clipped = _clipped(edge[key], maximum)
            truncated = truncated or clipped
    versions = edge.get("versions") or []
    result["versions"] = []
    if isinstance(versions, list):
        truncated = truncated or len(versions) > MAX_RELATIONSHIP_VERSIONS
        for version in versions[:MAX_RELATIONSHIP_VERSIONS]:
            if not isinstance(version, Mapping):
                continue
            view: dict[str, Any] = {}
            for key, maximum in (
                ("momentId", MAX_IDENTIFIER_LENGTH),
                ("from", MAX_IDENTIFIER_LENGTH),
                ("to", MAX_IDENTIFIER_LENGTH),
                ("label", MAX_MENTION_LENGTH),
                ("style", 40),
            ):
                if key in version:
                    view[key], clipped = _clipped(version[key], maximum)
                    truncated = truncated or clipped
            if "active" in version:
                view["active"] = version["active"] is True
            if "gerichtet" in version or "directed" in version:
                view["directed"] = bool(version.get("gerichtet", version.get("directed", False)))
            result["versions"].append(view)
    return result, truncated


def _moment_view(moment: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    result: dict[str, Any] = {}
    truncated = False
    for key, maximum in (
        ("id", MAX_IDENTIFIER_LENGTH),
        ("title", MAX_MENTION_LENGTH),
        ("date", 40),
        ("note", 1_000),
        ("precision", 20),
        ("endPrecision", 20),
    ):
        if key in moment:
            result[key], clipped = _clipped(moment[key], maximum)
            truncated = truncated or clipped
    for key in ("time", "position", "endTime"):
        if type(moment.get(key)) is int:
            result[key] = moment[key]
    return result, truncated


def _chunk_view(chunk: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    result: dict[str, Any] = {}
    truncated = False
    for key, maximum in (
        ("id", 320),
        ("kind", 40),
        ("title", 240),
        ("text", MAX_TEXT_LENGTH),
    ):
        result[key], clipped = _clipped(chunk.get(key), maximum)
        truncated = truncated or clipped
    target = chunk.get("target")
    result["target"] = {}
    if isinstance(target, Mapping):
        for key in ("workspace", "id"):
            if key in target:
                result["target"][key], clipped = _clipped(target[key], MAX_IDENTIFIER_LENGTH)
                truncated = truncated or clipped
    return result, truncated


class StoryWorldReadTools:
    """Pure dispatcher implementing the shared read-tool execution port."""

    def catalog(self) -> tuple[dict[str, Any], ...]:
        return read_tool_catalog()

    def execute(
        self,
        name: str,
        arguments: Mapping[str, Any],
        *,
        manuscript: Mapping[str, Any],
        figures: Mapping[str, Any],
        world_revision: int,
    ) -> dict[str, Any]:
        if not _valid_revision(world_revision):
            return _error(name, 0, "invalid_snapshot")
        if name not in READ_TOOL_NAMES:
            return _error(name, world_revision, "unknown_tool")
        if not isinstance(manuscript, Mapping) or not isinstance(figures, Mapping):
            return _error(name, world_revision, "invalid_snapshot")
        try:
            manuscript_snapshot = deepcopy(dict(manuscript))
            figures_snapshot = deepcopy(dict(figures))
        # Snapshot inputs cross a transport boundary and must fail closed on copy errors.
        except Exception:  # noqa: BLE001
            return _error(name, world_revision, "invalid_snapshot")
        return self._execute_snapshot(
            name,
            arguments,
            manuscript_snapshot,
            figures_snapshot,
            world_revision,
        )

    def execute_many(
        self,
        calls: Sequence[Mapping[str, Any]],
        *,
        manuscript: Mapping[str, Any],
        figures: Mapping[str, Any],
        world_revision: int,
    ) -> tuple[dict[str, Any], ...]:
        revision = world_revision if _valid_revision(world_revision) else 0
        valid_call_list = isinstance(calls, (list, tuple))
        too_many_calls = valid_call_list and len(calls) > MAX_READ_TOOL_CALLS
        if (
            not valid_call_list
            or too_many_calls
            or not _valid_revision(world_revision)
            or not isinstance(manuscript, Mapping)
            or not isinstance(figures, Mapping)
        ):
            code = "too_many_calls" if too_many_calls else "invalid_snapshot"
            return (_error("unknown", revision, code),)
        try:
            manuscript_snapshot = deepcopy(dict(manuscript))
            figures_snapshot = deepcopy(dict(figures))
        # Snapshot inputs cross a transport boundary and must fail closed on copy errors.
        except Exception:  # noqa: BLE001
            return (_error("unknown", revision, "invalid_snapshot"),)
        results: list[dict[str, Any]] = []
        for call in calls:
            if not isinstance(call, Mapping):
                results.append(_error("unknown", revision, "invalid_arguments"))
                continue
            results.append(
                self._execute_snapshot(
                    call.get("name"),
                    call.get("arguments"),
                    manuscript_snapshot,
                    figures_snapshot,
                    revision,
                )
            )
        return tuple(results)

    def _execute_snapshot(
        self,
        name: Any,
        arguments: Any,
        manuscript: dict[str, Any],
        figures: dict[str, Any],
        revision: int,
    ) -> dict[str, Any]:
        if name not in READ_TOOL_NAMES:
            return _error(name, revision, "unknown_tool")
        try:
            handlers = {
                "resolve_entity": self._resolve_entity,
                "get_entity": self._get_entity,
                "get_relationships": self._get_relationships,
                "find_timeline_events": self._find_timeline_events,
                "get_world_state": self._get_world_state,
                "search_manuscript": self._search_manuscript,
            }
            result = handlers[name](arguments, manuscript, figures)
            return _success(name, revision, result)
        except _ReadToolInputError:
            return _error(name, revision, "invalid_arguments")
        except LookupError:
            return _error(name, revision, "not_found")
        # Public dispatch never exposes unexpected domain failures to the caller.
        except Exception:  # noqa: BLE001
            return _error(name, revision, "unavailable")

    @staticmethod
    def _resolve_entity(
        raw: Any, _manuscript: dict[str, Any], figures: dict[str, Any]
    ) -> dict[str, Any]:
        arguments = _arguments(
            raw,
            allowed=("mention", "entityType", "contextIds", "vocabulary"),
            required=("mention",),
        )
        mention = _text(arguments, "mention", maximum=MAX_MENTION_LENGTH, required=True)
        entity_type = _text(arguments, "entityType", maximum=40)
        if entity_type is not None and entity_type not in ENTITY_TYPES:
            raise _ReadToolInputError
        context_ids = _string_list(
            arguments,
            "contextIds",
            maximum_items=MAX_CONTEXT_IDS,
        )
        vocabulary = _string_list(
            arguments,
            "vocabulary",
            maximum_items=MAX_VOCABULARY_ITEMS,
            maximum_length=MAX_VOCABULARY_LENGTH,
        )
        result = StoryWorldUseCases.resolve_entity(
            figures,
            mention or "",
            entity_type=entity_type,
            context_ids=context_ids,
            vocabulary=vocabulary,
        )
        candidates = result.get("candidates") or []
        result["candidates"] = deepcopy(candidates[:MAX_RESOLUTION_CANDIDATES])
        result["candidateCount"] = len(candidates)
        result["truncated"] = len(candidates) > MAX_RESOLUTION_CANDIDATES
        return result

    @staticmethod
    def _get_entity(
        raw: Any, _manuscript: dict[str, Any], figures: dict[str, Any]
    ) -> dict[str, Any]:
        arguments = _arguments(raw, allowed=("elementId",), required=("elementId",))
        element_id = _text(
            arguments,
            "elementId",
            maximum=MAX_IDENTIFIER_LENGTH,
            required=True,
        )
        node = StoryWorldQueries.get_entity(figures, element_id or "")
        if node is None:
            raise LookupError
        entity, truncated = _entity_view(node)
        return {"entity": entity, "truncated": truncated}

    @staticmethod
    def _get_relationships(
        raw: Any, _manuscript: dict[str, Any], figures: dict[str, Any]
    ) -> dict[str, Any]:
        arguments = _arguments(
            raw,
            allowed=("elementId", "otherElementId", "limit"),
            required=("elementId",),
        )
        element_id = _text(
            arguments,
            "elementId",
            maximum=MAX_IDENTIFIER_LENGTH,
            required=True,
        )
        other_id = _text(arguments, "otherElementId", maximum=MAX_IDENTIFIER_LENGTH)
        limit = _limit(arguments, MAX_RESULT_ITEMS, 8)
        if StoryWorldQueries.get_entity(figures, element_id or "") is None:
            raise LookupError
        if other_id is not None and StoryWorldQueries.get_entity(figures, other_id) is None:
            raise LookupError
        edges = StoryWorldQueries.get_relationships(
            figures,
            element_id or "",
            other_element_id=other_id,
            limit=limit + 1,
        )
        views: list[dict[str, Any]] = []
        truncated = len(edges) > limit
        for edge in edges[:limit]:
            view, clipped = _relationship_view(edge)
            views.append(view)
            truncated = truncated or clipped
        return {"relationships": views, "count": len(views), "truncated": truncated}

    @staticmethod
    def _find_timeline_events(
        raw: Any, _manuscript: dict[str, Any], figures: dict[str, Any]
    ) -> dict[str, Any]:
        arguments = _arguments(raw, allowed=("query", "entityId", "limit"))
        query = _text(
            arguments,
            "query",
            maximum=MAX_QUERY_LENGTH,
            allow_empty=True,
        )
        entity_id = _text(arguments, "entityId", maximum=MAX_IDENTIFIER_LENGTH)
        limit = _limit(arguments, MAX_RESULT_ITEMS, 8)
        if entity_id is not None and StoryWorldQueries.get_entity(figures, entity_id) is None:
            raise LookupError
        moments = StoryWorldQueries.find_timeline_events(
            figures,
            query or "",
            entity_id=entity_id,
            limit=limit + 1,
        )
        views: list[dict[str, Any]] = []
        truncated = len(moments) > limit
        for moment in moments[:limit]:
            view, clipped = _moment_view(moment)
            views.append(view)
            truncated = truncated or clipped
        return {"events": views, "count": len(views), "truncated": truncated}

    @staticmethod
    def _get_world_state(
        raw: Any, _manuscript: dict[str, Any], figures: dict[str, Any]
    ) -> dict[str, Any]:
        arguments = _arguments(
            raw,
            allowed=("momentId", "phase", "entityIds", "relationshipIds"),
            required=("momentId",),
        )
        moment_id = _text(
            arguments,
            "momentId",
            maximum=MAX_IDENTIFIER_LENGTH,
            required=True,
        )
        phase = _text(arguments, "phase", maximum=10) or "at"
        if phase not in {"before", "at", "after"}:
            raise _ReadToolInputError
        entity_ids = _string_list(
            arguments,
            "entityIds",
            maximum_items=MAX_RESULT_ITEMS,
        )
        relationship_ids = _string_list(
            arguments,
            "relationshipIds",
            maximum_items=MAX_RESULT_ITEMS,
        )
        state = StoryWorldQueries.get_world_state(figures, moment_id or "", phase=phase)
        all_entities = state.get("entities") or {}
        all_relationships = state.get("relationships") or {}
        if entity_ids and any(identifier not in all_entities for identifier in entity_ids):
            raise LookupError
        if relationship_ids and any(
            identifier not in all_relationships for identifier in relationship_ids
        ):
            raise LookupError
        selected_entities = list(entity_ids) or sorted(all_entities)[:MAX_RESULT_ITEMS]
        selected_relationships = (
            list(relationship_ids) or sorted(all_relationships)[:MAX_RESULT_ITEMS]
        )
        entities: dict[str, Any] = {}
        relationships: dict[str, Any] = {}
        field_truncated = False
        for identifier in selected_entities:
            safe_id, clipped = _clipped(identifier, MAX_IDENTIFIER_LENGTH)
            field_truncated = field_truncated or clipped
            entity = all_entities[identifier]
            location, location_cut = _clipped(entity.get("location"), MAX_IDENTIFIER_LENGTH)
            entities[safe_id] = {"alive": entity.get("alive"), "location": location}
            field_truncated = field_truncated or location_cut
        for identifier in selected_relationships:
            safe_id, clipped = _clipped(identifier, MAX_IDENTIFIER_LENGTH)
            field_truncated = field_truncated or clipped
            view, view_cut = _relationship_view(all_relationships[identifier])
            relationships[safe_id] = view
            field_truncated = field_truncated or view_cut
        truncated = (
            field_truncated
            or (not entity_ids and len(all_entities) > MAX_RESULT_ITEMS)
            or (not relationship_ids and len(all_relationships) > MAX_RESULT_ITEMS)
        )
        return {
            "momentId": state.get("momentId"),
            "phase": state.get("phase"),
            "entities": entities,
            "relationships": relationships,
            "totals": {
                "entities": len(all_entities),
                "relationships": len(all_relationships),
            },
            "truncated": truncated,
        }

    @staticmethod
    def _search_manuscript(
        raw: Any, manuscript: dict[str, Any], _figures: dict[str, Any]
    ) -> dict[str, Any]:
        arguments = _arguments(
            raw,
            allowed=("query", "chapterIds", "limit"),
            required=("query",),
        )
        query = _text(
            arguments,
            "query",
            maximum=MAX_QUERY_LENGTH,
            required=True,
        )
        chapter_ids = _string_list(
            arguments,
            "chapterIds",
            maximum_items=MAX_CHAPTER_IDS,
        )
        limit = _limit(arguments, MAX_SEARCH_RESULTS, 6)
        chunks = StoryWorldQueries.search_manuscript(
            manuscript,
            query or "",
            chapter_ids=chapter_ids,
            limit=limit + 1,
        )
        views: list[dict[str, Any]] = []
        truncated = len(chunks) > limit
        for chunk in chunks[:limit]:
            view, clipped = _chunk_view(chunk)
            views.append(view)
            truncated = truncated or clipped
        return {"matches": views, "count": len(views), "truncated": truncated}


def execute_read_tool(
    name: str,
    arguments: Mapping[str, Any],
    *,
    manuscript: Mapping[str, Any],
    figures: Mapping[str, Any],
    world_revision: int,
) -> dict[str, Any]:
    return StoryWorldReadTools().execute(
        name,
        arguments,
        manuscript=manuscript,
        figures=figures,
        world_revision=world_revision,
    )


def execute_read_tools(
    calls: Sequence[Mapping[str, Any]],
    *,
    manuscript: Mapping[str, Any],
    figures: Mapping[str, Any],
    world_revision: int,
) -> tuple[dict[str, Any], ...]:
    return StoryWorldReadTools().execute_many(
        calls,
        manuscript=manuscript,
        figures=figures,
        world_revision=world_revision,
    )


__all__ = [
    "MAX_READ_TOOL_CALLS",
    "MAX_READ_TOOL_OUTPUT_BYTES",
    "READ_TOOL_NAMES",
    "ReadToolExecutor",
    "ReadToolName",
    "StoryWorldReadTools",
    "execute_read_tool",
    "execute_read_tools",
    "read_tool_catalog",
]
