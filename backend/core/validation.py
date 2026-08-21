from __future__ import annotations

from typing import Any


MAX_SAFE_INTEGER = 9_007_199_254_740_991


def valid_figures(payload: Any) -> bool:
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("nodes"), list)
        or not isinstance(payload.get("edges"), list)
    ):
        return False
    if not _valid_time_system(payload.get("timeSystem")):
        return False
    ids: list[str] = []
    kinds: dict[str, str] = {}
    for node in payload["nodes"]:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
            return False
        if (
            not isinstance(node.get("name"), str)
            or not isinstance(node.get("x"), (int, float))
            or not isinstance(node.get("y"), (int, float))
        ):
            return False
        if node.get("mapX") is not None and not isinstance(node.get("mapX"), (int, float)):
            return False
        if node.get("mapY") is not None and not isinstance(node.get("mapY"), (int, float)):
            return False
        ids.append(node["id"])
        kinds[node["id"]] = node.get("type", "person")
    if len(ids) != len(set(ids)):
        return False

    timeline = payload.get("timeline", [])
    if not isinstance(timeline, list):
        return False
    moment_ids: list[str] = []
    for moment in timeline:
        if (
            not isinstance(moment, dict)
            or not isinstance(moment.get("id"), str)
            or not moment["id"]
            or not isinstance(moment.get("title", ""), str)
            or not isinstance(moment.get("date", ""), str)
            or not isinstance(moment.get("note", ""), str)
        ):
            return False
        if "time" in moment and (
            type(moment["time"]) is not int or abs(moment["time"]) > MAX_SAFE_INTEGER
        ):
            return False
        if "position" in moment and type(moment["position"]) is not int:
            return False
        if moment.get("precision", "day") not in {"day", "month", "year"}:
            return False
        if "endTime" in moment and (
            type(moment["endTime"]) is not int
            or abs(moment["endTime"]) > MAX_SAFE_INTEGER
            or moment["endTime"] < moment.get("time", moment["endTime"])
        ):
            return False
        if "endPrecision" in moment and (
            "endTime" not in moment
            or moment["endPrecision"] not in {"day", "month", "year"}
        ):
            return False
        moment_ids.append(moment["id"])
    if len(moment_ids) != len(set(moment_ids)):
        return False

    known, known_moments, edge_ids = set(ids), set(moment_ids), []
    death_moments = [node.get("diedMomentId") for node in payload["nodes"]]
    if any(moment_id is not None and moment_id not in known_moments for moment_id in death_moments):
        return False
    for edge in payload["edges"]:
        if (
            not isinstance(edge, dict)
            or not isinstance(edge.get("id"), str)
            or not edge["id"]
            or edge.get("from") not in known
            or edge.get("to") not in known
        ):
            return False
        versions = edge.get("versions", [])
        if not isinstance(versions, list):
            return False
        version_moments: list[str] = []
        for version in versions:
            if (
                not isinstance(version, dict)
                or version.get("momentId") not in known_moments
                or type(version.get("active")) is not bool
                or ("from" in version and version["from"] not in known)
                or ("to" in version and version["to"] not in known)
                or ("label" in version and not isinstance(version["label"], str))
                or ("style" in version and not isinstance(version["style"], str))
                or ("gerichtet" in version and type(version["gerichtet"]) is not bool)
            ):
                return False
            version_moments.append(version["momentId"])
        if len(version_moments) != len(set(version_moments)):
            return False
        edge_ids.append(edge["id"])
    if len(edge_ids) != len(set(edge_ids)):
        return False
    presence = payload.get("presence")
    if presence is None:
        return True
    if not isinstance(presence, list):
        return False
    entry_ids = []
    for entry in presence:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"]:
            return False
        if entry.get("elementId") not in known or kinds.get(entry.get("placeId")) != "ort":
            return False
        if entry.get("momentId") is not None and entry.get("momentId") not in known_moments:
            return False
        entry_ids.append(entry["id"])
    logical_presence = [
        (entry["elementId"], entry.get("momentId")) for entry in presence if isinstance(entry, dict)
    ]
    return len(entry_ids) == len(set(entry_ids)) and len(logical_presence) == len(
        set(logical_presence)
    )


