"""Deterministic projection of Quiltor's temporal world data.

The resolver deliberately works on the public ``FigureState`` shape.  It is pure
domain logic: no database, HTTP or assistant dependency is involved.  A moment is
ordered by its canonical ``(time, position)`` key.  Simultaneous moments therefore
remain distinct without interpreting their ids as time.
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Literal, NamedTuple

from quiltor.domain.json_values import JsonObject, as_array, as_object
from quiltor.domain.story_world.validation import valid_figures

UNKNOWN = "unknown"
Phase = Literal["before", "at", "after"]
WorldState = dict[str, Any]


class WorldStateError(ValueError):
    """The supplied aggregate cannot be projected without guessing."""


class _Moment(NamedTuple):
    id: str
    time: int
    position: int

    @property
    def key(self) -> tuple[int, int]:
        return self.time, self.position


def _rows(value: object) -> list[JsonObject]:
    """The object rows of a list; the aggregate was validated, so nothing is dropped."""

    items = as_array(value or []) or []
    return [row for row in map(as_object, items) if row is not None]


def _text(row: JsonObject, key: str) -> str:
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _moment_ref(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _timeline(figures: JsonObject) -> list[_Moment]:
    timeline = _rows(figures.get("timeline"))
    if any(type(moment.get("time")) is not int for moment in timeline):
        raise WorldStateError("Every timeline moment needs a canonical integer time.")
    if any(type(moment.get("position")) is not int for moment in timeline):
        raise WorldStateError("Every timeline moment needs a stable integer position.")
    moments: list[_Moment] = []
    for row in timeline:
        time, position = row.get("time"), row.get("position")
        if type(time) is int and type(position) is int:
            moments.append(_Moment(_text(row, "id"), time, position))
    coordinates = [moment.key for moment in moments]
    if len(coordinates) != len(set(coordinates)):
        raise WorldStateError("Timeline moments need unique (time, position) coordinates.")
    return sorted(moments, key=lambda moment: moment.key)


def _validated(figures: object) -> tuple[JsonObject, list[_Moment]]:
    aggregate = as_object(figures)
    if aggregate is None or not valid_figures(figures):
        raise WorldStateError("Invalid figure state or dangling temporal reference.")
    return aggregate, _timeline(aggregate)


def _moment(figures: object, moment_id: str) -> tuple[JsonObject, list[_Moment], _Moment]:
    aggregate, timeline = _validated(figures)
    moment = next((item for item in timeline if item.id == moment_id), None)
    if moment is None:
        raise WorldStateError(f"Unknown timeline moment: {moment_id!r}.")
    return aggregate, timeline, moment


def _project(
    figures: JsonObject,
    timeline: list[_Moment],
    through: tuple[int, int] | None,
    *,
    moment_id: str | None,
    phase: Phase,
    inclusive: bool,
) -> WorldState:
    moments = {item.id: item for item in timeline}

    def applies(candidate_id: str | None) -> bool:
        if candidate_id is None:
            return True
        candidate = moments[candidate_id]
        if through is None:
            return False
        return candidate.key <= through if inclusive else candidate.key < through

    entities: dict[str, dict[str, Any]] = {}
    for node in _rows(figures.get("nodes")):
        death_id = _moment_ref(node.get("diedMomentId"))
        alive: bool | str = UNKNOWN
        if death_id is not None:
            alive = not applies(death_id)
        entities[_text(node, "id")] = {"alive": alive, "location": UNKNOWN}

    def presence_key(entry: JsonObject) -> tuple[tuple[int, int], str]:
        moment_ref = _moment_ref(entry.get("momentId"))
        coordinate = (-1, -1) if moment_ref is None else moments[moment_ref].key
        return coordinate, _text(entry, "id")

    for entry in sorted(_rows(figures.get("presence")), key=presence_key):
        if applies(_moment_ref(entry.get("momentId"))):
            entities[_text(entry, "elementId")]["location"] = entry["placeId"]

    relationships: dict[str, dict[str, Any]] = {}
    for edge in _rows(figures.get("edges")):
        resolved: dict[str, Any] = {
            "active": edge.get("active", True) is not False,
            "from": edge["from"],
            "to": edge["to"],
            "label": edge.get("label"),
            "directed": bool(edge.get("directed", False)),
            "style": edge.get("style"),
        }
        versions = sorted(
            _rows(edge.get("versions")),
            key=lambda version: moments[_text(version, "momentId")].key,
        )
        for version in versions:
            if not applies(_text(version, "momentId")):
                continue
            resolved["active"] = version["active"]
            for source, target in (
                ("from", "from"),
                ("to", "to"),
                ("label", "label"),
                ("directed", "directed"),
                ("style", "style"),
            ):
                if source in version:
                    resolved[target] = version[source]
        relationships[_text(edge, "id")] = resolved

    return {
        "momentId": moment_id,
        "phase": phase,
        "entities": entities,
        "relationships": relationships,
    }


def state_at(figures: Mapping[str, object], moment_id: str) -> WorldState:
    aggregate, timeline, moment = _moment(figures, moment_id)
    return _project(
        aggregate,
        timeline,
        moment.key,
        moment_id=moment_id,
        phase="at",
        inclusive=True,
    )


def state_before(figures: Mapping[str, object], moment_id: str) -> WorldState:
    aggregate, timeline, moment = _moment(figures, moment_id)
    return _project(
        aggregate,
        timeline,
        moment.key,
        moment_id=moment_id,
        phase="before",
        inclusive=False,
    )


def state_after(figures: Mapping[str, object], moment_id: str) -> WorldState:
    """Return the state immediately after this moment's ordered transitions.

    Transitions are instantaneous, so this has the same values as ``state_at``;
    the explicit phase keeps callers from having to infer which boundary they asked
    for and leaves room for later duration semantics.
    """

    aggregate, timeline, moment = _moment(figures, moment_id)
    return _project(
        aggregate,
        timeline,
        moment.key,
        moment_id=moment_id,
        phase="after",
        inclusive=True,
    )


def state_diff(figures: Mapping[str, object], moment_a: str, moment_b: str) -> dict[str, Any]:
    before = state_at(figures, moment_a)
    after = state_at(figures, moment_b)
    result: dict[str, Any] = {
        "fromMomentId": moment_a,
        "toMomentId": moment_b,
        "entities": {},
        "relationships": {},
    }
    for section in ("entities", "relationships"):
        for object_id in sorted(set(before[section]) | set(after[section])):
            left = before[section].get(object_id, {})
            right = after[section].get(object_id, {})
            changes = {
                field: {"from": deepcopy(left.get(field)), "to": deepcopy(right.get(field))}
                for field in sorted(set(left) | set(right))
                if left.get(field) != right.get(field)
            }
            if changes:
                result[section][object_id] = changes
    return result


def history_for(
    figures: Mapping[str, object], entity_id: str, predicate: str | None = None
) -> list[dict[str, Any]]:
    aggregate, timeline = _validated(figures)
    if entity_id not in {_text(node, "id") for node in _rows(aggregate.get("nodes"))}:
        raise WorldStateError(f"Unknown entity: {entity_id!r}.")
    if predicate not in {None, "alive", "location"}:
        raise WorldStateError(f"Unsupported entity predicate: {predicate!r}.")

    base = _project(aggregate, timeline, None, moment_id=None, phase="before", inclusive=False)[
        "entities"
    ][entity_id]
    entries: list[dict[str, Any]] = []
    previous = base
    for moment in timeline:
        current = state_at(aggregate, moment.id)["entities"][entity_id]
        changes = {
            field: {"from": deepcopy(previous[field]), "to": deepcopy(current[field])}
            for field in ("alive", "location")
            if previous[field] != current[field] and (predicate is None or predicate == field)
        }
        if changes:
            entries.append(
                {
                    "momentId": moment.id,
                    "time": moment.time,
                    "position": moment.position,
                    "changes": changes,
                }
            )
        previous = current
    return entries
