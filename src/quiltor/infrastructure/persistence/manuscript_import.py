from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from quiltor.application.document_wire_v1 import encode_document_v1
from quiltor.application.manuscript_import import (
    MAX_IMPORT_BYTES,
    WARNING_CODES,
    ConflictingManuscriptRequest,
    InvalidManuscriptFile,
    InvalidManuscriptSelection,
    ManuscriptLimitExceeded,
    ManuscriptPreviewMismatch,
    ManuscriptPublicationFailed,
    ManuscriptWarningsUnacknowledged,
    ParsedManuscript,
    ParsedUnitManuscript,
)
from quiltor.application.worlds import WorldSummary
from quiltor.domain.manuscript.tree import flatten_tree, validate_tree
from quiltor.infrastructure.importing.docx import parse_docx, parse_docx_units
from quiltor.infrastructure.importing.text_formats import parse_markdown_units, parse_text_units
from quiltor.infrastructure.persistence.sqlite import (
    manuscript,
    schema,
    story_world,
    storyboards,
    world_catalog,
)
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths
from quiltor.infrastructure.persistence.sqlite.connection import connection


class SQLiteManuscriptImportRepository:
    def __init__(self, paths: SQLitePaths) -> None:
        self.paths = paths

    def preview(self, file_name: str, content: bytes, selection: Any = None) -> dict:
        digest = hashlib.sha256(content).hexdigest()
        parsed = parse_docx(file_name, content)
        chosen_title, chosen = _selection(parsed, selection)
        return _public_preview(file_name, digest, parsed, chosen_title, chosen)

    def preview_v2(self, file_name: str, content: bytes, selection: Any = None) -> dict:
        digest = hashlib.sha256(content).hexdigest()
        parsed = _parse_v2(file_name, content)
        chosen_title, chosen = _selection_v2(parsed, selection)
        _build_structure(chosen, [f"preview-{index}" for index in range(len(chosen))])
        return _public_preview_v2(file_name, digest, parsed, chosen_title, chosen)

    def publish(
        self,
        file_name: str,
        content: bytes,
        source_sha256: str,
        title: str,
        chapters: Any,
        acknowledged_warnings: Any,
        request_id: str,
        owner_sub: str,
    ) -> dict[str, str]:
        digest = hashlib.sha256(content).hexdigest()
        if not isinstance(source_sha256, str) or source_sha256 != digest:
            raise ManuscriptPreviewMismatch("The source digest differs from the reviewed preview.")
        try:
            normalized_request_id = str(uuid.UUID(request_id))
        except (AttributeError, TypeError, ValueError) as error:
            raise InvalidManuscriptSelection("The request id must be a UUID string.") from error
        parsed = parse_docx(file_name, content)
        selected_title, selected = _selection(
            parsed, {"title": title, "chapters": chapters}, require_selection=True
        )
        acknowledged = _acknowledgments(acknowledged_warnings)
        warning_codes = {warning["code"] for warning in parsed.warnings}
        missing = sorted(warning_codes - acknowledged)
        unexpected = sorted(acknowledged - warning_codes)
        if missing or unexpected:
            raise ManuscriptWarningsUnacknowledged(
                "Warning acknowledgments do not match the preview.",
                params={"warnings": missing, "unexpected": unexpected},
            )
        preview = _public_preview(file_name, digest, parsed, selected_title, selected)
        fingerprint = _fingerprint(
            {
                "fileName": file_name,
                "sourceSha256": digest,
                "title": selected_title,
                "chapters": chapters,
                "acknowledgedWarnings": sorted(acknowledged),
            }
        )
        return self._publish_selected(
            file_name,
            digest,
            selected_title,
            selected,
            preview,
            parsed.warnings,
            normalized_request_id,
            owner_sub,
            fingerprint,
            protocol_version=1,
            format_name="docx",
        )

    def publish_v2(
        self,
        file_name: str,
        content: bytes,
        source_sha256: str,
        title: str,
        chapters: Any,
        acknowledged_warnings: Any,
        request_id: str,
        owner_sub: str,
    ) -> dict[str, str]:
        digest = hashlib.sha256(content).hexdigest()
        if not isinstance(source_sha256, str) or source_sha256 != digest:
            raise ManuscriptPreviewMismatch("The source digest differs from the reviewed preview.")
        try:
            normalized_request_id = str(uuid.UUID(request_id))
        except (AttributeError, TypeError, ValueError) as error:
            raise InvalidManuscriptSelection("The request id must be a UUID string.") from error
        parsed = _parse_v2(file_name, content)
        selected_title, selected = _selection_v2(
            parsed, {"title": title, "chapters": chapters}, require_selection=True
        )
        _build_structure(selected, [f"preview-{index}" for index in range(len(selected))])
        acknowledged = _acknowledgments(acknowledged_warnings)
        warning_codes = {warning["code"] for warning in parsed.warnings}
        missing = sorted(warning_codes - acknowledged)
        unexpected = sorted(acknowledged - warning_codes)
        if missing or unexpected:
            raise ManuscriptWarningsUnacknowledged(
                "Warning acknowledgments do not match the preview.",
                params={"warnings": missing, "unexpected": unexpected},
            )
        preview = _public_preview_v2(file_name, digest, parsed, selected_title, selected)
        fingerprint = _fingerprint(
            {
                "protocolVersion": 2,
                "fileName": file_name,
                "sourceSha256": digest,
                "title": selected_title,
                "chapters": chapters,
                "acknowledgedWarnings": sorted(acknowledged),
            }
        )
        return self._publish_selected(
            file_name,
            digest,
            selected_title,
            selected,
            preview,
            parsed.warnings,
            normalized_request_id,
            owner_sub,
            fingerprint,
            protocol_version=2,
            format_name=parsed.format,
        )

    def _publish_selected(
        self,
        file_name,
        digest,
        selected_title,
        selected,
        preview,
        warnings,
        normalized_request_id,
        owner_sub,
        fingerprint,
        *,
        protocol_version,
        format_name,
    ):
        world_id = hashlib.sha256(f"{owner_sub}\0{normalized_request_id}".encode()).hexdigest()[:32]
        self.paths.worlds.mkdir(parents=True, exist_ok=True)
        final = world_catalog.world_db_path(world_id, paths=self.paths)
        if final.exists():
            return self._existing(final, owner_sub, normalized_request_id, fingerprint).public()
        staged = self.paths.worlds / f".{world_id}.{uuid.uuid4().hex}.importing.sqlite3"
        imported_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        chapter_records = [
            {
                "id": uuid.uuid4().hex,
                "title": chapter["title"],
                "body": chapter["body"],
                "note": "",
                "marks": chapter["marks"],
            }
            for chapter in selected
        ]
        state = {
            "chapters": chapter_records,
            "importSource": {
                "version": protocol_version,
                "fileName": file_name,
                "format": format_name,
                "sourceSha256": digest,
                "importedAt": imported_at,
                "counts": preview["counts"],
                "warnings": list(warnings),
            },
        }
        if protocol_version == 2:
            state["structure"] = _build_structure(
                selected, [chapter["id"] for chapter in chapter_records]
            )
        try:
            schema.initialize(staged)
            manuscript.save(state, db_path=staged)
            with connection(staged) as database:
                metadata = {
                    "world_title": selected_title,
                    "owner_sub": owner_sub,
                    "manuscript_import_request_id": normalized_request_id,
                    "manuscript_import_fingerprint": fingerprint,
                    "manuscript_import_created_at": imported_at,
                }
                database.executemany(
                    "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", metadata.items()
                )
                database.execute("DELETE FROM meta WHERE key='backup_endpoint'")
                database.execute("DELETE FROM meta WHERE key='deleted_at'")
                integrity = database.execute("PRAGMA quick_check").fetchall()
                if [row[0] for row in integrity] != ["ok"]:
                    raise RuntimeError("Staged manuscript database failed integrity validation.")
                if database.execute("PRAGMA foreign_key_check").fetchall():
                    raise RuntimeError("Staged manuscript database failed foreign-key validation.")
            with connection(staged) as database:
                database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            loaded = manuscript.load(staged)
            encode_document_v1("manuscript", loaded)
            encode_document_v1("figures", story_world.load(staged))
            encode_document_v1("storyboards", storyboards.load(staged))
            expected_chapters = [
                {
                    "title": chapter["title"],
                    "body": chapter["body"],
                    "marks": chapter["marks"],
                }
                for chapter in selected
            ]
            actual_chapters = [
                {
                    "title": chapter.get("title", ""),
                    "body": chapter.get("body", ""),
                    "marks": chapter.get("marks", []),
                }
                for chapter in loaded.get("chapters", [])
            ]
            if (
                loaded.get("importSource") != state["importSource"]
                or actual_chapters != expected_chapters
                or (protocol_version == 2 and loaded.get("structure") != state.get("structure"))
            ):
                raise RuntimeError("Staged manuscript did not round trip.")
            try:
                os.link(staged, final)
            except FileExistsError:
                return self._existing(final, owner_sub, normalized_request_id, fingerprint).public()
        except (
            ConflictingManuscriptRequest,
            InvalidManuscriptSelection,
            ManuscriptPreviewMismatch,
            ManuscriptWarningsUnacknowledged,
        ):
            raise
        except Exception as error:
            raise ManuscriptPublicationFailed(
                "Could not publish the imported manuscript."
            ) from error
        finally:
            for candidate in (Path(f"{staged}-wal"), Path(f"{staged}-shm"), staged):
                candidate.unlink(missing_ok=True)
        return WorldSummary(world_id, selected_title, "", imported_at).public()

    def _existing(
        self, path: Path, owner_sub: str, request_id: str, fingerprint: str
    ) -> WorldSummary:
        try:
            with connection(path) as database:
                values = dict(
                    database.execute(
                        "SELECT key,value FROM meta WHERE key IN ("
                        "'world_title','owner_sub','manuscript_import_request_id',"
                        "'manuscript_import_fingerprint','manuscript_import_created_at')"
                    ).fetchall()
                )
        except sqlite3.Error as error:
            raise ManuscriptPublicationFailed(
                "The existing imported project cannot be opened."
            ) from error
        if (
            values.get("owner_sub") != owner_sub
            or values.get("manuscript_import_request_id") != request_id
            or values.get("manuscript_import_fingerprint") != fingerprint
        ):
            raise ConflictingManuscriptRequest(
                "This request id was already used for different import data."
            )
        updated = (
            values.get("manuscript_import_created_at")
            or datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()
        )
        return WorldSummary(path.stem, values.get("world_title", ""), "", updated)


