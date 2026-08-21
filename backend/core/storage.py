from __future__ import annotations

import json
import os
import sqlite3
import uuid
import re
import shutil
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

BASE = Path(__file__).resolve().parent.parent.parent
# QUILTOR_DATA_DIR wins outright (Docker sets it explicitly); QUILTOR_HOME is
# the packaged CLI's per-user default (see backend/llm/installer.py's HOME);
# with neither set, a source checkout / Docker keeps using BASE/data as before.
_HOME = Path(os.environ.get("QUILTOR_HOME", str(BASE)))
DATA = Path(os.environ.get("QUILTOR_DATA_DIR", str(_HOME / "data"))).resolve()
DB = DATA / ".no-active-world.sqlite3"
BACKUPS = DATA / "backups"
WORLDS = DATA / "worlds"
ACTIVE_WORLD_ID = ""

# The sub of the local single-user identity, and the owner every world gets when
# nobody claimed it. The empty string is load-bearing, not a placeholder: it is
# what initialize() has always written into meta.owner_sub, so naming it changes
# nothing about existing databases -- it only gives the value somewhere to be
# referred to from (backend/identity.py's LocalIdentity.MASTER_SUB).
#
# Every ownership check in this module is spelled `if owner_sub is not None`
# precisely so that "" is a real owner rather than "no owner". Keep it that way.
LOCAL_OWNER = ""

SCHEMA_VERSION = 5
MAX_BACKUPS = 40
BACKUP_INTERVAL = 300

# World ids are uuid.uuid4().hex (lowercase hex, 32 chars) -- the one format every
# world-id validator in this module (and server.py's resolve_world) should agree on.
WORLD_ID_RE = re.compile(r"[0-9a-f]{32}")

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
  extra_json TEXT NOT NULL DEFAULT '{}'
);
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
  position INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (figure_id, position)
);
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
CREATE TABLE IF NOT EXISTS assistant_interactions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  question TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS assistant_interactions_created ON assistant_interactions(created_at DESC);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a database connection whose lifetime is owned by the caller."""
    conn = sqlite3.connect(path or DB, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    return conn


@contextmanager
def connection(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Provide a transactional connection and always release its file handle.

    ``sqlite3.Connection`` commits or rolls back in ``__exit__`` but does not
    close there. Keeping the close in this owning context manager is important
    on Windows, where an otherwise successful request can leave the database
    locked until the next garbage-collection cycle.
    """
    conn = connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def initialize(path: Path | None = None) -> None:
    """Create only the schema and its internal forward migrations."""
    DATA.mkdir(parents=True, exist_ok=True)
    BACKUPS.mkdir(exist_ok=True)
    with connection(path) as conn:
        conn.executescript(SCHEMA)
        current = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        version = int(current[0]) if current else 0
        migrate(conn, version)


def world_db_path(world_id: str) -> Path:
    return WORLDS / f"{world_id}.sqlite3"


def get_world_owner(world_id: str) -> str | None:
    path = world_db_path(world_id)
    if not path.exists():
        return None
    try:
        with connection(path) as conn:
            row = conn.execute("SELECT value FROM meta WHERE key='owner_sub'").fetchone()
        return row[0] if row else ""
    except sqlite3.Error:
        return None


def list_worlds(owner_sub: str | None = None) -> list[dict[str, str]]:
    WORLDS.mkdir(exist_ok=True)
    candidates = [(path.stem, path) for path in sorted(WORLDS.glob("*.sqlite3"))]
    result = []
    for world_id, path in candidates:
        if not path.exists():
            continue
        try:
            with connection(path) as conn:
                row = conn.execute("SELECT value FROM meta WHERE key='world_title'").fetchone()
                repository_row = conn.execute(
                    "SELECT value FROM meta WHERE key='backup_endpoint'"
                ).fetchone()
                owner_row = conn.execute("SELECT value FROM meta WHERE key='owner_sub'").fetchone()
            if owner_sub is not None and (owner_row[0] if owner_row else "") != owner_sub:
                continue
            title = row[0] if row else world_id
            repository = repository_row[0] if repository_row else ""
            result.append(
                {
                    "id": world_id,
                    "title": title,
                    "backupUrl": repository,
                    "updated": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
                }
            )
        except sqlite3.Error:
            continue
    return result


