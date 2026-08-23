"""Pure structural integrity inspection for a story-world aggregate."""

from __future__ import annotations

from datetime import date
from itertools import pairwise
from typing import Any

from quiltor.domain.story_world.knowledge import moment_order


def _moment_date_diff_days(from_date: Any, to_date: Any) -> int | None:
    if not from_date or not to_date:
        return None
    try:
        start, end = date.fromisoformat(str(from_date)), date.fromisoformat(str(to_date))
    except ValueError:
        return None
    return (end - start).days


def _figure_journey_stops(
    figure: dict[str, Any], presence: list[dict[str, Any]], timeline: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    died_id = figure.get("diedMomentId")
    death_index = moment_order(timeline, died_id) if died_id else float("inf")
    stops = []
    for entry in presence:
        if entry.get("elementId") != figure.get("id"):
            continue
        index = moment_order(timeline, entry.get("momentId"))
        if index < -1 or index > death_index:
            continue
        stops.append(
            {"placeId": entry.get("placeId"), "momentId": entry.get("momentId"), "index": index}
        )
    stops.sort(key=lambda stop: stop["index"])
    return [
        stop
        for index, stop in enumerate(stops)
        if index == 0 or stop["placeId"] != stops[index - 1]["placeId"]
    ]


def _issue(text: str, key: str, **params: Any) -> tuple[str, str, dict[str, Any]]:
    return text, key, params


def _presence_issue_entries(figures: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    nodes = figures.get("nodes") or []
    presence = figures.get("presence") or []
    timeline = figures.get("timeline") or []
    moments_by_id = {moment.get("id"): moment for moment in timeline}
    entries: list[tuple[str, str, dict[str, Any]]] = []
    for figure in nodes:
        name = figure.get("name") or figure.get("id")
        stops = _figure_journey_stops(figure, presence, timeline)
        for previous, current in pairwise(stops):
            from_date = moments_by_id.get(previous.get("momentId"), {}).get("date")
            to_date = moments_by_id.get(current.get("momentId"), {}).get("date")
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


def presence_consistency_issues(figures: dict[str, Any]) -> list[str]:
    return [text for text, _key, _params in _presence_issue_entries(figures)]


def validate_world(figures: dict[str, Any]) -> dict[str, Any]:
    """Inspect references and duplicates without mutating or repairing the aggregate."""

    nodes = {node.get("id") for node in figures.get("nodes") or []}
    moments = {moment.get("id") for moment in figures.get("timeline") or []}
    edges = figures.get("edges") or []
    presence = figures.get("presence") or []
    entries: list[tuple[str, str, dict[str, Any]]] = []
    seen: set[tuple[Any, ...]] = set()
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
        key = endpoints if edge.get("gerichtet") else tuple(sorted(endpoints, key=str))
        duplicate_key = (bool(edge.get("gerichtet")), *key)
        if duplicate_key in seen:
            entries.append(
                _issue(
                    f"Beziehung {edge_id} ist strukturell doppelt",
                    "issueDuplicateRelationship",
                    id=edge_id,
                )
            )
        seen.add(duplicate_key)
        version_moments: set[Any] = set()
        for version in edge.get("versions") or []:
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
        "issues": [text for text, _key, _params in entries],
        "issueItems": [{"key": key, "params": params} for _text, key, params in entries],
        "inspected": {
            "elements": len(nodes),
            "relationships": len(edges),
            "timelineMoments": len(moments),
            "relationshipStates": sum(len(edge.get("versions") or []) for edge in edges),
            "presenceEntries": len(presence),
        },
    }


__all__ = ["presence_consistency_issues", "validate_world"]
