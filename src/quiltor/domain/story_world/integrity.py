"""Pure structural integrity inspection for a story-world aggregate."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import date
from itertools import pairwise
from typing import Any, NamedTuple

from quiltor.domain.json_values import JsonObject, as_array, as_object
from quiltor.domain.story_world.knowledge import moment_order


class _Issue(NamedTuple):
    text: str
    key: str
    params: dict[str, object]


class _Stop(NamedTuple):
    place_id: object
    moment_id: object
    order: int


def _objects(value: object) -> list[JsonObject]:
    """The objects of a decoded JSON list; a missing list is empty, other items are skipped."""

    return [entry for item in as_array(value) or [] if (entry := as_object(item)) is not None]


def _moment_date_diff_days(from_date: object, to_date: object) -> int | None:
    if not from_date or not to_date:
        return None
    try:
        start, end = date.fromisoformat(str(from_date)), date.fromisoformat(str(to_date))
    except ValueError:
        return None
    return (end - start).days


def _figure_journey_stops(
    figure: Mapping[str, object],
    presence: Sequence[Mapping[str, object]],
    timeline: Sequence[Mapping[str, object]],
) -> list[_Stop]:
    died_id = figure.get("diedMomentId")
    death_index = moment_order(timeline, died_id) if died_id else math.inf
    stops: list[_Stop] = []
    for entry in presence:
        if entry.get("elementId") != figure.get("id"):
            continue
        index = moment_order(timeline, entry.get("momentId"))
        if index < -1 or index > death_index:
            continue
        stops.append(_Stop(entry.get("placeId"), entry.get("momentId"), index))
    stops.sort(key=lambda stop: stop.order)
    return [
        stop
        for index, stop in enumerate(stops)
        if index == 0 or stop.place_id != stops[index - 1].place_id
    ]


def _issue(text: str, key: str, **params: object) -> _Issue:
    return _Issue(text, key, params)


def _date_of(moments_by_id: Mapping[object, JsonObject], moment_id: object) -> object:
    moment = moments_by_id.get(moment_id)
    return None if moment is None else moment.get("date")


def _presence_issue_entries(figures: Mapping[str, object]) -> list[_Issue]:
    nodes = _objects(figures.get("nodes"))
    presence = _objects(figures.get("presence"))
    timeline = _objects(figures.get("timeline"))
    moments_by_id = {moment.get("id"): moment for moment in timeline}
    entries: list[_Issue] = []
    for figure in nodes:
        name = figure.get("name") or figure.get("id")
        stops = _figure_journey_stops(figure, presence, timeline)
        for previous, current in pairwise(stops):
            from_date = _date_of(moments_by_id, previous.moment_id)
            to_date = _date_of(moments_by_id, current.moment_id)
            days = _moment_date_diff_days(from_date, to_date)
            if days is None:
                continue
            if days < 0:
                entries.append(
                    _issue(
                        f"{name} wechselt laut Anwesenheit den Ort, aber das Zieldatum "
                        "liegt vor dem Ausgangsdatum",
                        "issuePresenceBackward",
                        name=name,
                    )
                )
            elif days == 0:
                entries.append(
                    _issue(
                        f"{name} wechselt laut Anwesenheit am selben Tag den Ort",
                        "issuePresenceSameDay",
                        name=name,
                    )
                )
    return entries


def presence_consistency_issues(figures: Mapping[str, object]) -> list[str]:
    return [issue.text for issue in _presence_issue_entries(figures)]


def validate_world(figures: Mapping[str, object]) -> dict[str, Any]:
    """Inspect references and duplicates without mutating or repairing the aggregate.

    The result stays `dict[str, Any]`: its callers in application and the assistant are not
    strict yet and read it as such.
    """

    nodes = {node.get("id") for node in _objects(figures.get("nodes"))}
    moments = {moment.get("id") for moment in _objects(figures.get("timeline"))}
    edges = _objects(figures.get("edges"))
    presence = _objects(figures.get("presence"))
    entries: list[_Issue] = []
    seen: set[tuple[object, ...]] = set()
    for edge in edges:
        edge_id = edge.get("id")
        if edge.get("from") not in nodes or edge.get("to") not in nodes:
            entries.append(
                _issue(
                    f"Beziehung {edge_id} hat einen fehlenden Endpunkt",
                    "issueMissingEndpoint",
                    id=edge_id,
                )
            )
        endpoints = (edge.get("from"), edge.get("to"))
        key = endpoints if edge.get("directed") else tuple(sorted(endpoints, key=str))
        duplicate_key = (bool(edge.get("directed")), *key)
        if duplicate_key in seen:
            entries.append(
                _issue(
                    f"Beziehung {edge_id} ist strukturell doppelt",
                    "issueDuplicateRelationship",
                    id=edge_id,
                )
            )
        seen.add(duplicate_key)
        version_moments: set[object] = set()
        for version in _objects(edge.get("versions")):
            moment_id = version.get("momentId")
            if moment_id not in moments:
                entries.append(
                    _issue(
                        f"Beziehung {edge_id} verweist auf einen fehlenden Zeitpunkt {moment_id}",
                        "issueMissingMoment",
                        id=edge_id,
                        momentId=moment_id,
                    )
                )
            if moment_id in version_moments:
                entries.append(
                    _issue(
                        f"Beziehung {edge_id} hat mehrere Stände am selben Zeitpunkt {moment_id}",
                        "issueDuplicateMomentState",
                        id=edge_id,
                        momentId=moment_id,
                    )
                )
            version_moments.add(moment_id)
    entries.extend(_presence_issue_entries(figures))
    return {
        "issues": [issue.text for issue in entries],
        "issueItems": [{"key": issue.key, "params": issue.params} for issue in entries],
        "inspected": {
            "elements": len(nodes),
            "relationships": len(edges),
            "timelineMoments": len(moments),
            "relationshipStates": sum(len(_objects(edge.get("versions"))) for edge in edges),
            "presenceEntries": len(presence),
        },
    }


__all__ = ["presence_consistency_issues", "validate_world"]