def normalize_backup_url(value: str) -> str:
    """Validate a backup endpoint's base URL (see backend/backup/remote.py).

    HTTP is only tolerated on loopback: a backup carries the user's entire
    manuscript, and sending that unencrypted across a network is not something to
    let a typo decide. Everything else must be HTTPS.
    """
    url = value.strip().removesuffix("/")
    if not url:
        return ""
    match = re.fullmatch(r"(https?)://([A-Za-z0-9.-]+)(?::(\d+))?(/[A-Za-z0-9_./-]*)?", url)
    if not match:
        raise ValueError("Enter a valid backup endpoint URL, e.g. https://backup.example.com")
    scheme, host = match.group(1), match.group(2)
    if scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Use https:// for a remote backup endpoint.")
    return url


def create_world(title: str, backup_url: str = "", owner_sub: str | None = None) -> dict[str, str]:
    clean = " ".join(title.split()).strip()
    if not clean or len(clean) > 100:
        raise ValueError("Der Welttitel muss zwischen 1 und 100 Zeichen lang sein.")
    repository = normalize_backup_url(backup_url)
    WORLDS.mkdir(exist_ok=True)
    world_id = uuid.uuid4().hex
    path = WORLDS / f"{world_id}.sqlite3"
    initialize(path)
    with connection(path) as conn:
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('world_title',?)", (clean,))
        if repository:
            conn.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('backup_endpoint',?)", (repository,)
            )
        if owner_sub is not None:
            conn.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('owner_sub',?)", (owner_sub,)
            )
        conn.execute(
            "INSERT INTO chapters(id,position,title,body,note) VALUES(?,0,'','','')",
            (uuid.uuid4().hex,),
        )
    return {
        "id": world_id,
        "title": clean,
        "backupUrl": repository,
        "updated": datetime.now().isoformat(),
    }


def activate_world(world_id: str) -> dict[str, str]:
    global DB, BACKUPS, ACTIVE_WORLD_ID
    if WORLD_ID_RE.fullmatch(world_id):
        path = WORLDS / f"{world_id}.sqlite3"
    else:
        raise ValueError("Ungültige Welt.")
    if not path.exists():
        raise FileNotFoundError("Diese Welt existiert nicht.")
    initialize(path)
    DB = path
    ACTIVE_WORLD_ID = world_id
    BACKUPS = DATA / "backups" / world_id
    BACKUPS.mkdir(parents=True, exist_ok=True)
    world = next((item for item in list_worlds() if item["id"] == world_id), None)
    if not world:
        raise ValueError("Diese Welt ist nicht lesbar.")
    return world


def log_assistant_interaction(
    question: str,
    response: dict[str, Any] | None = None,
    error: str = "",
    db_path: Path | None = None,
) -> str:
    interaction_id = uuid.uuid4().hex
    with connection(db_path) as conn:
        conn.execute(
            "INSERT INTO assistant_interactions(id,created_at,question,response_json,status,error) VALUES(?,?,?,?,?,?)",
            (
                interaction_id,
                datetime.now().isoformat(),
                question,
                json.dumps(response, ensure_ascii=False) if response is not None else None,
                "failed" if error else "completed",
                error,
            ),
        )
    return interaction_id


def list_assistant_interactions(
    limit: int = 50, db_path: Path | None = None
) -> list[dict[str, Any]]:
    with connection(db_path) as conn:
        rows = conn.execute(
            "SELECT id,created_at,question,response_json,status,error FROM assistant_interactions ORDER BY created_at DESC LIMIT ?",
            (max(1, min(limit, 200)),),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "createdAt": row["created_at"],
            "question": row["question"],
            "response": json.loads(row["response_json"]) if row["response_json"] else None,
            "status": row["status"],
            "error": row["error"],
        }
        for row in rows
    ]


def delete_world(world_id: str, owner_sub: str | None = None) -> None:
    """Delete one local world without touching its configured remote repository."""
    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    if owner_sub is not None and get_world_owner(world_id) != owner_sub:
        raise PermissionError("This world belongs to a different account.")
    if world_id == ACTIVE_WORLD_ID:
        raise ValueError("The active world cannot be deleted.")
    path = WORLDS / f"{world_id}.sqlite3"
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    for database_file in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        database_file.unlink(missing_ok=True)
    shutil.rmtree(DATA / "backups" / world_id, ignore_errors=True)
    # The world's version history (backend/backup/snapshots.py). Deleting a world
    # has to take its snapshots with it -- they hold full copies of the manuscript.
    shutil.rmtree(DATA / "history" / world_id, ignore_errors=True)