def _selection(parsed: ParsedManuscript, value: Any, *, require_selection: bool = False):
    if value is None and not require_selection:
        return parsed.title, [
            _merge_group(parsed, [chapter.source_index], chapter.title)
            for chapter in parsed.chapters
        ]
    if not isinstance(value, dict) or set(value) != {"title", "chapters"}:
        raise InvalidManuscriptSelection("The import selection fields are invalid.")
    title = value["title"]
    groups = value["chapters"]
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 100:
        raise InvalidManuscriptSelection("The project title is invalid.")
    if not isinstance(groups, list) or not groups:
        raise InvalidManuscriptSelection("At least one chapter is required.")
    expected = 0
    result = []
    for group in groups:
        if not isinstance(group, dict) or set(group) != {"sourceIndexes", "title"}:
            raise InvalidManuscriptSelection("A selected chapter is invalid.")
        indexes = group["sourceIndexes"]
        chapter_title = group["title"]
        if (
            not isinstance(indexes, list)
            or not indexes
            or not isinstance(chapter_title, str)
            or not chapter_title.strip()
            or len(chapter_title.strip()) > 1000
            or any(type(index) is not int for index in indexes)
            or indexes != list(range(expected, expected + len(indexes)))
            or expected + len(indexes) > len(parsed.chapters)
        ):
            raise InvalidManuscriptSelection(
                "Chapter source indexes must be contiguous and ordered."
            )
        expected += len(indexes)
        result.append(_merge_group(parsed, indexes, chapter_title.strip()))
    if expected != len(parsed.chapters):
        raise InvalidManuscriptSelection("Chapter source indexes must partition the preview.")
    return title.strip(), result


