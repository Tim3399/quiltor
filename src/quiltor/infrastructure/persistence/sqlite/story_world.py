"""SQLite mapping for the StoryWorld aggregate."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from quiltor.domain.story_world.entity_resolution import normalize_entity_name
from quiltor.infrastructure.persistence.sqlite import temporal, time_system
from quiltor.infrastructure.persistence.sqlite.codec import decode_extra, encode_extra
from quiltor.infrastructure.persistence.sqlite.connection import connection


def load(db_path: Path | None = None) -> dict[str, Any]:
    with connection(db_path) as database:
        settings = database.execute("SELECT * FROM figure_settings WHERE id=1").fetchone()
        result = decode_extra(settings["extra_json"]) if settings else {}
        raw_collections = result.pop(temporal.COLLECTIONS_KEY, [])
        temporal_collections = set(raw_collections) if isinstance(raw_collections, list) else set()
        if settings:
            result["canvasSize"] = {
                "w": settings["canvas_width"],
                "h": settings["canvas_height"],
            }
        timeline = []
        for row in database.execute("SELECT * FROM timeline_moments ORDER BY time,position"):
            moment, fields = temporal.decode(row["extra_json"])
            moment["id"] = row["id"]
            if fields is None or "title" in fields:
                moment["title"] = row["title"]
            if fields is None or "date" in fields:
                moment["date"] = row["legacy_date"]
            if fields is None or "note" in fields:
                moment["note"] = row["note"]
            moment["time"] = row["time"]
            moment["position"] = row["position"]
            timeline.append(moment)
        nodes = []
        for row in database.execute("SELECT * FROM figures ORDER BY position"):
            node = decode_extra(row["extra_json"])
            persisted_kind = node.get("type", row["kind"])
            node.update(
                id=row["id"],
                x=row["x"],
                y=row["y"],
                type=persisted_kind,
                label=row["label"],
                name=row["name"],
                sub=row["subtitle"],
                accent=row["accent"],
                dash=bool(row["dashed"]),
                pinned=bool(row["pinned"]),
            )
            if row["death_moment_id"] is not None:
                node["diedMomentId"] = row["death_moment_id"]
            profile = database.execute(
                "SELECT * FROM profiles WHERE figure_id=?", (row["id"],)
            ).fetchone()
            if profile:
                profile_state = decode_extra(profile["extra_json"])
                profile_state.update(
                    alter=profile["age"],
                    rolle=profile["role"],
                    aussehen=profile["appearance"],
                    herkunft=profile["origin"],
                    stimme=profile["voice"],
                    notizen=profile["notes"],
                )
                profile_state["extra"] = [
                    {"k": field["label"], "v": field["value"]}
                    for field in database.execute(
                        """
                        SELECT * FROM profile_fields
                        WHERE figure_id=? ORDER BY position
                        """,
                        (row["id"],),
                    )
                ]
                node["profile"] = profile_state
            aliases = []
            for alias_row in database.execute(
                "SELECT * FROM entity_aliases WHERE element_id=? ORDER BY rowid",
                (row["id"],),
            ):
                alias = decode_extra(alias_row["extra_json"])
                alias.update(alias=alias_row["alias"], source=alias_row["source"])
                aliases.append(alias)
            if aliases:
                node["aliases"] = aliases
            nodes.append(node)
        edges = []
        for row in database.execute("SELECT * FROM connections ORDER BY rowid"):
            edge = decode_extra(row["extra_json"])
            raw_collections = edge.pop(temporal.COLLECTIONS_KEY, [])
            edge_collections = set(raw_collections) if isinstance(raw_collections, list) else set()
            edge.update(
                id=row["id"],
                **{"from": row["source_id"]},
                to=row["target_id"],
                label=row["label"],
                style=row["style"],
                gerichtet=bool(row["directed"]),
            )
            versions = []
            for version_row in database.execute(
                """
                SELECT relationship_states.*
                FROM relationship_states
                JOIN timeline_moments
                  ON timeline_moments.id=relationship_states.moment_id
                WHERE relationship_states.relationship_id=?
                ORDER BY timeline_moments.time,timeline_moments.position
                """,
                (row["id"],),
            ):
                version, fields = temporal.decode(version_row["extra_json"])
                version["momentId"] = version_row["moment_id"]
                values = {
                    "from": version_row["source_id"],
                    "to": version_row["target_id"],
                    "active": bool(version_row["active"]),
                    "label": version_row["label"],
                    "gerichtet": bool(version_row["directed"]),
                    "style": version_row["style"],
                }
                for field, value in values.items():
                    if fields is None or field in fields:
                        version[field] = value
                versions.append(version)
            if versions or "versions" in edge_collections:
                edge["versions"] = versions
            edges.append(edge)
        presence = []
        for row in database.execute("SELECT * FROM presence_states ORDER BY rowid"):
            entry, fields = temporal.decode(row["extra_json"])
            entry.update(
                id=row["id"],
                elementId=row["element_id"],
                placeId=row["place_id"],
            )
            if row["moment_id"] is not None or (fields is not None and "momentId" in fields):
                entry["momentId"] = row["moment_id"]
            presence.append(entry)
        result.update(nodes=nodes, edges=edges)
        result["timeSystem"] = time_system.load(database)
        if timeline or "timeline" in temporal_collections:
            result["timeline"] = timeline
        if presence or "presence" in temporal_collections:
            result["presence"] = presence
        return result


def _delete_missing_rows(
    database: sqlite3.Connection,
    table: str,
    id_column: str,
    retained_ids: set[str],
) -> None:
    removed = [
        (row[0],)
        for row in database.execute(f"SELECT {id_column} FROM {table}")
        if row[0] not in retained_ids
    ]
    if removed:
        database.executemany(f"DELETE FROM {table} WHERE {id_column}=?", removed)


def _sync_connection_order(database: sqlite3.Connection, ordered_ids: list[str]) -> None:
    current_ids = [row[0] for row in database.execute("SELECT id FROM connections ORDER BY rowid")]
    if current_ids == ordered_ids or not ordered_ids:
        return
    maximum = database.execute("SELECT COALESCE(MAX(rowid), 0) FROM connections").fetchone()[0]
    database.executemany(
        "UPDATE connections SET rowid=? WHERE id=?",
        [
            (maximum + position + 1, connection_id)
            for position, connection_id in enumerate(ordered_ids)
        ],
    )


def _sync_presence_order(database: sqlite3.Connection, ordered_ids: list[str]) -> None:
    current_ids = [
        row[0] for row in database.execute("SELECT id FROM presence_states ORDER BY rowid")
    ]
    if current_ids == ordered_ids or not ordered_ids:
        return
    maximum = database.execute("SELECT COALESCE(MAX(rowid), 0) FROM presence_states").fetchone()[0]
    database.executemany(
        "UPDATE presence_states SET rowid=? WHERE id=?",
        [(maximum + position + 1, entry_id) for position, entry_id in enumerate(ordered_ids)],
    )


def _sync(state: dict[str, Any], database: sqlite3.Connection) -> None:
    raw_schema = database.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='figures'"
    ).fetchone()[0]
    supported_kinds = {
        kind
        for kind in (
            "person",
            "tier",
            "ort",
            "organisation",
            "objekt",
            "konzept",
        )
        if f"'{kind}'" in raw_schema
    }
    timeline = [moment for moment in state.get("timeline") or [] if isinstance(moment, dict)]
    moment_ids = temporal.upsert_timeline_moments(database, timeline)
    if "timeSystem" in state:
        time_system.sync(database, state["timeSystem"])
    else:
        time_system.ensure_primary(database)
    for position, node in enumerate(state.get("nodes", [])):
        kind = node.get("type", "person")
        if kind not in {
            "person",
            "tier",
            "ort",
            "organisation",
            "objekt",
            "konzept",
        }:
            kind = "person"
        database_kind = kind if kind in supported_kinds else "person"
        extra_node = dict(node)
        if database_kind != kind:
            extra_node["type"] = kind
        database.execute(
            """
            INSERT INTO figures(
              id, position, x, y, kind, label, name, subtitle,
              accent, dashed, pinned, death_moment_id, extra_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              position=excluded.position,
              x=excluded.x,
              y=excluded.y,
              kind=excluded.kind,
              label=excluded.label,
              name=excluded.name,
              subtitle=excluded.subtitle,
              accent=excluded.accent,
              dashed=excluded.dashed,
              pinned=excluded.pinned,
              death_moment_id=excluded.death_moment_id,
              extra_json=excluded.extra_json
            """,
            (
                node["id"],
                position,
                float(node.get("x", 0)),
                float(node.get("y", 0)),
                database_kind,
                node.get("label", ""),
                node.get("name", "Ohne Namen"),
                node.get("sub", ""),
                node.get("accent", "ink"),
                int(bool(node.get("dash"))),
                int(bool(node.get("pinned"))),
                node.get("diedMomentId") if node.get("diedMomentId") in moment_ids else None,
                encode_extra(
                    extra_node,
                    {
                        "id",
                        "x",
                        "y",
                        "label",
                        "name",
                        "sub",
                        "accent",
                        "dash",
                        "pinned",
                        "diedMomentId",
                        "profile",
                        "aliases",
                    },
                ),
            ),
        )
    ids = {node["id"] for node in state.get("nodes", [])}

    for node in state.get("nodes", []):
        if "aliases" not in node:
            continue
        retained: set[str] = set()
        for alias in node.get("aliases") or []:
            if not isinstance(alias, dict):
                continue
            value = alias.get("alias", "")
            normalized = normalize_entity_name(value)
            if not normalized:
                continue
            retained.add(normalized)
            database.execute(
                """
                INSERT INTO entity_aliases(
                  element_id,alias,normalized_alias,source,extra_json
                ) VALUES(?,?,?,?,?)
                ON CONFLICT(element_id,normalized_alias) DO UPDATE SET
                  alias=excluded.alias,
                  source=excluded.source,
                  extra_json=excluded.extra_json
                """,
                (
                    node["id"],
                    value,
                    normalized,
                    alias.get("source", "manual"),
                    encode_extra(alias, {"alias", "source"}),
                ),
            )
        existing = {
            row[0]
            for row in database.execute(
                """
                SELECT normalized_alias FROM entity_aliases
                WHERE element_id=?
                """,
                (node["id"],),
            )
        }
        database.executemany(
            "DELETE FROM entity_aliases WHERE element_id=? AND normalized_alias=?",
            [(node["id"], normalized) for normalized in existing - retained],
        )

    for node in state.get("nodes", []):
        profile = node.get("profile") or {}
        database.execute(
            """
            INSERT INTO profiles(
              figure_id, age, role, appearance, origin, voice, notes, extra_json
            ) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(figure_id) DO UPDATE SET
              age=excluded.age,
              role=excluded.role,
              appearance=excluded.appearance,
              origin=excluded.origin,
              voice=excluded.voice,
              notes=excluded.notes,
              extra_json=excluded.extra_json
            """,
            (
                node["id"],
                profile.get("alter", ""),
                profile.get("rolle", ""),
                profile.get("aussehen", ""),
                profile.get("herkunft", ""),
                profile.get("stimme", ""),
                profile.get("notizen", ""),
                encode_extra(
                    profile,
                    {
                        "alter",
                        "rolle",
                        "aussehen",
                        "herkunft",
                        "stimme",
                        "notizen",
                        "extra",
                    },
                ),
            ),
        )
        fields = profile.get("extra") or []
        for index, field in enumerate(fields):
            database.execute(
                """
                INSERT INTO profile_fields(figure_id, position, label, value)
                VALUES(?,?,?,?)
                ON CONFLICT(figure_id, position) DO UPDATE SET
                  label=excluded.label,
                  value=excluded.value
                """,
                (node["id"], index, field.get("k", ""), field.get("v", "")),
            )
        database.execute(
            "DELETE FROM profile_fields WHERE figure_id=? AND position>=?",
            (node["id"], len(fields)),
        )

    valid_edges = [
        edge for edge in state.get("edges", []) if edge.get("from") in ids and edge.get("to") in ids
    ]
    for edge in valid_edges:
        edge_extra = {
            key: value
            for key, value in edge.items()
            if key
            not in {
                "id",
                "from",
                "to",
                "label",
                "style",
                "gerichtet",
                "versions",
            }
        }
        if "versions" in edge:
            edge_extra[temporal.COLLECTIONS_KEY] = ["versions"]
        database.execute(
            """
            INSERT INTO connections(
              id, source_id, target_id, label, style, directed, extra_json
            ) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              source_id=excluded.source_id,
              target_id=excluded.target_id,
              label=excluded.label,
              style=excluded.style,
              directed=excluded.directed,
              extra_json=excluded.extra_json
            """,
            (
                edge["id"],
                edge["from"],
                edge["to"],
                edge.get("label", ""),
                edge.get("style", "solid"),
                int(bool(edge.get("gerichtet"))),
                json.dumps(edge_extra, ensure_ascii=False),
            ),
        )
    ordered_connection_ids = [edge["id"] for edge in valid_edges]
    relationship_states = temporal.upsert_relationship_states(database, valid_edges, moment_ids)
    temporal.delete_missing_relationship_states(database, relationship_states)

    # Direct/legacy calls historically accepted any figure as a place.
    place_ids = ids
    presence_ids = temporal.upsert_presence_states(
        database,
        state.get("presence") or [],
        ids,
        place_ids,
        moment_ids,
    )
    _delete_missing_rows(database, "presence_states", "id", set(presence_ids))
    _sync_presence_order(database, presence_ids)
    _delete_missing_rows(database, "connections", "id", set(ordered_connection_ids))
    _sync_connection_order(database, ordered_connection_ids)
    _delete_missing_rows(database, "figures", "id", ids)
    _delete_missing_rows(database, "timeline_moments", "id", moment_ids)
    canvas = state.get("canvasSize") or {"w": 2400, "h": 1600}
    extra_settings = {
        key: value
        for key, value in state.items()
        if key
        not in {
            "nodes",
            "edges",
            "canvasSize",
            "timeline",
            "presence",
            "timeSystem",
        }
    }
    collections = [key for key in ("timeline", "presence") if key in state]
    if collections:
        extra_settings[temporal.COLLECTIONS_KEY] = collections
    settings_extra = json.dumps(extra_settings, ensure_ascii=False)
    database.execute(
        """
        INSERT INTO figure_settings(id, canvas_width, canvas_height, extra_json)
        VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          canvas_width=excluded.canvas_width,
          canvas_height=excluded.canvas_height,
          extra_json=excluded.extra_json
        """,
        (
            int(canvas.get("w", 2400)),
            int(canvas.get("h", 1600)),
            settings_extra,
        ),
    )


def save(
    state: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    db_path: Path | None = None,
) -> None:
    if conn is not None:
        _sync(state, conn)
        return
    with connection(db_path) as managed:
        _sync(state, managed)


__all__ = ["load", "save"]
