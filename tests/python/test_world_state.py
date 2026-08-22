import json
import unittest
from copy import deepcopy
from pathlib import Path

from quiltor.domain.story_world.world_state import (
    UNKNOWN,
    WorldStateError,
    history_for,
    state_after,
    state_at,
    state_before,
    state_diff,
)


FIXTURE = json.loads(
    (Path(__file__).parents[2] / "contracts/fixtures/story-world/world-state.v1.json").read_text(
        encoding="utf-8"
    )
)


class WorldStateResolverTests(unittest.TestCase):
    def setUp(self):
        self.figures = deepcopy(FIXTURE["figures"])

    def test_shared_fixture_projects_relationship_presence_and_death(self):
        for check in FIXTURE["checks"]:
            with self.subTest(moment=check["momentId"]):
                state = state_at(self.figures, check["momentId"])
                self.assertEqual(state["entities"]["ada"]["alive"], check["adaAlive"])
                self.assertEqual(state["entities"]["ada"]["location"], check["adaLocation"])
                self.assertEqual(state["entities"]["ben"]["location"], check["benLocation"])
                relationship = state["relationships"]["bond"]
                self.assertEqual(relationship["active"], check["relationshipActive"])
                self.assertEqual(relationship["label"], check["relationshipLabel"])
                self.assertEqual(relationship["from"], check["relationshipFrom"])
                self.assertEqual(relationship["directed"], check["relationshipDirected"])

    def test_before_excludes_and_at_after_include_the_selected_transition(self):
        before = state_before(self.figures, "break")
        at = state_at(self.figures, "break")
        after = state_after(self.figures, "break")
        self.assertEqual(before["entities"]["ada"]["location"], "harbor")
        self.assertTrue(before["relationships"]["bond"]["active"])
        self.assertEqual(at["entities"]["ada"]["location"], "tower")
        self.assertFalse(at["relationships"]["bond"]["active"])
        self.assertEqual(after["entities"], at["entities"])
        self.assertEqual(after["relationships"], at["relationships"])
        self.assertEqual(after["phase"], "after")

    def test_simultaneous_moments_use_position_as_the_tie_breaker(self):
        broken = state_at(self.figures, "break")["relationships"]["bond"]
        returned = state_at(self.figures, "return")["relationships"]["bond"]
        self.assertFalse(broken["active"])
        self.assertTrue(returned["active"])
        self.assertEqual(returned["from"], "ben")

    def test_unknown_is_not_false_for_unstated_life_and_location(self):
        state = state_at(self.figures, "prologue")
        self.assertEqual(state["entities"]["ben"]["alive"], UNKNOWN)
        self.assertEqual(state["entities"]["ben"]["location"], UNKNOWN)

    def test_diff_reports_only_fields_that_changed(self):
        diff = state_diff(self.figures, "prologue", "end")
        self.assertEqual(
            diff["entities"]["ada"],
            {
                "alive": {"from": True, "to": False},
                "location": {"from": "harbor", "to": "tower"},
            },
        )
        self.assertEqual(
            diff["entities"]["ben"]["location"],
            {"from": UNKNOWN, "to": "harbor"},
        )
        self.assertNotIn("active", diff["relationships"]["bond"])
        self.assertEqual(
            diff["relationships"]["bond"]["label"],
            {"from": "Freunde", "to": "Rivalen"},
        )

    def test_entity_history_is_chronological_and_filterable(self):
        self.assertEqual(
            history_for(self.figures, "ada"),
            [
                {
                    "momentId": "break",
                    "time": 4,
                    "position": 2,
                    "changes": {"location": {"from": "harbor", "to": "tower"}},
                },
                {
                    "momentId": "end",
                    "time": 8,
                    "position": 4,
                    "changes": {"alive": {"from": True, "to": False}},
                },
            ],
        )
        self.assertEqual(
            [item["momentId"] for item in history_for(self.figures, "ada", "alive")],
            ["end"],
        )

    def test_dangling_references_and_missing_canonical_time_are_errors(self):
        dangling = deepcopy(self.figures)
        dangling["presence"][0]["placeId"] = "missing"
        with self.assertRaises(WorldStateError):
            state_at(dangling, "start")
        missing_time = deepcopy(self.figures)
        missing_time["timeline"][0].pop("time")
        with self.assertRaisesRegex(WorldStateError, "canonical integer time"):
            state_at(missing_time, "start")
        duplicate_position = deepcopy(self.figures)
        duplicate_position["timeline"][3]["position"] = 2
        with self.assertRaisesRegex(WorldStateError, "unique"):
            state_at(duplicate_position, "start")


if __name__ == "__main__":
    unittest.main()