def _merge_group(parsed: ParsedManuscript, indexes: list[int], title: str) -> dict:
    body_parts: list[str] = []
    marks: list[dict] = []
    paragraph_count = 0
    offset = 0
    first = parsed.chapters[indexes[0]]
    represented_heading = bool(first.heading)
    for position, index in enumerate(indexes):
        source = parsed.chapters[index]
        pieces = []
        if position and source.heading:
            pieces.append((source.heading, ()))
            paragraph_count += 1
        if source.body_paragraphs:
            pieces.append((source.body, source.marks))
            paragraph_count += source.body_paragraphs
        for text, source_marks in pieces:
            if body_parts:
                body_parts.append("\n\n")
                offset += 2
            body_parts.append(text)
            for mark in source_marks:
                marks.append(
                    {
                        "from": mark["from"] + offset,
                        "to": mark["to"] + offset,
                        "kind": mark["kind"],
                    }
                )
            offset += _utf16_len(text)
    body = "".join(body_parts)
    return {
        "sourceIndexes": list(indexes),
        "title": title,
        "body": body,
        "marks": _canonical_marks(marks),
        "_paragraphs": paragraph_count,
        "_representedHeading": represented_heading,
    }


def _public_preview(file_name, digest, parsed, title, chapters):
    public_chapters = [
        {key: value for key, value in chapter.items() if not key.startswith("_")}
        for chapter in chapters
    ]
    imported_words = 0
    imported_paragraphs = 0
    for chapter in chapters:
        imported_words += _word_count(chapter["body"])
        imported_paragraphs += chapter["_paragraphs"]
        if chapter["_representedHeading"]:
            imported_words += _word_count(chapter["title"])
            imported_paragraphs += 1
    return {
        "format": "docx",
        "fileName": file_name,
        "sourceSha256": digest,
        "title": title,
        "chapters": public_chapters,
        "counts": {
            "sourceWords": parsed.source_words,
            "sourceParagraphs": parsed.source_paragraphs,
            "importedWords": imported_words,
            "importedParagraphs": imported_paragraphs,
        },
        "warnings": list(parsed.warnings),
    }


