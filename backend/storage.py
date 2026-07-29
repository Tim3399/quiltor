from __future__ import annotations

import json
import os
import sqlite3
import uuid
import re
from datetime import datetime
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("QUILTOR_DATA_DIR", str(BASE / "data"))).resolve()
DB = DATA / ".no-active-world.sqlite3"
BACKUPS = DATA / "backups"
WORLDS = DATA / "worlds"
ACTIVE_WORLD_ID = ""
SCHEMA_VERSION = 2
MAX_BACKUPS = 40
BACKUP_INTERVAL = 300

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
CREATE TABLE IF NOT EXISTS figures (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','ort','konzept')),
  label TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'ink',
  dashed INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
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
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    return conn


def initialize(path: Path | None = None) -> None:
    """Create only the schema and its internal forward migrations."""
    DATA.mkdir(exist_ok=True)
    BACKUPS.mkdir(exist_ok=True)
    with connect(path) as conn:
        conn.executescript(SCHEMA)
        current = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        version = int(current[0]) if current else 0
        migrate(conn, version)


def list_worlds() -> list[dict[str, str]]:
    WORLDS.mkdir(exist_ok=True)
    candidates = [(path.stem, path) for path in sorted(WORLDS.glob("*.sqlite3"))]
    result = []
    for world_id, path in candidates:
        if not path.exists():
            continue
        try:
            with connect(path) as conn:
                row = conn.execute("SELECT value FROM meta WHERE key='world_title'").fetchone()
                repository_row = conn.execute("SELECT value FROM meta WHERE key='github_repository'").fetchone()
            title = row[0] if row else world_id
            repository = repository_row[0] if repository_row else ""
            result.append({"id": world_id, "title": title, "githubUrl": repository, "updated": datetime.fromtimestamp(path.stat().st_mtime).isoformat()})
        except sqlite3.Error:
            continue
    return result


def normalize_github_url(value: str) -> str:
    url = value.strip().removesuffix("/")
    if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?", url):
        raise ValueError("Enter a valid GitHub repository URL.")
    return url if url.endswith(".git") else f"{url}.git"


def create_world(title: str, github_url: str) -> dict[str, str]:
    clean = " ".join(title.split()).strip()
    if not clean or len(clean) > 100:
        raise ValueError("Der Welttitel muss zwischen 1 und 100 Zeichen lang sein.")
    repository = normalize_github_url(github_url)
    WORLDS.mkdir(exist_ok=True)
    world_id = uuid.uuid4().hex
    path = WORLDS / f"{world_id}.sqlite3"
    initialize(path)
    with connect(path) as conn:
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('world_title',?)", (clean,))
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('github_repository',?)", (repository,))
        conn.execute("INSERT INTO chapters(id,position,title,body,note) VALUES(?,0,'','','')", (uuid.uuid4().hex,))
    return {"id": world_id, "title": clean, "githubUrl": repository, "updated": datetime.now().isoformat()}


def activate_world(world_id: str) -> dict[str, str]:
    global DB, BACKUPS, ACTIVE_WORLD_ID
    if world_id.isalnum() and len(world_id) == 32:
        path = WORLDS / f"{world_id}.sqlite3"
    else:
        raise ValueError("Ungültige Welt.")
    if not path.exists():
        raise FileNotFoundError("Diese Welt existiert nicht.")
    DB = path
    ACTIVE_WORLD_ID = world_id
    BACKUPS = DATA / "backups" / world_id
    BACKUPS.mkdir(parents=True, exist_ok=True)
    world = next((item for item in list_worlds() if item["id"] == world_id), None)
    if not world:
        raise ValueError("Diese Welt ist nicht lesbar.")
    if not world.get("githubUrl"):
        raise ValueError("This world has no GitHub backup repository configured.")
    return world


def migrate(conn: sqlite3.Connection, version: int) -> None:
    """Apply explicit forward-only migrations; every step is idempotent."""
    conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('manuscript_revision','0')")
    conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('figures_revision','0')")
    if version < 2:
        conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('last_restore_at','')")
    conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))


class ConflictError(RuntimeError):
    pass


