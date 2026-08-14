"""Append-only version history for one world.

On-disk layout, under data/history/{world_id}/:

    index.jsonl        one JSON object per snapshot, oldest first, append-only
    blobs/ab/cdef...   file contents, zlib-compressed, named by their SHA-256

Content addressing is what makes snapshotting the *whole* world on every commit
affordable: an untouched chapter is the same blob in all of them and is stored
once. index.jsonl being append-only means a crash mid-write can only ever cost
the newest entry, never corrupt the history behind it.

Snapshot ids are the SHA-256 of the manifest, so they behave like Git's commit
hashes for the History dialog (full id plus a short prefix) without any of Git
being involved.

Format versioning: every entry carries "format" and "encryption". Encryption is
"none" today; adding it later is a format bump handled at read time, not a
migration of what is already on disk.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import re
import sqlite3
import tempfile
import zlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

FORMAT_VERSION = 1
ENCRYPTION_NONE = "none"

DATABASE_NAME = "world.sqlite3"
TEXT_DIRS = ("manuscripts", "profiles")

# Manuscript/profile mirrors are always written as "{index:02d} - {title}.md"
# (see backend/mirror.py's MIRROR_RE) -- this recovers the human title from that.
_MIRROR_TITLE_RE = re.compile(r"^\d{2,} - (.+)\.md$")

# Word-diff tokens: runs of non-space, single newlines, and runs of blanks kept
# separate so rewrapping a paragraph does not read as every word having changed.
_TOKEN_RE = re.compile(r"\S+|\n|[^\S\n]+")


@dataclass
class BackupContext:
    """Paths for one world's history, resolved per request and never stored."""

    root: Path
    database: Path
    manuscripts: Path
    profiles: Path
    endpoint_url: str = ""


def _describe_changes(changes: list[str]) -> str | None:
    """Turn change entries into an author-facing summary, e.g. 'Chapter "The Storm"
    edited' or '2 chapters, 1 profile edited'. Returns None when nothing under
    manuscripts/ or profiles/ changed (e.g. only the database)."""
    chapters: list[str] = []
    profiles: list[str] = []
    for line in changes:
        directory, _, name = line[3:].strip().partition("/")
        match = _MIRROR_TITLE_RE.match(name)
        if not match:
            continue
        if directory == "manuscripts":
            chapters.append(match.group(1))
        elif directory == "profiles":
            profiles.append(match.group(1))
    if not chapters and not profiles:
        return None
    if len(chapters) == 1 and not profiles:
        return f'Chapter "{chapters[0]}" edited'
    if len(profiles) == 1 and not chapters:
        return f'Profile "{profiles[0]}" edited'
    parts = []
    if chapters:
        parts.append(f"{len(chapters)} chapter{'s' if len(chapters) != 1 else ''}")
    if profiles:
        parts.append(f"{len(profiles)} profile{'s' if len(profiles) != 1 else ''}")
    return ", ".join(parts) + " edited"


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text)


def _word_diff(old: str, new: str) -> list[str]:
    """Git's --word-diff=plain output: one text with [-removed-] and {+added+}
    inline. The History dialog parses exactly these markers (markWords() in
    src/features/tools/HistoryDialog.tsx), so the shape is a contract."""
    matcher = difflib.SequenceMatcher(None, _tokenize(old), _tokenize(new), autojunk=False)
    out: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("delete", "replace"):
            out.append("[-" + "".join(matcher.a[i1:i2]) + "-]")
        if tag in ("insert", "replace"):
            out.append("{+" + "".join(matcher.b[j1:j2]) + "+}")
        if tag == "equal":
            out.append("".join(matcher.a[i1:i2]))
    # Markers must not straddle a line break, or a single changed paragraph would
    # swallow every following line into one unreadable block.
    return "".join(out).replace("\n", "\n\x00").split("\x00")


def _hunks(lines: list[str], interesting: Iterable[int], context: int) -> list[str]:
    """Group changed lines into @@-separated hunks with `context` lines around
    each, matching what unified diffs look like to the History dialog's parser."""
    marked = sorted(set(interesting))
    if not marked:
        return []
    keep: set[int] = set()
    for index in marked:
        keep.update(range(max(0, index - context), min(len(lines), index + context + 1)))
    out: list[str] = []
    previous = None
    for index in sorted(keep):
        if previous is None or index != previous + 1:
            out.append("@@")
        out.append(lines[index])
        previous = index
    return out