def _parse_v2(file_name: str, content: bytes) -> ParsedUnitManuscript:
    if len(content) > MAX_IMPORT_BYTES:
        raise ManuscriptLimitExceeded("The decoded manuscript exceeds 8 MiB.")
    suffix = Path(file_name).suffix.casefold()
    if suffix == ".docx":
        return parse_docx_units(file_name, content)
    if suffix in {".md", ".markdown"}:
        return parse_markdown_units(file_name, content)
    if suffix == ".txt":
        return parse_text_units(file_name, content)
    raise InvalidManuscriptFile("The manuscript format is not supported.")


def _selection_v2(parsed: ParsedUnitManuscript, value: Any, *, require_selection: bool = False):
    if value is None and not require_selection:
        groups = []
        start = 0
        for index, unit in enumerate(parsed.units):
            if unit.is_heading and index > start:
                groups.append(
                    _merge_units(
                        parsed,
                        list(range(start, index)),
                        _default_unit_title(parsed, start, len(groups)),
                        [],
                    )
                )
                start = index
        groups.append(
            _merge_units(
                parsed,
                list(range(start, len(parsed.units))),
                _default_unit_title(parsed, start, len(groups)),
                [],
            )
        )
        return parsed.title, groups
    if not isinstance(value, dict) or set(value) != {"title", "chapters"}:
        raise InvalidManuscriptSelection("The import selection fields are invalid.")
    title = value["title"]
    groups = value["chapters"]
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 100:
        raise InvalidManuscriptSelection("The project title is invalid.")
    if not isinstance(groups, list) or not groups:
        raise InvalidManuscriptSelection("At least one chapter is required.")
    expected = 0
    result = []
    for group in groups:
        if not isinstance(group, dict) or set(group) != {
            "sourceIndexes",
            "title",
            "folderPath",
        }:
            raise InvalidManuscriptSelection("A selected chapter is invalid.")
        indexes = group["sourceIndexes"]
        chapter_title = group["title"]
        folder_path = group["folderPath"]
        if (
            not isinstance(indexes, list)
            or not indexes
            or any(type(index) is not int for index in indexes)
            or indexes != list(range(expected, expected + len(indexes)))
            or expected + len(indexes) > len(parsed.units)
            or not isinstance(chapter_title, str)
            or not chapter_title.strip()
            or len(chapter_title.strip()) > 1000
            or not _valid_folder_path(folder_path)
        ):
            raise InvalidManuscriptSelection(
                "Chapter source indexes, title, or folder path are invalid."
            )
        expected += len(indexes)
        result.append(
            _merge_units(
                parsed,
                indexes,
                chapter_title.strip(),
                [component.strip() for component in folder_path],
            )
        )
    if expected != len(parsed.units):
        raise InvalidManuscriptSelection("Chapter source indexes must partition the preview.")
    _validate_folder_sequence(result)
    return title.strip(), result