def migrate(conn: sqlite3.Connection, version: int) -> None:
    """Apply explicit forward-only migrations; every step is idempotent."""
    conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('manuscript_revision','0')")
    conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('figures_revision','0')")
    if version < 2:
        conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('last_restore_at','')")
    if version < 3:
        # Worlds created before multi-tenancy land on LOCAL_OWNER ('') — invisible to
        # every OIDC user once owner_sub filtering is in effect, on purpose (not
        # auto-claimed), and exactly the owner the local single-user identity uses.
        conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('owner_sub',?)", (LOCAL_OWNER,))
    if version < 4:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(figures)")}
        if "death_moment_id" not in columns:
            conn.execute(
                "ALTER TABLE figures ADD COLUMN death_moment_id TEXT "
                "REFERENCES timeline_moments(id) ON DELETE SET NULL"
            )
        _migrate_temporal_state(conn)
    if version < 5:
        _ensure_primary_time_system(conn)
    conn.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),)
    )


class ConflictError(RuntimeError):
    pass


def revision(kind: str, conn: sqlite3.Connection | None = None, db_path: Path | None = None) -> int:
    own = conn is None
    db = conn or connect(db_path)
    try:
        row = db.execute("SELECT value FROM meta WHERE key=?", (f"{kind}_revision",)).fetchone()
        return int(row[0]) if row else 0
    finally:
        if own:
            db.close()


def save_with_revision(
    kind: str, state: dict[str, Any], expected: int | None, db_path: Path | None = None
) -> int:
    with connection(db_path) as conn:
        current = revision(kind, conn)
        if expected is not None and expected != current:
            raise ConflictError(f"Stand wurde zwischenzeitlich geändert ({expected} → {current}).")
        if kind == "manuscript":
            save_manuscript(state, conn)
        elif kind == "figures":
            save_figures(state, conn)
        else:
            raise ValueError("Unbekannter Dokumenttyp")
        updated = current + 1
        conn.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", (f"{kind}_revision", str(updated))
        )
        return updated


def _extra(source: dict[str, Any], known: set[str]) -> str:
    return json.dumps({k: v for k, v in source.items() if k not in known}, ensure_ascii=False)


def _decoded(value: str) -> dict[str, Any]:
    try:
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except ValueError:
        return {}


def _default_time_system() -> dict[str, Any]:
    return {
        "id": "primary", "name": "Relative time", "kind": "relative", "unit": "day",
        "eraName": "", "eraAbbreviation": "", "epochTime": 0, "epochYear": 1,
        "epochMonth": 1, "epochDay": 1, "epochWeekday": 0, "displayFormat": "",
        "months": [], "weekdays": [],
    }


def _ensure_primary_time_system(db: sqlite3.Connection) -> None:
    if not db.execute("SELECT 1 FROM time_systems WHERE is_primary=1").fetchone():
        _sync_time_system(db, _default_time_system())


def _sync_time_system(db: sqlite3.Connection, source: Any) -> None:
    system = source if isinstance(source, dict) else _default_time_system()
    system_id = system.get("id") if isinstance(system.get("id"), str) else "primary"
    system_id = system_id or "primary"
    db.execute("UPDATE time_systems SET is_primary=0 WHERE is_primary=1 AND id<>?", (system_id,))
    db.execute(
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
            system_id, system.get("name", "Relative time"), system.get("kind", "relative"),
            system.get("unit", "day"), system.get("eraName", ""),
            system.get("eraAbbreviation", ""), system.get("epochTime", 0),
            system.get("epochYear", 1), system.get("epochMonth", 1),
            system.get("epochDay", 1), system.get("epochWeekday", 0),
            system.get("displayFormat", ""),
            _extra(
                system,
                {
                    "id", "name", "kind", "unit", "eraName", "eraAbbreviation",
                    "epochTime", "epochYear", "epochMonth", "epochDay", "epochWeekday",
                    "displayFormat", "months", "weekdays",
                },
            ),
        ),
    )
    months = [item for item in system.get("months", []) if isinstance(item, dict)]
    for position, month in enumerate(months):
        db.execute(
            """
            INSERT INTO calendar_months(
              time_system_id,position,name,short_name,day_count,extra_json
            ) VALUES(?,?,?,?,?,?)
            ON CONFLICT(time_system_id,position) DO UPDATE SET
              name=excluded.name,short_name=excluded.short_name,
              day_count=excluded.day_count,extra_json=excluded.extra_json
            """,
            (
                system_id, position, month.get("name", ""), month.get("shortName", ""),
                month.get("dayCount", 1), _extra(month, {"name", "shortName", "dayCount"}),
            ),
        )
    db.execute(
        "DELETE FROM calendar_months WHERE time_system_id=? AND position>=?",
        (system_id, len(months)),
    )
    weekdays = [item for item in system.get("weekdays", []) if isinstance(item, dict)]
    for position, weekday in enumerate(weekdays):
        db.execute(
            """
            INSERT INTO calendar_weekdays(
              time_system_id,position,name,short_name,extra_json
            ) VALUES(?,?,?,?,?)
            ON CONFLICT(time_system_id,position) DO UPDATE SET
              name=excluded.name,short_name=excluded.short_name,extra_json=excluded.extra_json
            """,
            (
                system_id, position, weekday.get("name", ""), weekday.get("shortName", ""),
                _extra(weekday, {"name", "shortName"}),
            ),
        )
    db.execute(
        "DELETE FROM calendar_weekdays WHERE time_system_id=? AND position>=?",
        (system_id, len(weekdays)),
    )
    db.execute("DELETE FROM time_systems WHERE id<>?", (system_id,))


