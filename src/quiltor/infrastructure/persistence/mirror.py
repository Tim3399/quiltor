"""Human-readable Markdown mirrors of the SQLite-authoritative manuscript and character
profiles -- these exist purely for reading, backups, and the snapshot history, never as a
second source of truth (SQLite always wins on load)."""

from __future__ import annotations

import re
from pathlib import Path

from quiltor.domain.story_world.profile import normalize_profile
from quiltor.domain.text_offsets import utf16_length, utf16_offsets_to_indices

MIRROR_RE = re.compile(r"^\d{2,} - .*\.md$")  # writer uses f"{i:02d} - ...", unbounded above 99


def safe_name(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title or "").strip()
    name = re.sub(r"\s+", " ", name)
    return (name or "Ohne Titel")[:70]


def markdown_body(body: str, marks) -> str:
    """Bold and italic live as ranges beside the manuscript body, never as characters in it.

    The grammar check, mention scanner and assistant all read the raw text. The mirror is
    Markdown, so only here do the ranges become `**fett**`/`*kursiv*`.

    Mirrors ``markdownBody()`` in the manuscript module's ``marks.ts``; the two exports have
    to read the same, while their runtime-specific range traversal stays separate.
    """
    if not isinstance(marks, list) or not body:
        return body
    body_length = utf16_length(body)
    normalized_marks = []
    offsets: list[int] = []
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("kind") not in ("bold", "italic"):
            continue
        start, end = mark.get("from"), mark.get("to")
        if type(start) is not int or type(end) is not int:
            continue
        normalized = (max(0, start), min(end, body_length), mark["kind"])
        if normalized[1] <= normalized[0]:
            continue
        normalized_marks.append(normalized)
        offsets.extend(normalized[:2])
    indices = utf16_offsets_to_indices(body, offsets)
    if indices is None:
        return body
    bold = bytearray(len(body))
    italic = bytearray(len(body))
    for start, end, kind in normalized_marks:
        span = bold if kind == "bold" else italic
        for index in range(indices[start], indices[end]):
            span[index] = 1
    if not any(bold) and not any(italic):
        return body

    out, run_start = [], 0
    for index in range(1, len(body) + 1):
        same = (
            index < len(body)
            and bold[index] == bold[run_start]
            and italic[index] == italic[run_start]
        )
        if same:
            continue
        out.append(_emphasize(body[run_start:index], bold[run_start], italic[run_start]))
        run_start = index
    return "".join(out)


def _emphasize(text: str, bold: int, italic: int) -> str:
    """Markdown emphasis cannot cross a blank line and its delimiters must not sit against
    whitespace, so a run is split at paragraph breaks and trimmed before it is wrapped."""
    if not bold and not italic:
        return text
    open_marker = ("**" if bold else "") + ("*" if italic else "")
    close_marker = ("*" if italic else "") + ("**" if bold else "")
    pieces = re.split(r"(\n\s*\n)", text)
    wrapped = []
    for piece in pieces:
        if not piece.strip() or re.fullmatch(r"\n\s*\n", piece):
            wrapped.append(piece)
            continue
        lead = piece[: len(piece) - len(piece.lstrip())]
        tail = piece[len(piece.rstrip()) :]
        wrapped.append(f"{lead}{open_marker}{piece.strip()}{close_marker}{tail}")
    return "".join(wrapped)


