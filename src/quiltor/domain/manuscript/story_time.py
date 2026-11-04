"""Story-time references attached to manuscript chapters.

Chapter list order is narrative order.  These references point into the separate
canonical world timeline and must never be used to reorder the manuscript.
"""

from __future__ import annotations

from dataclasses import dataclass

from quiltor.domain.json_values import as_array, as_object

MAX_STORY_TIME_ID_LENGTH = 200


@dataclass(frozen=True, slots=True)
class StoryTimeAnchorIssue:
    reason: str
    chapter_id: str = ""
    moment_id: str = ""


def valid_story_time_reference(value: object) -> bool:
    """Validate the transport-independent shape of one optional chapter anchor."""

    reference = as_object(value)
    if reference is None:
        return False
    start = reference.get("startMomentId")
    if not _valid_moment_id(start):
        return False
    if "endMomentId" not in reference:
        return True
    end = reference["endMomentId"]
    return _valid_moment_id(end) and end != start


def story_time_anchor_issue(
    manuscript: object,
    story_world: object,
) -> StoryTimeAnchorIssue | None:
    """Return the first cross-document story-time violation, if one exists.

    The comparison deliberately considers each chapter independently.  In
    particular, there is no monotonicity check across chapter order: a chapter
    anchored in the future may be followed by a flashback in the past.
    """

    document = as_object(manuscript)
    chapters = as_array(document.get("chapters")) if document is not None else None
    if chapters is None:
        return StoryTimeAnchorIssue("invalid_manuscript")
    anchored = [
        chapter
        for chapter in map(as_object, chapters)
        if chapter is not None and "storyTime" in chapter
    ]
    if not anchored:
        return None
    coordinates, duplicate_coordinates = _timeline_coordinates(story_world)
    if duplicate_coordinates:
        return StoryTimeAnchorIssue("ambiguous_timeline_coordinates")

    for chapter in anchored:
        raw_id = chapter.get("id", "")
        chapter_id = raw_id if isinstance(raw_id, str) else ""
        reference = as_object(chapter["storyTime"])
        if reference is None or not valid_story_time_reference(reference):
            return StoryTimeAnchorIssue("invalid_reference", chapter_id)
        start = reference["startMomentId"]
        if not isinstance(start, str) or start not in coordinates:
            return StoryTimeAnchorIssue("unknown_moment", chapter_id, str(start))
        end = reference.get("endMomentId")
        if end is None:
            continue
        if not isinstance(end, str) or end not in coordinates:
            return StoryTimeAnchorIssue("unknown_moment", chapter_id, str(end))
        if coordinates[end] < coordinates[start]:
            return StoryTimeAnchorIssue("reversed_range", chapter_id, end)
    return None


def _valid_moment_id(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and value == value.strip()
        and len(value) <= MAX_STORY_TIME_ID_LENGTH
    )


def _timeline_coordinates(
    story_world: object,
) -> tuple[dict[str, tuple[int, int]], bool]:
    world = as_object(story_world)
    timeline = as_array(world.get("timeline", [])) if world is not None else None
    if timeline is None:
        return {}, False
    coordinates: dict[str, tuple[int, int]] = {}
    seen: set[tuple[int, int]] = set()
    duplicate = False
    for fallback, raw_moment in enumerate(timeline):
        moment = as_object(raw_moment)
        if moment is None:
            continue
        moment_id = moment.get("id")
        if not isinstance(moment_id, str) or not _valid_moment_id(moment_id):
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
        coordinates[moment_id] = coordinate
    return coordinates, duplicate


__all__ = [
    "MAX_STORY_TIME_ID_LENGTH",
    "StoryTimeAnchorIssue",
    "story_time_anchor_issue",
    "valid_story_time_reference",
]
