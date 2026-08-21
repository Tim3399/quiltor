"""Pure projections for Quiltor's canonical signed timeline."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Mapping

MAX_SAFE_INTEGER = 9_007_199_254_740_991


@dataclass(frozen=True)
class CalendarDate:
    year: int
    month: int
    day: int
    weekday: int | None = None
    month_name: str = ""
    month_short_name: str = ""
    weekday_name: str = ""
    weekday_short_name: str = ""


def add_time(base_time: int, delta: int) -> int:
    if type(base_time) is not int or type(delta) is not int:
        raise TypeError("Canonical time and delta must be integers.")
    result = base_time + delta
    if any(abs(value) > MAX_SAFE_INTEGER for value in (base_time, delta, result)):
        raise OverflowError("Canonical time exceeds JavaScript's safe integer range.")
    return result


def _integer(system: Mapping[str, Any], key: str, default: int) -> int:
    value = system.get(key, default)
    if type(value) is not int:
        raise ValueError(f"{key} must be an integer.")
    if abs(value) > MAX_SAFE_INTEGER:
        raise ValueError(f"{key} exceeds the safe integer range.")
    return value


def _parts(value: CalendarDate | Mapping[str, Any]) -> tuple[int, int, int]:
    if isinstance(value, CalendarDate):
        return value.year, value.month, value.day
    try:
        parts = value["year"], value["month"], value["day"]
    except (KeyError, TypeError) as exc:
        raise ValueError("A calendar date needs year, month and day.") from exc
    if any(type(part) is not int for part in parts):
        raise ValueError("Calendar date components must be integers.")
    return parts


def _months(system: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    months = system.get("months", [])
    if not isinstance(months, list) or not months or any(
        not isinstance(month, Mapping)
        or type(month.get("dayCount")) is not int
        or month["dayCount"] <= 0
        for month in months
    ):
        raise ValueError("A custom calendar needs months with positive dayCount.")
    return months


def _ordinal(year: int, month: int, day: int, months: list[Mapping[str, Any]]) -> int:
    if month < 1 or month > len(months):
        raise ValueError("Month is outside the custom calendar.")
    if day < 1 or day > months[month - 1]["dayCount"]:
        raise ValueError("Day is outside the custom month.")
    year_length = sum(item["dayCount"] for item in months)
    return (year - 1) * year_length + sum(
        item["dayCount"] for item in months[: month - 1]
    ) + day - 1


def time_to_calendar_date(
    time_value: int, system: Mapping[str, Any]
) -> CalendarDate | None:
    if type(time_value) is not int:
        raise TypeError("Canonical time must be an integer.")
    if abs(time_value) > MAX_SAFE_INTEGER:
        raise ValueError("Canonical time exceeds the safe integer range.")
    kind = system.get("kind", "relative")
    if kind == "relative":
        return None
    if system.get("unit", "day") != "day":
        raise ValueError("Calendar projections require day units.")
    epoch_time = _integer(system, "epochTime", 0)
    epoch = (
        _integer(system, "epochYear", 1),
        _integer(system, "epochMonth", 1),
        _integer(system, "epochDay", 1),
    )
    delta = time_value - epoch_time
    if kind == "gregorian":
        try:
            projected = date(*epoch) + timedelta(days=delta)
        except (OverflowError, ValueError) as exc:
            raise ValueError("Gregorian date is outside the supported range.") from exc
        return CalendarDate(
            projected.year, projected.month, projected.day, projected.weekday(),
            projected.strftime("%B"), projected.strftime("%b"),
            projected.strftime("%A"), projected.strftime("%a"),
        )
    if kind != "custom":
        raise ValueError(f"Unknown time system kind: {kind}")
    months = _months(system)
    ordinal = _ordinal(*epoch, months) + delta
    year_length = sum(month["dayCount"] for month in months)
    year_offset, day_of_year = divmod(ordinal, year_length)
    month_index = 0
    while day_of_year >= months[month_index]["dayCount"]:
        day_of_year -= months[month_index]["dayCount"]
        month_index += 1
    weekdays = system.get("weekdays", [])
    weekdays = weekdays if isinstance(weekdays, list) else []
    epoch_weekday = _integer(system, "epochWeekday", 0)
    weekday = (epoch_weekday + delta) % len(weekdays) if weekdays else None
    month_item = months[month_index]
    weekday_item = weekdays[weekday] if weekday is not None else {}
    return CalendarDate(
        year_offset + 1, month_index + 1, day_of_year + 1, weekday,
        str(month_item.get("name", "")), str(month_item.get("shortName", "")),
        str(weekday_item.get("name", "")), str(weekday_item.get("shortName", "")),
    )


def calendar_date_to_time(
    value: CalendarDate | Mapping[str, Any], system: Mapping[str, Any]
) -> int:
    kind = system.get("kind", "relative")
    if kind == "relative":
        raise ValueError("Relative time does not have calendar dates.")
    if system.get("unit", "day") != "day":
        raise ValueError("Calendar projections require day units.")
    year, month, day = _parts(value)
    epoch_time = _integer(system, "epochTime", 0)
    epoch = (
        _integer(system, "epochYear", 1), _integer(system, "epochMonth", 1),
        _integer(system, "epochDay", 1),
    )
    if kind == "gregorian":
        try:
            return epoch_time + (date(year, month, day) - date(*epoch)).days
        except ValueError as exc:
            raise ValueError("Invalid Gregorian date.") from exc
    if kind != "custom":
        raise ValueError(f"Unknown time system kind: {kind}")
    months = _months(system)
    return epoch_time + _ordinal(year, month, day, months) - _ordinal(*epoch, months)


class _FormatValues(dict[str, Any]):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def format_time(time_value: int, system: Mapping[str, Any]) -> str:
    kind = system.get("kind", "relative")
    if kind == "relative":
        if type(time_value) is not int:
            raise TypeError("Canonical time must be an integer.")
        return "t0" if time_value == 0 else f"t{time_value:+d}"
    projected = time_to_calendar_date(time_value, system)
    assert projected is not None
    era_name = str(system.get("eraName", ""))
    era_abbreviation = str(system.get("eraAbbreviation", ""))
    values = _FormatValues(
        year=projected.year, month=projected.month, day=projected.day,
        monthName=projected.month_name, monthShortName=projected.month_short_name,
        weekdayName=projected.weekday_name, weekdayShortName=projected.weekday_short_name,
        eraName=era_name, eraAbbreviation=era_abbreviation,
        era=era_abbreviation or era_name, time=time_value,
    )
    template = system.get("displayFormat")
    if not isinstance(template, str) or not template:
        template = (
            "{year:04d}-{month:02d}-{day:02d}"
            if kind == "gregorian"
            else "{day} {monthName}, {year} {era}"
        )
    try:
        return template.format_map(values).strip()
    except (ValueError, TypeError):
        return f"{projected.year:04d}-{projected.month:02d}-{projected.day:02d}"
