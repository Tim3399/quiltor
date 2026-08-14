from __future__ import annotations

import os
import re
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

# Manuscript/profile mirrors are always written as "{index:02d} - {title}.md"
# (see backend/mirror.py's MIRROR_RE) -- this recovers the human title from that.
_MIRROR_TITLE_RE = re.compile(r"^\d{2,} - (.+)\.md$")


def _describe_changes(changes: list[str]) -> str | None:
    """Turn `git status --porcelain` lines into an author-facing summary, e.g.
    'Chapter "The Storm" edited' or '2 chapters, 1 profile edited'. Returns None
    when nothing under manuscripts/ or profiles/ changed (e.g. only the database)."""
    chapters: list[str] = []
    profiles: list[str] = []
    for line in changes:
        path = line[3:].strip()
        if " -> " in path:  # renames: "R  old -> new"
            path = path.split(" -> ", 1)[1]
        directory, _, name = path.partition("/")
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


def _parse_porcelain_z(output: str) -> list[str]:
    """Parse `git status --porcelain -z` into "XY path" / "XY old -> new" strings.

    Plain --porcelain (no -z) quotes any path containing a space on at least some
    Git-for-Windows builds (regardless of core.quotepath, which only covers non-ASCII
    bytes) -- that silently broke path parsing for every chapter/profile title, since
    those are ordinary prose with spaces. -z is NUL-delimited and never quotes."""
    tokens = output.split("\x00")
    entries: list[str] = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if not token:
            continue
        code, path = token[:2], token[3:]
        if code[0] in ("R", "C"):
            old_path = tokens[i] if i < len(tokens) else ""
            i += 1
            entries.append(f"{code} {old_path} -> {path}")
        else:
            entries.append(f"{code} {path}")
    return entries

# Git subprocess timeouts, in seconds. Local metadata reads stay short; anything that
# scans/writes more content, or touches the network (a push), gets more headroom.
TIMEOUT_METADATA = 10       # quick local reads: rev-parse, remote get-url, config
TIMEOUT_WORKING_TREE = 20   # status --porcelain scans the working tree
TIMEOUT_LOCAL_READ = 30     # diff --cached --quiet, log, show
TIMEOUT_LOCAL_WRITE = 60    # add -A, commit, diff/show over larger content
TIMEOUT_DEFAULT = 90        # GitBackup.run()'s default -- local init/remote setup
TIMEOUT_PUSH = 180          # push -- the only operation that touches the network


@dataclass
class GitContext:
    """Paths for one world's backup repository, resolved by the caller (never stored)."""

    root: Path
    database: Path
    manuscripts: Path
    profiles: Path
    repository_url: str = ""


