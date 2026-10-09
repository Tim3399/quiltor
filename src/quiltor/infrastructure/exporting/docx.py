from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any, Literal
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

from quiltor.application.manuscript_export import (
    ExportLimitExceeded,
    InvalidExportContent,
    word_count,
)
from quiltor.infrastructure.exporting._utf16 import _python_indexes, _utf16_boundary, _utf16_len

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"

MAX_CHAPTERS = 10_000
MAX_PARAGRAPHS = 100_000
MAX_TEXT_CHARS = 10_000_000
MAX_MARKS = 500_000
MAX_DOCX_BYTES = 8 * 1024 * 1024
MAX_DOCUMENT_XML_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_XML_BYTES = 32 * 1024 * 1024
MAX_XML_NODES = 500_000
_XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'


@dataclass(frozen=True, slots=True)
class ExportChapter:
    title: str
    body: str
    marks: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class DocxExportOptions:
    preset: Literal["editor", "normseite"] = "editor"
    page_numbers: bool = True


@dataclass(frozen=True, slots=True)
class DocxExportResult:
    content: bytes
    counts: dict[str, int]
    warnings: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class _Preset:
    font: str
    line: int
    line_rule: str
    left: int
    right: int
    top: int
    bottom: int
    footer: int


_PRESETS = {
    "editor": _Preset("Times New Roman", 360, "auto", 1440, 1440, 1440, 1440, 720),
    # Word needs two extra twips beyond the nominal 60 × 144 grid before its
    # fixed-pitch line breaker accepts the sixtieth Courier New 12 pt glyph.
    # Calibration still rejects a 61st glyph. Word also reserves a hidden footer
    # clearance at 720 twips; 598 is the closest measured footer position that
    # retains 30 exact 480-twip lines while keeping the body margins unchanged.
    "normseite": _Preset("Courier New", 480, "exact", 1701, 1563, 1417, 1021, 598),
}


def serialize_docx(
    chapters: Sequence[ExportChapter | Mapping[str, Any]],
    options: DocxExportOptions | None = None,
) -> DocxExportResult:
    options = options or DocxExportOptions()
    if not isinstance(options, DocxExportOptions):
        raise InvalidExportContent("DOCX export options are invalid.")
    if (
        not isinstance(options.preset, str)
        or options.preset not in _PRESETS
        or type(options.page_numbers) is not bool
    ):
        raise InvalidExportContent("DOCX export options are invalid.")
    normalized = _chapters(chapters)
    preset = _PRESETS[options.preset]
    document = _document_xml(normalized, preset, options.page_numbers)
    if len(document) > MAX_DOCUMENT_XML_BYTES:
        raise ExportLimitExceeded("The generated manuscript XML exceeds the safe limit.")
    if sum(1 for _node in ET.fromstring(document).iter()) > MAX_XML_NODES:
        raise ExportLimitExceeded("The generated DOCX contains too many XML nodes.")
    members = {
        "[Content_Types].xml": _content_types(options.page_numbers),
        "_rels/.rels": _package_relationships(),
        "word/_rels/document.xml.rels": _document_relationships(options.page_numbers),
        "word/document.xml": document,
        "word/settings.xml": _settings_xml(),
        "word/styles.xml": _styles_xml(preset),
    }
    if options.page_numbers:
        members["word/footer1.xml"] = _footer_xml(preset)
    if sum(len(payload) for payload in members.values()) > MAX_EXPANDED_XML_BYTES:
        raise ExportLimitExceeded("The generated DOCX expands beyond the safe limit.")
    content = _archive(members)
    if len(content) > MAX_DOCX_BYTES:
        raise ExportLimitExceeded("The generated DOCX exceeds 8 MiB.")
    paragraphs = sum(1 + len(chapter.body.split("\n\n")) for chapter in normalized)
    words = sum(word_count(chapter.title) + word_count(chapter.body) for chapter in normalized)
    return DocxExportResult(
        content,
        {"chapters": len(normalized), "paragraphs": paragraphs, "words": words},
    )