def revision(kind: str, conn: sqlite3.Connection | None = None) -> int:
    own = conn is None; db = conn or connect()
    try:
        row = db.execute("SELECT value FROM meta WHERE key=?", (f"{kind}_revision",)).fetchone()
        return int(row[0]) if row else 0
    finally:
        if own: db.close()


def save_with_revision(kind: str, state: dict[str, Any], expected: int | None) -> int:
    with connect() as conn:
        current = revision(kind, conn)
        if expected is not None and expected != current:
            raise ConflictError(f"Stand wurde zwischenzeitlich geändert ({expected} → {current}).")
        if kind == "manuscript": save_manuscript(state, conn)
        elif kind == "figures": save_figures(state, conn)
        else: raise ValueError("Unbekannter Dokumenttyp")
        updated = current + 1
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", (f"{kind}_revision", str(updated)))
        return updated


def _extra(source: dict[str, Any], known: set[str]) -> str:
    return json.dumps({k: v for k, v in source.items() if k not in known}, ensure_ascii=False)


def _decoded(value: str) -> dict[str, Any]:
    try:
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except ValueError:
        return {}


def load_manuscript() -> dict[str, Any]:
    with connect() as conn:
        settings = conn.execute("SELECT * FROM manuscript_settings WHERE id=1").fetchone()
        result = _decoded(settings["extra_json"]) if settings else {}
        result["words"] = json.loads(settings["words_json"]) if settings else []
        result["zeichenAktiv"] = json.loads(settings["characters_json"]) if settings else []
        chapters = []
        for row in conn.execute("SELECT * FROM chapters ORDER BY position"):
            chapter = _decoded(row["extra_json"])
            chapter.update(id=row["id"], title=row["title"], body=row["body"], note=row["note"])
            chapters.append(chapter)
        result["chapters"] = chapters
        return result