def _valid_time_system(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, dict):
        return False
    if (
        not isinstance(value.get("id"), str)
        or not value["id"]
        or not isinstance(value.get("name"), str)
        or value.get("kind") not in {"relative", "gregorian", "custom"}
        or value.get("unit", "day") not in {"day", "abstract"}
        or (value.get("kind") != "relative" and value.get("unit", "day") != "day")
    ):
        return False
    if any(
        not isinstance(value.get(field, ""), str)
        for field in ("eraName", "eraAbbreviation", "displayFormat")
    ):
        return False
    for field, default in (
        ("epochTime", 0), ("epochYear", 1), ("epochMonth", 1),
        ("epochDay", 1), ("epochWeekday", 0),
    ):
        number = value.get(field, default)
        if type(number) is not int or abs(number) > MAX_SAFE_INTEGER:
            return False
    months, weekdays = value.get("months", []), value.get("weekdays", [])
    if not isinstance(months, list) or not isinstance(weekdays, list):
        return False
    if value.get("kind") == "custom" and not months:
        return False
    if any(
        not isinstance(month, dict)
        or not isinstance(month.get("name"), str)
        or not isinstance(month.get("shortName", ""), str)
        or type(month.get("dayCount")) is not int
        or month["dayCount"] <= 0
        or month["dayCount"] > MAX_SAFE_INTEGER
        for month in months
    ):
        return False
    if any(
        not isinstance(weekday, dict)
        or not isinstance(weekday.get("name"), str)
        or not isinstance(weekday.get("shortName", ""), str)
        for weekday in weekdays
    ):
        return False
    epoch_weekday = value.get("epochWeekday", 0)
    if weekdays and not 0 <= epoch_weekday < len(weekdays):
        return False
    try:
        if value.get("kind") == "gregorian":
            from datetime import date

            date(value.get("epochYear", 1), value.get("epochMonth", 1), value.get("epochDay", 1))
        elif value.get("kind") == "custom":
            month, day = value.get("epochMonth", 1), value.get("epochDay", 1)
            if month < 1 or month > len(months) or day < 1 or day > months[month - 1]["dayCount"]:
                return False
    except ValueError:
        return False
    return True


def valid_manuscript(payload: Any) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("chapters"), list):
        return False
    if payload.get("language", "de-DE") != "de-DE" or payload.get("grammarMode", "manual") not in {
        "manual",
        "automatic",
    }:
        return False
    ids: list[str] = []
    for chapter in payload["chapters"]:
        if (
            not isinstance(chapter, dict)
            or not isinstance(chapter.get("id"), str)
            or not chapter["id"]
        ):
            return False
        if any(not isinstance(chapter.get(key, ""), str) for key in ("title", "body", "note")):
            return False
        if (
            len(chapter["id"]) > 200
            or len(chapter.get("title", "")) > 1000
            or len(chapter.get("note", "")) > 100_000
            or len(chapter.get("body", "")) > 10_000_000
        ):
            return False
        mentions = chapter.get("mentions", [])
        if not isinstance(mentions, list) or len(mentions) > 10_000:
            return False
        previous_to = -1
        mention_ids: set[str] = set()
        for mention in sorted(
            mentions, key=lambda item: item.get("from", -1) if isinstance(item, dict) else -1
        ):
            if not isinstance(mention, dict):
                return False
            if any(
                not isinstance(mention.get(key), str) or not mention[key] or len(mention[key]) > 500
                for key in ("id", "elementId", "surface", "source")
            ):
                return False
            if mention["source"] not in {"completion", "helper", "deterministic", "llm-assisted"}:
                return False
            start, end, confidence = (
                mention.get("from"),
                mention.get("to"),
                mention.get("confidence"),
            )
            if (
                type(start) is not int
                or type(end) is not int
                or start < 0
                or end <= start
                or end > len(chapter.get("body", ""))
            ):
                return False
            if (
                not isinstance(confidence, (int, float))
                or isinstance(confidence, bool)
                or confidence < 0
                or confidence > 1
            ):
                return False
            if (
                start < previous_to
                or chapter["body"][start:end] != mention["surface"]
                or mention["id"] in mention_ids
            ):
                return False
            previous_to = end
            mention_ids.add(mention["id"])
        if not _valid_marks(chapter):
            return False
        ids.append(chapter["id"])
    return len(ids) == len(set(ids))


def _valid_marks(chapter: dict) -> bool:
    """Bold and italic are ranges over the body, exactly like a mention -- and held to the
    same standard: inside the text, in order, and never overlapping their own kind (the
    editor merges those into one range). Bold over italic is fine, they are separate kinds."""
    marks = chapter.get("marks", [])
    if not isinstance(marks, list) or len(marks) > 10_000:
        return False
    body_length = len(chapter.get("body", ""))
    previous_to: dict[str, int] = {}
    for mark in sorted(
        marks, key=lambda item: item.get("from", -1) if isinstance(item, dict) else -1
    ):
        if not isinstance(mark, dict) or mark.get("kind") not in {"bold", "italic"}:
            return False
        start, end = mark.get("from"), mark.get("to")
        if (
            type(start) is not int
            or type(end) is not int
            or start < 0
            or end <= start
            or end > body_length
        ):
            return False
        if start < previous_to.get(mark["kind"], -1):
            return False
        previous_to[mark["kind"]] = end
    return True
