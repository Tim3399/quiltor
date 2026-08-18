from __future__ import annotations

import json
import sqlite3
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
    with connect(path, readonly=True) as conn:
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
        with connect(path, readonly=True) as conn:
            row = conn.execute("SELECT value FROM metadata WHERE key='version'").fetchone()
            return row[0] if row else None
    except sqlite3.Error:
        return None
