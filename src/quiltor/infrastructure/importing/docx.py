from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

from quiltor.application.manuscript_import import (
    MAX_DOCX_BYTES,
    ImportChapter,
    ImportUnit,
    InvalidManuscriptFile,
    ManuscriptLimitExceeded,
    ParsedManuscript,
    ParsedUnitManuscript,
    UnsupportedManuscriptContent,
)

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
MAX_MEMBERS = 256
MAX_EXPANDED_BYTES = 32 * 1024 * 1024
MAX_XML_BYTES = 16 * 1024 * 1024
MAX_PARAGRAPHS = 100_000
MAX_TEXT_CHARS = 10_000_000
MAX_XML_NODES = 500_000
MAX_XML_DEPTH = 128
_FALSE = {"0", "false", "off", "no"}
_WORD = re.compile(r"\w+", re.UNICODE)


def parse_docx(file_name: str, payload: bytes) -> ParsedManuscript:
    document, styles, warnings, package_title = _docx_parts(payload)
    return _parse_document(file_name, document, styles, warnings, package_title)


def parse_docx_units(file_name: str, payload: bytes) -> ParsedUnitManuscript:
    document, styles, warnings, package_title = _docx_parts(payload)
    parsed, title = _paragraph_units(file_name, document, styles, warnings, package_title)
    units = tuple(
        ImportUnit(index, text, marks, heading)
        for index, (text, marks, heading) in enumerate(parsed)
    )
    if not units:
        raise InvalidManuscriptFile("The DOCX contains no manuscript paragraphs.")
    warnings["formatting"] += sum(unit.is_heading and bool(unit.marks) for unit in units)
    return ParsedUnitManuscript(
        format="docx",
        title=title,
        units=units,
        source_words=sum(_word_count(unit.text) for unit in units),
        source_paragraphs=len(units),
        warnings=tuple(
            {"code": code, "count": count} for code, count in sorted(warnings.items()) if count
        ),
    )


def _docx_parts(payload: bytes):
    if not payload:
        raise InvalidManuscriptFile("The DOCX file is empty.")
    if len(payload) > MAX_DOCX_BYTES:
        raise ManuscriptLimitExceeded("The decoded DOCX exceeds 8 MiB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except (zipfile.BadZipFile, OSError) as error:
        raise InvalidManuscriptFile("The DOCX is not a readable ZIP archive.") from error
    with archive:
        members = archive.infolist()
        if not members or len(members) > MAX_MEMBERS:
            raise ManuscriptLimitExceeded("The DOCX contains too many archive members.")
        names = [member.filename for member in members]
        if len(names) != len(set(names)):
            raise InvalidManuscriptFile("The DOCX contains duplicate archive members.")
        expanded = 0
        for member in members:
            if member.flag_bits & 1:
                raise InvalidManuscriptFile("Encrypted DOCX files are not supported.")
            if not _safe_member(member.filename):
                raise InvalidManuscriptFile("The DOCX contains an unsafe archive member.")
            expanded += member.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise ManuscriptLimitExceeded("The expanded DOCX is too large.")
        if "word/document.xml" not in names:
            raise InvalidManuscriptFile("The DOCX has no main document part.")
        document = _read_xml(archive, "word/document.xml")
        styles = _styles(archive) if "word/styles.xml" in names else _StyleBook.empty()
        warnings = _package_warnings(names)
        package_title = _core_title(archive) if "docProps/core.xml" in names else ""
        return document, styles, warnings, package_title


def _safe_member(name: str) -> bool:
    if not name or "\\" in name or name.startswith("/"):
        return False
    path = PurePosixPath(name)
    return not path.is_absolute() and all(part not in {"", ".", ".."} for part in path.parts)


def _read_xml(archive: zipfile.ZipFile, name: str) -> ET.Element:
    info = archive.getinfo(name)
    if info.file_size > MAX_XML_BYTES:
        raise ManuscriptLimitExceeded("A DOCX XML part is too large.")
    try:
        payload = archive.read(info)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError) as error:
        raise InvalidManuscriptFile("A DOCX XML part cannot be read.") from error
    # XML declarations and DTD keywords are ASCII even when the containing XML is
    # UTF-16/32. Removing NUL code-unit padding catches both byte orders without
    # trusting or fully decoding a client-controlled encoding declaration.
    upper = payload.upper().replace(b"\0", b"")
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise InvalidManuscriptFile("DTD and entity declarations are not allowed in DOCX XML.")
    try:
        root = ET.fromstring(payload)
    except (ET.ParseError, RecursionError) as error:
        raise InvalidManuscriptFile("A DOCX XML part is malformed.") from error
    nodes = 0
    stack = [(root, 1)]
    while stack:
        element, depth = stack.pop()
        nodes += 1
        if nodes > MAX_XML_NODES or depth > MAX_XML_DEPTH:
            raise ManuscriptLimitExceeded("A DOCX XML part is too complex.")
        stack.extend((child, depth + 1) for child in element)
    return root


