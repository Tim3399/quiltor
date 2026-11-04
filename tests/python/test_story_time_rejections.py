"""Characterises the story-time anchor rejections before the module was typed (T-19 P1)."""

from __future__ import annotations

import unittest
from typing import Any

from quiltor.domain.manuscript.story_time import StoryTimeAnchorIssue, story_time_anchor_issue
from tests.python.narrowing import present

TIMELINE = {
    "timeline": [
        {"id": "past", "time": 1},
        {"id": "present", "time": 5},
        {"id": "future", "time": 9},
    ]
}


def _chapters(*chapters: Any) -> dict[str, Any]:
    return {"chapters": list(chapters)}


class StoryTimeAnchorIssueTests(unittest.TestCase):
    def test_a_manuscript_without_a_chapter_list_is_invalid(self) -> None:
        for manuscript in (None, [], "x", {}, {"chapters": {}}):
            with self.subTest(manuscript=manuscript):
                self.assertEqual(
                    story_time_anchor_issue(manuscript, TIMELINE),
                    StoryTimeAnchorIssue("invalid_manuscript"),
                )

    def test_chapters_without_anchors_are_never_checked(self) -> None:
        manuscript = _chapters({"id": "a"}, "not a chapter", 5)
        self.assertIsNone(story_time_anchor_issue(manuscript, None))

    def test_a_malformed_reference_names_its_chapter(self) -> None:
        for reference in (
            None,
            {},
            {"startMomentId": ""},
            {"startMomentId": "past", "endMomentId": "past"},
        ):
            with self.subTest(reference=reference):
                manuscript = _chapters({"id": "c1", "storyTime": reference})
                self.assertEqual(
                    story_time_anchor_issue(manuscript, TIMELINE),
                    StoryTimeAnchorIssue("invalid_reference", "c1"),
                )

    def test_a_chapter_without_a_string_id_reports_an_empty_chapter_id(self) -> None:
        manuscript = _chapters({"id": 7, "storyTime": {"startMomentId": "ghost"}})
        self.assertEqual(
            story_time_anchor_issue(manuscript, TIMELINE),
            StoryTimeAnchorIssue("unknown_moment", "", "ghost"),
        )

    def test_unknown_start_and_end_moments_name_the_missing_one(self) -> None:
        start = _chapters({"id": "c1", "storyTime": {"startMomentId": "ghost"}})
        self.assertEqual(
            story_time_anchor_issue(start, TIMELINE),
            StoryTimeAnchorIssue("unknown_moment", "c1", "ghost"),
        )
        end = _chapters(
            {"id": "c1", "storyTime": {"startMomentId": "past", "endMomentId": "ghost"}}
        )
        self.assertEqual(
            story_time_anchor_issue(end, TIMELINE),
            StoryTimeAnchorIssue("unknown_moment", "c1", "ghost"),
        )

    def test_a_range_may_not_run_backwards_but_may_run_forwards(self) -> None:
        backwards = _chapters(
            {"id": "c1", "storyTime": {"startMomentId": "future", "endMomentId": "past"}}
        )
        self.assertEqual(
            story_time_anchor_issue(backwards, TIMELINE),
            StoryTimeAnchorIssue("reversed_range", "c1", "past"),
        )
        forwards = _chapters(
            {"id": "c1", "storyTime": {"startMomentId": "past", "endMomentId": "future"}}
        )
        self.assertIsNone(story_time_anchor_issue(forwards, TIMELINE))

    def test_the_first_violation_in_chapter_order_wins(self) -> None:
        manuscript = _chapters(
            {"id": "ok", "storyTime": {"startMomentId": "past"}},
            {"id": "bad", "storyTime": {"startMomentId": "ghost"}},
            {"id": "worse", "storyTime": {}},
        )
        self.assertEqual(
            story_time_anchor_issue(manuscript, TIMELINE),
            StoryTimeAnchorIssue("unknown_moment", "bad", "ghost"),
        )

    def test_a_story_world_without_a_timeline_list_knows_no_moments(self) -> None:
        manuscript = _chapters({"id": "c1", "storyTime": {"startMomentId": "past"}})
        for world in (None, [], {"timeline": "x"}, {"timeline": {}}):
            with self.subTest(world=world):
                self.assertEqual(
                    story_time_anchor_issue(manuscript, world),
                    StoryTimeAnchorIssue("unknown_moment", "c1", "past"),
                )
        self.assertEqual(
            story_time_anchor_issue(manuscript, {}),
            StoryTimeAnchorIssue("unknown_moment", "c1", "past"),
        )

    def test_unusable_timeline_entries_are_skipped_not_fatal(self) -> None:
        world = {
            "timeline": [
                "not a moment",
                {"id": ""},
                {"id": " padded "},
                {"id": "kept", "time": 3},
            ]
        }
        manuscript = _chapters({"id": "c1", "storyTime": {"startMomentId": "kept"}})
        self.assertIsNone(story_time_anchor_issue(manuscript, world))
        padded = _chapters({"id": "c1", "storyTime": {"startMomentId": "padded"}})
        self.assertEqual(
            present(story_time_anchor_issue(padded, world)).reason,
            "unknown_moment",
        )

    def test_a_non_integer_time_falls_back_to_the_array_index(self) -> None:
        world = {
            "timeline": [
                {"id": "late", "time": True},
                {"id": "early", "time": "soon"},
            ]
        }
        manuscript = _chapters(
            {"id": "c1", "storyTime": {"startMomentId": "late", "endMomentId": "early"}}
        )
        self.assertIsNone(story_time_anchor_issue(manuscript, world))
        manuscript = _chapters(
            {"id": "c1", "storyTime": {"startMomentId": "early", "endMomentId": "late"}}
        )
        self.assertEqual(
            story_time_anchor_issue(manuscript, world),
            StoryTimeAnchorIssue("reversed_range", "c1", "late"),
        )


if __name__ == "__main__":
    unittest.main()
