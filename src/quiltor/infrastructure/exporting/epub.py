from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any
from xml.sax.saxutils import escape

from quiltor.application.manuscript_export import (
    ExportLimitExceeded,
    InvalidExportContent,
    word_count,
)
from quiltor.infrastructure.exporting.docx import ExportChapter

MAX_CHAPTERS = 10_000
MAX_PARAGRAPHS = 100_000
MAX_TEXT_CHARS = 10_000_000
MAX_MARKS = 500_000
MAX_CONTENT_DOCUMENT_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_BYTES = 32 * 1024 * 1024
MAX_XML_NODES = 500_000
MAX_EPUB_BYTES = 8 * 1024 * 1024

_XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
_MODIFIED_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z")
_LANGUAGE_PATTERN = re.compile(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*\Z")


@dataclass(frozen=True, slots=True)
class EpubExportOptions:
    title: str = "Manuskript"
    author: str = ""
    language: str = "de"
    identifier: str | None = None
    modified: str | None = None


@dataclass(frozen=True, slots=True)
class EpubExportResult:
    content: bytes
    counts: dict[str, int]


def serialize_epub(
    chapters: Sequence[ExportChapter | Mapping[str, Any]],
    options: EpubExportOptions | None = None,
) -> EpubExportResult:
    options = options or EpubExportOptions()
    if not isinstance(options, EpubExportOptions):
        raise InvalidExportContent("EPUB export options are invalid.")
    normalized = _chapters(chapters)
    title, author, language, identifier, modified = _options(options, normalized)

    budget = _PackageBudget()
    members: dict[str, bytes] = {}
    for index, chapter in enumerate(normalized, 1):
        path = f"EPUB/chapter-{index:05d}.xhtml"
        members[path] = _chapter_document(chapter, index, language, budget)

    static_members = {
        "META-INF/container.xml": _container_document(),
        "EPUB/styles.css": _stylesheet(),
        "EPUB/nav.xhtml": _navigation_document(normalized, language),
        "EPUB/package.opf": _package_document(
            normalized, title, author, language, identifier, modified
        ),
    }
    static_nodes = {
        "META-INF/container.xml": 3,
        "EPUB/styles.css": 0,
        "EPUB/nav.xhtml": 7 + 2 * len(normalized),
        "EPUB/package.opf": 9 + bool(author) + 2 * len(normalized),
    }
    for path, payload in static_members.items():
        budget.add_payload(payload, static_nodes[path])
        members[path] = payload
    budget.add_payload(b"application/epub+zip")

    content = _archive(members)
    if len(content) > MAX_EPUB_BYTES:
        raise ExportLimitExceeded("The generated EPUB exceeds 8 MiB.")
    paragraphs = sum(1 + len(chapter.body.split("\n\n")) for chapter in normalized)
    words = sum(word_count(chapter.title) + word_count(chapter.body) for chapter in normalized)
    return EpubExportResult(
        content,
        {"chapters": len(normalized), "paragraphs": paragraphs, "words": words},
    )


def _chapters(value: Any) -> tuple[ExportChapter, ...]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise InvalidExportContent("EPUB chapters must be an ordered sequence.")
    if not value:
        raise InvalidExportContent("At least one chapter is required for EPUB export.")
    if len(value) > MAX_CHAPTERS:
        raise ExportLimitExceeded("The EPUB export contains too many chapters.")
    result = []
    text_chars = paragraphs = mark_count = 0
    for item in value:
        if isinstance(item, ExportChapter):
            chapter = item
        elif isinstance(item, Mapping) and {"title", "body"} <= set(item):
            chapter = ExportChapter(item["title"], item["body"], item.get("marks", ()))
        else:
            raise InvalidExportContent("An EPUB chapter is invalid.")
        if not isinstance(chapter.title, str) or not isinstance(chapter.body, str):
            raise InvalidExportContent("EPUB chapter text must be a string.")
        _validate_text(chapter.title)
        _validate_text(chapter.body)
        text_chars += len(chapter.title) + len(chapter.body)
        paragraphs += 1 + len(chapter.body.split("\n\n"))
        if text_chars > MAX_TEXT_CHARS:
            raise ExportLimitExceeded("The EPUB export contains too much text.")
        if paragraphs > MAX_PARAGRAPHS:
            raise ExportLimitExceeded("The EPUB export contains too many paragraphs.")
        if isinstance(chapter.marks, (str, bytes)) or not isinstance(chapter.marks, Sequence):
            raise InvalidExportContent("EPUB marks must be an ordered sequence.")
        mark_count += len(chapter.marks)
        if mark_count > MAX_MARKS:
            raise ExportLimitExceeded("The EPUB export contains too many marks.")
        result.append(
            ExportChapter(chapter.title, chapter.body, _marks(chapter.body, chapter.marks))
        )
    return tuple(result)


def _options(
    options: EpubExportOptions, chapters: tuple[ExportChapter, ...]
) -> tuple[str, str, str, str, str]:
    for value in (options.title, options.author, options.language):
        if not isinstance(value, str):
            raise InvalidExportContent("EPUB export options are invalid.")
    if (
        not options.title.strip()
        or len(options.title) > 1_000
        or len(options.author) > 1_000
        or len(options.language) > 64
        or not _LANGUAGE_PATTERN.fullmatch(options.language)
    ):
        raise InvalidExportContent("EPUB export options are invalid.")
    for value in (options.title, options.author, options.language):
        _validate_text(value)
    if options.identifier is not None:
        if (
            not isinstance(options.identifier, str)
            or not options.identifier.strip()
            or len(options.identifier) > 256
        ):
            raise InvalidExportContent("EPUB export options are invalid.")
        _validate_text(options.identifier)
        identifier = options.identifier
    else:
        identifier = _content_identifier(chapters, options)
    if options.modified is None:
        modified = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    elif not isinstance(options.modified, str) or not _valid_modified(options.modified):
        raise InvalidExportContent("EPUB modification time must be a UTC timestamp.")
    else:
        modified = options.modified
    return options.title, options.author, options.language, identifier, modified


def _valid_modified(value: str) -> bool:
    if not _MODIFIED_PATTERN.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError:
        return False
    return True


def _content_identifier(chapters: tuple[ExportChapter, ...], options: EpubExportOptions) -> str:
    value = {
        "author": options.author,
        "chapters": [
            {"body": chapter.body, "marks": chapter.marks, "title": chapter.title}
            for chapter in chapters
        ],
        "language": options.language,
        "title": options.title,
    }
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return f"urn:sha256:{hashlib.sha256(encoded).hexdigest()}"


def _validate_text(value: str) -> None:
    for character in value:
        codepoint = ord(character)
        if (
            character == "\r"
            or codepoint < 0x20
            and character not in {"\t", "\n"}
            or 0xD800 <= codepoint <= 0xDFFF
            or codepoint in {0xFFFE, 0xFFFF}
        ):
            raise InvalidExportContent("EPUB text contains an unrepresentable character.")


def _marks(text: str, value: Sequence[Any]) -> tuple[dict[str, Any], ...]:
    encoded = text.encode("utf-16-le")
    length = len(encoded) // 2
    by_kind: dict[str, list[tuple[int, int]]] = {"bold": [], "italic": []}
    for mark in value:
        if not isinstance(mark, Mapping) or set(mark) != {"from", "to", "kind"}:
            raise InvalidExportContent("An EPUB mark is invalid.")
        start, end, kind = mark["from"], mark["to"], mark["kind"]
        if (
            type(start) is not int
            or type(end) is not int
            or not isinstance(kind, str)
            or kind not in by_kind
            or start < 0
            or start >= end
            or end > length
            or not _utf16_boundary(encoded, start)
            or not _utf16_boundary(encoded, end)
        ):
            raise InvalidExportContent("An EPUB mark range is invalid.")
        by_kind[kind].append((start, end))
    result = []
    for kind in ("bold", "italic"):
        merged: list[list[int]] = []
        for start, end in sorted(by_kind[kind]):
            if merged and start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        result.extend({"from": start, "to": end, "kind": kind} for start, end in merged)
    return tuple(result)


class _PackageBudget:
    def __init__(self) -> None:
        self.expanded_bytes = 0
        self.nodes = 0
        self.document_bytes: int | None = None

    def begin_document(self) -> None:
        self.document_bytes = 0

    def add_fragment(self, value: str, nodes: int = 0) -> None:
        size = len(value.encode())
        self.expanded_bytes += size
        if self.document_bytes is not None:
            self.document_bytes += size
            if self.document_bytes > MAX_CONTENT_DOCUMENT_BYTES:
                raise ExportLimitExceeded(
                    "A generated EPUB content document exceeds the safe limit."
                )
        self.nodes += nodes
        self._check()

    def add_payload(self, value: bytes, nodes: int = 0) -> None:
        self.expanded_bytes += len(value)
        self.nodes += nodes
        self._check()

    def end_document(self) -> None:
        self.document_bytes = None

    def _check(self) -> None:
        if self.expanded_bytes > MAX_EXPANDED_BYTES:
            raise ExportLimitExceeded("The generated EPUB expands beyond the safe limit.")
        if self.nodes > MAX_XML_NODES:
            raise ExportLimitExceeded("The generated EPUB contains too many XML nodes.")


def _chapter_document(
    chapter: ExportChapter, index: int, language: str, budget: _PackageBudget
) -> bytes:
    budget.begin_document()
    document_title = chapter.title if chapter.title.strip() else f"Kapitel {index}"
    opening = (
        f'{_XML_DECLARATION}<html xmlns="http://www.w3.org/1999/xhtml" '
        f'xml:lang="{escape(language)}" lang="{escape(language)}"><head>'
        f'<title>{escape(document_title)}</title><link rel="stylesheet" type="text/css" '
        'href="styles.css"/></head><body><section>'
        f"<h1>{escape(chapter.title)}</h1>"
    )
    budget.add_fragment(opening, 8)
    parts = [opening]
    marks_by_kind = {
        kind: [mark for mark in chapter.marks if mark["kind"] == kind]
        for kind in ("bold", "italic")
    }
    mark_indexes = {"bold": 0, "italic": 0}
    offset = 0
    paragraphs = chapter.body.split("\n\n")
    for paragraph_index, paragraph in enumerate(paragraphs):
        end = offset + _utf16_len(paragraph)
        paragraph_marks = _marks_in_range(marks_by_kind, mark_indexes, offset, end)
        rendered = "<p>" + _inline_content(paragraph, paragraph_marks, budget) + "</p>"
        budget.add_fragment("<p></p>", 1)
        parts.append(rendered)
        offset = end + (2 if paragraph_index < len(paragraphs) - 1 else 0)
    closing = "</section></body></html>"
    budget.add_fragment(closing)
    parts.append(closing)
    payload = "".join(parts).encode()
    budget.end_document()
    return payload


def _marks_in_range(
    marks_by_kind: Mapping[str, Sequence[Mapping[str, Any]]],
    indexes: dict[str, int],
    start: int,
    end: int,
) -> tuple[dict[str, Any], ...]:
    result = []
    for kind in ("bold", "italic"):
        marks = marks_by_kind[kind]
        at = indexes[kind]
        while at < len(marks) and marks[at]["to"] <= start:
            at += 1
        indexes[kind] = at
        while at < len(marks) and marks[at]["from"] < end:
            mark = marks[at]
            result.append(
                {
                    "from": max(mark["from"], start) - start,
                    "to": min(mark["to"], end) - start,
                    "kind": kind,
                }
            )
            if mark["to"] > end:
                break
            at += 1
        indexes[kind] = at
    return tuple(result)


def _inline_content(text: str, marks: Sequence[Mapping[str, Any]], budget: _PackageBudget) -> str:
    boundaries = {0, _utf16_len(text)}
    for mark in marks:
        boundaries.update((mark["from"], mark["to"]))
    indexes = _python_indexes(text, boundaries)
    marks_by_kind = {
        kind: [mark for mark in marks if mark["kind"] == kind] for kind in ("bold", "italic")
    }
    mark_indexes = {"bold": 0, "italic": 0}
    result = []
    for start, end in pairwise(sorted(boundaries)):
        active = set()
        for kind in ("bold", "italic"):
            candidates = marks_by_kind[kind]
            at = mark_indexes[kind]
            while at < len(candidates) and candidates[at]["to"] <= start:
                at += 1
            mark_indexes[kind] = at
            if at < len(candidates) and candidates[at]["from"] <= start < candidates[at]["to"]:
                active.add(kind)
        value = _escaped_text(text[indexes[start] : indexes[end]])
        if "italic" in active:
            value = f"<em>{value}</em>"
        if "bold" in active:
            value = f"<strong>{value}</strong>"
        budget.add_fragment(value, value.count("<br/>") + len(active))
        result.append(value)
    return "".join(result)


def _escaped_text(value: str) -> str:
    return "<br/>".join(escape(part) for part in value.split("\n"))


def _navigation_document(chapters: tuple[ExportChapter, ...], language: str) -> bytes:
    items = "".join(
        f'<li><a href="chapter-{index:05d}.xhtml">'
        f"{escape(chapter.title if chapter.title.strip() else f'Kapitel {index}')}</a></li>"
        for index, chapter in enumerate(chapters, 1)
    )
    return (
        f'{_XML_DECLARATION}<html xmlns="http://www.w3.org/1999/xhtml" '
        f'xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{escape(language)}" '
        f'lang="{escape(language)}"><head><title>Inhaltsverzeichnis</title></head><body>'
        f'<nav epub:type="toc" id="toc"><h1>Inhaltsverzeichnis</h1><ol>{items}</ol></nav>'
        "</body></html>"
    ).encode()


def _package_document(
    chapters: tuple[ExportChapter, ...],
    title: str,
    author: str,
    language: str,
    identifier: str,
    modified: str,
) -> bytes:
    chapter_manifest = "".join(
        f'<item id="chapter-{index:05d}" href="chapter-{index:05d}.xhtml" '
        'media-type="application/xhtml+xml"/>'
        for index in range(1, len(chapters) + 1)
    )
    spine = "".join(
        f'<itemref idref="chapter-{index:05d}"/>' for index in range(1, len(chapters) + 1)
    )
    creator = f"<dc:creator>{escape(author)}</dc:creator>" if author else ""
    return (
        f'{_XML_DECLARATION}<package xmlns="http://www.idpf.org/2007/opf" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" '
        'unique-identifier="publication-id"><metadata>'
        f'<dc:identifier id="publication-id">{escape(identifier)}</dc:identifier>'
        f"<dc:title>{escape(title)}</dc:title>{creator}<dc:language>{escape(language)}</dc:language>"
        f'<meta property="dcterms:modified">{modified}</meta></metadata><manifest>'
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        '<item id="css" href="styles.css" media-type="text/css"/>'
        f"{chapter_manifest}</manifest><spine>{spine}</spine></package>"
    ).encode()


def _container_document() -> bytes:
    return (
        f'{_XML_DECLARATION}<container version="1.0" '
        'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
        '<rootfile full-path="EPUB/package.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles></container>'
    ).encode()


def _stylesheet() -> bytes:
    return (
        b"body { margin: 5%; font-family: serif; line-height: 1.5; }\n"
        b"h1 { break-before: page; }\n"
        b"p { margin: 0 0 1em; white-space: pre-wrap; }\n"
    )


def _archive(members: Mapping[str, bytes]) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        _write_member(archive, "mimetype", b"application/epub+zip", zipfile.ZIP_STORED)
        for name in sorted(members):
            _write_member(archive, name, members[name], zipfile.ZIP_DEFLATED)
    return target.getvalue()


def _write_member(archive: zipfile.ZipFile, name: str, payload: bytes, compression: int) -> None:
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = compression
    info.create_system = 3
    info.external_attr = 0o600 << 16
    archive.writestr(info, payload)


def _utf16_len(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _utf16_boundary(encoded: bytes, offset: int) -> bool:
    if offset <= 0 or offset >= len(encoded) // 2:
        return True
    previous = int.from_bytes(encoded[(offset - 1) * 2 : offset * 2], "little")
    current = int.from_bytes(encoded[offset * 2 : (offset + 1) * 2], "little")
    return not (0xD800 <= previous <= 0xDBFF and 0xDC00 <= current <= 0xDFFF)


def _python_indexes(value: str, wanted: set[int]) -> dict[int, int]:
    result = {}
    offset = 0
    for index, character in enumerate(value):
        if offset in wanted:
            result[offset] = index
        offset += 2 if ord(character) > 0xFFFF else 1
    if offset in wanted:
        result[offset] = len(value)
    return result


__all__ = ["EpubExportOptions", "EpubExportResult", "serialize_epub"]
