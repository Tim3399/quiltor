from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
import threading
from collections.abc import Mapping
from contextlib import closing
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries(
 id INTEGER PRIMARY KEY, language TEXT NOT NULL, mode TEXT NOT NULL,
 query TEXT NOT NULL COLLATE NOCASE, lemma TEXT NOT NULL, part_of_speech TEXT NOT NULL DEFAULT '',
 meaning TEXT NOT NULL DEFAULT '', values_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_lookup ON entries(language, mode, query COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS forms(
 language TEXT NOT NULL, form TEXT NOT NULL COLLATE NOCASE, lemma TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forms_lookup ON forms(language, form COLLATE NOCASE);
"""

# Layout of the dictionary database. 2 added the ``forms`` table and the license
# keys. The database is replaced on install, never migrated, so a file without
# the marker is schema 1 and is read from ``entries`` alone.
DICTIONARY_SCHEMA = 2

# Keys a build may set in ``metadata`` next to version, coverage and schema.
LICENSE_KEYS = ("license", "license_url", "attribution")


_MIGRATION_LOCK = threading.Lock()
_REPARSE_POINT = 0x400


def _unsafe_entry(path: Path) -> bool:
    try:
        status = path.lstat()
    except FileNotFoundError:
        return False
    return path.is_symlink() or bool(getattr(status, "st_file_attributes", 0) & _REPARSE_POINT)


def _validate_tree(root: Path) -> None:
    if _unsafe_entry(root):
        raise ValueError("writing-assistance data must not contain links or reparse points")
    for directory, names, files in os.walk(root, followlinks=False):
        base = Path(directory)
        for name in [*names, *files]:
            candidate = base / name
            if _unsafe_entry(candidate):
                raise ValueError("writing-assistance data must not contain links or reparse points")
            mode = candidate.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError("writing-assistance data contains an unsupported file type")


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tree_digest(path: Path) -> str:
    if path.is_file():
        return _file_digest(path)
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*"), key=lambda value: value.relative_to(path).as_posix()):
        relative = item.relative_to(path).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        if item.is_file():
            digest.update(_file_digest(item).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def _remove_tree(path: Path) -> None:
    for item in sorted(
        path.rglob("*"), key=lambda value: len(value.relative_to(path).parts), reverse=True
    ):
        if item.is_file():
            item.unlink()
        else:
            item.rmdir()
    path.rmdir()


def _preserve_conflict(source: Path, target_root: Path, relative: Path) -> None:
    digest = _tree_digest(source)
    conflict = target_root / ".legacy-import-conflicts" / relative.parent
    conflict.mkdir(parents=True, exist_ok=True)
    destination = conflict / f"{relative.name}.legacy-{digest[:16]}"
    if destination.exists():
        if _tree_digest(destination) != digest:
            raise ValueError("writing-assistance legacy collision could not be preserved")
        if source.is_dir():
            _remove_tree(source)
        else:
            source.unlink()
        return
    os.replace(source, destination)


def _merge_legacy(source: Path, destination: Path, target_root: Path, relative: Path) -> None:
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, destination)
        return
    if source.is_file() and destination.is_file():
        if _file_digest(source) == _file_digest(destination):
            source.unlink()
        else:
            _preserve_conflict(source, target_root, relative)
        return
    if source.is_dir() and destination.is_dir():
        for child in list(source.iterdir()):
            _merge_legacy(
                child,
                destination / child.name,
                target_root,
                relative / child.name,
            )
        source.rmdir()
        return
    _preserve_conflict(source, target_root, relative)


def migrate_legacy_directory(data_dir: Path) -> Path:
    """Safely migrate ``data/language`` to ``data/writing-assistance`` once.

    Symlinks are refused so a crafted legacy path cannot move content from
    outside Quiltor's data directory. Existing new-format files always win.
    """
    with _MIGRATION_LOCK:
        root = data_dir.resolve()
        legacy = data_dir / "language"
        target = data_dir / "writing-assistance"
        if _unsafe_entry(target) or _unsafe_entry(legacy):
            raise ValueError("writing-assistance data directory must not be a link")
        if legacy.exists() and not legacy.is_dir():
            raise ValueError("legacy writing-assistance path must be a directory")
        if target.exists() and not target.is_dir():
            raise ValueError("writing-assistance path must be a directory")
        if legacy.exists() and legacy.resolve().parent != root:
            raise ValueError("legacy writing-assistance path escapes the data directory")
        if target.exists() and target.resolve().parent != root:
            raise ValueError("writing-assistance path escapes the data directory")
        if legacy.is_dir():
            _validate_tree(legacy)
        if target.is_dir():
            _validate_tree(target)
        if legacy.is_dir() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(legacy, target)
        elif legacy.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            for child in list(legacy.iterdir()):
                _merge_legacy(child, target / child.name, target, Path(child.name))
            legacy.rmdir()
        target.mkdir(parents=True, exist_ok=True)
        if _unsafe_entry(target / "writing.sqlite3"):
            raise ValueError("writing-assistance database must not be a link")
        return target


class SQLiteWritingAssistanceRepository:
    def __init__(self, data_dir: Path) -> None:
        self.directory = migrate_legacy_directory(data_dir)
        self.path = self.directory / "writing.sqlite3"

    def version(self) -> str | None:
        return version(self.path)

    def coverage(self) -> str | None:
        return coverage(self.path)

    def schema(self) -> int | None:
        return schema(self.path)

    def metadata(self) -> dict[str, str]:
        return metadata(self.path)

    def lookup(self, language: str, mode: str, query: str) -> list[dict]:
        return lookup(self.path, language, mode, query)


def connect(path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(path)


def initialize(
    path: Path, version: str, coverage: str, licenses: Mapping[str, str] | None = None
) -> sqlite3.Connection:
    unknown = set(licenses or {}) - set(LICENSE_KEYS)
    if unknown:
        raise ValueError(f"unknown writing-assistance metadata keys: {sorted(unknown)}")
    conn = connect(path)
    conn.executescript(SCHEMA)
    values = {
        "version": version,
        "coverage": coverage,
        "schema": str(DICTIONARY_SCHEMA),
        **(licenses or {}),
    }
    conn.executemany("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)", values.items())
    return conn


def insert(
    conn: sqlite3.Connection,
    language: str,
    mode: str,
    query: str,
    lemma: str,
    part_of_speech: str,
    meaning: str,
    values: list[str],
    source: str,
) -> None:
    conn.execute(
        "INSERT INTO entries(language,mode,query,lemma,part_of_speech,meaning,values_json,source) VALUES(?,?,?,?,?,?,?,?)",
        (
            language,
            mode,
            query.casefold(),
            lemma,
            part_of_speech,
            meaning,
            json.dumps(values, ensure_ascii=False),
            source,
        ),
    )


def insert_form(conn: sqlite3.Connection, language: str, form: str, lemma: str) -> None:
    conn.execute(
        "INSERT INTO forms(language,form,lemma) VALUES(?,?,?)",
        (language, form.casefold(), lemma),
    )


_ENTRIES = "SELECT lemma,part_of_speech,meaning,values_json,source FROM entries WHERE language=? AND mode=? AND query=? COLLATE NOCASE ORDER BY id LIMIT 50"


def lookup(path: Path, language: str, mode: str, query: str) -> list[dict]:
    """Entries for ``query``; an inflected form with no entry of its own falls
    back to its lemmas, one step deep. Schema 1 has no ``forms`` table."""
    with closing(connect(path, readonly=True)) as conn, conn:
        rows = conn.execute(_ENTRIES, (language, mode, query.casefold())).fetchall()
        if not rows and _schema(conn) >= 2:
            lemmas = conn.execute(
                "SELECT DISTINCT lemma FROM forms WHERE language=? AND form=? COLLATE NOCASE ORDER BY lemma",
                (language, query.casefold()),
            ).fetchall()
            for (lemma,) in lemmas:
                rows += conn.execute(_ENTRIES, (language, mode, lemma.casefold())).fetchall()
            rows = rows[:50]
    return [
        {
            "lemma": row[0],
            "partOfSpeech": row[1],
            "meaning": row[2],
            "values": json.loads(row[3]),
            "source": row[4],
        }
        for row in rows
    ]


def _schema(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
    return int(row[0]) if row else 1


def schema(path: Path) -> int | None:
    """Layout of the installed database; 1 for files written before the marker."""
    if not path.exists():
        return None
    try:
        with closing(connect(path, readonly=True)) as conn, conn:
            return _schema(conn)
    except (sqlite3.Error, ValueError):
        return None


def metadata(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        with closing(connect(path, readonly=True)) as conn, conn:
            return dict(conn.execute("SELECT key,value FROM metadata ORDER BY key").fetchall())
    except sqlite3.Error:
        return {}


def coverage(path: Path) -> str | None:
    """How much of the vocabulary the installed database holds: "core" for the
    small built-in set, "full" for an import of the upstream sources.

    Databases written before this key existed were always the built-in set.
    """
    if not path.exists():
        return None
    try:
        with closing(connect(path, readonly=True)) as conn, conn:
            row = conn.execute("SELECT value FROM metadata WHERE key='coverage'").fetchone()
    except sqlite3.Error:
        return None
    return row[0] if row else "core"


def version(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        with closing(connect(path, readonly=True)) as conn, conn:
            row = conn.execute("SELECT value FROM metadata WHERE key='version'").fetchone()
            return row[0] if row else None
    except sqlite3.Error:
        return None