def _default_unit_title(parsed: ParsedUnitManuscript, start: int, chapter_index: int) -> str:
    unit = parsed.units[start]
    if unit.is_heading and unit.text.strip():
        if len(unit.text.strip()) > 1000:
            raise InvalidManuscriptSelection("A source heading exceeds the title limit.")
        return unit.text.strip()
    return parsed.title if chapter_index == 0 else f"Kapitel {chapter_index + 1}"


def _merge_units(parsed, indexes, title, folder_path):
    first = parsed.units[indexes[0]]
    represented_heading = first.is_heading and bool(first.text.strip())
    body_units = [parsed.units[index] for index in indexes[1 if represented_heading else 0 :]]
    body_parts = []
    marks = []
    offset = 0
    for position, unit in enumerate(body_units):
        if position:
            body_parts.append("\n\n")
            offset += 2
        body_parts.append(unit.text)
        marks.extend(
            {
                "from": mark["from"] + offset,
                "to": mark["to"] + offset,
                "kind": mark["kind"],
            }
            for mark in unit.marks
        )
        offset += _utf16_len(unit.text)
    return {
        "sourceIndexes": list(indexes),
        "title": title,
        "folderPath": list(folder_path),
        "body": "".join(body_parts),
        "marks": _canonical_marks(marks),
        "_paragraphs": len(body_units),
        "_representedHeading": represented_heading,
    }


def _public_preview_v2(file_name, digest, parsed, title, chapters):
    public_chapters = [
        {key: value for key, value in chapter.items() if not key.startswith("_")}
        for chapter in chapters
    ]
    imported_words = 0
    imported_paragraphs = 0
    for chapter in chapters:
        imported_words += _word_count(chapter["body"])
        imported_paragraphs += chapter["_paragraphs"]
        if chapter["_representedHeading"]:
            imported_words += _word_count(chapter["title"])
            imported_paragraphs += 1
    return {
        "format": parsed.format,
        "fileName": file_name,
        "sourceSha256": digest,
        "title": title,
        "units": [
            {
                "index": unit.index,
                "text": unit.text,
                "marks": list(unit.marks),
                "isHeading": unit.is_heading,
            }
            for unit in parsed.units
        ],
        "chapters": public_chapters,
        "counts": {
            "sourceWords": parsed.source_words,
            "sourceParagraphs": parsed.source_paragraphs,
            "importedWords": imported_words,
            "importedParagraphs": imported_paragraphs,
        },
        "warnings": list(parsed.warnings),
    }


