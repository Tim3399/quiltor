from __future__ import annotations

import json
import hashlib
import os
import sqlite3
import stat
import threading
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
"""


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

    def lookup(self, language: str, mode: str, query: str) -> list[dict]:
        return lookup(self.path, language, mode, query)


def connect(path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(path)


def initialize(path: Path, version: str) -> sqlite3.Connection:
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('version',?)", (version,))
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


def lookup(path: Path, language: str, mode: str, query: str) -> list[dict]:
    with closing(connect(path, readonly=True)) as conn:
        with conn:
            rows = conn.execute(
                "SELECT lemma,part_of_speech,meaning,values_json,source FROM entries WHERE language=? AND mode=? AND query=? COLLATE NOCASE ORDER BY id LIMIT 50",
                (language, mode, query.casefold()),
            ).fetchall()
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


def version(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        with closing(connect(path, readonly=True)) as conn:
            with conn:
                row = conn.execute("SELECT value FROM metadata WHERE key='version'").fetchone()
                return row[0] if row else None
    except sqlite3.Error:
        return None