def _chapters(value) -> tuple[ExportChapter, ...]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise InvalidExportContent("DOCX chapters must be an ordered sequence.")
    if not value:
        raise InvalidExportContent("At least one chapter is required for DOCX export.")
    if len(value) > MAX_CHAPTERS:
        raise ExportLimitExceeded("The DOCX export contains too many chapters.")
    result = []
    text_chars = paragraphs = marks = 0
    for item in value:
        if isinstance(item, ExportChapter):
            chapter = item
        elif isinstance(item, Mapping) and {"title", "body"} <= set(item):
            chapter = ExportChapter(item["title"], item["body"], item.get("marks", ()))
        else:
            raise InvalidExportContent("A DOCX chapter is invalid.")
        if not isinstance(chapter.title, str) or not isinstance(chapter.body, str):
            raise InvalidExportContent("DOCX chapter text must be a string.")
        _validate_text(chapter.title)
        _validate_text(chapter.body)
        paragraph_count = len(chapter.body.split("\n\n"))
        text_chars += len(chapter.title) + len(chapter.body)
        paragraphs += 1 + paragraph_count
        if text_chars > MAX_TEXT_CHARS:
            raise ExportLimitExceeded("The DOCX export contains too much text.")
        if paragraphs > MAX_PARAGRAPHS:
            raise ExportLimitExceeded("The DOCX export contains too many paragraphs.")
        if isinstance(chapter.marks, (str, bytes)) or not isinstance(chapter.marks, Sequence):
            raise InvalidExportContent("DOCX marks must be an ordered sequence.")
        marks += len(chapter.marks)
        if marks > MAX_MARKS:
            raise ExportLimitExceeded("The DOCX export contains too many marks.")
        normalized_marks = _marks(chapter.body, chapter.marks)
        result.append(ExportChapter(chapter.title, chapter.body, normalized_marks))
    return tuple(result)


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
            raise InvalidExportContent("DOCX text contains an unrepresentable character.")


def _marks(text: str, value) -> tuple[dict[str, Any], ...]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise InvalidExportContent("DOCX marks must be an ordered sequence.")
    encoded = text.encode("utf-16-le")
    length = len(encoded) // 2
    by_kind: dict[str, list[tuple[int, int]]] = {"bold": [], "italic": []}
    for mark in value:
        if not isinstance(mark, Mapping) or set(mark) != {"from", "to", "kind"}:
            raise InvalidExportContent("A DOCX mark is invalid.")
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
            raise InvalidExportContent("A DOCX mark range is invalid.")
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


def _document_xml(chapters: tuple[ExportChapter, ...], preset: _Preset, footer: bool) -> bytes:
    budget = _XmlBudget()
    opening = f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>'
    budget.add(opening)
    body = [opening]
    for chapter in chapters:
        body.append(_paragraph_xml(chapter.title, (), preset, budget, heading=True))
        marks_by_kind = {
            kind: [mark for mark in chapter.marks if mark["kind"] == kind]
            for kind in ("bold", "italic")
        }
        mark_indexes = {"bold": 0, "italic": 0}
        offset = 0
        parts = chapter.body.split("\n\n")
        for index, text in enumerate(parts):
            start = offset
            end = start + _utf16_len(text)
            paragraph_marks = _marks_in_paragraph(marks_by_kind, mark_indexes, start, end)
            body.append(_paragraph_xml(text, paragraph_marks, preset, budget))
            offset = end + (2 if index < len(parts) - 1 else 0)
    footer_reference = '<w:footerReference w:type="default" r:id="rId3"/>' if footer else ""
    section = (
        f'<w:sectPr>{footer_reference}<w:pgSz w:w="11906" w:h="16838"/>'
        f'<w:pgMar w:top="{preset.top}" w:right="{preset.right}" '
        f'w:bottom="{preset.bottom}" w:left="{preset.left}" '
        f'w:header="0" w:footer="{preset.footer}" w:gutter="0"/></w:sectPr>'
    )
    closing = section + "</w:body></w:document>"
    budget.add(closing)
    body.append(closing)
    return (_XML_DECLARATION + "".join(body)).encode("utf-8")


class _XmlBudget:
    def __init__(self) -> None:
        self.used = len(_XML_DECLARATION.encode("utf-8"))

    def add(self, value: str) -> None:
        self.used += len(value.encode("utf-8"))
        if self.used > MAX_DOCUMENT_XML_BYTES:
            raise ExportLimitExceeded("The generated manuscript XML exceeds the safe limit.")


def _marks_in_paragraph(marks_by_kind, indexes, start, end):
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


def _paragraph_xml(
    text: str, marks, preset: _Preset, budget: _XmlBudget, *, heading: bool = False
) -> str:
    properties = [
        '<w:jc w:val="left"/>',
        '<w:ind w:left="0" w:right="0" w:firstLine="0"/>',
        (
            f'<w:spacing w:before="0" w:after="0" w:line="{preset.line}" '
            f'w:lineRule="{preset.line_rule}"/>'
        ),
        '<w:widowControl w:val="0"/>',
    ]
    if heading:
        properties[:0] = ['<w:pStyle w:val="Heading1"/>', "<w:pageBreakBefore/>"]
    opening = f"<w:p><w:pPr>{''.join(properties)}</w:pPr>"
    closing = "</w:p>"
    budget.add(opening)
    runs = _runs_xml(text, marks, preset, budget)
    budget.add(closing)
    return opening + runs + closing


