from __future__ import annotations

import re
from collections import Counter
from pathlib import PurePath

from quiltor.application.manuscript_import import (
    ImportUnit,
    InvalidManuscriptFile,
    ManuscriptLimitExceeded,
    ParsedUnitManuscript,
    UnsupportedManuscriptContent,
)

MAX_PARAGRAPHS = 100_000
MAX_TEXT_CHARS = 10_000_000
MAX_MARKDOWN_TOKENS = 300_000
MAX_MARKDOWN_SOURCE_CHARS = 2_000_000
MAX_MARKDOWN_DEPTH = 64
_WORD = re.compile(r"\w+", re.UNICODE)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def parse_text_units(file_name: str, payload: bytes) -> ParsedUnitManuscript:
    text = _decode_text(payload)
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = normalized.split("\n\n")
    if len(paragraphs) > MAX_PARAGRAPHS:
        raise ManuscriptLimitExceeded("The text file contains too many paragraphs.")
    units = tuple(ImportUnit(index, value, (), False) for index, value in enumerate(paragraphs))
    return _result("txt", file_name, units, ())


def parse_markdown_units(file_name: str, payload: bytes) -> ParsedUnitManuscript:
    from markdown_it import MarkdownIt

    text = _decode_text(payload)
    if len(text) > MAX_MARKDOWN_SOURCE_CHARS:
        raise ManuscriptLimitExceeded("The Markdown source is too large to parse safely.")
    try:
        tokens = MarkdownIt("commonmark", {"maxNesting": 256}).parse(text)
    except (RecursionError, RuntimeError, ValueError) as error:
        raise InvalidManuscriptFile("The Markdown document is malformed.") from error
    if _token_count(tokens) > MAX_MARKDOWN_TOKENS or any(
        token.level > MAX_MARKDOWN_DEPTH for token in tokens
    ):
        raise ManuscriptLimitExceeded("The Markdown document is too complex.")
    warnings = Counter()
    units: list[ImportUnit] = []
    heading_depth = 0
    for token in tokens:
        if token.type == "html_block":
            raise UnsupportedManuscriptContent("Raw HTML is not supported in Markdown imports.")
        if token.type == "heading_open":
            heading_depth += 1
        elif token.type == "heading_close":
            heading_depth -= 1
        elif token.type == "ordered_list_open":
            warnings["numbering"] += 1
        elif token.type in {"bullet_list_open", "blockquote_open"}:
            warnings["formatting"] += 1
        elif token.type == "inline":
            value, marks = _inline(token.children or [], warnings)
            units.append(ImportUnit(len(units), value, tuple(marks), heading_depth > 0))
        elif token.type in {"fence", "code_block"}:
            warnings["formatting"] += 1
            units.append(ImportUnit(len(units), token.content, (), False))
        elif token.type == "hr":
            warnings["formatting"] += 1
            units.append(ImportUnit(len(units), token.markup, (), False))
        elif token.content:
            raise UnsupportedManuscriptContent(
                "Markdown contains an unsupported text-bearing structure."
            )
    if not units:
        units.append(ImportUnit(0, "", (), False))
    if len(units) > MAX_PARAGRAPHS:
        raise ManuscriptLimitExceeded("The Markdown document contains too many paragraphs.")
    warnings["formatting"] += sum(unit.is_heading and bool(unit.marks) for unit in units)
    return _result("markdown", file_name, tuple(units), _warning_list(warnings))


def _decode_text(payload: bytes) -> str:
    if not payload:
        return ""
    try:
        if payload.startswith(b"\xef\xbb\xbf"):
            text = payload[3:].decode("utf-8")
        elif payload.startswith(b"\xff\xfe"):
            text = payload[2:].decode("utf-16-le")
        elif payload.startswith(b"\xfe\xff"):
            text = payload[2:].decode("utf-16-be")
        else:
            text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise InvalidManuscriptFile("The text encoding is invalid.") from error
    if len(text) > MAX_TEXT_CHARS:
        raise ManuscriptLimitExceeded("The text document contains too much text.")
    if _CONTROL.search(text):
        raise InvalidManuscriptFile("Binary or NUL content is not a text manuscript.")
    return text


def _inline(children, warnings: Counter):
    parts: list[str] = []
    marks: list[dict] = []
    offset = 0
    bold = 0
    italic = 0

    nesting = 0

    def append(value: str, nested_marks=()) -> None:
        nonlocal offset
        if not value:
            return
        start = offset
        offset += _utf16_len(value)
        parts.append(value)
        if bold:
            marks.append({"from": start, "to": offset, "kind": "bold"})
        if italic:
            marks.append({"from": start, "to": offset, "kind": "italic"})
        marks.extend(
            {
                "from": mark["from"] + start,
                "to": mark["to"] + start,
                "kind": mark["kind"],
            }
            for mark in nested_marks
        )

    for child in children:
        if child.type == "strong_open":
            bold += 1
            nesting += 1
        elif child.type == "strong_close":
            bold -= 1
            nesting -= 1
        elif child.type == "em_open":
            italic += 1
            nesting += 1
        elif child.type == "em_close":
            italic -= 1
            nesting -= 1
        elif child.type == "link_open":
            warnings["hyperlinks"] += 1
        elif child.type == "link_close":
            continue
        elif child.type == "image":
            warnings["images"] += 1
            alt, alt_marks = _inline(child.children or [], warnings)
            append(alt, alt_marks)
        elif child.type in {"text", "code_inline"}:
            if child.type == "code_inline":
                warnings["formatting"] += 1
            append(child.content)
        elif child.type in {"softbreak", "hardbreak"}:
            append("\n")
        elif child.type == "html_inline":
            raise UnsupportedManuscriptContent("Raw HTML is not supported in Markdown imports.")
        elif child.content:
            raise UnsupportedManuscriptContent("Markdown contains unsupported inline text content.")
        if nesting > MAX_MARKDOWN_DEPTH:
            raise ManuscriptLimitExceeded("Markdown inline nesting is too deep.")
    if bold or italic:
        raise InvalidManuscriptFile("Markdown emphasis is unbalanced.")
    return "".join(parts), _canonical_marks(marks)


def _token_count(tokens) -> int:
    count = 0
    pending = list(tokens)
    while pending:
        token = pending.pop()
        count += 1
        if count > MAX_MARKDOWN_TOKENS:
            return count
        pending.extend(token.children or [])
    return count


def _result(format_name, file_name, units, warnings):
    title = PurePath(file_name).name.rsplit(".", 1)[0].strip() or "Manuskript"
    title = title[:100]
    return ParsedUnitManuscript(
        format=format_name,
        title=title,
        units=units,
        source_words=sum(len(_WORD.findall(unit.text)) for unit in units),
        source_paragraphs=len(units),
        warnings=warnings,
    )


def _warning_list(warnings: Counter):
    return tuple(
        {"code": code, "count": count} for code, count in sorted(warnings.items()) if count
    )


def _canonical_marks(marks):
    result = []
    for kind in ("bold", "italic"):
        for mark in sorted(
            (candidate for candidate in marks if candidate["kind"] == kind),
            key=lambda candidate: (candidate["from"], candidate["to"]),
        ):
            if result and result[-1]["kind"] == kind and mark["from"] <= result[-1]["to"]:
                result[-1]["to"] = max(result[-1]["to"], mark["to"])
            else:
                result.append(dict(mark))
    return sorted(result, key=lambda mark: (mark["from"], mark["to"], mark["kind"]))


def _utf16_len(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


__all__ = ["parse_markdown_units", "parse_text_units"]
