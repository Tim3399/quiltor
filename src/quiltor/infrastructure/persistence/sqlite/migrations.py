"""Explicit forward-only SQLite migrations."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping

from quiltor.domain.story_world.profile import (
    LEGACY_PROFILE_FIELDS,
    legacy_extra_field_id,
    legacy_profile_field_id,
)
from quiltor.domain.storyboard import DEFAULT_STORYBOARD_ID, DEFAULT_STORYBOARD_TITLE
from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.schema import SCHEMA_VERSION
from quiltor.infrastructure.persistence.sqlite.temporal import migrate_legacy_state
from quiltor.infrastructure.persistence.sqlite.time_system import ensure_primary


def migrate(database: sqlite3.Connection, version: int) -> None:
    """Apply every missing step; each migration remains idempotent."""

    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('manuscript_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('figures_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('storyboards_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('storyboards_extra_json','{}')")
    if version < 2:
        database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('last_restore_at','')")
    if version < 3:
        database.execute(
            "INSERT OR IGNORE INTO meta(key,value) VALUES('owner_sub',?)",
            (config.LOCAL_OWNER,),
        )
    if version < 4:
        columns = {row[1] for row in database.execute("PRAGMA table_info(figures)")}
        if "death_moment_id" not in columns:
            database.execute(
                "ALTER TABLE figures ADD COLUMN death_moment_id TEXT "
                "REFERENCES timeline_moments(id) ON DELETE SET NULL"
            )
        migrate_legacy_state(database)
    if version < 5:
        ensure_primary(database)
    if version < 6:
        database.execute(
            "CREATE INDEX IF NOT EXISTS alias_lookup ON entity_aliases(normalized_alias)"
        )
    if version < 7:
        database.execute(
            "UPDATE meta SET value=? WHERE key='owner_sub' AND value=''",
            (config.LOCAL_OWNER,),
        )
    if version < 8:
        chapters_exist = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapters'"
        ).fetchone()
        if chapters_exist:
            columns = {row[1] for row in database.execute("PRAGMA table_info(chapters)")}
            if "story_time_start_moment_id" not in columns:
                database.execute(
                    "ALTER TABLE chapters ADD COLUMN story_time_start_moment_id TEXT "
                    "REFERENCES timeline_moments(id) ON DELETE RESTRICT"
                )
            if "story_time_end_moment_id" not in columns:
                database.execute(
                    "ALTER TABLE chapters ADD COLUMN story_time_end_moment_id TEXT "
                    "REFERENCES timeline_moments(id) ON DELETE RESTRICT"
                )
            if "story_time_extra_json" not in columns:
                database.execute(
                    "ALTER TABLE chapters ADD COLUMN story_time_extra_json TEXT "
                    "NOT NULL DEFAULT '{}'"
                )
            database.execute(
                "CREATE INDEX IF NOT EXISTS chapters_story_time_start "
                "ON chapters(story_time_start_moment_id)"
            )
            database.execute(
                "CREATE INDEX IF NOT EXISTS chapters_story_time_end "
                "ON chapters(story_time_end_moment_id)"
            )
    if version < 9:
        tables = {
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('chapters','manuscript_tree_items')"
            )
        }
        if tables == {"chapters", "manuscript_tree_items"}:
            database.execute(
                """
                INSERT OR IGNORE INTO manuscript_tree_items(
                  id,parent_folder_id,kind,chapter_id,folder_id,position,extra_json
                )
                SELECT 'chapter:' || id,NULL,'chapter',id,NULL,position,'{}'
                FROM chapters
                ORDER BY position
                """
            )
    if version < 10:
        profile_tables = {
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('profiles','profile_fields')"
            )
        }
        if profile_tables == {"profiles", "profile_fields"}:
            profile_field_columns = {
                row[1] for row in database.execute("PRAGMA table_info(profile_fields)")
            }
            if not {"field_id", "extra_json"} <= profile_field_columns:
                database.execute(
                    """
                    CREATE TABLE IF NOT EXISTS profile_fields_v10 (
                      figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
                      field_id TEXT NOT NULL,
                      position INTEGER NOT NULL,
                      label TEXT NOT NULL DEFAULT '',
                      value TEXT NOT NULL DEFAULT '',
                      extra_json TEXT NOT NULL DEFAULT '{}',
                      PRIMARY KEY (figure_id, field_id),
                      UNIQUE (figure_id, position)
                    )
                    """
                )
                for profile in database.execute(
                    "SELECT figure_id,age,role,appearance,origin,voice,extra_json "
                    "FROM profiles ORDER BY rowid"
                ).fetchall():
                    figure_id = profile[0]
                    existing = database.execute(
                        "SELECT label,value FROM profile_fields "
                        "WHERE figure_id=? ORDER BY position",
                        (figure_id,),
                    ).fetchall()
                    try:
                        profile_extensions = json.loads(profile[6])
                    except (TypeError, ValueError):
                        profile_extensions = None
                    has_canonical_fields = isinstance(profile_extensions, dict) and (
                        "fields" in profile_extensions
                    )
                    canonical_fields = (
                        profile_extensions.get("fields") if has_canonical_fields else None
                    )
                    if has_canonical_fields:
                        if not isinstance(canonical_fields, list):
                            raise ValueError("invalid canonical profile fields during migration")
                        seen_ids: set[str] = set()
                        migrated = []
                        for field in canonical_fields:
                            if (
                                not isinstance(field, Mapping)
                                or not isinstance(field.get("id"), str)
                                or not field["id"]
                                or field["id"] in seen_ids
                                or not isinstance(field.get("key"), str)
                                or not isinstance(field.get("value"), str)
                            ):
                                raise ValueError("invalid canonical profile field during migration")
                            seen_ids.add(field["id"])
                            migrated.append(
                                (
                                    field["id"],
                                    field["key"],
                                    field["value"],
                                    json.dumps(
                                        {
                                            key: value
                                            for key, value in field.items()
                                            if key not in {"id", "key", "value"}
                                        },
                                        ensure_ascii=False,
                                    ),
                                )
                            )
                        del profile_extensions["fields"]
                        database.execute(
                            "UPDATE profiles SET extra_json=? WHERE figure_id=?",
                            (
                                json.dumps(profile_extensions, ensure_ascii=False),
                                figure_id,
                            ),
                        )
                    else:
                        migrated = [
                            (
                                legacy_profile_field_id(figure_id, key),
                                label,
                                profile[column_index],
                                "{}",
                            )
                            for (key, label), column_index in zip(
                                LEGACY_PROFILE_FIELDS,
                                range(1, 6),
                                strict=True,
                            )
                            if profile[column_index]
                        ]
                        migrated.extend(
                            (
                                legacy_extra_field_id(figure_id, position),
                                field[0],
                                field[1],
                                "{}",
                            )
                            for position, field in enumerate(existing)
                        )
                    database.executemany(
                        "INSERT INTO profile_fields_v10("
                        "figure_id,field_id,position,label,value,extra_json"
                        ") VALUES(?,?,?,?,?,?)",
                        [
                            (figure_id, field_id, position, label, value, extra_json)
                            for position, (field_id, label, value, extra_json) in enumerate(
                                migrated
                            )
                        ],
                    )
                database.execute("DROP TABLE profile_fields")
                database.execute("ALTER TABLE profile_fields_v10 RENAME TO profile_fields")
    if version < 11:
        storyboards_exist = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='storyboards'"
        ).fetchone()
        if storyboards_exist:
            database.execute(
                """
                INSERT INTO storyboards(id,position,title,extra_json)
                SELECT ?,0,?,'{}'
                WHERE NOT EXISTS (SELECT 1 FROM storyboards)
                """,
                (DEFAULT_STORYBOARD_ID, DEFAULT_STORYBOARD_TITLE),
            )
    if version < 12:
        # The bootstrap script already creates the table for every database it
        # opens; repeating it here keeps the step readable on its own and costs
        # nothing, and the index is what makes the unreferenced-image sweep at
        # save time a scan of dates rather than of image bytes.
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS place_map_images (
              -- The id is the lowercase SHA-256 of `data`: one row per
              -- distinct map, and a served image that may be cached forever.
              id TEXT PRIMARY KEY,
              mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
              width INTEGER NOT NULL CHECK (width > 0),
              height INTEGER NOT NULL CHECK (height > 0),
              byte_size INTEGER NOT NULL CHECK (byte_size > 0),
              created_at TEXT NOT NULL,
              data BLOB NOT NULL
            )
            """
        )
        database.execute(
            "CREATE INDEX IF NOT EXISTS place_map_images_created ON place_map_images(created_at)"
        )
    database.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)",
        (str(SCHEMA_VERSION),),
    )


__all__ = ["migrate"]
