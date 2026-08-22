"""Story-time references attached to manuscript chapters.

Chapter list order is narrative order.  These references point into the separate
canonical world timeline and must never be used to reorder the manuscript.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


MAX_STORY_TIME_ID_LENGTH = 200


@dataclass(frozen=True, slots=True)
class StoryTimeAnchorIssue:
    reason: str
    chapter_id: str = ""
    moment_id: str = ""


def valid_story_time_reference(value: Any) -> bool:
    """Validate the transport-independent shape of one optional chapter anchor."""

    if not isinstance(value, dict):
        return False
    start = value.get("startMomentId")
    if not _valid_moment_id(start):
        return False
    if "endMomentId" not in value:
        return True
    end = value["endMomentId"]
    return _valid_moment_id(end) and end != start


def story_time_anchor_issue(
    manuscript: Any,
    story_world: Any,
) -> StoryTimeAnchorIssue | None:
    """Return the first cross-document story-time violation, if one exists.

    The comparison deliberately considers each chapter independently.  In
    particular, there is no monotonicity check across chapter order: a chapter
    anchored in the future may be followed by a flashback in the past.
    """

    if not isinstance(manuscript, dict) or not isinstance(manuscript.get("chapters"), list):
        return StoryTimeAnchorIssue("invalid_manuscript")
    anchored = [
        chapter
        for chapter in manuscript["chapters"]
        if isinstance(chapter, dict) and "storyTime" in chapter
    ]
    if not anchored:
        return None
    coordinates, duplicate_coordinates = _timeline_coordinates(story_world)
    if duplicate_coordinates:
        return StoryTimeAnchorIssue("ambiguous_timeline_coordinates")

    for chapter in anchored:
        chapter_id = chapter.get("id", "") if isinstance(chapter.get("id"), str) else ""
        reference = chapter["storyTime"]
        if not valid_story_time_reference(reference):
            return StoryTimeAnchorIssue("invalid_reference", chapter_id)
        start = reference["startMomentId"]
        if start not in coordinates:
            return StoryTimeAnchorIssue("unknown_moment", chapter_id, start)
        end = reference.get("endMomentId")
        if end is None:
            continue
        if end not in coordinates:
            return StoryTimeAnchorIssue("unknown_moment", chapter_id, end)
        if coordinates[end] < coordinates[start]:
            return StoryTimeAnchorIssue("reversed_range", chapter_id, end)
    return None


def _valid_moment_id(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and value == value.strip()
        and len(value) <= MAX_STORY_TIME_ID_LENGTH
    )


def _timeline_coordinates(
    story_world: Any,
) -> tuple[dict[str, tuple[int, int]], bool]:
    if not isinstance(story_world, dict) or not isinstance(story_world.get("timeline", []), list):
        return {}, False
    coordinates: dict[str, tuple[int, int]] = {}
    seen: set[tuple[int, int]] = set()
    duplicate = False
    for fallback, moment in enumerate(story_world.get("timeline", [])):
        if not isinstance(moment, dict) or not _valid_moment_id(moment.get("id")):
            continue
        time = moment.get("time")
        coordinate = (
            time if type(time) is int else fallback,
            # SQLite writes timeline position from the incoming array index.  Do
            # not trust a stale transport ``position`` when predicting range order.
            fallback,
        )
        if coordinate in seen:
            duplicate = True
        seen.add(coordinate)
        coordinates[moment["id"]] = coordinate
    return coordinates, duplicate


__all__ = [
    "MAX_STORY_TIME_ID_LENGTH",
    "StoryTimeAnchorIssue",
    "story_time_anchor_issue",
    "valid_story_time_reference",
]