def _valid_folder_path(value):
    return (
        isinstance(value, list)
        and len(value) <= 8
        and all(
            isinstance(component, str)
            and bool(component.strip())
            and len(component.strip()) <= 1000
            for component in value
        )
    )


def _validate_folder_sequence(chapters):
    previous: tuple[str, ...] = ()
    closed: set[tuple[str, ...]] = set()
    for chapter in chapters:
        current = tuple(chapter["folderPath"])
        common = 0
        while common < min(len(previous), len(current)) and previous[common] == current[common]:
            common += 1
        for depth in range(common + 1, len(previous) + 1):
            closed.add(previous[:depth])
        if any(current[:depth] in closed for depth in range(1, len(current) + 1)):
            raise InvalidManuscriptSelection("A folder path cannot be re-entered after leaving it.")
        previous = current


def _build_structure(chapters, chapter_ids):
    _validate_folder_sequence(chapters)
    folders = []
    items = []
    folder_ids: dict[tuple[str, ...], str] = {}
    positions: dict[str | None, int] = {}

    def next_position(parent):
        value = positions.get(parent, 0)
        positions[parent] = value + 1
        return value

    for chapter, chapter_id in zip(chapters, chapter_ids, strict=True):
        parent = None
        prefix: tuple[str, ...] = ()
        for component in chapter["folderPath"]:
            prefix += (component,)
            folder_id = folder_ids.get(prefix)
            if folder_id is None:
                folder_id = uuid.uuid4().hex
                folder_ids[prefix] = folder_id
                folders.append({"id": folder_id, "title": component})
                item = {
                    "id": f"folder:{folder_id}",
                    "kind": "folder",
                    "folderId": folder_id,
                    "position": next_position(parent),
                }
                if parent is not None:
                    item["parentFolderId"] = parent
                items.append(item)
            parent = folder_id
        item = {
            "id": f"chapter:{chapter_id}",
            "kind": "chapter",
            "chapterId": chapter_id,
            "position": next_position(parent),
        }
        if parent is not None:
            item["parentFolderId"] = parent
        items.append(item)
    structure = {"folders": folders, "items": items}
    validate_tree(chapter_ids, structure)
    if flatten_tree(chapter_ids, structure) != list(chapter_ids):
        raise InvalidManuscriptSelection("Folder paths do not preserve chapter order.")
    return structure


def _acknowledgments(value: Any) -> set[str]:
    if (
        not isinstance(value, list)
        or any(not isinstance(code, str) or code not in WARNING_CODES for code in value)
        or len(value) != len(set(value))
    ):
        raise ManuscriptWarningsUnacknowledged("Warning acknowledgments are invalid.")
    return set(value)


def _canonical_marks(marks: list[dict]) -> list[dict]:
    ordered = sorted(marks, key=lambda mark: (mark["from"], mark["to"], mark["kind"]))
    result = []
    for mark in ordered:
        if result and result[-1]["kind"] == mark["kind"] and mark["from"] <= result[-1]["to"]:
            result[-1]["to"] = max(result[-1]["to"], mark["to"])
        else:
            result.append(dict(mark))
    return result


def _fingerprint(value: dict) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _utf16_len(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _word_count(value: str) -> int:
    import re

    return len(re.findall(r"\w+", value, re.UNICODE))


__all__ = ["SQLiteManuscriptImportRepository"]