def _load_time_system(db: sqlite3.Connection) -> dict[str, Any]:
    row = db.execute("SELECT * FROM time_systems WHERE is_primary=1").fetchone()
    if row is None:
        _ensure_primary_time_system(db)
        row = db.execute("SELECT * FROM time_systems WHERE is_primary=1").fetchone()
    assert row is not None
    system = _decoded(row["extra_json"])
    system.update(
        id=row["id"], name=row["name"], kind=row["kind"], unit=row["unit"],
        eraName=row["era_name"], eraAbbreviation=row["era_abbreviation"],
        epochTime=row["epoch_time"], epochYear=row["epoch_year"],
        epochMonth=row["epoch_month"], epochDay=row["epoch_day"],
        epochWeekday=row["epoch_weekday"], displayFormat=row["display_format"],
    )
    system["months"] = [
        {
            **_decoded(item["extra_json"]), "name": item["name"],
            "shortName": item["short_name"], "dayCount": item["day_count"],
        }
        for item in db.execute(
            "SELECT * FROM calendar_months WHERE time_system_id=? ORDER BY position", (row["id"],)
        )
    ]
    system["weekdays"] = [
        {
            **_decoded(item["extra_json"]), "name": item["name"],
            "shortName": item["short_name"],
        }
        for item in db.execute(
            "SELECT * FROM calendar_weekdays WHERE time_system_id=? ORDER BY position", (row["id"],)
        )
    ]
    return system


_TEMPORAL_FIELDS = "__quiltor_temporal_fields__"
_TEMPORAL_COLLECTIONS = "__quiltor_temporal_collections__"


def _temporal_extra(
    source: dict[str, Any], known: set[str], optional_fields: tuple[str, ...] = ()
) -> str:
    """Encode extension data and which optional legacy wire fields were present.

    The normalized columns need concrete defaults, while FigureState historically
    distinguished an omitted field from an explicitly empty/false one. Keeping
    that small presence mask in extension JSON lets v4 remain wire-compatible.
    """
    extra = {key: value for key, value in source.items() if key not in known}
    present = [field for field in optional_fields if field in source]
    if optional_fields:
        extra[_TEMPORAL_FIELDS] = present
    return json.dumps(extra, ensure_ascii=False)


def _temporal_decoded(value: str) -> tuple[dict[str, Any], set[str] | None]:
    extra = _decoded(value)
    if _TEMPORAL_FIELDS not in extra:
        return extra, None
    raw_fields = extra.pop(_TEMPORAL_FIELDS, [])
    fields = {field for field in raw_fields if isinstance(field, str)} if isinstance(
        raw_fields, list
    ) else set()
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


def _upsert_timeline_moments(
    db: sqlite3.Connection, timeline: list[dict[str, Any]]
) -> set[str]:
    existing = {
        row["id"]: row["time"] for row in db.execute("SELECT id,time FROM timeline_moments")
    }
    times = _canonical_moment_times(timeline, existing)
    ids: set[str] = set()
    for position, moment in enumerate(timeline):
        moment_id = moment["id"]
        ids.add(moment_id)
        db.execute(
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
                _temporal_extra(
                    moment,
                    {"id", "title", "date", "note", "time", "position"},
                    ("title", "date", "note"),
                ),
            ),
        )
    return ids