def note_markdown(note: str, marks, heading_offset: int = 0) -> str:
    """Render note marks as Markdown while keeping the persisted note plain.

    Note offsets are JavaScript/CodeMirror UTF-16 offsets. Heading marks cover
    exactly one non-empty source line; ``heading_offset`` nests them below a
    surrounding mirror section such as ``## Notizen``.
    """
    if not isinstance(note, str) or not note:
        return note
    if not isinstance(marks, list):
        return note

    safe_heading_offset = heading_offset if type(heading_offset) is int else 0
    output: list[str] = []
    line_start = 0
    for line in note.split("\n"):
        line_length = utf16_length(line)
        line_end = line_start + line_length
        inline_marks = []
        heading_level = None

        for mark in marks:
            if not isinstance(mark, dict):
                continue
            kind = mark.get("kind")
            start, end = mark.get("from"), mark.get("to")
            if type(start) is not int or type(end) is not int:
                continue
            if kind in {"bold", "italic"}:
                clipped_start = max(start, line_start)
                clipped_end = min(end, line_end)
                if clipped_end > clipped_start:
                    inline_marks.append(
                        {
                            "from": clipped_start - line_start,
                            "to": clipped_end - line_start,
                            "kind": kind,
                        }
                    )
            elif (
                kind == "heading"
                and start == line_start
                and end == line_end
                and line
                and type(mark.get("level")) is int
                and mark["level"] in {1, 2, 3}
            ):
                heading_level = mark["level"]

        prefix = ""
        if heading_level is not None:
            level = max(1, min(6, heading_level + safe_heading_offset))
            prefix = f"{'#' * level} "
        output.append(prefix + markdown_body(line, inline_marks))
        line_start = line_end + 1

    return "\n".join(output)


def mirror_text(chapters, manuscript_dir: Path) -> None:
    """Write every chapter to Markdown for reading, backups, and versioning."""
    manuscript_dir.mkdir(parents=True, exist_ok=True)
    expected_files = set()
    for i, ch in enumerate(chapters, start=1):
        title = ch.get("title") or f"Kapitel {i}"
        fname = f"{i:02d} - {safe_name(title)}.md"
        expected_files.add(fname)
        body = markdown_body(ch.get("body") or "", ch.get("marks") or [])
        note = note_markdown(ch.get("note") or "", ch.get("noteMarks") or []).strip()
        text = f"# {title}\n\n{body.rstrip()}\n"
        if note:
            text += "\n---\n\n<!-- Notiz\n" + note.rstrip() + "\n-->\n"
        path = manuscript_dir / fname
        if path.exists() and path.read_text(encoding="utf-8") == text:
            continue
        path.write_text(text, encoding="utf-8")
    # Remove orphaned mirrors, touching only files owned by this application.
    for f in manuscript_dir.glob("*.md"):
        if f.name not in expected_files and MIRROR_RE.match(f.name):
            f.unlink(missing_ok=True)


def mirror_profiles(state, profile_dir: Path) -> None:
    """Write every character profile to readable, versionable Markdown."""
    profile_dir.mkdir(parents=True, exist_ok=True)
    nodes = state.get("nodes", [])
    edges = state.get("edges", [])
    names = {n.get("id"): (n.get("name") or "Ohne Namen") for n in nodes}
    expected_files = set()

    for i, n in enumerate(nodes, start=1):
        name = n.get("name") or "Ohne Namen"
        fname = f"{i:02d} - {safe_name(name)}.md"
        expected_files.add(fname)

        lines = [f"# {name}", ""]
        if n.get("label"):
            lines += [f"*{n['label']}*", ""]
        if n.get("sub"):
            lines += [n["sub"], ""]

        prof = normalize_profile(n.get("profile"), str(n.get("id", "")))
        notes = note_markdown(
            prof.get("notizen") or "", prof.get("noteMarks") or [], heading_offset=2
        ).strip()
        if notes:
            lines += ["## Notizen", "", notes, ""]
        for field in prof.get("fields") or []:
            k = (field.get("key") or "").strip()
            v = (field.get("value") or "").strip()
            if k or v:
                lines += [f"## {k or 'Ohne Titel'}", "", v, ""]

        relationships = []
        for e in edges:
            if e.get("from") == n.get("id"):
                relationships.append(
                    f"- → {names.get(e.get('to'), '?')}"
                    + (f" — {e['label']}" if e.get("label") else "")
                )
            elif e.get("to") == n.get("id"):
                relationships.append(
                    f"- ← {names.get(e.get('from'), '?')}"
                    + (f" — {e['label']}" if e.get("label") else "")
                )
        if relationships:
            lines += ["## Verbindungen im Diagramm", ""] + relationships + [""]

        text = "\n".join(lines).rstrip() + "\n"
        path = profile_dir / fname
        if path.exists() and path.read_text(encoding="utf-8") == text:
            continue
        path.write_text(text, encoding="utf-8")

    for f in profile_dir.glob("*.md"):
        if f.name not in expected_files and MIRROR_RE.match(f.name):
            f.unlink(missing_ok=True)