def _runs_xml(text: str, marks, preset: _Preset, budget: _XmlBudget) -> str:
    boundaries = {0, _utf16_len(text)}
    for mark in marks:
        boundaries.update((mark["from"], mark["to"]))
    result = []
    ordered = sorted(boundaries)
    python_indexes = _python_indexes(text, boundaries)
    marks_by_kind = {
        kind: [mark for mark in marks if mark["kind"] == kind] for kind in ("bold", "italic")
    }
    mark_indexes = {"bold": 0, "italic": 0}
    for start, end in pairwise(ordered):
        value = text[python_indexes[start] : python_indexes[end]]
        active = set()
        for kind in ("bold", "italic"):
            candidates = marks_by_kind[kind]
            at = mark_indexes[kind]
            while at < len(candidates) and candidates[at]["to"] <= start:
                at += 1
            mark_indexes[kind] = at
            if at < len(candidates) and candidates[at]["from"] <= start < candidates[at]["to"]:
                active.add(kind)
        run = _run_xml(value, active, preset)
        budget.add(run)
        result.append(run)
    if not result:
        run = _run_xml("", set(), preset)
        budget.add(run)
        result.append(run)
    return "".join(result)


def _run_xml(text: str, active: set[str], preset: _Preset) -> str:
    properties = [
        (
            f"<w:rFonts w:ascii={quoteattr(preset.font)} w:hAnsi={quoteattr(preset.font)} "
            f"w:eastAsia={quoteattr(preset.font)} w:cs={quoteattr(preset.font)}/>"
        ),
        '<w:sz w:val="24"/><w:szCs w:val="24"/>',
    ]
    if "bold" in active:
        properties.append("<w:b/>")
    if "italic" in active:
        properties.append("<w:i/>")
    content = []
    chunks = re.split("([\n\t])", text)
    for chunk in chunks:
        if chunk == "\n":
            content.append("<w:br/>")
        elif chunk == "\t":
            content.append("<w:tab/>")
        elif chunk:
            content.append(f'<w:t xml:space="preserve">{escape(chunk)}</w:t>')
    if not content:
        content.append('<w:t xml:space="preserve"></w:t>')
    return f"<w:r><w:rPr>{''.join(properties)}</w:rPr>{''.join(content)}</w:r>"


def _styles_xml(preset: _Preset) -> bytes:
    font = quoteattr(preset.font)
    return _xml(
        f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr>'
        f"<w:rFonts w:ascii={font} w:hAnsi={font} w:eastAsia={font} w:cs={font}/>"
        '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1">'
        '<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:outlineLvl w:val="0"/><w:pageBreakBefore/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style></w:styles>'
    )


def _settings_xml() -> bytes:
    return _xml(f'<w:settings xmlns:w="{W}"><w:autoHyphenation w:val="false"/></w:settings>')


def _footer_xml(preset: _Preset) -> bytes:
    font = quoteattr(preset.font)
    return _xml(
        f'<w:ftr xmlns:w="{W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>'
        f'<w:rFonts w:ascii={font} w:hAnsi={font}/><w:sz w:val="20"/></w:rPr>'
        '<w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGE </w:instrText>'
        '<w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>'
    )


def _content_types(footer: bool) -> bytes:
    footer_override = (
        '<Override PartName="/word/footer1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        if footer
        else ""
    )
    return _xml(
        f'<Types xmlns="{CONTENT_TYPES}"><Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/settings.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        f"{footer_override}</Types>"
    )


def _package_relationships() -> bytes:
    return _xml(
        f'<Relationships xmlns="{PACKAGE_REL}"><Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/></Relationships>'
    )


def _document_relationships(footer: bool) -> bytes:
    footer_relationship = (
        '<Relationship Id="rId3" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" '
        'Target="footer1.xml"/>'
        if footer
        else ""
    )
    return _xml(
        f'<Relationships xmlns="{PACKAGE_REL}"><Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/><Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" '
        f'Target="settings.xml"/>{footer_relationship}</Relationships>'
    )


def _archive(members: Mapping[str, bytes]) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(members):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, members[name])
    return target.getvalue()


def _xml(value: str) -> bytes:
    return (_XML_DECLARATION + value).encode("utf-8")


__all__ = [
    "DocxExportOptions",
    "DocxExportResult",
    "ExportChapter",
    "ExportLimitExceeded",
    "InvalidExportContent",
    "serialize_docx",
]
