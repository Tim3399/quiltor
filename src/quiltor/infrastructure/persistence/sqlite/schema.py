"""SQLite schema creation and migration entry point."""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.connection import connection

SCHEMA_VERSION = 14

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manuscript_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  words_json TEXT NOT NULL DEFAULT '[]',
  characters_json TEXT NOT NULL DEFAULT '[]',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  story_time_start_moment_id TEXT REFERENCES timeline_moments(id) ON DELETE RESTRICT,
  story_time_end_moment_id TEXT REFERENCES timeline_moments(id) ON DELETE RESTRICT,
  story_time_extra_json TEXT NOT NULL DEFAULT '{}',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS chapter_folders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS manuscript_tree_items (
  id TEXT PRIMARY KEY,
  parent_folder_id TEXT REFERENCES chapter_folders(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('chapter','folder')),
  chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES chapter_folders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  CHECK (
    (kind='chapter' AND chapter_id IS NOT NULL AND folder_id IS NULL)
    OR
    (kind='folder' AND folder_id IS NOT NULL AND chapter_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS manuscript_tree_parent_position
  ON manuscript_tree_items(COALESCE(parent_folder_id, ''), position);
CREATE UNIQUE INDEX IF NOT EXISTS manuscript_tree_chapter_once
  ON manuscript_tree_items(chapter_id) WHERE chapter_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manuscript_tree_folder_once
  ON manuscript_tree_items(folder_id) WHERE folder_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS storyboards (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS storyboards_position
  ON storyboards(position, id);
CREATE TABLE IF NOT EXISTS storyboard_nodes (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('note','reference','storyboard','group')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL CHECK (width IS NULL OR width > 0),
  height REAL CHECK (height IS NULL OR height > 0),
  z_index INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (board_id, id),
  CHECK (
    (kind='reference' AND target_kind IN ('entity','place','timeline','chapter') AND target_id<>'')
    OR (kind='storyboard' AND target_kind='storyboard' AND target_id<>'')
    OR (kind IN ('note','group') AND target_kind='' AND target_id='')
  )
);
CREATE INDEX IF NOT EXISTS storyboard_nodes_board
  ON storyboard_nodes(board_id, position, id);
CREATE INDEX IF NOT EXISTS storyboard_nodes_position
  ON storyboard_nodes(position, id);
CREATE INDEX IF NOT EXISTS storyboard_nodes_target
  ON storyboard_nodes(target_kind, target_id);
CREATE TABLE IF NOT EXISTS storyboard_edges (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (board_id, source_node_id)
    REFERENCES storyboard_nodes(board_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, target_node_id)
    REFERENCES storyboard_nodes(board_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS storyboard_edges_board
  ON storyboard_edges(board_id, position, id);
CREATE INDEX IF NOT EXISTS storyboard_edges_position
  ON storyboard_edges(position, id);
CREATE INDEX IF NOT EXISTS storyboard_edges_source
  ON storyboard_edges(board_id, source_node_id);
CREATE INDEX IF NOT EXISTS storyboard_edges_target
  ON storyboard_edges(board_id, target_node_id);
CREATE TABLE IF NOT EXISTS figure_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  canvas_width INTEGER NOT NULL DEFAULT 2400,
  canvas_height INTEGER NOT NULL DEFAULT 1600,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS timeline_moments (
  id TEXT PRIMARY KEY,
  time INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  legacy_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS timeline_moments_time
  ON timeline_moments(time, position);
CREATE TABLE IF NOT EXISTS time_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('relative','gregorian','custom')),
  unit TEXT NOT NULL DEFAULT 'day' CHECK (unit IN ('day','abstract')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  era_name TEXT NOT NULL DEFAULT '',
  era_abbreviation TEXT NOT NULL DEFAULT '',
  epoch_time INTEGER NOT NULL DEFAULT 0,
  epoch_year INTEGER NOT NULL DEFAULT 1,
  epoch_month INTEGER NOT NULL DEFAULT 1,
  epoch_day INTEGER NOT NULL DEFAULT 1,
  epoch_weekday INTEGER NOT NULL DEFAULT 0,
  display_format TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_time_system
  ON time_systems(is_primary) WHERE is_primary=1;
CREATE TABLE IF NOT EXISTS calendar_months (
  time_system_id TEXT NOT NULL REFERENCES time_systems(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  day_count INTEGER NOT NULL CHECK (day_count > 0),
  extra_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (time_system_id, position)
);
CREATE TABLE IF NOT EXISTS calendar_weekdays (
  time_system_id TEXT NOT NULL REFERENCES time_systems(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (time_system_id, position)
);
CREATE TABLE IF NOT EXISTS figures (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','tier','ort','organisation','objekt','konzept')),
  label TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'ink',
  dashed INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  death_moment_id TEXT REFERENCES timeline_moments(id) ON DELETE SET NULL,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS profiles (
  figure_id TEXT PRIMARY KEY REFERENCES figures(id) ON DELETE CASCADE,
  age TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS profile_fields (
  figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (figure_id, field_id),
  UNIQUE (figure_id, position)
);
CREATE TABLE IF NOT EXISTS entity_aliases (
  element_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  extra_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (element_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS alias_lookup ON entity_aliases(normalized_alias);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'solid',
  directed INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS connections_source ON connections(source_id);
CREATE INDEX IF NOT EXISTS connections_target ON connections(target_id);
CREATE TABLE IF NOT EXISTS relationship_states (
  relationship_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  moment_id TEXT NOT NULL REFERENCES timeline_moments(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES figures(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES figures(id) ON DELETE CASCADE,
  active INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  directed INTEGER NOT NULL DEFAULT 0,
  style TEXT NOT NULL DEFAULT 'solid',
  extra_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (relationship_id, moment_id)
);
CREATE TABLE IF NOT EXISTS presence_states (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  moment_id TEXT REFERENCES timeline_moments(id) ON DELETE CASCADE,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS presence_by_element
  ON presence_states(element_id, moment_id);
CREATE INDEX IF NOT EXISTS presence_by_place
  ON presence_states(place_id, moment_id);
CREATE TABLE IF NOT EXISTS place_map_images (
  -- The id is the lowercase SHA-256 of `data`. Content addressing means the
  -- same map dropped twice occupies one row, and a served image can be cached
  -- forever because a different image can never answer to the same id.
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_interactions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  question TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS assistant_interactions_created
  ON assistant_interactions(created_at DESC);
"""


def _stored_version(path: Path) -> tuple[int, bool]:
    """Return the declared version and whether this is an existing world database."""

    if not path.exists() or path.stat().st_size == 0:
        return 0, False
    uri = f"{path.resolve().as_uri()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as database:
        has_tables = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1"
        ).fetchone()
        if has_tables is None:
            return 0, False
        has_meta = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'"
        ).fetchone()
        if has_meta is None:
            return 0, True
        current = database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    try:
        return (int(current[0]) if current else 0), True
    except (TypeError, ValueError) as error:
        raise ValueError("Database schema version is invalid.") from error


def _backup_database(source_path: Path, destination_path: Path) -> None:
    """Create a standalone snapshot, including changes held in a WAL."""

    with closing(sqlite3.connect(destination_path)) as destination:
        source_uri = f"{source_path.resolve().as_uri()}?mode=ro"
        with closing(sqlite3.connect(source_uri, uri=True)) as opened_source:
            opened_source.backup(destination)


def _migration_backup_path(database_path: Path, version: int) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
    return database_path.with_name(
        f"{database_path.stem}.pre-migration-v{version}-{timestamp}.sqlite3"
    )


def _initialize_in_place(database_path: Path, version: int) -> None:
    """Apply schema changes to a new database or an isolated staging copy."""

    # Import lazily: migrations intentionally calls focused story-world helpers,
    # while those modules remain independent of this schema entry point.
    from quiltor.infrastructure.persistence.sqlite.migrations import migrate

    with connection(database_path) as database:
        database.executescript(SCHEMA)
        migrate(database, version)


def _execute_schema(database: sqlite3.Connection) -> None:
    """Execute bootstrap DDL without ``executescript``'s implicit commit."""

    statement = ""
    for line in SCHEMA.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            database.execute(statement)
            statement = ""
    if statement.strip():
        raise ValueError("Schema contains an incomplete SQL statement.")


def _validate_migrated_database(database: sqlite3.Connection) -> None:
    integrity = database.execute("PRAGMA quick_check").fetchall()
    if [row[0] for row in integrity] != ["ok"]:
        raise ValueError("Migrated database failed its integrity check.")
    if database.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("Migrated database failed its foreign key check.")
    current = database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    if current is None or int(current[0]) != SCHEMA_VERSION:
        raise ValueError("Migration did not produce the current schema version.")


def initialize(path: Path | None = None) -> None:
    """Create the schema or safely migrate an existing older database."""

    database_path = path or config.DB
    database_path.parent.mkdir(parents=True, exist_ok=True)
    version, existing = _stored_version(database_path)
    if version < 0:
        raise ValueError(f"Database schema version {version} is invalid.")
    if version > SCHEMA_VERSION:
        raise ValueError(
            f"Database schema version {version} is newer than supported version {SCHEMA_VERSION}."
        )
    if existing and version == SCHEMA_VERSION:
        return
    if not existing:
        _initialize_in_place(database_path, 0)
        return

    # Hold SQLite's writer lock from snapshot through commit. The safety copy includes
    # committed WAL contents, and another writer cannot slip changes between snapshot and
    # migration. Individual DDL statements keep the migration transactional, so any failed
    # step rolls back without partially updating the active world.
    safety_path = _migration_backup_path(database_path, version)
    safety_temp = safety_path.with_suffix(".tmp")
    database = None
    try:
        from quiltor.infrastructure.persistence.sqlite.connection import connect

        database = connect(database_path)
        database.execute("BEGIN IMMEDIATE")
        has_meta = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'"
        ).fetchone()
        locked_version = (
            database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
            if has_meta
            else None
        )
        observed_version = int(locked_version[0]) if locked_version else 0
        if observed_version != version:
            raise RuntimeError("Database changed while migration was starting.")
        # sqlite3_backup cannot advance from the same connection while that connection
        # owns a write transaction. A second read-only handle observes the locked,
        # committed snapshot while the first handle prevents concurrent writers.
        _backup_database(database_path, safety_temp)
        os.replace(safety_temp, safety_path)
        _execute_schema(database)

        from quiltor.infrastructure.persistence.sqlite.migrations import migrate

        migrate(database, version)
        _validate_migrated_database(database)
        database.commit()
    except BaseException:
        if database is not None:
            database.rollback()
        raise
    finally:
        if database is not None:
            database.close()
        safety_temp.unlink(missing_ok=True)


__all__ = ["SCHEMA", "SCHEMA_VERSION", "initialize"]
