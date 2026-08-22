"""Normalized timeline, relationship-version, and presence persistence."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from quiltor.infrastructure.persistence.sqlite.codec import decode_extra


FIELDS_KEY = "__quiltor_temporal_fields__"
COLLECTIONS_KEY = "__quiltor_temporal_collections__"


def encode_extra(
    source: dict[str, Any],
    known: set[str],
    optional_fields: tuple[str, ...] = (),
) -> str:
    """Encode extension data and which optional legacy fields were present."""

    extra = {key: value for key, value in source.items() if key not in known}
    present = [field for field in optional_fields if field in source]
    if optional_fields:
        extra[FIELDS_KEY] = present
    return json.dumps(extra, ensure_ascii=False)


def decode(value: str) -> tuple[dict[str, Any], set[str] | None]:
    extra = decode_extra(value)
    if FIELDS_KEY not in extra:
        return extra, None
    raw_fields = extra.pop(FIELDS_KEY, [])
    fields = (
        {field for field in raw_fields if isinstance(field, str)}
        if isinstance(raw_fields, list)
        else set()
    )
    return extra, fields


def _canonical_moment_times(
    timeline: list[dict[str, Any]], existing: dict[str, int]
) -> dict[str, int]:
    """Resolve hidden signed time without coupling it to later UI reordering."""

    resolved: dict[str, int] = {}
    for position, moment in enumerate(timeline):
        moment_id = moment["id"]
        explicit = moment.get("time")
        if isinstance(explicit, int) and not isinstance(explicit, bool):
            resolved[moment_id] = explicit
            continue
        if moment_id in existing:
            resolved[moment_id] = existing[moment_id]
            continue
        previous = next(
            (
                resolved[prior["id"]]
                for prior in reversed(timeline[:position])
                if prior.get("id") in resolved
            ),
            None,
        )
        if previous is not None:
            resolved[moment_id] = previous + 1
            continue
        following = next(
            (
                existing[later["id"]]
                for later in timeline[position + 1 :]
                if later.get("id") in existing
            ),
            None,
        )
        resolved[moment_id] = following - 1 if following is not None else 0
    return resolved


def upsert_timeline_moments(
    database: sqlite3.Connection, timeline: list[dict[str, Any]]
) -> set[str]:
    existing = {
        row["id"]: row["time"] for row in database.execute("SELECT id,time FROM timeline_moments")
    }
    times = _canonical_moment_times(timeline, existing)
    identifiers: set[str] = set()
    for position, moment in enumerate(timeline):
        moment_id = moment["id"]
        identifiers.add(moment_id)
        database.execute(
            """
            INSERT INTO timeline_moments(
              id, time, position, title, legacy_date, note, extra_json
            ) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              time=excluded.time,
              position=excluded.position,
              title=excluded.title,
              legacy_date=excluded.legacy_date,
              note=excluded.note,
              extra_json=excluded.extra_json
            """,
            (
                moment_id,
                times[moment_id],
                position,
                moment.get("title", ""),
                moment.get("date", ""),
                moment.get("note", ""),
                encode_extra(
                    moment,
                    {"id", "title", "date", "note", "time", "position"},
                    ("title", "date", "note"),
                ),
            ),
        )
    return identifiers


def upsert_relationship_states(
    database: sqlite3.Connection,
    edges: list[dict[str, Any]],
    moment_ids: set[str],
) -> set[tuple[str, str]]:
    retained: set[tuple[str, str]] = set()
    for edge in edges:
        for version in edge.get("versions") or []:
            if not isinstance(version, dict) or version.get("momentId") not in moment_ids:
                continue
            key = (edge["id"], version["momentId"])
            retained.add(key)
            database.execute(
                """
                INSERT INTO relationship_states(
                  relationship_id, moment_id, source_id, target_id,
                  active, label, directed, style, extra_json
                ) VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(relationship_id, moment_id) DO UPDATE SET
                  source_id=excluded.source_id,
                  target_id=excluded.target_id,
                  active=excluded.active,
                  label=excluded.label,
                  directed=excluded.directed,
                  style=excluded.style,
                  extra_json=excluded.extra_json
                """,
                (
                    edge["id"],
                    version["momentId"],
                    version.get("from"),
                    version.get("to"),
                    int(bool(version.get("active"))),
                    version.get("label", ""),
                    int(bool(version.get("gerichtet"))),
                    version.get("style", "solid"),
                    encode_extra(
                        version,
                        {
                            "momentId",
                            "from",
                            "to",
                            "active",
                            "label",
                            "gerichtet",
                            "style",
                        },
                        ("from", "to", "active", "label", "gerichtet", "style"),
                    ),
                ),
            )
    return retained


def delete_missing_relationship_states(
    database: sqlite3.Connection, retained: set[tuple[str, str]]
) -> None:
    removed = [
        (row[0], row[1])
        for row in database.execute("SELECT relationship_id,moment_id FROM relationship_states")
        if (row[0], row[1]) not in retained
    ]
    if removed:
        database.executemany(
            "DELETE FROM relationship_states WHERE relationship_id=? AND moment_id=?",
            removed,
        )


def upsert_presence_states(
    database: sqlite3.Connection,
    presence: list[dict[str, Any]],
    figure_ids: set[str],
    place_ids: set[str],
    moment_ids: set[str],
) -> list[str]:
    valid_entries = [
        entry
        for entry in presence
        if isinstance(entry, dict)
        and entry.get("elementId") in figure_ids
        and entry.get("placeId") in place_ids
        and (entry.get("momentId") is None or entry.get("momentId") in moment_ids)
    ]
    # Last occurrence wins both for a transition and for a reused row id.
    seen_transitions: set[tuple[str, str | None]] = set()
    seen_ids: set[str] = set()
    deduplicated: list[dict[str, Any]] = []
    for entry in reversed(valid_entries):
        transition = (entry["elementId"], entry.get("momentId"))
        entry_id = entry["id"]
        if transition in seen_transitions or entry_id in seen_ids:
            continue
        seen_transitions.add(transition)
        seen_ids.add(entry_id)
        deduplicated.append(entry)
    deduplicated.reverse()

    retained: list[str] = []
    for entry in deduplicated:
        retained.append(entry["id"])
        database.execute(
            """
            INSERT INTO presence_states(id, element_id, place_id, moment_id, extra_json)
            VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              element_id=excluded.element_id,
              place_id=excluded.place_id,
              moment_id=excluded.moment_id,
              extra_json=excluded.extra_json
            """,
            (
                entry["id"],
                entry["elementId"],
                entry["placeId"],
                entry.get("momentId"),
                encode_extra(
                    entry,
                    {"id", "elementId", "placeId", "momentId"},
                    ("momentId",),
                ),
            ),
        )
    return retained


def migrate_legacy_state(database: sqlite3.Connection) -> None:
    """Move v3 temporal JSON into normalized rows in one idempotent transaction."""

    settings = database.execute("SELECT extra_json FROM figure_settings WHERE id=1").fetchone()
    settings_extra = decode_extra(settings["extra_json"]) if settings else {}
    collections = [key for key in ("timeline", "presence") if key in settings_extra]
    timeline = settings_extra.pop("timeline", [])
    presence = settings_extra.pop("presence", [])
    if collections:
        settings_extra[COLLECTIONS_KEY] = collections
    timeline = [
        moment
        for moment in timeline
        if isinstance(moment, dict) and isinstance(moment.get("id"), str) and bool(moment["id"])
    ]
    presence = [
        entry
        for entry in presence
        if isinstance(entry, dict) and isinstance(entry.get("id"), str) and bool(entry["id"])
    ]
    moment_ids = upsert_timeline_moments(database, timeline)

    figure_ids = {row[0] for row in database.execute("SELECT id FROM figures")}
    place_ids = {row[0] for row in database.execute("SELECT id FROM figures WHERE kind='ort'")}
    valid_edges: list[dict[str, Any]] = []
    for row in database.execute("SELECT id,extra_json FROM connections").fetchall():
        extra = decode_extra(row["extra_json"])
        had_versions = "versions" in extra
        versions = extra.pop("versions", [])
        sanitized_versions = []
        for version in versions if isinstance(versions, list) else []:
            if not isinstance(version, dict):
                continue
            sanitized = dict(version)
            if sanitized.get("from") not in figure_ids:
                sanitized.pop("from", None)
            if sanitized.get("to") not in figure_ids:
                sanitized.pop("to", None)
            sanitized_versions.append(sanitized)
        if had_versions:
            extra[COLLECTIONS_KEY] = ["versions"]
        valid_edges.append({"id": row["id"], "versions": sanitized_versions})
        database.execute(
            "UPDATE connections SET extra_json=? WHERE id=?",
            (json.dumps(extra, ensure_ascii=False), row["id"]),
        )
    upsert_relationship_states(database, valid_edges, moment_ids)
    upsert_presence_states(database, presence, figure_ids, place_ids, moment_ids)

    for row in database.execute("SELECT id,extra_json FROM figures").fetchall():
        extra = decode_extra(row["extra_json"])
        death_moment_id = extra.pop("diedMomentId", None)
        database.execute(
            "UPDATE figures SET death_moment_id=?,extra_json=? WHERE id=?",
            (
                death_moment_id if death_moment_id in moment_ids else None,
                json.dumps(extra, ensure_ascii=False),
                row["id"],
            ),
        )
    if settings:
        database.execute(
            "UPDATE figure_settings SET extra_json=? WHERE id=1",
            (json.dumps(settings_extra, ensure_ascii=False),),
        )


__all__ = [
    "COLLECTIONS_KEY",
    "decode",
    "delete_missing_relationship_states",
    "encode_extra",
    "migrate_legacy_state",
    "upsert_presence_states",
    "upsert_relationship_states",
    "upsert_timeline_moments",
]
