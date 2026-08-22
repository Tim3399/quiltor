"""Deterministic projection of Quiltor's temporal world data.

The resolver deliberately works on the public ``FigureState`` shape.  It is pure
domain logic: no database, HTTP or assistant dependency is involved.  A moment is
ordered by its canonical ``(time, position)`` key.  Simultaneous moments therefore
remain distinct without interpreting their ids as time.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

from quiltor.domain.story_world.validation import valid_figures


UNKNOWN = "unknown"
Phase = Literal["before", "at", "after"]
WorldState = dict[str, Any]


class WorldStateError(ValueError):
    """The supplied aggregate cannot be projected without guessing."""


def _timeline(figures: dict[str, Any]) -> list[dict[str, Any]]:
    timeline = figures.get("timeline") or []
    if any(type(moment.get("time")) is not int for moment in timeline):
        raise WorldStateError("Every timeline moment needs a canonical integer time.")
    if any(type(moment.get("position")) is not int for moment in timeline):
        raise WorldStateError("Every timeline moment needs a stable integer position.")
    coordinates = [(item["time"], item["position"]) for item in timeline]
    if len(coordinates) != len(set(coordinates)):
        raise WorldStateError("Timeline moments need unique (time, position) coordinates.")
    return sorted(timeline, key=lambda item: (item["time"], item["position"]))


def _validated(figures: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not valid_figures(figures):
        raise WorldStateError("Invalid figure state or dangling temporal reference.")
    return figures, _timeline(figures)


def _moment(
    figures: Any, moment_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    aggregate, timeline = _validated(figures)
    moment = next((item for item in timeline if item["id"] == moment_id), None)
    if moment is None:
        raise WorldStateError(f"Unknown timeline moment: {moment_id!r}.")
    return aggregate, timeline, moment


def _key(moment: dict[str, Any]) -> tuple[int, int]:
    return moment["time"], moment["position"]


def _project(
    figures: dict[str, Any],
    timeline: list[dict[str, Any]],
    through: tuple[int, int] | None,
    *,
    moment_id: str | None,
    phase: Phase,
    inclusive: bool,
) -> WorldState:
    moments = {item["id"]: item for item in timeline}

    def applies(candidate_id: str | None) -> bool:
        if candidate_id is None:
            return True
        candidate = moments[candidate_id]
        if through is None:
            return False
        return _key(candidate) <= through if inclusive else _key(candidate) < through

    entities: dict[str, dict[str, Any]] = {}
    for node in figures["nodes"]:
        death_id = node.get("diedMomentId")
        alive: bool | str = UNKNOWN
        if death_id is not None:
            alive = not applies(death_id)
        entities[node["id"]] = {"alive": alive, "location": UNKNOWN}

    presence = sorted(
        figures.get("presence") or [],
        key=lambda entry: (
            (-1, -1) if entry.get("momentId") is None else _key(moments[entry["momentId"]]),
            entry["id"],
        ),
    )
    for entry in presence:
        if applies(entry.get("momentId")):
            entities[entry["elementId"]]["location"] = entry["placeId"]

    relationships: dict[str, dict[str, Any]] = {}
    for edge in figures["edges"]:
        resolved = {
            "active": edge.get("active", True) is not False,
            "from": edge["from"],
            "to": edge["to"],
            "label": edge.get("label"),
            "directed": bool(edge.get("gerichtet", False)),
            "style": edge.get("style"),
        }
        versions = sorted(
            edge.get("versions") or [],
            key=lambda version: _key(moments[version["momentId"]]),
        )
        for version in versions:
            if not applies(version["momentId"]):
                continue
            resolved["active"] = version["active"]
            for source, target in (
                ("from", "from"),
                ("to", "to"),
                ("label", "label"),
                ("gerichtet", "directed"),
                ("style", "style"),
            ):
                if source in version:
                    resolved[target] = version[source]
        relationships[edge["id"]] = resolved

    return {
        "momentId": moment_id,
        "phase": phase,
        "entities": entities,
        "relationships": relationships,
    }


def state_at(figures: dict[str, Any], moment_id: str) -> WorldState:
    aggregate, timeline, moment = _moment(figures, moment_id)
    return _project(
        aggregate,
        timeline,
        _key(moment),
        moment_id=moment_id,
        phase="at",
        inclusive=True,
    )


def state_before(figures: dict[str, Any], moment_id: str) -> WorldState:
    aggregate, timeline, moment = _moment(figures, moment_id)
    return _project(
        aggregate,
        timeline,
        _key(moment),
        moment_id=moment_id,
        phase="before",
        inclusive=False,
    )


def state_after(figures: dict[str, Any], moment_id: str) -> WorldState:
    """Return the state immediately after this moment's ordered transitions.

    Transitions are instantaneous, so this has the same values as ``state_at``;
    the explicit phase keeps callers from having to infer which boundary they asked
    for and leaves room for later duration semantics.
    """

    aggregate, timeline, moment = _moment(figures, moment_id)
    return _project(
        aggregate,
        timeline,
        _key(moment),
        moment_id=moment_id,
        phase="after",
        inclusive=True,
    )


def state_diff(figures: dict[str, Any], moment_a: str, moment_b: str) -> dict[str, Any]:
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
    figures: dict[str, Any], entity_id: str, predicate: str | None = None
) -> list[dict[str, Any]]:
    aggregate, timeline = _validated(figures)
    if entity_id not in {node["id"] for node in aggregate["nodes"]}:
        raise WorldStateError(f"Unknown entity: {entity_id!r}.")
    if predicate not in {None, "alive", "location"}:
        raise WorldStateError(f"Unsupported entity predicate: {predicate!r}.")

    base = _project(aggregate, timeline, None, moment_id=None, phase="before", inclusive=False)[
        "entities"
    ][entity_id]
    entries: list[dict[str, Any]] = []
    previous = base
    for moment in timeline:
        current = state_at(aggregate, moment["id"])["entities"][entity_id]
        changes = {
            field: {"from": deepcopy(previous[field]), "to": deepcopy(current[field])}
            for field in ("alive", "location")
            if previous[field] != current[field] and (predicate is None or predicate == field)
        }
        if changes:
            entries.append(
                {
                    "momentId": moment["id"],
                    "time": moment["time"],
                    "position": moment["position"],
                    "changes": changes,
                }
            )
        previous = current
    return entries
