"""SQLite mapping for manuscript settings and ordered chapters."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence.sqlite.codec import decode_extra, encode_extra
from quiltor.infrastructure.persistence.sqlite.connection import connect, connection


def load(db_path: Path | None = None) -> dict[str, Any]:
    with connection(db_path) as database:
        settings = database.execute("SELECT * FROM manuscript_settings WHERE id=1").fetchone()
        result = decode_extra(settings["extra_json"]) if settings else {}
        result["words"] = json.loads(settings["words_json"]) if settings else []
        result["zeichenAktiv"] = json.loads(settings["characters_json"]) if settings else []
        result.setdefault("language", "de-DE")
        result.setdefault("grammarMode", "manual")
        chapters = []
        for row in database.execute("SELECT * FROM chapters ORDER BY position"):
            chapter = decode_extra(row["extra_json"])
            chapter.update(
                id=row["id"],
                title=row["title"],
                body=row["body"],
                note=row["note"],
            )
            chapters.append(chapter)
        result["chapters"] = chapters
        return result


def save(
    state: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    db_path: Path | None = None,
) -> None:
    own = conn is None
    database = conn or connect(db_path)
    try:
        with database:
            database.execute("DELETE FROM chapters")
            for position, chapter in enumerate(state.get("chapters", [])):
                database.execute(
                    """
                    INSERT INTO chapters(id,position,title,body,note,extra_json)
                    VALUES(?,?,?,?,?,?)
                    """,
                    (
                        chapter["id"],
                        position,
                        chapter.get("title", ""),
                        chapter.get("body", ""),
                        chapter.get("note", ""),
                        encode_extra(chapter, {"id", "title", "body", "note"}),
                    ),
                )
            database.execute(
                """
                INSERT OR REPLACE INTO manuscript_settings(
                  id,words_json,characters_json,extra_json
                ) VALUES(1,?,?,?)
                """,
                (
                    json.dumps(state.get("words", []), ensure_ascii=False),
                    json.dumps(state.get("zeichenAktiv", []), ensure_ascii=False),
                    encode_extra(state, {"chapters", "words", "zeichenAktiv"}),
                ),
            )
    finally:
        if own:
            database.close()


__all__ = ["load", "save"]