class GitBackup:
    """Git operations for world backup repositories, isolated from the application repo.

    Stateless by design: every method takes an explicit GitContext instead of mutating
    shared instance state, so requests for different worlds never cross-talk even when
    handled concurrently.
    """

    def __init__(self, repositories_dir: Path):
        self.repositories_dir = repositories_dir
        self.env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo", "GCM_INTERACTIVE": "never", "LC_ALL": "C"}

    def context(self, world_id: str, repository_url: str, database: Path, manuscripts: Path, profiles: Path) -> GitContext:
        return GitContext(root=self.repositories_dir / world_id, database=database,
                           manuscripts=manuscripts, profiles=profiles, repository_url=repository_url)

    def _ensure(self, ctx: GitContext) -> None:
        ctx.root.mkdir(parents=True, exist_ok=True)
        if not (ctx.root / ".git").exists():
            self.run(ctx, "init", "-b", "main")
        # A world without a configured remote still gets a local-only history --
        # only manage the "origin" remote when there's a URL to point it at.
        if not ctx.repository_url:
            return
        current = self.run(ctx, "remote", "get-url", "origin")
        if current.returncode == 0:
            if current.stdout.strip() != ctx.repository_url:
                self.run(ctx, "remote", "set-url", "origin", ctx.repository_url)
        else:
            self.run(ctx, "remote", "add", "origin", ctx.repository_url)

    def run(self, ctx: GitContext, *args: str, timeout: int = TIMEOUT_DEFAULT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", "-c", "core.quotepath=false", "-C", str(ctx.root), *args],
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=timeout, env=self.env)

    def sync(self, ctx: GitContext) -> None:
        self._ensure(ctx)
        target = ctx.root / "world.sqlite3"
        with sqlite3.connect(ctx.database) as source, sqlite3.connect(target) as destination:
            source.backup(destination)
        for source_dir, name in ((ctx.manuscripts, "manuscripts"), (ctx.profiles, "profiles")):
            target_dir = ctx.root / name
            target_dir.mkdir(exist_ok=True)
            expected = set()
            for source_file in source_dir.glob("*.md"):
                expected.add(source_file.name)
                shutil.copy2(source_file, target_dir / source_file.name)
            for old_file in target_dir.glob("*.md"):
                if old_file.name not in expected:
                    old_file.unlink()

    def status(self, ctx: GitContext) -> dict[str, Any]:
        try:
            self.sync(ctx)
            probe = self.run(ctx, "rev-parse", "--is-inside-work-tree", timeout=TIMEOUT_METADATA)
        except FileNotFoundError as exc:
            return {"ok": False, "grund": str(exc)}
        if probe.returncode != 0:
            return {"ok": False, "grund": "The world backup is not a Git repository."}

        def output(*args: str) -> str:
            result = self.run(ctx, *args, timeout=TIMEOUT_METADATA)
            return result.stdout.strip() if result.returncode == 0 else ""

        branch = output("rev-parse", "--abbrev-ref", "HEAD") or "main"
        upstream = output("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        changes = _parse_porcelain_z(self.run(ctx, "status", "--porcelain", "-z", "--", ".", timeout=TIMEOUT_WORKING_TREE).stdout)
        return {"ok": True, "branch": branch, "upstream": upstream, "remote": output("remote", "get-url", "origin"),
                "identitaet": bool(output("config", "user.name") and output("config", "user.email")),
                "aenderungen": changes[:60], "anzahl": len(changes), "unveroeffentlicht": 0,
                "vorschlag": _describe_changes(changes) or f"Writing backup {datetime.now():%Y-%m-%d %H:%M}"}

    def commit(self, ctx: GitContext, message: str, push: bool) -> dict[str, Any]:
        status = self.status(ctx)
        if not status.get("ok") or not status.get("identitaet"):
            return {"ok": False, "grund": status.get("grund") or "Configure your Git user name and email first.", "log": []}
        self.run(ctx, "add", "-A", "--", ".", timeout=TIMEOUT_LOCAL_WRITE)
        log: list[str] = []
        if self.run(ctx, "diff", "--cached", "--quiet", timeout=TIMEOUT_LOCAL_READ).returncode != 0:
            result = self.run(ctx, "commit", "-m", message or status["vorschlag"], timeout=TIMEOUT_LOCAL_WRITE)
            if result.returncode != 0:
                return {"ok": False, "grund": (result.stderr or result.stdout).strip(), "log": log}
            log.append("Backup commit created.")
        else:
            log.append("Everything is already backed up.")
        if push:
            args = ("push",) if status.get("upstream") else ("push", "-u", "origin", status["branch"])
            try:
                result = self.run(ctx, *args, timeout=TIMEOUT_PUSH)
            except subprocess.TimeoutExpired:
                return {"ok": False, "grund": "Push timed out. Check your local GitHub authentication.", "log": log}
            if result.returncode != 0:
                return {"ok": False, "grund": (result.stderr or result.stdout).strip(), "log": log}
            log.append("Backup pushed to GitHub.")
        return {"ok": True, "log": log, "status": self.status(ctx)}

    def history(self, ctx: GitContext, limit: int = 40) -> list[dict[str, str]]:
        result = self.run(ctx, "log", f"-{limit}", "--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s", "--date=format:%d.%m.%Y %H:%M", timeout=TIMEOUT_LOCAL_READ)
        entries = []
        for line in result.stdout.splitlines() if result.returncode == 0 else []:
            parts = line.split("\x1f")
            if len(parts) == 5:
                entries.append({"hash": parts[0], "kurz": parts[1], "datum": parts[2], "autor": parts[3], "betreff": parts[4]})
        return entries

    def diff(self, ctx: GitContext, ref: str, text_only: bool = True, word_diff: bool = True) -> dict[str, Any]:
        self.sync(ctx)
        paths = ["--", "manuscripts", "profiles"] if text_only else ["--", "."]
        options = ["--word-diff=plain", "--word-diff-regex=[^[:space:]]+", "--unified=1"] if word_diff else ["--unified=3"]
        has_head = self.run(ctx, "rev-parse", "--verify", "HEAD", timeout=TIMEOUT_METADATA).returncode == 0
        if ref in ("", "WORK", None):
            result = self.run(ctx, "diff", "HEAD", *options, *paths, timeout=TIMEOUT_LOCAL_WRITE) if has_head else self.run(ctx, "diff", *options, *paths, timeout=TIMEOUT_LOCAL_WRITE)
        elif ref.replace("-", "").isalnum():
            result = self.run(ctx, "show", "--patch", "--format=", ref, *options, *paths, timeout=TIMEOUT_LOCAL_WRITE)
        else:
            return {"ok": False, "grund": "Invalid revision."}
        return {"ok": result.returncode in (0, 1), "diff": result.stdout, "neu": [], "wortweise": word_diff}

    def chapter_version(self, ctx: GitContext, ref: str, chapter_index: int, filename: str) -> dict[str, Any]:
        revision = "HEAD" if ref in ("", "WORK", None) else ref
        result = self.run(ctx, "show", f"{revision}:manuscripts/{chapter_index:02d} - {filename}.md", timeout=TIMEOUT_LOCAL_READ)
        if result.returncode != 0:
            return {"ok": True, "neu": True, "text": ""}
        body = result.stdout.split("\n\n", 1)[-1].split("\n---\n\n<!-- Notiz", 1)[0]
        return {"ok": True, "neu": False, "text": body.rstrip("\n")}
