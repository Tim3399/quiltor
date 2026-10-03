"""Review and export a revision-bound manuscript without mutating its source."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from pathlib import Path

from quiltor.application.document_wire_v1 import InvalidDocumentWireV1, encode_document_v1
from quiltor.application.documents.ports import DocumentRepository
from quiltor.application.errors import ApplicationConflict, InvalidApplicationInput
from quiltor.domain.manuscript import flatten_tree, structure_or_flat

PRESETS = ("editor", "normseite")
WARNING_CODES = ("notes", "references", "folders", "excluded_chapters", "extensions")
DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FILE_NAMES = {"editor": "Quiltor-Manuskript.docx", "normseite": "Quiltor-Normseite.docx"}
# ECMAScript whitespace, matching the author-facing manuscript word counter.
_WORDS = re.compile(
    r"[^\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"
)


class InvalidExportRequest(InvalidApplicationInput):
    code = "manuscript_export.invalid_request"


class EmptyExportBook(InvalidApplicationInput):
    code = "manuscript_export.empty_book"


class InvalidExportContent(InvalidApplicationInput):
    code = "manuscript_export.invalid_content"


class ExportLimitExceeded(InvalidApplicationInput):
    code = "manuscript_export.limit_exceeded"


class ExportPreviewMismatch(ApplicationConflict):
    code = "manuscript_export.preview_mismatch"


class ExportWarningsUnacknowledged(InvalidApplicationInput):
    code = "manuscript_export.warnings_unacknowledged"


def word_count(value: str) -> int:
    return len(_WORDS.findall(value))


def validate_preset(preset: object) -> str:
    if not isinstance(preset, str) or preset not in PRESETS:
        raise InvalidExportRequest("Unknown manuscript export preset.")
    return preset


class ManuscriptExportUseCases:
    def __init__(self, documents: DocumentRepository, render: Callable[[list[dict], str], bytes]):
        self._documents = documents
        self._render = render

    def _snapshot(self, database: Path, preset: str) -> tuple[dict, list[dict]]:
        validate_preset(preset)
        state = self._documents.load("manuscript", database)
        revision = self._documents.revision("manuscript", database)
        try:
            state = encode_document_v1("manuscript", state, revision)["payload"]
        except InvalidDocumentWireV1 as error:
            raise InvalidExportContent("The saved manuscript cannot be exported.") from error
        chapters_by_id = {chapter["id"]: chapter for chapter in state["chapters"]}
        structure = structure_or_flat(chapters_by_id, state.get("structure"))
        chapters = [
            chapters_by_id[chapter_id]
            for chapter_id in flatten_tree(chapters_by_id, structure)
            if chapters_by_id[chapter_id].get("inBook", True)
        ]
        if not chapters:
            raise EmptyExportBook("The book contains no chapters.")
        digest = hashlib.sha256(
            json.dumps(
                {"state": state, "preset": preset},
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("ascii")
        ).hexdigest()
        known_chapter = {
            "id",
            "inBook",
            "title",
            "body",
            "note",
            "noteReferences",
            "noteMarks",
            "storyTime",
            "mentions",
            "marks",
        }
        known_manuscript = {
            "chapters",
            "structure",
            "trash",
            "bookLayout",
            "language",
            "grammarMode",
            "words",
            "activeSymbols",
            "hiddenElements",
            "importSource",
        }
        counts = {
            "notes": sum(bool(chapter.get("note")) for chapter in chapters),
            "references": sum(
                len(chapter.get("mentions", [])) + bool(chapter.get("storyTime"))
                for chapter in chapters
            ),
            "folders": len(structure["folders"]),
            "excluded_chapters": len(state["chapters"]) - len(chapters),
            "extensions": len(state.keys() - known_manuscript)
            + sum(len(chapter.keys() - known_chapter) for chapter in chapters),
        }
        return {
            "preset": preset,
            "revision": revision,
            "sourceSha256": digest,
            "fileName": FILE_NAMES[preset],
            "chapters": [
                {
                    "id": chapter["id"],
                    "title": chapter["title"],
                    "words": word_count(chapter["body"]),
                    "excerpt": chapter["body"][:280],
                }
                for chapter in chapters
            ],
            "counts": {
                "manuscriptChapters": len(state["chapters"]),
                "manuscriptWords": sum(
                    word_count(chapter["body"]) for chapter in state["chapters"]
                ),
                "exportedChapters": len(chapters),
                "exportedWords": sum(word_count(chapter["body"]) for chapter in chapters),
            },
            "warnings": [
                {"code": code, "count": counts[code]} for code in WARNING_CODES if counts[code]
            ],
        }, chapters

    def preview(self, database: Path, preset: str) -> dict:
        preview, chapters = self._snapshot(database, preset)
        # Run the same bounded serializer before the author approves the preview.
        # No file, generated archive, or manuscript content is persisted here.
        self._render(chapters, preset)
        return preview

    def export(self, database: Path, payload: dict) -> tuple[str, bytes]:
        preview, chapters = self._snapshot(database, payload["preset"])
        if (
            payload["revision"] != preview["revision"]
            or payload["sourceSha256"] != preview["sourceSha256"]
        ):
            raise ExportPreviewMismatch("The manuscript changed after the export preview.")
        required = {warning["code"] for warning in preview["warnings"]}
        if set(payload["acknowledgedWarnings"]) != required:
            raise ExportWarningsUnacknowledged("Review the current export warnings.")
        return preview["fileName"], self._render(chapters, payload["preset"])
