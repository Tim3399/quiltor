"""Explicit forward-only SQLite migrations."""

from __future__ import annotations

import sqlite3

from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.schema import SCHEMA_VERSION
from quiltor.infrastructure.persistence.sqlite.temporal import migrate_legacy_state
from quiltor.infrastructure.persistence.sqlite.time_system import ensure_primary


def migrate(database: sqlite3.Connection, version: int) -> None:
    """Apply every missing step; each migration remains idempotent."""

    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('manuscript_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('figures_revision','0')")
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
    database.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)",
        (str(SCHEMA_VERSION),),
    )


__all__ = ["migrate"]