def _core_title(archive: zipfile.ZipFile) -> str:
    root = _read_xml(archive, "docProps/core.xml")
    element = root.find("{http://purl.org/dc/elements/1.1/}title")
    return (element.text or "").strip()[:100] if element is not None else ""


class _StyleBook:
    def __init__(self, styles: dict[str, tuple], defaults, defaults_unsupported: bool = False):
        self.styles = styles
        self.defaults = defaults
        self.defaults_unsupported = defaults_unsupported

    @classmethod
    def empty(cls):
        return cls({}, {"bold": False, "italic": False})

    def properties(self, style_id: str | None) -> dict[str, bool]:
        result = dict(self.defaults)
        result.update(self.explicit_properties(style_id))
        return result

    def explicit_properties(self, style_id: str | None) -> dict[str, bool]:
        result = {}
        chain: list[dict[str, bool]] = []
        seen: set[str] = set()
        current = style_id
        while current and current not in seen and len(seen) < 64:
            seen.add(current)
            style = self.styles.get(current)
            if style is None:
                break
            chain.append(style[2])
            current = style[1]
        for values in reversed(chain):
            result.update(values)
        return result

    def has_unsupported_formatting(self, style_id: str | None) -> bool:
        current = style_id
        seen: set[str] = set()
        while current and current not in seen and len(seen) < 64:
            seen.add(current)
            style = self.styles.get(current)
            if style is None:
                break
            if style[3]:
                return True
            current = style[1]
        return False

    def is_heading_one(self, style_id: str | None) -> bool:
        current = style_id
        seen: set[str] = set()
        while current and current not in seen and len(seen) < 64:
            seen.add(current)
            style = self.styles.get(current)
            name = style[0] if style else current
            normalized = re.sub(r"[\s_-]", "", name).casefold()
            if normalized in {"heading1", "überschrift1", "uberschrift1"}:
                return True
            current = style[1] if style else None
        return False


def _styles(archive: zipfile.ZipFile) -> _StyleBook:
    root = _read_xml(archive, "word/styles.xml")
    default_rpr = root.find(f"{W}docDefaults/{W}rPrDefault/{W}rPr")
    defaults = _properties(default_rpr)
    defaults.setdefault("bold", False)
    defaults.setdefault("italic", False)
    styles = {}
    for element in root.findall(f"{W}style"):
        style_id = element.get(f"{W}styleId")
        if not style_id:
            continue
        name_element = element.find(f"{W}name")
        based = element.find(f"{W}basedOn")
        name = name_element.get(f"{W}val", style_id) if name_element is not None else style_id
        style_rpr = element.find(f"{W}rPr")
        style_ppr = element.find(f"{W}pPr")
        normalized_name = re.sub(r"[\s_-]", "", name).casefold()
        styles[style_id] = (
            name,
            based.get(f"{W}val") if based is not None else None,
            _properties(style_rpr),
            _unsupported_rpr(style_rpr) or _unsupported_style_ppr(style_ppr, normalized_name),
        )
    return _StyleBook(styles, defaults, _unsupported_rpr(default_rpr))


def _properties(rpr: ET.Element | None) -> dict[str, bool]:
    if rpr is None:
        return {}
    result = {}
    for key, tag in (("bold", "b"), ("italic", "i")):
        element = rpr.find(f"{W}{tag}")
        if element is not None:
            result[key] = element.get(f"{W}val", "true").casefold() not in _FALSE
    return result


def _unsupported_rpr(rpr: ET.Element | None) -> bool:
    return bool(rpr is not None and {child.tag for child in rpr} - {f"{W}b", f"{W}i", f"{W}rStyle"})


def _package_warnings(names: list[str]) -> Counter:
    warnings = Counter()
    warnings["headers_footers"] = sum(
        name.startswith(("word/header", "word/footer")) for name in names
    )
    warnings["footnotes_endnotes"] = sum(
        name in {"word/footnotes.xml", "word/endnotes.xml"} for name in names
    )
    warnings["comments"] = sum(name.startswith("word/comments") for name in names)
    return warnings


