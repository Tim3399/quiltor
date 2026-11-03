"""Characterises rejection branches of the small story-world modules before typing them (T-19 P3)."""

from __future__ import annotations

import json
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any

from quiltor.domain.story_world.entity_resolution import normalize_entity_name, resolve_entity
from quiltor.domain.story_world.profile import normalize_profile
from quiltor.domain.story_world.time_system import (
    MAX_SAFE_INTEGER,
    add_time,
    calendar_date_to_time,
    format_time,
    time_to_calendar_date,
)
from quiltor.domain.story_world.world_state import WorldStateError, history_for, state_at

FIXTURE = json.loads(
    (Path(__file__).parents[2] / "contracts/fixtures/story-world/world-state.v1.json").read_text(
        encoding="utf-8"
    )
)


class EntityResolutionRejectionTests(unittest.TestCase):
    def test_a_non_string_name_normalizes_to_nothing(self) -> None:
        for value in (None, 5, ["Anna"], b"Anna"):
            with self.subTest(value=value):
                self.assertEqual(normalize_entity_name(value), "")

    def test_a_mention_that_matches_no_node_is_not_found(self) -> None:
        figures = {"nodes": [{"id": "anna", "name": "Anna"}], "edges": []}
        result = resolve_entity(figures, "Zacharias")
        self.assertEqual(result.status, "not_found")
        self.assertIsNone(result.resolved_id)
        self.assertEqual(result.candidates, [])

    def test_nodes_and_edges_that_are_not_lists_resolve_nothing(self) -> None:
        for figures in ({"nodes": "anna"}, {"nodes": {"anna": 1}}, {}, {"nodes": [5, None]}):
            with self.subTest(figures=figures):
                self.assertEqual(resolve_entity(figures, "anna").status, "not_found")
        malformed_edges = {"nodes": [{"id": "anna", "name": "Anna"}], "edges": "x"}
        self.assertEqual(resolve_entity(malformed_edges, "Anna").resolved_id, "anna")

    def test_a_mention_without_letters_is_not_found(self) -> None:
        figures = {"nodes": [{"id": "anna", "name": "Anna"}]}
        self.assertEqual(resolve_entity(figures, "  --  ").status, "not_found")


class ProfileProjectionTests(unittest.TestCase):
    def test_a_non_string_legacy_value_is_kept_beside_the_empty_projection(self) -> None:
        self.assertEqual(normalize_profile({"alter": 5}, "o"), {"alter": 5, "fields": []})

    def test_extra_that_is_not_a_list_is_kept_untouched(self) -> None:
        self.assertEqual(normalize_profile({"extra": "x"}, "o"), {"extra": "x", "fields": []})

    def test_a_malformed_extra_row_keeps_the_whole_list_and_stops_projecting(self) -> None:
        extras = [{"k": "a", "v": "b"}, 5, {"k": "c", "v": "d"}]
        result = normalize_profile({"extra": extras}, "o")
        self.assertEqual(result["extra"], extras)
        self.assertEqual(
            result["fields"], [{"id": "profile-field:o:extra:0", "key": "a", "value": "b"}]
        )

    def test_an_extra_row_with_non_string_parts_keeps_the_list(self) -> None:
        for row in ({"k": 1, "v": "x"}, {"k": "a", "v": 2}, {"k": "a"}):
            with self.subTest(row=row):
                result = normalize_profile({"extra": [row]}, "o")
                self.assertEqual(result["extra"], [row])
                self.assertEqual(result["fields"], [])

    def test_valid_extra_rows_become_fields_and_keep_their_other_keys(self) -> None:
        result = normalize_profile({"extra": [{"k": "a", "v": "b", "note": "n"}]}, "o")
        self.assertNotIn("extra", result)
        self.assertEqual(
            result["fields"],
            [{"note": "n", "id": "profile-field:o:extra:0", "key": "a", "value": "b"}],
        )

    def test_legacy_values_project_with_their_labels_and_empty_ones_vanish(self) -> None:
        result = normalize_profile({"alter": "40", "rolle": ""}, "o")
        self.assertEqual(
            result["fields"], [{"id": "profile-field:o:legacy:alter", "key": "Alter", "value": "40"}]
        )

    def test_present_fields_win_and_only_invalid_leftovers_survive(self) -> None:
        source: dict[str, Any] = {
            "fields": [{"id": "f", "key": "k", "value": "v"}],
            "alter": "40",
            "rolle": 7,
            "extra": [{"k": "a", "v": "b"}],
        }
        result = normalize_profile(source, "o")
        self.assertEqual(result, {"fields": source["fields"], "rolle": 7})
        source["extra"] = [5]
        self.assertEqual(normalize_profile(source, "o")["extra"], [5])
        source["extra"] = "x"
        self.assertEqual(normalize_profile(source, "o")["extra"], "x")

    def test_the_source_profile_is_never_mutated(self) -> None:
        source = {"extra": [{"k": "a", "v": "b"}], "alter": 5}
        before = deepcopy(source)
        normalize_profile(source, "o")
        self.assertEqual(source, before)


class WorldStateRejectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.figures = deepcopy(FIXTURE["figures"])

    def test_an_unknown_moment_is_named(self) -> None:
        with self.assertRaises(WorldStateError) as caught:
            state_at(self.figures, "nowhere")
        self.assertEqual(str(caught.exception), "Unknown timeline moment: 'nowhere'.")

    def test_history_rejects_unknown_entities_and_predicates(self) -> None:
        with self.assertRaises(WorldStateError) as caught:
            history_for(self.figures, "nobody")
        self.assertEqual(str(caught.exception), "Unknown entity: 'nobody'.")
        with self.assertRaises(WorldStateError) as caught:
            history_for(self.figures, "ada", "mood")
        self.assertEqual(str(caught.exception), "Unsupported entity predicate: 'mood'.")

    def test_a_predicate_limits_the_reported_changes(self) -> None:
        full = history_for(self.figures, "ada")
        for predicate in ("alive", "location"):
            with self.subTest(predicate=predicate):
                narrowed = history_for(self.figures, "ada", predicate)
                for entry in narrowed:
                    self.assertEqual(set(entry["changes"]), {predicate})
                self.assertEqual(
                    [entry["momentId"] for entry in narrowed],
                    [entry["momentId"] for entry in full if predicate in entry["changes"]],
                )

    def test_an_invalid_aggregate_is_refused_before_projection(self) -> None:
        self.figures["timeline"][0]["position"] = "first"
        with self.assertRaises(WorldStateError) as caught:
            state_at(self.figures, self.figures["timeline"][0]["id"])
        self.assertEqual(str(caught.exception), "Invalid figure state or dangling temporal reference.")


def _gregorian(**extra: Any) -> dict[str, Any]:
    return {"kind": "gregorian", "unit": "day", "epochTime": 0, **extra}


def _custom(**extra: Any) -> dict[str, Any]:
    return {
        "kind": "custom",
        "unit": "day",
        "months": [
            {"name": "Aster", "shortName": "Ast", "dayCount": 10},
            {"name": "Bram", "dayCount": 20},
        ],
        **extra,
    }


