from __future__ import annotations

from dataclasses import dataclass
from typing import Any

MAX_DOCX_BYTES = 8 * 1024 * 1024
MAX_IMPORT_BYTES = MAX_DOCX_BYTES
WARNING_CODES = frozenset(
    {
        "images",
        "hyperlinks",
        "headers_footers",
        "footnotes_endnotes",
        "comments",
        "numbering",
        "fields",
        "formatting",
    }
)


@dataclass(frozen=True, slots=True)
class ImportChapter:
    source_index: int
    heading: str
    title: str
    body: str
    marks: tuple[dict[str, Any], ...]
    body_paragraphs: int


@dataclass(frozen=True, slots=True)
class ParsedManuscript:
    title: str
    chapters: tuple[ImportChapter, ...]
    source_words: int
    source_paragraphs: int
    warnings: tuple[dict[str, Any], ...]


@dataclass(frozen=True, slots=True)
class ImportUnit:
    index: int
    text: str
    marks: tuple[dict[str, Any], ...]
    is_heading: bool


@dataclass(frozen=True, slots=True)
class ParsedUnitManuscript:
    format: str
    title: str
    units: tuple[ImportUnit, ...]
    source_words: int
    source_paragraphs: int
    warnings: tuple[dict[str, Any], ...]


class ManuscriptImportRepository:
    def preview(self, file_name: str, content: bytes, selection: Any = None) -> dict: ...

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
    ) -> dict[str, str]: ...

    def preview_v2(self, file_name: str, content: bytes, selection: Any = None) -> dict: ...

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
    ) -> dict[str, str]: ...


__all__ = [
    "MAX_DOCX_BYTES",
    "MAX_IMPORT_BYTES",
    "WARNING_CODES",
    "ImportChapter",
    "ImportUnit",
    "ManuscriptImportRepository",
    "ParsedManuscript",
    "ParsedUnitManuscript",
]
