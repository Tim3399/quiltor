"""Persistence mapping for a story world's primary time system."""

from __future__ import annotations

import sqlite3
from typing import Any

from quiltor.infrastructure.persistence.sqlite.codec import decode_extra, encode_extra


def default_time_system() -> dict[str, Any]:
    return {
        "id": "primary",
        "name": "Relative time",
        "kind": "relative",
        "unit": "day",
        "eraName": "",
        "eraAbbreviation": "",
        "epochTime": 0,
        "epochYear": 1,
        "epochMonth": 1,
        "epochDay": 1,
        "epochWeekday": 0,
        "displayFormat": "",
        "months": [],
        "weekdays": [],
    }


def ensure_primary(database: sqlite3.Connection) -> None:
    if not database.execute("SELECT 1 FROM time_systems WHERE is_primary=1").fetchone():
        sync(database, default_time_system())


def sync(database: sqlite3.Connection, source: Any) -> None:
    system = source if isinstance(source, dict) else default_time_system()
    system_id = system.get("id") if isinstance(system.get("id"), str) else "primary"
    system_id = system_id or "primary"
    database.execute(
        "UPDATE time_systems SET is_primary=0 WHERE is_primary=1 AND id<>?",
        (system_id,),
    )
    database.execute(
        """
        INSERT INTO time_systems(
          id,name,kind,unit,is_primary,era_name,era_abbreviation,epoch_time,
          epoch_year,epoch_month,epoch_day,epoch_weekday,display_format,extra_json
        ) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,kind=excluded.kind,unit=excluded.unit,is_primary=1,
          era_name=excluded.era_name,era_abbreviation=excluded.era_abbreviation,
          epoch_time=excluded.epoch_time,epoch_year=excluded.epoch_year,
          epoch_month=excluded.epoch_month,epoch_day=excluded.epoch_day,
          epoch_weekday=excluded.epoch_weekday,display_format=excluded.display_format,
          extra_json=excluded.extra_json
        """,
        (
            system_id,
            system.get("name", "Relative time"),
            system.get("kind", "relative"),
            system.get("unit", "day"),
            system.get("eraName", ""),
            system.get("eraAbbreviation", ""),
            system.get("epochTime", 0),
            system.get("epochYear", 1),
            system.get("epochMonth", 1),
            system.get("epochDay", 1),
            system.get("epochWeekday", 0),
            system.get("displayFormat", ""),
            encode_extra(
                system,
                {
                    "id",
                    "name",
                    "kind",
                    "unit",
                    "eraName",
                    "eraAbbreviation",
                    "epochTime",
                    "epochYear",
                    "epochMonth",
                    "epochDay",
                    "epochWeekday",
                    "displayFormat",
                    "months",
                    "weekdays",
                },
            ),
        ),
    )
    months = [item for item in system.get("months", []) if isinstance(item, dict)]
    for position, month in enumerate(months):
        database.execute(
            """
            INSERT INTO calendar_months(
              time_system_id,position,name,short_name,day_count,extra_json
            ) VALUES(?,?,?,?,?,?)
            ON CONFLICT(time_system_id,position) DO UPDATE SET
              name=excluded.name,short_name=excluded.short_name,
              day_count=excluded.day_count,extra_json=excluded.extra_json
            """,
            (
                system_id,
                position,
                month.get("name", ""),
                month.get("shortName", ""),
                month.get("dayCount", 1),
                encode_extra(month, {"name", "shortName", "dayCount"}),
            ),
        )
    database.execute(
        "DELETE FROM calendar_months WHERE time_system_id=? AND position>=?",
        (system_id, len(months)),
    )
    weekdays = [item for item in system.get("weekdays", []) if isinstance(item, dict)]
    for position, weekday in enumerate(weekdays):
        database.execute(
            """
            INSERT INTO calendar_weekdays(
              time_system_id,position,name,short_name,extra_json
            ) VALUES(?,?,?,?,?)
            ON CONFLICT(time_system_id,position) DO UPDATE SET
              name=excluded.name,short_name=excluded.short_name,extra_json=excluded.extra_json
            """,
            (
                system_id,
                position,
                weekday.get("name", ""),
                weekday.get("shortName", ""),
                encode_extra(weekday, {"name", "shortName"}),
            ),
        )
    database.execute(
        "DELETE FROM calendar_weekdays WHERE time_system_id=? AND position>=?",
        (system_id, len(weekdays)),
    )
    database.execute("DELETE FROM time_systems WHERE id<>?", (system_id,))


def load(database: sqlite3.Connection) -> dict[str, Any]:
    row = database.execute("SELECT * FROM time_systems WHERE is_primary=1").fetchone()
    if row is None:
        ensure_primary(database)
        row = database.execute("SELECT * FROM time_systems WHERE is_primary=1").fetchone()
    assert row is not None
    system = decode_extra(row["extra_json"])
    system.update(
        id=row["id"],
        name=row["name"],
        kind=row["kind"],
        unit=row["unit"],
        eraName=row["era_name"],
        eraAbbreviation=row["era_abbreviation"],
        epochTime=row["epoch_time"],
        epochYear=row["epoch_year"],
        epochMonth=row["epoch_month"],
        epochDay=row["epoch_day"],
        epochWeekday=row["epoch_weekday"],
        displayFormat=row["display_format"],
    )
    system["months"] = [
        {
            **decode_extra(item["extra_json"]),
            "name": item["name"],
            "shortName": item["short_name"],
            "dayCount": item["day_count"],
        }
        for item in database.execute(
            "SELECT * FROM calendar_months WHERE time_system_id=? ORDER BY position",
            (row["id"],),
        )
    ]
    system["weekdays"] = [
        {
            **decode_extra(item["extra_json"]),
            "name": item["name"],
            "shortName": item["short_name"],
        }
        for item in database.execute(
            "SELECT * FROM calendar_weekdays WHERE time_system_id=? ORDER BY position",
            (row["id"],),
        )
    ]
    return system


__all__ = ["default_time_system", "ensure_primary", "load", "sync"]
