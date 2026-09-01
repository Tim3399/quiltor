"""SQLite schema creation and migration entry point."""

from __future__ import annotations

from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.connection import connection

SCHEMA_VERSION = 12

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


def initialize(path: Path | None = None) -> None:
    """Create the current schema and apply every forward-only migration."""

    # Import lazily: migrations intentionally calls focused story-world helpers,
    # while those modules remain independent of this schema entry point.
    from quiltor.infrastructure.persistence.sqlite.migrations import migrate

    database_path = path or config.DB
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with connection(database_path) as database:
        database.executescript(SCHEMA)
        current = database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        version = int(current[0]) if current else 0
        migrate(database, version)


__all__ = ["SCHEMA", "SCHEMA_VERSION", "initialize"]
