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
    database.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)",
        (str(SCHEMA_VERSION),),
    )


__all__ = ["migrate"]
