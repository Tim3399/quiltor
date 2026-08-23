"""SQLite mapping for manuscript settings and ordered chapters."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from quiltor.domain.manuscript.tree import flatten_tree, structure_or_flat
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
        chapters_by_id: dict[str, dict[str, Any]] = {}
        for row in database.execute("SELECT * FROM chapters ORDER BY position"):
            chapter = decode_extra(row["extra_json"])
            chapter.update(
                id=row["id"],
                title=row["title"],
                body=row["body"],
                note=row["note"],
            )
            if row["story_time_start_moment_id"] is not None:
                story_time = decode_extra(row["story_time_extra_json"])
                story_time["startMomentId"] = row["story_time_start_moment_id"]
                if row["story_time_end_moment_id"] is not None:
                    story_time["endMomentId"] = row["story_time_end_moment_id"]
                chapter["storyTime"] = story_time
            chapters_by_id[chapter["id"]] = chapter
        folders = []
        for row in database.execute("SELECT * FROM chapter_folders ORDER BY id"):
            folder = decode_extra(row["extra_json"])
            folder.update(id=row["id"], title=row["title"])
            folders.append(folder)
        items = []
        for row in database.execute(
            "SELECT * FROM manuscript_tree_items ORDER BY parent_folder_id,position,id"
        ):
            item = decode_extra(row["extra_json"])
            item.update(id=row["id"], kind=row["kind"], position=row["position"])
            if row["parent_folder_id"] is not None:
                item["parentFolderId"] = row["parent_folder_id"]
            if row["kind"] == "chapter":
                item["chapterId"] = row["chapter_id"]
            else:
                item["folderId"] = row["folder_id"]
            items.append(item)
        structure = structure_or_flat(chapters_by_id, {"folders": folders, "items": items})
        order = flatten_tree(chapters_by_id, structure)
        result["chapters"] = [chapters_by_id[chapter_id] for chapter_id in order]
        result["structure"] = structure
        return result


def save(
    state: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    db_path: Path | None = None,
) -> None:
    own = conn is None
    database = conn or connect(db_path)
    try:
        chapters = state.get("chapters", [])
        chapters_by_id = {chapter["id"]: chapter for chapter in chapters}
        structure = structure_or_flat(chapters_by_id, state.get("structure"))
        ordered_chapter_ids = flatten_tree(chapters_by_id, structure)
        with database:
            database.execute("DELETE FROM manuscript_tree_items")
            database.execute("DELETE FROM chapter_folders")
            database.execute("DELETE FROM chapters")
            for position, chapter_id in enumerate(ordered_chapter_ids):
                chapter = chapters_by_id[chapter_id]
                story_time = chapter.get("storyTime")
                start_moment_id = (
                    story_time.get("startMomentId") if isinstance(story_time, dict) else None
                )
                end_moment_id = (
                    story_time.get("endMomentId") if isinstance(story_time, dict) else None
                )
                database.execute(
                    """
                    INSERT INTO chapters(
                      id,position,title,body,note,
                      story_time_start_moment_id,story_time_end_moment_id,
                      story_time_extra_json,extra_json
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        chapter["id"],
                        position,
                        chapter.get("title", ""),
                        chapter.get("body", ""),
                        chapter.get("note", ""),
                        start_moment_id,
                        end_moment_id,
                        encode_extra(story_time, {"startMomentId", "endMomentId"})
                        if isinstance(story_time, dict)
                        else "{}",
                        encode_extra(chapter, {"id", "title", "body", "note", "storyTime"}),
                    ),
                )
            for folder in structure["folders"]:
                database.execute(
                    "INSERT INTO chapter_folders(id,title,extra_json) VALUES(?,?,?)",
                    (
                        folder["id"],
                        folder.get("title", ""),
                        encode_extra(folder, {"id", "title"}),
                    ),
                )
            for item in structure["items"]:
                database.execute(
                    """
                    INSERT INTO manuscript_tree_items(
                      id,parent_folder_id,kind,chapter_id,folder_id,position,extra_json
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        item["id"],
                        item.get("parentFolderId"),
                        item["kind"],
                        item.get("chapterId"),
                        item.get("folderId"),
                        item["position"],
                        encode_extra(
                            item,
                            {
                                "id",
                                "parentFolderId",
                                "kind",
                                "chapterId",
                                "folderId",
                                "position",
                            },
                        ),
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
                    encode_extra(state, {"chapters", "structure", "words", "zeichenAktiv"}),
                ),
            )
    finally:
        if own:
            database.close()


__all__ = ["load", "save"]
