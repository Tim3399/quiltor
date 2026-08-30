"""Append-only version history for one world.

On-disk layout, under data/history/{world_id}/:

    index.jsonl        one JSON object per snapshot, oldest first, append-only
    blobs/ab/cdef...   file contents, zlib-compressed, named by their SHA-256

Content addressing is what makes snapshotting the *whole* world on every commit
affordable: an untouched chapter is the same blob in all of them and is stored
once. index.jsonl being append-only means a crash mid-write can only ever cost
the newest entry, never corrupt the history behind it.

A snapshot's id is the SHA-256 of its manifest, which makes it both a name and a
checksum: two snapshots with the same id hold the same world. The History dialog
shows a short prefix and keeps the full id for lookups.

Every entry carries "format" and "encryption". Encryption is "none" today, and
adding it is a format bump handled at read time.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import tempfile
import zlib
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable

from quiltor.application.backup_manifest import (
    BackupContractError,
    CURRENT_FORMAT_VERSION,
    DATABASE_NAME,
    DIGEST_RE,
    ENCRYPTION_NONE,
    MAX_BLOB_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_TEXT_FILE_BYTES,
    MAX_TOTAL_BYTES,
    ManifestFile,
    build_manifest_files,
    manifest_identifier,
    strict_json_loads,
    validate_manifest,
    verify_blob,
)
from quiltor.application.backups import (
    BackupAuthorization,
    BackupAuthorizationUnavailable,
    BackupEndpointNotConfigured,
    BackupGatewayError,
    RemoteBackupGateway,
)
from quiltor.application.backups import WorldBackupContext as BackupContext
from quiltor.application.history import HistoryRevisionNotFound

FORMAT_VERSION = CURRENT_FORMAT_VERSION
TEXT_DIRS = ("manuscripts", "profiles")

# Manuscript/profile mirrors are always written as "{index:02d} - {title}.md"
# (see src/quiltor/infrastructure/persistence/mirror.py's MIRROR_RE) -- this recovers the human title from that.
_MIRROR_TITLE_RE = re.compile(r"^\d{2,} - (.+)\.md$")

# Word-diff tokens: runs of non-space, single newlines, and runs of blanks kept
# separate so rewrapping a paragraph does not read as every word having changed.
_TOKEN_RE = re.compile(r"\S+|\n|[^\S\n]+")


def _is_link_or_reparse(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return False
    attributes = getattr(metadata, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return stat.S_ISLNK(metadata.st_mode) or bool(attributes & reparse_flag)


def _assert_no_link_or_reparse(path: Path) -> None:
    """Reject links/junctions in every existing component of a mutation path."""

    for component in (path, *path.parents):
        if _is_link_or_reparse(component):
            raise BackupContractError(
                "unsafe_backup_destination", "Backup destination failed safety checks."
            )


def _assert_contained(directory: Path, candidate: Path) -> None:
    _assert_no_link_or_reparse(directory)
    _assert_no_link_or_reparse(candidate)
    try:
        candidate.resolve(strict=False).relative_to(directory.resolve(strict=False))
    except ValueError as exc:
        raise BackupContractError(
            "unsafe_backup_destination", "Backup destination failed safety checks."
        ) from exc


def _manifest_digests(entry: dict[str, Any], expected_world: str) -> dict[str, str]:
    validated = validate_manifest(entry, expected_world=expected_world)
    return {record.logical_path: record.digest for record in validated.files}


def _assert_safe_tree(directory: Path) -> None:
    _assert_no_link_or_reparse(directory)
    if not directory.exists():
        return
    if not directory.is_dir():
        raise BackupContractError(
            "unsafe_backup_destination", "Backup destination failed safety checks."
        )
    for entry in directory.rglob("*"):
        if _is_link_or_reparse(entry):
            raise BackupContractError(
                "unsafe_backup_destination", "Backup destination failed safety checks."
            )


def _validate_sqlite_database(path: Path) -> None:
    try:
        if not path.read_bytes()[:16] == b"SQLite format 3\x00":
            raise BackupContractError(
                "backup_content_integrity", "Backup content failed integrity verification."
            )
        uri = f"{path.resolve().as_uri()}?mode=ro&immutable=1"
        with closing(sqlite3.connect(uri, uri=True)) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
        if result != ("ok",):
            raise BackupContractError(
                "backup_content_integrity", "Backup content failed integrity verification."
            )
    except BackupContractError:
        raise
    except (OSError, sqlite3.Error) as exc:
        raise BackupContractError(
            "backup_content_integrity", "Backup content failed integrity verification."
        ) from exc


def _temporary_backup_path(target: Path, *, directory: bool) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if directory:
        path = Path(tempfile.mkdtemp(prefix=".quiltor-restore-backup-", dir=target.parent))
        path.rmdir()
        return path
    descriptor, raw = tempfile.mkstemp(prefix=".quiltor-restore-backup-", dir=target.parent)
    os.close(descriptor)
    path = Path(raw)
    path.unlink()
    return path


def _remove_staged_path(path: Path) -> None:
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def _replace_world_atomically(ctx: BackupContext, payloads: dict[str, bytes]) -> None:
    """Stage every target, then swap it with rollback for any failed swap."""

    destinations = (ctx.database, ctx.manuscripts, ctx.profiles)
    for destination in destinations:
        _assert_no_link_or_reparse(destination)
        _assert_no_link_or_reparse(destination.parent)
    resolved_destinations = tuple(path.resolve(strict=False) for path in destinations)
    if len({str(path).casefold() for path in resolved_destinations}) != 3 or any(
        left in right.parents or right in left.parents
        for index, left in enumerate(resolved_destinations)
        for right in resolved_destinations[index + 1 :]
    ):
        raise BackupContractError(
            "unsafe_backup_destination", "Backup destination failed safety checks."
        )
    _assert_safe_tree(ctx.manuscripts)
    _assert_safe_tree(ctx.profiles)

    for destination in destinations:
        destination.parent.mkdir(parents=True, exist_ok=True)
        _assert_no_link_or_reparse(destination.parent)

    staged_paths: list[Path] = []
    replacements: list[tuple[Path, Path | None, bool]] = []
    try:
        descriptor, raw_database = tempfile.mkstemp(
            prefix=".quiltor-restore-stage-", dir=ctx.database.parent
        )
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payloads[DATABASE_NAME])
            handle.flush()
            os.fsync(handle.fileno())
        staged_database = Path(raw_database)
        staged_paths.append(staged_database)
        _validate_sqlite_database(staged_database)
        replacements.append((ctx.database, staged_database, False))
        replacements.extend(
            (Path(f"{ctx.database}{suffix}"), None, False) for suffix in ("-wal", "-shm")
        )

        for directory, logical_name in (
            (ctx.manuscripts, "manuscripts"),
            (ctx.profiles, "profiles"),
        ):
            staged = Path(tempfile.mkdtemp(prefix=".quiltor-restore-stage-", dir=directory.parent))
            staged_paths.append(staged)
            if directory.exists():
                for existing in directory.iterdir():
                    if existing.is_file() and existing.suffix.casefold() == ".md":
                        continue
                    destination = staged / existing.name
                    if existing.is_dir():
                        shutil.copytree(existing, destination)
                    else:
                        shutil.copy2(existing, destination)
            prefix = f"{logical_name}/"
            for logical_path, payload in payloads.items():
                if not logical_path.startswith(prefix):
                    continue
                filename = logical_path.removeprefix(prefix)
                target = staged / filename
                _assert_contained(staged, target)
                with target.open("wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
            replacements.append((directory, staged, True))

        completed: list[tuple[Path, Path, bool, bool]] = []
        try:
            for target, staged, is_directory in replacements:
                _assert_no_link_or_reparse(target)
                backup = _temporary_backup_path(target, directory=is_directory)
                existed = target.exists()
                if existed:
                    os.replace(target, backup)
                completed.append((target, backup, existed, is_directory))
                if staged is not None:
                    os.replace(staged, target)
                    staged_paths.remove(staged)
        except Exception as exc:
            for target, backup, existed, _ in reversed(completed):
                _remove_staged_path(target)
                if existed and backup.exists():
                    os.replace(backup, target)
            raise BackupContractError(
                "backup_restore_failed", "Backup restore could not be completed safely."
            ) from exc
        for _, backup, existed, _ in completed:
            if existed:
                _remove_staged_path(backup)
    finally:
        for staged in staged_paths:
            _remove_staged_path(staged)


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
    """One text with removals as [-this-] and additions as {+that+}, inline.
    The History dialog parses exactly these markers (markWords() in
    packages/client/src/modules/history/HistoryDialog.tsx), so the shape is a contract."""
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

    def __init__(
        self,
        history_dir: Path | Callable[[], Path],
        remote_gateway: RemoteBackupGateway | None = None,
    ):
        self._history_dir = history_dir
        self._remote_gateway = remote_gateway

    @property
    def history_dir(self) -> Path:
        return self._history_dir() if callable(self._history_dir) else self._history_dir

    def context(
        self,
        world_id: str,
        endpoint_url: str,
        database: Path,
        manuscripts: Path,
        profiles: Path,
        title: str = "",
    ) -> BackupContext:
        # A world without its own endpoint falls back to the account-wide one, so
        # configuring the backup service once is enough for every world.
        return BackupContext(
            root=self.history_dir / world_id,
            database=database,
            manuscripts=manuscripts,
            profiles=profiles,
            endpoint_url=endpoint_url
            or (self._remote_gateway.default_endpoint() if self._remote_gateway else ""),
            title=title,
        )

    # ----------------------------------------------------------------- storage

    def _blob_path(self, ctx: BackupContext, digest: str) -> Path:
        # Two-character shard: a long-lived history can hold tens of thousands of
        # blobs, and some filesystems degrade badly with that many siblings.
        if not DIGEST_RE.fullmatch(digest):
            raise BackupContractError(
                "backup_content_integrity", "Backup content failed integrity verification."
            )
        return ctx.root / "blobs" / digest[:2] / digest[2:]

    def _write_blob(self, ctx: BackupContext, payload: bytes) -> str:
        digest = hashlib.sha256(payload).hexdigest()
        target = self._blob_path(ctx, digest)
        _assert_contained(ctx.root, target)
        if target.exists():
            # A prior crash or disk corruption must not become trusted merely
            # because a correctly named path exists.
            try:
                if self._read_blob(ctx, digest) == payload:
                    return digest
            except BackupContractError:
                pass
        target.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename so a crash cannot leave a half-written blob that its
        # own name claims is complete content.
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            handle.write(zlib.compress(payload, 6))
            staged = Path(handle.name)
        staged.replace(target)
        return digest

    def _read_blob(self, ctx: BackupContext, digest: str) -> bytes:
        path = self._blob_path(ctx, digest)
        _assert_contained(ctx.root, path)
        try:
            payload = zlib.decompress(path.read_bytes())
        except (OSError, zlib.error) as exc:
            raise BackupContractError(
                "backup_content_integrity", "Backup content failed integrity verification."
            ) from exc
        if len(payload) > MAX_BLOB_BYTES or hashlib.sha256(payload).hexdigest() != digest:
            raise BackupContractError(
                "backup_content_integrity", "Backup content failed integrity verification."
            )
        return payload

    def _index_path(self, ctx: BackupContext) -> Path:
        path = ctx.root / "index.jsonl"
        _assert_contained(ctx.root, path)
        return path

    def entries(self, ctx: BackupContext) -> list[dict[str, Any]]:
        path = self._index_path(ctx)
        if not path.exists():
            return []
        lines = path.read_text(encoding="utf-8").splitlines()
        found: list[dict[str, Any]] = []
        for position, line in enumerate(lines):
            if not line.strip():
                continue
            try:
                parsed = strict_json_loads(line, maximum_bytes=MAX_MANIFEST_BYTES)
            except BackupContractError:
                # Preserve the established append-crash recovery, but only for
                # syntactically torn JSON at the final physical line. A complete
                # duplicate-key or schema-invalid object remains a hard failure.
                try:
                    json.loads(line)
                except ValueError:
                    if position == len(lines) - 1:
                        continue
                raise
            validated = validate_manifest(parsed, expected_world=ctx.root.name)
            found.append(validated.document)
        return found

    def _resolve(self, ctx: BackupContext, ref: str) -> dict[str, Any] | None:
        entries = self.entries(ctx)
        if not entries:
            return None
        if ref in ("", "WORK", "HEAD", None):
            return entries[-1]
        return next(
            (e for e in reversed(entries) if e["id"] == ref or e["id"].startswith(ref)), None
        )

    # ------------------------------------------------------------- world state

    def _collect(self, ctx: BackupContext) -> dict[str, bytes]:
        """The world exactly as it stands right now: the database plus the
        human-readable mirrors, read straight from where they live. There is no
        staging copy to keep in sync."""
        files: dict[str, bytes] = {}
        if ctx.database.exists():
            # sqlite3's backup API, not a file copy: the database may have
            # in-flight WAL content that a plain read would miss or tear.
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / DATABASE_NAME
                # A sqlite connection's own context manager controls only the
                # transaction; ``closing`` also releases both file handles before
                # the staged database is read and its temporary directory removed.
                with (
                    closing(sqlite3.connect(ctx.database)) as source,
                    closing(sqlite3.connect(target)) as destination,
                ):
                    with source, destination:
                        source.backup(destination)
                files[DATABASE_NAME] = target.read_bytes()
        for directory, name in ((ctx.manuscripts, "manuscripts"), (ctx.profiles, "profiles")):
            if not directory.exists():
                continue
            for source_file in sorted(directory.glob("*.md")):
                files[f"{name}/{source_file.name}"] = source_file.read_bytes()
        return files

    def _manifest_of(self, entry: dict[str, Any] | None) -> dict[str, str]:
        return _manifest_digests(entry, entry["world"]) if entry else {}

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
            "changes": changes[:60],
            "changeCount": len(changes),
            "suggestedMessage": _describe_changes(changes)
            or f"Writing backup {datetime.now():%Y-%m-%d %H:%M}",
        }

    def commit(
        self,
        ctx: BackupContext,
        message: str,
        push: bool,
        authorization: BackupAuthorization | None = None,
    ) -> dict[str, Any]:
        current = self._collect(ctx)
        previous_entry = self._resolve(ctx, "HEAD")
        changes = self._changes(current, self._manifest_of(previous_entry))
        log: list[str] = []
        if not changes:
            return {
                "ok": True,
                "log": ["Everything is already backed up."],
                "status": self.status(ctx),
            }

        _assert_no_link_or_reparse(ctx.root.parent)
        _assert_no_link_or_reparse(ctx.root)
        ctx.root.mkdir(parents=True, exist_ok=True)
        _assert_no_link_or_reparse(ctx.root)
        manifest = build_manifest_files(sorted(current.items()))
        for payload in current.values():
            self._write_blob(ctx, payload)
        created = datetime.now()
        entry = {
            "format": FORMAT_VERSION,
            "encryption": ENCRYPTION_NONE,
            "created": created.isoformat(timespec="seconds"),
            # Identity travels with the manifest so the endpoint is self-describing:
            # restoring onto an empty machine must be able to show world names, not
            # the hex ids the storage layout happens to use as directories.
            "world": ctx.root.name,
            "title": ctx.title,
            "message": message
            or _describe_changes(changes)
            or f"Writing backup {created:%Y-%m-%d %H:%M}",
            "parent": previous_entry["id"] if previous_entry else "",
            "files": manifest,
        }
        # The id covers the manifest and the metadata, so two snapshots of
        # identical content taken at different times stay distinct entries.
        entry["id"] = manifest_identifier(entry, FORMAT_VERSION)
        entry = validate_manifest(entry, expected_world=ctx.root.name).document
        with self._index_path(ctx).open("a", encoding="utf-8") as index:
            index.write(json.dumps(entry, ensure_ascii=False) + "\n")
        log.append("Snapshot created.")

        if push:
            if not ctx.endpoint_url:
                raise BackupEndpointNotConfigured(
                    params={"operation": "upload", "snapshotCreated": True}
                )
            if self._remote_gateway is None or authorization is None:
                raise BackupAuthorizationUnavailable(
                    params={"operation": "upload", "snapshotCreated": True}
                )
            try:
                self._remote_gateway.push(
                    ctx,
                    entry,
                    lambda digest: self._read_blob(ctx, digest),
                    authorization,
                )
            except Exception as exc:
                raise BackupGatewayError(
                    params={"operation": "upload", "snapshotCreated": True}
                ) from exc
            log.append("Snapshot uploaded to the backup endpoint.")
        return {"ok": True, "log": log, "status": self.status(ctx)}

    def history(self, ctx: BackupContext, limit: int = 40) -> list[dict[str, str]]:
        entries = self.entries(ctx)[-limit:]
        return [
            {
                "hash": entry["id"],
                "shortHash": entry["id"][:8],
                "date": datetime.fromisoformat(entry["created"]).isoformat(timespec="seconds"),
                "subject": entry.get("message", ""),
            }
            for entry in reversed(entries)
        ]

    def diff(
        self, ctx: BackupContext, ref: str, text_only: bool = True, word_diff: bool = True
    ) -> dict[str, Any]:
        if ref in ("", "WORK", None):
            new_files = {path: payload for path, payload in self._collect(ctx).items()}
            base = self._manifest_of(self._resolve(ctx, "HEAD"))
        else:
            entry = self._resolve(ctx, ref)
            if entry is None:
                raise HistoryRevisionNotFound(params={"operation": "diff"})
            manifest = _manifest_digests(entry, ctx.root.name)
            new_files = {path: self._read_blob(ctx, digest) for path, digest in manifest.items()}
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
        return {
            "ok": True,
            "diff": "\n".join(chunk for chunk in chunks if chunk),
            "newFiles": [],
            "mode": "word" if word_diff else "line",
        }

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
            body = [
                line.rstrip("\n")
                for line in difflib.unified_diff(
                    old.splitlines(),
                    new.splitlines(),
                    lineterm="",
                    n=3,
                    fromfile=f"a/{path}",
                    tofile=f"b/{path}",
                )
            ]
        return "\n".join([header, *body]) if body else ""

    def restore(
        self, ctx: BackupContext, entry: dict[str, Any], fetch: Callable[[str], bytes] | None = None
    ) -> dict[str, Any]:
        """Validate and stage an untrusted snapshot before rollback-safe replacement."""

        validated = validate_manifest(entry, expected_world=ctx.root.name)
        payloads: dict[str, bytes] = {}
        total = 0
        for record in sorted(validated.files, key=lambda item: item.logical_path):
            payload: bytes | None = None
            try:
                payload = self._read_blob(ctx, record.digest)
                verify_blob(record, payload)
            except BackupContractError:
                payload = None
            if payload is None:
                if fetch is None:
                    raise BackupContractError(
                        "backup_content_integrity",
                        "Backup content failed integrity verification.",
                    )
                try:
                    payload = fetch(record.digest)
                except Exception as exc:
                    raise BackupContractError(
                        "backup_content_unavailable", "Backup content could not be retrieved."
                    ) from exc
                payload = verify_blob(record, payload)
            total += len(payload)
            if total > MAX_TOTAL_BYTES:
                raise BackupContractError(
                    "backup_content_integrity", "Backup content failed integrity verification."
                )
            payloads[record.logical_path] = payload

        # Cache only verified bytes, and only after every referenced blob passed.
        # A failed fetch therefore changes neither world state nor local history.
        _assert_no_link_or_reparse(ctx.root.parent)
        _assert_no_link_or_reparse(ctx.root)
        ctx.root.mkdir(parents=True, exist_ok=True)
        _assert_no_link_or_reparse(ctx.root)
        for payload in payloads.values():
            self._write_blob(ctx, payload)

        _replace_world_atomically(ctx, payloads)

        # Record it locally only after the world swap committed successfully.
        if not any(existing["id"] == validated.identifier for existing in self.entries(ctx)):
            with self._index_path(ctx).open("a", encoding="utf-8") as index:
                index.write(json.dumps(validated.document, ensure_ascii=False) + "\n")
        return {
            "ok": True,
            "restored": validated.identifier,
            "files": len(validated.files),
        }

    def chapter_version(
        self, ctx: BackupContext, ref: str, chapter_index: int, filename: str
    ) -> dict[str, Any]:
        entry = self._resolve(ctx, ref)
        if entry is None and ref not in ("", "WORK", "HEAD", None):
            raise HistoryRevisionNotFound(params={"operation": "chapter_text"})
        path = f"manuscripts/{chapter_index:02d} - {filename}.md"
        digest = _manifest_digests(entry, ctx.root.name).get(path) if entry else None
        if digest is None:
            return {"ok": True, "isNew": True, "text": ""}
        text = self._read_blob(ctx, digest).decode("utf-8", errors="replace")
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        body = text.split("\n\n", 1)[-1].split("\n---\n\n<!-- Notiz", 1)[0]
        return {"ok": True, "isNew": False, "text": body.rstrip("\n")}

    def _chapter_record(
        self,
        ctx: BackupContext,
        entry: dict[str, Any] | None,
        chapter_id: str,
    ) -> dict[str, Any]:
        if entry is None:
            return {"available": False, "exists": False, "text": ""}
        digest = _manifest_digests(entry, ctx.root.name).get(DATABASE_NAME)
        if digest is None:
            return {"available": False, "exists": False, "text": ""}
        payload = self._read_blob(ctx, digest)
        try:
            with tempfile.TemporaryDirectory() as folder:
                database_path = Path(folder) / DATABASE_NAME
                database_path.write_bytes(payload)
                database_uri = f"{database_path.resolve().as_uri()}?mode=ro&immutable=1"
                with closing(sqlite3.connect(database_uri, uri=True)) as database:
                    table = database.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapters'"
                    ).fetchone()
                    if table is None:
                        return {"available": False, "exists": False, "text": ""}
                    metadata = database.execute(
                        "SELECT typeof(body),length(CAST(body AS BLOB)) FROM chapters WHERE id=?",
                        (chapter_id,),
                    ).fetchone()
                    if metadata is None:
                        return {"available": True, "exists": False, "text": ""}
                    if metadata[0] != "text" or metadata[1] > MAX_TEXT_FILE_BYTES:
                        return {"available": False, "exists": False, "text": ""}
                    row = database.execute(
                        "SELECT body FROM chapters WHERE id=?", (chapter_id,)
                    ).fetchone()
        except sqlite3.DatabaseError:
            return {"available": False, "exists": False, "text": ""}
        if row is None:
            return {"available": False, "exists": False, "text": ""}
        return {"available": True, "exists": True, "text": row[0]}

    def chapter_comparison(
        self,
        ctx: BackupContext,
        ref: str,
        chapter_id: str,
    ) -> dict[str, Any]:
        entry = self._resolve(ctx, ref)
        if entry is None:
            raise HistoryRevisionNotFound(params={"operation": "chapter_comparison"})
        selected = self._chapter_record(ctx, entry, chapter_id)
        parent_ref = entry.get("parent", "")
        if not parent_ref:
            previous = {"available": True, "exists": False, "text": ""}
        else:
            previous = self._chapter_record(ctx, self._resolve(ctx, parent_ref), chapter_id)
        return {"ok": True, "selected": selected, "previous": previous}
