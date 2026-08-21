import unittest

from backend.core.time_system import (
    CalendarDate,
    add_time,
    calendar_date_to_time,
    format_time,
    time_to_calendar_date,
)


class TimeSystemTest(unittest.TestCase):
    def gregorian(self):
        return {
            "kind": "gregorian",
            "unit": "day",
            "epochTime": 0,
            "epochYear": 2026,
            "epochMonth": 8,
            "epochDay": 18,
        }

    def custom(self):
        return {
            "kind": "custom",
            "unit": "day",
            "epochTime": 0,
            "epochYear": 417,
            "epochMonth": 1,
            "epochDay": 2,
            "epochWeekday": 1,
            "eraAbbreviation": "AF",
            "displayFormat": "{weekdayShortName} {day} {monthName}, {year} {era}",
            "months": [
                {"name": "Frostfall", "shortName": "Frost", "dayCount": 3},
                {"name": "Ember", "shortName": "Emb", "dayCount": 2},
            ],
            "weekdays": [
                {"name": "Firstday", "shortName": "First"},
                {"name": "Secondday", "shortName": "Second"},
                {"name": "Thirdday", "shortName": "Third"},
            ],
        }

    def test_relative_addition_and_formatting_use_signed_integer_time(self):
        self.assertEqual(add_time(0, 4), 4)
        self.assertEqual(add_time(0, -4), -4)
        self.assertEqual(format_time(-12, {"kind": "relative"}), "t-12")
        self.assertEqual(format_time(0, {"kind": "relative"}), "t0")
        self.assertEqual(format_time(27, {"kind": "relative"}), "t+27")
        with self.assertRaises(TypeError):
            add_time(0, 1.5)

    def test_gregorian_epoch_projects_both_directions_and_roundtrips(self):
        system = self.gregorian()
        projected = time_to_calendar_date(4, system)
        self.assertEqual(
            (projected.year, projected.month, projected.day, projected.weekday),
            (2026, 8, 22, 5),
        )
        before = time_to_calendar_date(-1, system)
        self.assertEqual((before.year, before.month, before.day), (2026, 8, 17))
        for time in (-365, -1, 0, 4, 365):
            projected = time_to_calendar_date(time, system)
            self.assertIsNotNone(projected)
            self.assertEqual(calendar_date_to_time(projected, system), time)

    def test_custom_calendar_rolls_month_year_and_negative_time(self):
        system = self.custom()
        self.assertEqual(
            time_to_calendar_date(2, system),
            CalendarDate(417, 2, 1, 0, "Ember", "Emb", "Firstday", "First"),
        )
        self.assertEqual(time_to_calendar_date(4, system).year, 418)
        before = time_to_calendar_date(-2, system)
        self.assertEqual((before.year, before.month, before.day), (416, 2, 2))
        for time in range(-12, 13):
            projected = time_to_calendar_date(time, system)
            self.assertEqual(calendar_date_to_time(projected, system), time)

    def test_custom_format_uses_month_weekday_and_era_without_changing_time(self):
        system = self.custom()
        self.assertEqual(format_time(0, system), "Second 2 Frostfall, 417 AF")
        changed = {**system, "eraAbbreviation": "NE"}
        self.assertEqual(format_time(0, changed), "Second 2 Frostfall, 417 NE")
        self.assertEqual(calendar_date_to_time(time_to_calendar_date(0, changed), changed), 0)

    def test_calendar_projection_rejects_abstract_units_and_invalid_custom_dates(self):
        with self.assertRaises(ValueError):
            time_to_calendar_date(0, {**self.gregorian(), "unit": "abstract"})
        with self.assertRaises(ValueError):
            calendar_date_to_time({"year": 1, "month": 3, "day": 1}, self.custom())


if __name__ == "__main__":
    unittest.main()