def _unsupported_style_ppr(ppr: ET.Element | None, normalized_name: str) -> bool:
    if ppr is None:
        return False
    for child in ppr:
        if (
            normalized_name in {"heading1", "überschrift1", "uberschrift1"}
            and child.tag == f"{W}outlineLvl"
            and child.get(f"{W}val") == "0"
        ):
            continue
        return True
    return False


def _parse_document(
    file_name: str,
    root: ET.Element,
    styles: _StyleBook,
    warnings: Counter,
    package_title: str,
) -> ParsedManuscript:
    parsed, title = _paragraph_units(file_name, root, styles, warnings, package_title)
    source_words = sum(_word_count(text) for text, _marks, _heading in parsed)
    chapters: list[ImportChapter] = []
    current_title = title
    current_heading = ""
    current_paragraphs: list[tuple[str, tuple[dict, ...]]] = []
    saw_heading = False

    def finish() -> None:
        nonlocal current_paragraphs
        if not current_paragraphs and chapters and not current_heading:
            return
        body_text, marks = _join_paragraphs(current_paragraphs)
        chapters.append(
            ImportChapter(
                len(chapters),
                current_heading,
                current_title or f"Kapitel {len(chapters) + 1}",
                body_text,
                tuple(marks),
                len(current_paragraphs),
            )
        )
        current_paragraphs = []

    for text, marks, heading in parsed:
        if heading:
            if saw_heading or current_paragraphs:
                finish()
            saw_heading = True
            current_heading = text
            current_title = text.strip() or f"Kapitel {len(chapters) + 1}"
            if len(current_title) > 1000:
                raise InvalidManuscriptFile("A DOCX chapter heading exceeds the title limit.")
        else:
            current_paragraphs.append((text, marks))
    finish()
    if not chapters:
        chapters.append(ImportChapter(0, "", title, "", (), 0))
    warning_list = tuple(
        {"code": code, "count": count} for code, count in sorted(warnings.items()) if count
    )
    return ParsedManuscript(
        title=title,
        chapters=tuple(chapters),
        source_words=source_words,
        source_paragraphs=len(parsed),
        warnings=warning_list,
    )


def _paragraph_units(
    file_name: str,
    root: ET.Element,
    styles: _StyleBook,
    warnings: Counter,
    package_title: str,
):
    body = root.find(f"{W}body")
    if body is None:
        raise InvalidManuscriptFile("The DOCX has no document body.")
    forbidden = {
        f"{W}tbl",
        f"{W}altChunk",
        f"{W}customXml",
        f"{W}ins",
        f"{W}del",
        f"{W}moveFrom",
        f"{W}moveTo",
        f"{W}txbxContent",
    }
    if any(element.tag in forbidden for element in body.iter()):
        raise UnsupportedManuscriptContent("The DOCX contains unsupported body structures.")
    if any(child.tag not in {f"{W}p", f"{W}sectPr"} for child in body):
        raise UnsupportedManuscriptContent("The DOCX contains unsupported body structures.")
    paragraphs = body.findall(f"{W}p")
    if len(paragraphs) > MAX_PARAGRAPHS:
        raise ManuscriptLimitExceeded("The DOCX contains too many paragraphs.")
    parsed = []
    text_chars = 0
    for paragraph in paragraphs:
        value = _paragraph(paragraph, styles, warnings)
        text_chars += len(value[0])
        if text_chars > MAX_TEXT_CHARS:
            raise ManuscriptLimitExceeded("The DOCX contains too much text.")
        parsed.append(value)
    title = PurePosixPath(file_name.replace("\\", "/")).name
    if title.casefold().endswith(".docx"):
        title = title[:-5]
    title = package_title or title.strip() or "Manuskript"
    title = title[:100]
    return parsed, title


