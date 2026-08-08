from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


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
        current = self.run(ctx, "remote", "get-url", "origin")
        if current.returncode == 0:
            if current.stdout.strip() != ctx.repository_url:
                self.run(ctx, "remote", "set-url", "origin", ctx.repository_url)
        else:
            self.run(ctx, "remote", "add", "origin", ctx.repository_url)

    def run(self, ctx: GitContext, *args: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
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
            probe = self.run(ctx, "rev-parse", "--is-inside-work-tree", timeout=10)
        except FileNotFoundError as exc:
            return {"ok": False, "grund": str(exc)}
        if probe.returncode != 0:
            return {"ok": False, "grund": "The world backup is not a Git repository."}

        def output(*args: str) -> str:
            result = self.run(ctx, *args, timeout=10)
            return result.stdout.strip() if result.returncode == 0 else ""

        branch = output("rev-parse", "--abbrev-ref", "HEAD") or "main"
        upstream = output("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        changes = [line for line in self.run(ctx, "status", "--porcelain", "--", ".", timeout=20).stdout.splitlines() if line.strip()]
        return {"ok": True, "branch": branch, "upstream": upstream, "remote": output("remote", "get-url", "origin"),
                "identitaet": bool(output("config", "user.name") and output("config", "user.email")),
                "aenderungen": changes[:60], "anzahl": len(changes), "unveroeffentlicht": 0,
                "vorschlag": f"Writing backup {datetime.now():%Y-%m-%d %H:%M}"}

    def commit(self, ctx: GitContext, message: str, push: bool) -> dict[str, Any]:
        status = self.status(ctx)
        if not status.get("ok") or not status.get("identitaet"):
            return {"ok": False, "grund": status.get("grund") or "Configure your Git user name and email first.", "log": []}
        self.run(ctx, "add", "-A", "--", ".", timeout=60)
        log: list[str] = []
        if self.run(ctx, "diff", "--cached", "--quiet", timeout=30).returncode != 0:
            result = self.run(ctx, "commit", "-m", message or status["vorschlag"], timeout=60)
            if result.returncode != 0:
                return {"ok": False, "grund": (result.stderr or result.stdout).strip(), "log": log}
            log.append("Backup commit created.")
        else:
            log.append("Everything is already backed up.")
        if push:
            args = ("push",) if status.get("upstream") else ("push", "-u", "origin", status["branch"])
            try:
                result = self.run(ctx, *args, timeout=180)
            except subprocess.TimeoutExpired:
                return {"ok": False, "grund": "Push timed out. Check your local GitHub authentication.", "log": log}
            if result.returncode != 0:
                return {"ok": False, "grund": (result.stderr or result.stdout).strip(), "log": log}
            log.append("Backup pushed to GitHub.")
        return {"ok": True, "log": log, "status": self.status(ctx)}

    def history(self, ctx: GitContext, limit: int = 40) -> list[dict[str, str]]:
        result = self.run(ctx, "log", f"-{limit}", "--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s", "--date=format:%d.%m.%Y %H:%M", timeout=30)
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
        has_head = self.run(ctx, "rev-parse", "--verify", "HEAD", timeout=10).returncode == 0
        if ref in ("", "WORK", None):
            result = self.run(ctx, "diff", "HEAD", *options, *paths, timeout=60) if has_head else self.run(ctx, "diff", *options, *paths, timeout=60)
        elif ref.replace("-", "").isalnum():
            result = self.run(ctx, "show", "--patch", "--format=", ref, *options, *paths, timeout=60)
        else:
            return {"ok": False, "grund": "Invalid revision."}
        return {"ok": result.returncode in (0, 1), "diff": result.stdout, "neu": [], "wortweise": word_diff}

    def chapter_version(self, ctx: GitContext, ref: str, chapter_index: int, filename: str) -> dict[str, Any]:
        revision = "HEAD" if ref in ("", "WORK", None) else ref
        result = self.run(ctx, "show", f"{revision}:manuscripts/{chapter_index:02d} - {filename}.md", timeout=30)
        if result.returncode != 0:
            return {"ok": True, "neu": True, "text": ""}
        body = result.stdout.split("\n\n", 1)[-1].split("\n---\n\n<!-- Notiz", 1)[0]
        return {"ok": True, "neu": False, "text": body.rstrip("\n")}