def save_manuscript(state: dict[str, Any], conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    db = conn or connect()
    try:
        with db:
            db.execute("DELETE FROM chapters")
            for position, chapter in enumerate(state.get("chapters", [])):
                db.execute(
                    "INSERT INTO chapters(id,position,title,body,note,extra_json) VALUES(?,?,?,?,?,?)",
                    (chapter["id"], position, chapter.get("title", ""), chapter.get("body", ""),
                     chapter.get("note", ""), _extra(chapter, {"id", "title", "body", "note"})),
                )
            db.execute(
                "INSERT OR REPLACE INTO manuscript_settings(id,words_json,characters_json,extra_json) VALUES(1,?,?,?)",
                (json.dumps(state.get("words", []), ensure_ascii=False),
                 json.dumps(state.get("zeichenAktiv", []), ensure_ascii=False),
                 _extra(state, {"chapters", "words", "zeichenAktiv"})),
            )
    finally:
        if own: db.close()


def load_figures() -> dict[str, Any]:
    with connect() as conn:
        settings = conn.execute("SELECT * FROM figure_settings WHERE id=1").fetchone()
        result = _decoded(settings["extra_json"]) if settings else {}
        if settings:
            result["canvasSize"] = {"w": settings["canvas_width"], "h": settings["canvas_height"]}
        nodes = []
        for row in conn.execute("SELECT * FROM figures ORDER BY position"):
            node = _decoded(row["extra_json"])
            node.update(id=row["id"], x=row["x"], y=row["y"], type=row["kind"], label=row["label"],
                        name=row["name"], sub=row["subtitle"], accent=row["accent"],
                        dash=bool(row["dashed"]), pinned=bool(row["pinned"]))
            profile = conn.execute("SELECT * FROM profiles WHERE figure_id=?", (row["id"],)).fetchone()
            if profile:
                p = _decoded(profile["extra_json"])
                p.update(alter=profile["age"], rolle=profile["role"], aussehen=profile["appearance"],
                         herkunft=profile["origin"], stimme=profile["voice"], notizen=profile["notes"])
                p["extra"] = [{"k": f["label"], "v": f["value"]} for f in conn.execute(
                    "SELECT * FROM profile_fields WHERE figure_id=? ORDER BY position", (row["id"],))]
                node["profile"] = p
            nodes.append(node)
        edges = []
        for row in conn.execute("SELECT * FROM connections ORDER BY rowid"):
            edge = _decoded(row["extra_json"])
            edge.update(id=row["id"], **{"from": row["source_id"]}, to=row["target_id"],
                        label=row["label"], style=row["style"], gerichtet=bool(row["directed"]))
            edges.append(edge)
        result.update(nodes=nodes, edges=edges)
        return result


def save_figures(state: dict[str, Any], conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    db = conn or connect()
    try:
        with db:
            db.execute("DELETE FROM connections")
            db.execute("DELETE FROM figures")
            for position, node in enumerate(state.get("nodes", [])):
                kind = node.get("type", "person")
                if kind not in {"person", "ort", "konzept"}: kind = "person"
                db.execute("INSERT INTO figures VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                    node["id"], position, float(node.get("x", 0)), float(node.get("y", 0)), kind,
                    node.get("label", ""), node.get("name", "Ohne Namen"), node.get("sub", ""),
                    node.get("accent", "ink"), int(bool(node.get("dash"))), int(bool(node.get("pinned"))),
                    _extra(node, {"id", "x", "y", "type", "label", "name", "sub", "accent", "dash", "pinned", "profile"}),
                ))
                profile = node.get("profile") or {}
                db.execute("INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)", (
                    node["id"], profile.get("alter", ""), profile.get("rolle", ""), profile.get("aussehen", ""),
                    profile.get("herkunft", ""), profile.get("stimme", ""), profile.get("notizen", ""),
                    _extra(profile, {"alter", "rolle", "aussehen", "herkunft", "stimme", "notizen", "extra"}),
                ))
                for index, field in enumerate(profile.get("extra") or []):
                    db.execute("INSERT INTO profile_fields VALUES(?,?,?,?)", (node["id"], index, field.get("k", ""), field.get("v", "")))
            ids = {node["id"] for node in state.get("nodes", [])}
            for edge in state.get("edges", []):
                if edge.get("from") not in ids or edge.get("to") not in ids: continue
                db.execute("INSERT INTO connections VALUES(?,?,?,?,?,?,?)", (
                    edge["id"], edge["from"], edge["to"], edge.get("label", ""), edge.get("style", "solid"),
                    int(bool(edge.get("gerichtet"))), _extra(edge, {"id", "from", "to", "label", "style", "gerichtet"}),
                ))
            canvas = state.get("canvasSize") or {"w": 2400, "h": 1600}
            db.execute("INSERT OR REPLACE INTO figure_settings VALUES(1,?,?,?)", (
                int(canvas.get("w", 2400)), int(canvas.get("h", 1600)),
                _extra(state, {"nodes", "edges", "canvasSize"}),
            ))
    finally:
        if own: db.close()


def backup_if_due(force: bool = False) -> None:
    BACKUPS.mkdir(exist_ok=True)
    files = sorted(BACKUPS.glob("backup-*.sqlite3"))
    if not force and files and datetime.now().timestamp() - files[-1].stat().st_mtime < BACKUP_INTERVAL:
        return
    target = BACKUPS / f"backup-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3"
    temp = target.with_suffix(".tmp")
    with connect() as source, sqlite3.connect(temp) as destination:
        source.backup(destination)
    os.replace(temp, target)
    for old in files[: max(0, len(files) - MAX_BACKUPS + 1)]:
        old.unlink(missing_ok=True)


def list_backups() -> list[dict[str, Any]]:
    return [{"name": path.name, "created": datetime.fromtimestamp(path.stat().st_mtime).isoformat(), "size": path.stat().st_size}
            for path in sorted(BACKUPS.glob("backup-*.sqlite3"), reverse=True)]


def restore_backup(name: str) -> None:
    if Path(name).name != name or not name.startswith("backup-") or not name.endswith(".sqlite3"):
        raise ValueError("Ungültiger Sicherungsname")
    source_path = BACKUPS / name
    if not source_path.exists(): raise FileNotFoundError(name)
    backup_if_due(force=True)
    with sqlite3.connect(source_path) as source, connect() as destination:
        source.backup(destination)
        destination.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('last_restore_at',?)", (datetime.now().isoformat(),))
        for kind in ("manuscript", "figures"):
            destination.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", (f"{kind}_revision", str(revision(kind, destination) + 1)))