def _paragraph(paragraph: ET.Element, styles: _StyleBook, warnings: Counter):
    ppr = paragraph.find(f"{W}pPr")
    pstyle_element = ppr.find(f"{W}pStyle") if ppr is not None else None
    pstyle = pstyle_element.get(f"{W}val") if pstyle_element is not None else None
    outline = ppr.find(f"{W}outlineLvl") if ppr is not None else None
    heading = styles.is_heading_one(pstyle) or (
        outline is not None and outline.get(f"{W}val") == "0"
    )
    if ppr is not None and ppr.find(f"{W}numPr") is not None:
        warnings["numbering"] += 1
    if ppr is not None and {child.tag for child in ppr} - {
        f"{W}pStyle",
        f"{W}outlineLvl",
        f"{W}numPr",
        f"{W}rPr",
    }:
        warnings["formatting"] += 1
    if styles.has_unsupported_formatting(pstyle):
        warnings["formatting"] += 1
    if paragraph.findall(f".//{W}hyperlink"):
        warnings["hyperlinks"] += len(paragraph.findall(f".//{W}hyperlink"))
    images = paragraph.findall(f".//{W}drawing") + paragraph.findall(f".//{W}pict")
    warnings["images"] += len(images)
    fields = (
        paragraph.findall(f".//{W}fldSimple")
        + paragraph.findall(f".//{W}instrText")
        + paragraph.findall(f".//{W}fldChar")
    )
    warnings["fields"] += len(fields)
    warnings["comments"] += len(paragraph.findall(f".//{W}commentRangeStart"))
    warnings["comments"] += len(paragraph.findall(f".//{W}commentReference"))
    warnings["footnotes_endnotes"] += len(paragraph.findall(f".//{W}footnoteReference"))
    warnings["footnotes_endnotes"] += len(paragraph.findall(f".//{W}endnoteReference"))
    parts: list[str] = []
    marks: list[dict] = []
    position = 0
    paragraph_style = styles.properties(pstyle)
    for run in paragraph.findall(f".//{W}r"):
        rpr = run.find(f"{W}rPr")
        rstyle_element = rpr.find(f"{W}rStyle") if rpr is not None else None
        rstyle = rstyle_element.get(f"{W}val") if rstyle_element is not None else None
        properties = dict(paragraph_style)
        if rstyle:
            properties.update(styles.explicit_properties(rstyle))
        properties.update(_properties(rpr))
        if (
            _unsupported_rpr(rpr)
            or styles.has_unsupported_formatting(rstyle)
            or styles.defaults_unsupported
        ):
            warnings["formatting"] += 1
        allowed_run_children = {
            f"{W}rPr",
            f"{W}t",
            f"{W}tab",
            f"{W}br",
            f"{W}cr",
            f"{W}noBreakHyphen",
            f"{W}softHyphen",
            f"{W}drawing",
            f"{W}pict",
            f"{W}instrText",
            f"{W}fldChar",
            f"{W}commentReference",
            f"{W}footnoteReference",
            f"{W}endnoteReference",
        }
        if any(child.tag not in allowed_run_children for child in run):
            raise UnsupportedManuscriptContent("The DOCX contains unsupported run content.")
        text = "".join(
            child.text or ""
            if child.tag in {f"{W}t", f"{W}delText"}
            else "\t"
            if child.tag == f"{W}tab"
            else "\n"
            if child.tag in {f"{W}br", f"{W}cr"}
            else "‑"
            if child.tag == f"{W}noBreakHyphen"
            else "\u00ad"
            if child.tag == f"{W}softHyphen"
            else ""
            for child in run
        )
        if not text:
            continue
        start = position
        position += _utf16_len(text)
        parts.append(text)
        for kind in ("bold", "italic"):
            if properties.get(kind):
                _append_mark(marks, start, position, kind)
    return "".join(parts), tuple(_canonical_marks(marks)), heading


def _join_paragraphs(paragraphs):
    body_parts = []
    marks = []
    offset = 0
    for index, (text, paragraph_marks) in enumerate(paragraphs):
        if index:
            body_parts.append("\n\n")
            offset += 2
        body_parts.append(text)
        for mark in paragraph_marks:
            _append_mark(marks, mark["from"] + offset, mark["to"] + offset, mark["kind"])
        offset += _utf16_len(text)
    return "".join(body_parts), marks


def _append_mark(marks: list[dict], start: int, end: int, kind: str) -> None:
    if start == end:
        return
    if marks and marks[-1]["kind"] == kind and marks[-1]["to"] == start:
        marks[-1]["to"] = end
    else:
        marks.append({"from": start, "to": end, "kind": kind})


def _canonical_marks(marks: list[dict]) -> list[dict]:
    merged = []
    for kind in ("bold", "italic"):
        for mark in sorted(
            (candidate for candidate in marks if candidate["kind"] == kind),
            key=lambda candidate: (candidate["from"], candidate["to"]),
        ):
            if merged and merged[-1]["kind"] == kind and merged[-1]["to"] == mark["from"]:
                merged[-1]["to"] = mark["to"]
            else:
                merged.append(dict(mark))
    return sorted(merged, key=lambda mark: (mark["from"], mark["to"], mark["kind"]))


def _utf16_len(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _word_count(value: str) -> int:
    return len(_WORD.findall(value))


__all__ = ["parse_docx", "parse_docx_units"]
