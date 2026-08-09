"""Human-readable Markdown mirrors of the SQLite-authoritative manuscript and character
profiles -- these exist purely for reading, backups, and Git history, never as a second
source of truth (SQLite always wins on load)."""

from __future__ import annotations

import re
from pathlib import Path

MIRROR_RE = re.compile(r"^\d{2,} - .*\.md$")  # writer uses f"{i:02d} - ...", unbounded above 99

PROFILE_FIELDS = [
    ("alter",       "Alter"),
    ("rolle",       "Rolle in der Geschichte"),
    ("aussehen",    "Aussehen"),
    ("herkunft",    "Herkunft & Vorgeschichte"),
    ("stimme",      "Stimme & Sprechweise"),
    ("notizen",     "Notizen"),
]


def safe_name(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title or "").strip()
    name = re.sub(r"\s+", " ", name)
    return (name or "Ohne Titel")[:70]


def mirror_text(chapters, manuscript_dir: Path) -> None:
    """Write every chapter to Markdown for reading, backups, and versioning."""
    manuscript_dir.mkdir(parents=True, exist_ok=True)
    expected_files = set()
    for i, ch in enumerate(chapters, start=1):
        title = ch.get("title") or f"Kapitel {i}"
        fname = f"{i:02d} - {safe_name(title)}.md"
        expected_files.add(fname)
        body = ch.get("body") or ""
        note = (ch.get("note") or "").strip()
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

        prof = n.get("profile") or {}
        for key, heading in PROFILE_FIELDS:
            value = (prof.get(key) or "").strip()
            if value:
                lines += [f"## {heading}", "", value, ""]
        for extra in prof.get("extra") or []:
            k = (extra.get("k") or "").strip()
            v = (extra.get("v") or "").strip()
            if k or v:
                lines += [f"## {k or 'Ohne Titel'}", "", v, ""]

        relationships = []
        for e in edges:
            if e.get("from") == n.get("id"):
                relationships.append(f"- → {names.get(e.get('to'), '?')}"
                            + (f" — {e['label']}" if e.get("label") else ""))
            elif e.get("to") == n.get("id"):
                relationships.append(f"- ← {names.get(e.get('from'), '?')}"
                            + (f" — {e['label']}" if e.get("label") else ""))
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