class TimeSystemRejectionTests(unittest.TestCase):
    def assertRaisesMessage(self, error: type[Exception], message: str, call: Any, *args: Any) -> None:
        with self.assertRaises(error) as caught:
            call(*args)
        self.assertEqual(str(caught.exception), message)

    def test_add_time_rejects_overflow_and_non_integers(self) -> None:
        self.assertEqual(add_time(MAX_SAFE_INTEGER - 1, 1), MAX_SAFE_INTEGER)
        self.assertRaisesMessage(
            OverflowError,
            "Canonical time exceeds JavaScript's safe integer range.",
            add_time,
            MAX_SAFE_INTEGER,
            1,
        )
        self.assertRaisesMessage(
            TypeError, "Canonical time and delta must be integers.", add_time, 1, 1.5
        )

    def test_epoch_fields_must_be_safe_integers(self) -> None:
        self.assertRaisesMessage(
            ValueError, "epochYear must be an integer.", time_to_calendar_date, 0, _gregorian(epochYear="1")
        )
        self.assertRaisesMessage(
            ValueError,
            "epochYear exceeds the safe integer range.",
            time_to_calendar_date,
            0,
            _gregorian(epochYear=MAX_SAFE_INTEGER + 1),
        )

    def test_time_must_be_a_safe_integer(self) -> None:
        self.assertRaisesMessage(
            TypeError, "Canonical time must be an integer.", time_to_calendar_date, 1.5, _gregorian()
        )
        self.assertRaisesMessage(
            ValueError,
            "Canonical time exceeds the safe integer range.",
            time_to_calendar_date,
            MAX_SAFE_INTEGER + 1,
            _gregorian(),
        )

    def test_relative_time_has_no_calendar_date(self) -> None:
        self.assertIsNone(time_to_calendar_date(5, {"kind": "relative"}))
        self.assertIsNone(time_to_calendar_date(5, {}))
        self.assertRaisesMessage(
            ValueError,
            "Relative time does not have calendar dates.",
            calendar_date_to_time,
            {"year": 1, "month": 1, "day": 1},
            {},
        )

    def test_gregorian_projection_outside_the_supported_range_is_refused(self) -> None:
        self.assertRaisesMessage(
            ValueError,
            "Gregorian date is outside the supported range.",
            time_to_calendar_date,
            10**15,
            _gregorian(),
        )

    def test_unknown_kinds_and_units_are_refused_in_both_directions(self) -> None:
        self.assertRaisesMessage(
            ValueError, "Unknown time system kind: lunar", time_to_calendar_date, 0, {"kind": "lunar"}
        )
        self.assertRaisesMessage(
            ValueError,
            "Unknown time system kind: lunar",
            calendar_date_to_time,
            {"year": 1, "month": 1, "day": 1},
            {"kind": "lunar"},
        )
        hourly = _gregorian(unit="hour")
        self.assertRaisesMessage(
            ValueError, "Calendar projections require day units.", time_to_calendar_date, 0, hourly
        )
        self.assertRaisesMessage(
            ValueError,
            "Calendar projections require day units.",
            calendar_date_to_time,
            {"year": 1, "month": 1, "day": 1},
            hourly,
        )

    def test_a_calendar_date_needs_integer_year_month_and_day(self) -> None:
        for value in (None, {"year": 1}, {"year": 1, "month": 1}, 5):
            with self.subTest(value=value):
                self.assertRaisesMessage(
                    ValueError,
                    "A calendar date needs year, month and day.",
                    calendar_date_to_time,
                    value,
                    _gregorian(),
                )
        self.assertRaisesMessage(
            ValueError,
            "Calendar date components must be integers.",
            calendar_date_to_time,
            {"year": 1, "month": "1", "day": 1},
            _gregorian(),
        )

    def test_an_impossible_gregorian_date_is_refused(self) -> None:
        self.assertRaisesMessage(
            ValueError,
            "Invalid Gregorian date.",
            calendar_date_to_time,
            {"year": 2024, "month": 2, "day": 30},
            _gregorian(),
        )

    def test_a_custom_calendar_needs_months_with_positive_day_counts(self) -> None:
        message = "A custom calendar needs months with positive dayCount."
        for months in (
            [],
            "x",
            [5],
            [{"dayCount": 0}],
            [{"dayCount": -3}],
            [{"dayCount": "3"}],
            [{"dayCount": True}],
            [{"name": "ok", "dayCount": 3}, {"name": "no"}],
        ):
            with self.subTest(months=months):
                self.assertRaisesMessage(
                    ValueError, message, time_to_calendar_date, 0, _custom(months=months)
                )
        self.assertRaisesMessage(
            ValueError,
            message,
            calendar_date_to_time,
            {"year": 1, "month": 1, "day": 1},
            {"kind": "custom", "unit": "day"},
        )

    def test_custom_dates_must_lie_inside_the_calendar(self) -> None:
        for value, message in (
            ({"year": 1, "month": 0, "day": 1}, "Month is outside the custom calendar."),
            ({"year": 1, "month": 3, "day": 1}, "Month is outside the custom calendar."),
            ({"year": 1, "month": 1, "day": 0}, "Day is outside the custom month."),
            ({"year": 1, "month": 1, "day": 11}, "Day is outside the custom month."),
        ):
            with self.subTest(value=value):
                self.assertRaisesMessage(ValueError, message, calendar_date_to_time, value, _custom())

    def test_custom_dates_round_trip_through_time(self) -> None:
        system = _custom()
        for time in (0, 9, 10, 29, 30, -1, -31):
            with self.subTest(time=time):
                projected = time_to_calendar_date(time, system)
                self.assertIsNotNone(projected)
                self.assertEqual(
                    calendar_date_to_time(
                        {
                            "year": getattr(projected, "year"),
                            "month": getattr(projected, "month"),
                            "day": getattr(projected, "day"),
                        },
                        system,
                    ),
                    time,
                )

    def test_formatting_rejects_non_integer_relative_time_and_formats_the_rest(self) -> None:
        self.assertRaisesMessage(
            TypeError, "Canonical time must be an integer.", format_time, 1.5, {"kind": "relative"}
        )
        self.assertEqual(format_time(0, {}), "t0")
        self.assertEqual(format_time(3, {}), "t+3")
        self.assertEqual(format_time(-3, {}), "t-3")

    def test_default_templates_depend_on_the_kind(self) -> None:
        self.assertEqual(format_time(0, _gregorian(epochYear=2024, epochMonth=3, epochDay=9)), "2024-03-09")
        self.assertEqual(format_time(0, _custom()), "1 Aster, 1")
        self.assertEqual(format_time(0, _custom(eraAbbreviation="n.E.")), "1 Aster, 1 n.E.")

    def test_unknown_placeholders_stay_literal_and_broken_templates_fall_back(self) -> None:
        self.assertEqual(format_time(0, _custom(displayFormat="{day}/{nope}")), "1/{nope}")
        fallback = format_time(0, _gregorian(displayFormat="{year:s}"))
        self.assertEqual(fallback, "0001-01-01")
        self.assertEqual(format_time(0, _gregorian(displayFormat="{year")), "0001-01-01")
        self.assertEqual(format_time(0, _gregorian(displayFormat="")), "0001-01-01")
        self.assertEqual(format_time(0, _gregorian(displayFormat=5)), "0001-01-01")


if __name__ == "__main__":
    unittest.main()