class SnapshotStore:
    """Version history for world backup directories.

    Stateless by design: every method takes an explicit BackupContext instead of
    mutating shared instance state, so requests for different worlds never
    cross-talk even when handled concurrently.
    """

    def __init__(self, history_dir: Path):
        self.history_dir = history_dir

    def context(self, world_id: str, endpoint_url: str, database: Path, manuscripts: Path, profiles: Path) -> BackupContext:
        return BackupContext(root=self.history_dir / world_id, database=database,
                             manuscripts=manuscripts, profiles=profiles, endpoint_url=endpoint_url)

    # ----------------------------------------------------------------- storage

    def _blob_path(self, ctx: BackupContext, digest: str) -> Path:
        # Two-character shard: a long-lived history can hold tens of thousands of
        # blobs, and some filesystems degrade badly with that many siblings.
        return ctx.root / "blobs" / digest[:2] / digest[2:]

    def _write_blob(self, ctx: BackupContext, payload: bytes) -> str:
        digest = hashlib.sha256(payload).hexdigest()
        target = self._blob_path(ctx, digest)
        if target.exists():
            return digest  # content-addressed: identical content is already stored
        target.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename so a crash cannot leave a half-written blob that its
        # own name claims is complete content.
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            handle.write(zlib.compress(payload, 6))
            staged = Path(handle.name)
        staged.replace(target)
        return digest

    def _read_blob(self, ctx: BackupContext, digest: str) -> bytes:
        return zlib.decompress(self._blob_path(ctx, digest).read_bytes())

    def _index_path(self, ctx: BackupContext) -> Path:
        return ctx.root / "index.jsonl"

    def entries(self, ctx: BackupContext) -> list[dict[str, Any]]:
        path = self._index_path(ctx)
        if not path.exists():
            return []
        found = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                found.append(json.loads(line))
            except ValueError:
                # A torn final line from an interrupted append: everything before
                # it is still valid history, so keep that rather than fail.
                continue
        return found

    def _resolve(self, ctx: BackupContext, ref: str) -> dict[str, Any] | None:
        entries = self.entries(ctx)
        if not entries:
            return None
        if ref in ("", "WORK", "HEAD", None):
            return entries[-1]
        return next((e for e in reversed(entries) if e["id"] == ref or e["id"].startswith(ref)), None)

    # ------------------------------------------------------------- world state

    def _collect(self, ctx: BackupContext) -> dict[str, bytes]:
        """The world exactly as it stands right now: the database plus the
        human-readable mirrors. This reads the live files directly -- the Git
        implementation first copied everything into a working tree, which only
        existed to give `git status` something to look at."""
        files: dict[str, bytes] = {}
        if ctx.database.exists():
            # sqlite3's backup API, not a file copy: the database may have
            # in-flight WAL content that a plain read would miss or tear.
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / DATABASE_NAME
                with sqlite3.connect(ctx.database) as source, sqlite3.connect(target) as destination:
                    source.backup(destination)
                files[DATABASE_NAME] = target.read_bytes()
        for directory, name in ((ctx.manuscripts, "manuscripts"), (ctx.profiles, "profiles")):
            if not directory.exists():
                continue
            for source_file in sorted(directory.glob("*.md")):
                files[f"{name}/{source_file.name}"] = source_file.read_bytes()
        return files

    def _manifest_of(self, entry: dict[str, Any] | None) -> dict[str, str]:
        return dict(entry.get("files", {})) if entry else {}

    def _changes(self, current: dict[str, bytes], previous: dict[str, str]) -> list[str]:
        """Two-character status code plus path, the shape the History dialog and
        _describe_changes() both read ("M  manuscripts/01 - Storm.md")."""
        changes = []
        for path, payload in sorted(current.items()):
            digest = hashlib.sha256(payload).hexdigest()
            if path not in previous:
                changes.append(f"A  {path}")
            elif previous[path] != digest:
                changes.append(f"M  {path}")
        for path in sorted(previous):
            if path not in current:
                changes.append(f"D  {path}")
        return changes

    # -------------------------------------------------------------- public API

    def status(self, ctx: BackupContext) -> dict[str, Any]:
        current = self._collect(ctx)
        previous = self._manifest_of(self._resolve(ctx, "HEAD"))
        changes = self._changes(current, previous)
        return {
            "ok": True,
            "endpoint": ctx.endpoint_url,
            "aenderungen": changes[:60],
            "anzahl": len(changes),
            "vorschlag": _describe_changes(changes) or f"Writing backup {datetime.now():%Y-%m-%d %H:%M}",
        }

    def commit(self, ctx: BackupContext, message: str, push: bool) -> dict[str, Any]:
        current = self._collect(ctx)
        previous_entry = self._resolve(ctx, "HEAD")
        changes = self._changes(current, self._manifest_of(previous_entry))
        log: list[str] = []
        if not changes:
            return {"ok": True, "log": ["Everything is already backed up."], "status": self.status(ctx)}

        ctx.root.mkdir(parents=True, exist_ok=True)
        manifest = {path: self._write_blob(ctx, payload) for path, payload in sorted(current.items())}
        created = datetime.now()
        entry = {
            "format": FORMAT_VERSION,
            "encryption": ENCRYPTION_NONE,
            "created": created.isoformat(timespec="seconds"),
            "message": message or _describe_changes(changes) or f"Writing backup {created:%Y-%m-%d %H:%M}",
            "parent": previous_entry["id"] if previous_entry else "",
            "files": manifest,
        }
        # The id covers the manifest and the metadata, so two snapshots of
        # identical content taken at different times stay distinct entries.
        entry["id"] = hashlib.sha256(json.dumps(entry, sort_keys=True).encode("utf-8")).hexdigest()
        with self._index_path(ctx).open("a", encoding="utf-8") as index:
            index.write(json.dumps(entry, ensure_ascii=False) + "\n")
        log.append("Snapshot created.")

        if push:
            if not ctx.endpoint_url:
                return {"ok": False, "grund": "No backup endpoint is configured for this world.", "log": log}
            from backend.backup import remote
            try:
                remote.push(ctx, entry, lambda digest: self._read_blob(ctx, digest))
            except Exception as exc:
                return {"ok": False, "grund": str(exc), "log": log}
            log.append("Snapshot uploaded to the backup endpoint.")
        return {"ok": True, "log": log, "status": self.status(ctx)}

    def history(self, ctx: BackupContext, limit: int = 40) -> list[dict[str, str]]:
        entries = self.entries(ctx)[-limit:]
        return [{
            "hash": entry["id"],
            "kurz": entry["id"][:8],
            "datum": datetime.fromisoformat(entry["created"]).strftime("%d.%m.%Y %H:%M"),
            "autor": "",
            "betreff": entry.get("message", ""),
        } for entry in reversed(entries)]

    def diff(self, ctx: BackupContext, ref: str, text_only: bool = True, word_diff: bool = True) -> dict[str, Any]:
        if ref in ("", "WORK", None):
            new_files = {path: payload for path, payload in self._collect(ctx).items()}
            base = self._manifest_of(self._resolve(ctx, "HEAD"))
        else:
            entry = self._resolve(ctx, ref)
            if entry is None:
                return {"ok": False, "grund": "Invalid revision."}
            new_files = {path: self._read_blob(ctx, digest) for path, digest in entry["files"].items()}
            parent = self._resolve(ctx, entry["parent"]) if entry.get("parent") else None
            base = self._manifest_of(parent)

        paths = sorted(set(new_files) | set(base))
        chunks = []
        for path in paths:
            if text_only and not path.startswith(TEXT_DIRS):
                continue
            old_bytes = self._read_blob(ctx, base[path]) if path in base else b""
            new_bytes = new_files.get(path, b"")
            if old_bytes == new_bytes:
                continue
            chunks.append(self._render(path, old_bytes, new_bytes, word_diff))
        return {"ok": True, "diff": "\n".join(chunk for chunk in chunks if chunk), "neu": [], "wortweise": word_diff}

    def _render(self, path: str, old_bytes: bytes, new_bytes: bytes, word_diff: bool) -> str:
        header = f"diff --git a/{path} b/{path}"
        try:
            old, new = old_bytes.decode("utf-8"), new_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return f"{header}\nBinary files a/{path} and b/{path} differ"
        if word_diff:
            lines = _word_diff(old, new)
            marked = [i for i, line in enumerate(lines) if "[-" in line or "{+" in line]
            body = _hunks(lines, marked, context=1)
        else:
            body = [line.rstrip("\n") for line in difflib.unified_diff(
                old.splitlines(), new.splitlines(), lineterm="", n=3,
                fromfile=f"a/{path}", tofile=f"b/{path}")]
        return "\n".join([header, *body]) if body else ""

    def chapter_version(self, ctx: BackupContext, ref: str, chapter_index: int, filename: str) -> dict[str, Any]:
        entry = self._resolve(ctx, ref)
        path = f"manuscripts/{chapter_index:02d} - {filename}.md"
        digest = (entry or {}).get("files", {}).get(path)
        if digest is None:
            return {"ok": True, "neu": True, "text": ""}
        text = self._read_blob(ctx, digest).decode("utf-8", errors="replace")
        body = text.split("\n\n", 1)[-1].split("\n---\n\n<!-- Notiz", 1)[0]
        return {"ok": True, "neu": False, "text": body.rstrip("\n")}