def _upsert_relationship_states(
    db: sqlite3.Connection, edges: list[dict[str, Any]], moment_ids: set[str]
) -> set[tuple[str, str]]:
    retained: set[tuple[str, str]] = set()
    for edge in edges:
        for version in edge.get("versions") or []:
            if not isinstance(version, dict) or version.get("momentId") not in moment_ids:
                continue
            key = (edge["id"], version["momentId"])
            retained.add(key)
            db.execute(
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
                    _temporal_extra(
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


def _delete_missing_relationship_states(
    db: sqlite3.Connection, retained: set[tuple[str, str]]
) -> None:
    removed = [
        (row[0], row[1])
        for row in db.execute("SELECT relationship_id,moment_id FROM relationship_states")
        if (row[0], row[1]) not in retained
    ]
    if removed:
        db.executemany(
            "DELETE FROM relationship_states WHERE relationship_id=? AND moment_id=?", removed
        )


def _upsert_presence_states(
    db: sqlite3.Connection,
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
    # One element can have only one location transition at a moment (including
    # the moment-less base state). Walk backwards so malformed legacy payloads
    # and direct repository calls resolve duplicates deterministically: the last
    # occurrence wins, both for the logical transition and for a reused row ID.
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
        db.execute(
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
                _temporal_extra(
                    entry,
                    {"id", "elementId", "placeId", "momentId"},
                    ("momentId",),
                ),
            ),
        )
    return retained


def _migrate_temporal_state(db: sqlite3.Connection) -> None:
    """Move v3 temporal JSON into normalized rows in one idempotent transaction."""
    settings = db.execute("SELECT extra_json FROM figure_settings WHERE id=1").fetchone()
    settings_extra = _decoded(settings["extra_json"]) if settings else {}
    collections = [key for key in ("timeline", "presence") if key in settings_extra]
    timeline = settings_extra.pop("timeline", [])
    presence = settings_extra.pop("presence", [])
    if collections:
        settings_extra[_TEMPORAL_COLLECTIONS] = collections
    timeline = [
        moment
        for moment in timeline
        if isinstance(moment, dict)
        and isinstance(moment.get("id"), str)
        and bool(moment["id"])
    ]
    presence = [
        entry
        for entry in presence
        if isinstance(entry, dict)
        and isinstance(entry.get("id"), str)
        and bool(entry["id"])
    ]
    moment_ids = _upsert_timeline_moments(db, timeline)

    figure_ids = {row[0] for row in db.execute("SELECT id FROM figures")}
    place_ids = {row[0] for row in db.execute("SELECT id FROM figures WHERE kind='ort'")}
    valid_edges: list[dict[str, Any]] = []
    for row in db.execute("SELECT id,extra_json FROM connections").fetchall():
        extra = _decoded(row["extra_json"])
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
            extra[_TEMPORAL_COLLECTIONS] = ["versions"]
        valid_edges.append({"id": row["id"], "versions": sanitized_versions})
        db.execute(
            "UPDATE connections SET extra_json=? WHERE id=?",
            (json.dumps(extra, ensure_ascii=False), row["id"]),
        )
    _upsert_relationship_states(db, valid_edges, moment_ids)
    _upsert_presence_states(db, presence, figure_ids, place_ids, moment_ids)

    for row in db.execute("SELECT id,extra_json FROM figures").fetchall():
        extra = _decoded(row["extra_json"])
        death_moment_id = extra.pop("diedMomentId", None)
        db.execute(
            "UPDATE figures SET death_moment_id=?,extra_json=? WHERE id=?",
            (
                death_moment_id if death_moment_id in moment_ids else None,
                json.dumps(extra, ensure_ascii=False),
                row["id"],
            ),
        )
    if settings:
        db.execute(
            "UPDATE figure_settings SET extra_json=? WHERE id=1",
            (json.dumps(settings_extra, ensure_ascii=False),),
        )


def load_manuscript(db_path: Path | None = None) -> dict[str, Any]:
    with connection(db_path) as conn:
        settings = conn.execute("SELECT * FROM manuscript_settings WHERE id=1").fetchone()
        result = _decoded(settings["extra_json"]) if settings else {}
        result["words"] = json.loads(settings["words_json"]) if settings else []
        result["zeichenAktiv"] = json.loads(settings["characters_json"]) if settings else []
        result.setdefault("language", "de-DE")
        result.setdefault("grammarMode", "manual")
        chapters = []
        for row in conn.execute("SELECT * FROM chapters ORDER BY position"):
            chapter = _decoded(row["extra_json"])
            chapter.update(id=row["id"], title=row["title"], body=row["body"], note=row["note"])
            chapters.append(chapter)
        result["chapters"] = chapters
        return result


def save_manuscript(
    state: dict[str, Any], conn: sqlite3.Connection | None = None, db_path: Path | None = None
) -> None:
    own = conn is None
    db = conn or connect(db_path)
    try:
        with db:
            db.execute("DELETE FROM chapters")
            for position, chapter in enumerate(state.get("chapters", [])):
                db.execute(
                    "INSERT INTO chapters(id,position,title,body,note,extra_json) VALUES(?,?,?,?,?,?)",
                    (
                        chapter["id"],
                        position,
                        chapter.get("title", ""),
                        chapter.get("body", ""),
                        chapter.get("note", ""),
                        _extra(chapter, {"id", "title", "body", "note"}),
                    ),
                )
            db.execute(
                "INSERT OR REPLACE INTO manuscript_settings(id,words_json,characters_json,extra_json) VALUES(1,?,?,?)",
                (
                    json.dumps(state.get("words", []), ensure_ascii=False),
                    json.dumps(state.get("zeichenAktiv", []), ensure_ascii=False),
                    _extra(state, {"chapters", "words", "zeichenAktiv"}),
                ),
            )
    finally:
        if own:
            db.close()


def load_figures(db_path: Path | None = None) -> dict[str, Any]:
    with connection(db_path) as conn:
        settings = conn.execute("SELECT * FROM figure_settings WHERE id=1").fetchone()
        result = _decoded(settings["extra_json"]) if settings else {}
        raw_collections = result.pop(_TEMPORAL_COLLECTIONS, [])
        temporal_collections = set(raw_collections) if isinstance(raw_collections, list) else set()
        if settings:
            result["canvasSize"] = {"w": settings["canvas_width"], "h": settings["canvas_height"]}
        timeline = []
        for row in conn.execute("SELECT * FROM timeline_moments ORDER BY time,position"):
            moment, fields = _temporal_decoded(row["extra_json"])
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
        for row in conn.execute("SELECT * FROM figures ORDER BY position"):
            node = _decoded(row["extra_json"])
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
            profile = conn.execute(
                "SELECT * FROM profiles WHERE figure_id=?", (row["id"],)
            ).fetchone()
            if profile:
                p = _decoded(profile["extra_json"])
                p.update(
                    alter=profile["age"],
                    rolle=profile["role"],
                    aussehen=profile["appearance"],
                    herkunft=profile["origin"],
                    stimme=profile["voice"],
                    notizen=profile["notes"],
                )
                p["extra"] = [
                    {"k": f["label"], "v": f["value"]}
                    for f in conn.execute(
                        "SELECT * FROM profile_fields WHERE figure_id=? ORDER BY position",
                        (row["id"],),
                    )
                ]
                node["profile"] = p
            nodes.append(node)
        edges = []
        for row in conn.execute("SELECT * FROM connections ORDER BY rowid"):
            edge = _decoded(row["extra_json"])
            raw_collections = edge.pop(_TEMPORAL_COLLECTIONS, [])
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
            for version_row in conn.execute(
                """
                SELECT relationship_states.*
                FROM relationship_states
                JOIN timeline_moments ON timeline_moments.id=relationship_states.moment_id
                WHERE relationship_states.relationship_id=?
                ORDER BY timeline_moments.time,timeline_moments.position
                """,
                (row["id"],),
            ):
                version, fields = _temporal_decoded(version_row["extra_json"])
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
        for row in conn.execute("SELECT * FROM presence_states ORDER BY rowid"):
            entry, fields = _temporal_decoded(row["extra_json"])
            entry.update(
                id=row["id"], elementId=row["element_id"], placeId=row["place_id"]
            )
            if row["moment_id"] is not None or (fields is not None and "momentId" in fields):
                entry["momentId"] = row["moment_id"]
            presence.append(entry)
        result.update(nodes=nodes, edges=edges)
        result["timeSystem"] = _load_time_system(conn)
        if timeline or "timeline" in temporal_collections:
            result["timeline"] = timeline
        if presence or "presence" in temporal_collections:
            result["presence"] = presence
        return result


def _delete_missing_rows(
    db: sqlite3.Connection, table: str, id_column: str, retained_ids: set[str]
) -> None:
    """Delete only aggregate rows whose stable identifier left the payload.

    Reading the small identifier set first avoids a variable-length ``NOT IN``
    statement (and its SQLite parameter limit). ``table`` and ``id_column`` are
    private, call-site-owned schema identifiers rather than user input.
    """
    removed = [
        (row[0],)
        for row in db.execute(f"SELECT {id_column} FROM {table}")
        if row[0] not in retained_ids
    ]
    if removed:
        db.executemany(f"DELETE FROM {table} WHERE {id_column}=?", removed)


def _sync_connection_order(db: sqlite3.Connection, ordered_ids: list[str]) -> None:
    """Keep the legacy rowid-backed connection order without recreating rows.

    ``connections`` predates explicit positions and ``load_figures`` therefore
    orders it by rowid. Moving rows to fresh rowids preserves their primary-key
    identity (and future references to ``connections.id``) while retaining the
    existing API ordering contract. Unchanged order performs no writes.
    """
    current_ids = [row[0] for row in db.execute("SELECT id FROM connections ORDER BY rowid")]
    if current_ids == ordered_ids or not ordered_ids:
        return
    maximum = db.execute("SELECT COALESCE(MAX(rowid), 0) FROM connections").fetchone()[0]
    db.executemany(
        "UPDATE connections SET rowid=? WHERE id=?",
        [
            (maximum + position + 1, connection_id)
            for position, connection_id in enumerate(ordered_ids)
        ],
    )


def _sync_presence_order(db: sqlite3.Connection, ordered_ids: list[str]) -> None:
    """Preserve FigureState presence ordering without delete/reinsert churn."""
    current_ids = [row[0] for row in db.execute("SELECT id FROM presence_states ORDER BY rowid")]
    if current_ids == ordered_ids or not ordered_ids:
        return
    maximum = db.execute("SELECT COALESCE(MAX(rowid), 0) FROM presence_states").fetchone()[0]
    db.executemany(
        "UPDATE presence_states SET rowid=? WHERE id=?",
        [(maximum + position + 1, entry_id) for position, entry_id in enumerate(ordered_ids)],
    )


def _sync_figures(state: dict[str, Any], db: sqlite3.Connection) -> None:
    schema = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='figures'"
    ).fetchone()[0]
    supported_kinds = {
        kind
        for kind in ("person", "tier", "ort", "organisation", "objekt", "konzept")
        if f"'{kind}'" in schema
    }
    timeline = [
        moment for moment in state.get("timeline") or [] if isinstance(moment, dict)
    ]
    moment_ids = _upsert_timeline_moments(db, timeline)
    if "timeSystem" in state:
        _sync_time_system(db, state["timeSystem"])
    else:
        # Older/partial FigureState clients may omit this optional aggregate.
        # Preserve an existing calendar instead of silently resetting it.
        _ensure_primary_time_system(db)
    for position, node in enumerate(state.get("nodes", [])):
        kind = node.get("type", "person")
        if kind not in {"person", "tier", "ort", "organisation", "objekt", "konzept"}:
            kind = "person"
        database_kind = kind if kind in supported_kinds else "person"
        extra_node = dict(node)
        if database_kind != kind:
            extra_node["type"] = kind
        db.execute(
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
                _extra(
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
                    },
                ),
            ),
        )
    ids = {node["id"] for node in state.get("nodes", [])}

    for node in state.get("nodes", []):
        profile = node.get("profile") or {}
        db.execute(
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
                _extra(
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
            db.execute(
                """
                INSERT INTO profile_fields(figure_id, position, label, value)
                VALUES(?,?,?,?)
                ON CONFLICT(figure_id, position) DO UPDATE SET
                  label=excluded.label,
                  value=excluded.value
                """,
                (node["id"], index, field.get("k", ""), field.get("v", "")),
            )
        db.execute(
            "DELETE FROM profile_fields WHERE figure_id=? AND position>=?",
            (node["id"], len(fields)),
        )

    valid_edges = [
        edge
        for edge in state.get("edges", [])
        if edge.get("from") in ids and edge.get("to") in ids
    ]
    for edge in valid_edges:
        edge_extra = {
            key: value
            for key, value in edge.items()
            if key not in {"id", "from", "to", "label", "style", "gerichtet", "versions"}
        }
        if "versions" in edge:
            edge_extra[_TEMPORAL_COLLECTIONS] = ["versions"]
        db.execute(
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
    relationship_states = _upsert_relationship_states(db, valid_edges, moment_ids)
    _delete_missing_relationship_states(db, relationship_states)

    # API validation enforces that placeId is an ``ort``. The repository keeps
    # accepting legacy/direct FigureState calls that historically used any
    # figure as a place, while the v3 migration below cleans those old rows.
    place_ids = ids
    presence_ids = _upsert_presence_states(
        db, state.get("presence") or [], ids, place_ids, moment_ids
    )
    _delete_missing_rows(db, "presence_states", "id", set(presence_ids))
    _sync_presence_order(db, presence_ids)
    _delete_missing_rows(db, "connections", "id", set(ordered_connection_ids))
    _sync_connection_order(db, ordered_connection_ids)
    # Connections are rewired/deleted first so removing a figure cannot
    # cascade-delete a retained connection that just changed endpoints.
    _delete_missing_rows(db, "figures", "id", ids)
    _delete_missing_rows(db, "timeline_moments", "id", moment_ids)
    canvas = state.get("canvasSize") or {"w": 2400, "h": 1600}
    extra_settings = {
        key: value
        for key, value in state.items()
        if key not in {"nodes", "edges", "canvasSize", "timeline", "presence", "timeSystem"}
    }
    collections = [key for key in ("timeline", "presence") if key in state]
    if collections:
        extra_settings[_TEMPORAL_COLLECTIONS] = collections
    settings_extra = json.dumps(extra_settings, ensure_ascii=False)
    db.execute(
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


def save_figures(
    state: dict[str, Any], conn: sqlite3.Connection | None = None, db_path: Path | None = None
) -> None:
    if conn is not None:
        _sync_figures(state, conn)
        return
    with connection(db_path) as managed:
        _sync_figures(state, managed)


def backup_if_due(
    force: bool = False, db_path: Path | None = None, backups_dir: Path | None = None
) -> None:
    backups_dir = backups_dir or BACKUPS
    backups_dir.mkdir(exist_ok=True)
    files = sorted(backups_dir.glob("backup-*.sqlite3"))
    if (
        not force
        and files
        and datetime.now().timestamp() - files[-1].stat().st_mtime < BACKUP_INTERVAL
    ):
        return
    target = backups_dir / f"backup-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3"
    temp = target.with_suffix(".tmp")
    source, destination = connect(db_path), sqlite3.connect(temp)
    try:
        with source, destination:
            source.backup(destination)
    finally:
        # sqlite3.Connection's context manager only commits/rolls back a transaction --
        # it never closes the connection. Without an explicit close(), `temp` stays
        # open (and locked on Windows), and os.replace() below fails with WinError 32.
        source.close()
        destination.close()
    os.replace(temp, target)
    for old in files[: max(0, len(files) - MAX_BACKUPS + 1)]:
        old.unlink(missing_ok=True)


def list_backups(backups_dir: Path | None = None) -> list[dict[str, Any]]:
    backups_dir = backups_dir or BACKUPS
    return [
        {
            "name": path.name,
            "created": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "size": path.stat().st_size,
        }
        for path in sorted(backups_dir.glob("backup-*.sqlite3"), reverse=True)
    ]


def restore_backup(name: str, db_path: Path | None = None, backups_dir: Path | None = None) -> None:
    backups_dir = backups_dir or BACKUPS
    if Path(name).name != name or not name.startswith("backup-") or not name.endswith(".sqlite3"):
        raise ValueError("Ungültiger Sicherungsname")
    source_path = backups_dir / name
    if not source_path.exists():
        raise FileNotFoundError(name)
    backup_if_due(force=True, db_path=db_path, backups_dir=backups_dir)
    source, destination = sqlite3.connect(source_path), connect(db_path)
    try:
        source.backup(destination)
    finally:
        source.close()
        destination.close()
    # A snapshot may come from an older app version. Upgrade it before any load
    # or revision bookkeeping touches tables introduced after that snapshot.
    initialize(db_path)
    with connection(db_path) as destination:
        destination.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('last_restore_at',?)",
            (datetime.now().isoformat(),),
        )
        for kind in ("manuscript", "figures"):
            destination.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
                (f"{kind}_revision", str(revision(kind, destination) + 1)),
            )
