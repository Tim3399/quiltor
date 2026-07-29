from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any


class GitBackup:
    """Owns Git operations for one world, isolated from the application repo."""

    def __init__(self, repositories_dir: Path):
        self.repositories_dir = repositories_dir
        self.root: Path | None = None
        self.database: Path | None = None
        self.manuscripts: Path | None = None
        self.profiles: Path | None = None
        self.env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo", "GCM_INTERACTIVE": "never", "LC_ALL": "C"}

    def activate(self, world_id: str, repository_url: str, database: Path, manuscripts: Path, profiles: Path) -> None:
        self.root = self.repositories_dir / world_id
        self.database, self.manuscripts, self.profiles = database, manuscripts, profiles
        self.root.mkdir(parents=True, exist_ok=True)
        if not (self.root / ".git").exists():
            self.run("init", "-b", "main")
        current = self.run("remote", "get-url", "origin")
        if current.returncode == 0:
            if current.stdout.strip() != repository_url:
                self.run("remote", "set-url", "origin", repository_url)
        else:
            self.run("remote", "add", "origin", repository_url)

    def deactivate(self) -> None:
        self.root = self.database = self.manuscripts = self.profiles = None

    def run(self, *args: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
        if not self.root:
            raise RuntimeError("No world backup repository is active.")
        return subprocess.run(["git", "-c", "core.quotepath=false", "-C", str(self.root), *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, env=self.env)

    def sync(self) -> None:
        if not all((self.root, self.database, self.manuscripts, self.profiles)):
            raise RuntimeError("No world backup repository is active.")
        target = self.root / "world.sqlite3"
        with sqlite3.connect(self.database) as source, sqlite3.connect(target) as destination:
            source.backup(destination)
        for source_dir, name in ((self.manuscripts, "manuscripts"), (self.profiles, "profiles")):
            target_dir = self.root / name
            target_dir.mkdir(exist_ok=True)
            expected = set()
            for source_file in source_dir.glob("*.md"):
                expected.add(source_file.name)
                shutil.copy2(source_file, target_dir / source_file.name)
            for old_file in target_dir.glob("*.md"):
                if old_file.name not in expected:
                    old_file.unlink()

    def status(self) -> dict[str, Any]:
        try:
            self.sync()
            probe = self.run("rev-parse", "--is-inside-work-tree", timeout=10)
        except (FileNotFoundError, RuntimeError) as exc:
            return {"ok": False, "grund": "No Git backup is configured for this world." if isinstance(exc, RuntimeError) else str(exc)}
        if probe.returncode != 0:
            return {"ok": False, "grund": "The world backup is not a Git repository."}
        def output(*args: str) -> str:
            result = self.run(*args, timeout=10)
            return result.stdout.strip() if result.returncode == 0 else ""
        branch = output("rev-parse", "--abbrev-ref", "HEAD") or "main"
        upstream = output("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        changes = [line for line in self.run("status", "--porcelain", "--", ".", timeout=20).stdout.splitlines() if line.strip()]
        return {"ok": True, "branch": branch, "upstream": upstream, "remote": output("remote", "get-url", "origin"),
                "identitaet": bool(output("config", "user.name") and output("config", "user.email")),
                "aenderungen": changes[:60], "anzahl": len(changes), "unveroeffentlicht": 0,
                "vorschlag": f"Writing backup {datetime.now():%Y-%m-%d %H:%M}"}

    def commit(self, message: str, push: bool) -> dict[str, Any]:
        status = self.status()
        if not status.get("ok") or not status.get("identitaet"):
            return {"ok": False, "grund": status.get("grund") or "Configure your Git user name and email first.", "log": []}
        self.run("add", "-A", "--", ".", timeout=60)
        log: list[str] = []
        if self.run("diff", "--cached", "--quiet", timeout=30).returncode != 0:
            result = self.run("commit", "-m", message or status["vorschlag"], timeout=60)
            if result.returncode != 0:
                return {"ok": False, "grund": (result.stderr or result.stdout).strip(), "log": log}
            log.append("Backup commit created.")
        else:
            log.append("Everything is already backed up.")
        if push:
            args = ("push",) if status.get("upstream") else ("push", "-u", "origin", status["branch"])
            try:
                result = self.run(*args, timeout=180)
            except subprocess.TimeoutExpired:
                return {"ok": False, "grund": "Push timed out. Check your local GitHub authentication.", "log": log}
            if result.returncode != 0:
                return {"ok": False, "grund": (result.stderr or result.stdout).strip(), "log": log}
            log.append("Backup pushed to GitHub.")
        return {"ok": True, "log": log, "status": self.status()}

    def history(self, limit: int = 40) -> list[dict[str, str]]:
        result = self.run("log", f"-{limit}", "--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s", "--date=format:%d.%m.%Y %H:%M", timeout=30)
        entries = []
        for line in result.stdout.splitlines() if result.returncode == 0 else []:
            parts = line.split("\x1f")
            if len(parts) == 5:
                entries.append({"hash": parts[0], "kurz": parts[1], "datum": parts[2], "autor": parts[3], "betreff": parts[4]})
        return entries

    def diff(self, ref: str, text_only: bool = True, word_diff: bool = True) -> dict[str, Any]:
        self.sync()
        paths = ["--", "manuscripts", "profiles"] if text_only else ["--", "."]
        options = ["--word-diff=plain", "--word-diff-regex=[^[:space:]]+", "--unified=1"] if word_diff else ["--unified=3"]
        has_head = self.run("rev-parse", "--verify", "HEAD", timeout=10).returncode == 0
        if ref in ("", "WORK", None):
            result = self.run("diff", "HEAD", *options, *paths, timeout=60) if has_head else self.run("diff", *options, *paths, timeout=60)
        elif ref.replace("-", "").isalnum():
            result = self.run("show", "--patch", "--format=", ref, *options, *paths, timeout=60)
        else:
            return {"ok": False, "grund": "Invalid revision."}
        return {"ok": result.returncode in (0, 1), "diff": result.stdout, "neu": [], "wortweise": word_diff}

    def chapter_version(self, ref: str, chapter_index: int, filename: str) -> dict[str, Any]:
        revision = "HEAD" if ref in ("", "WORK", None) else ref
        result = self.run("show", f"{revision}:manuscripts/{chapter_index:02d} - {filename}.md", timeout=30)
        if result.returncode != 0:
            return {"ok": True, "neu": True, "text": ""}
        body = result.stdout.split("\n\n", 1)[-1].split("\n---\n\n<!-- Notiz", 1)[0]
        return {"ok": True, "neu": False, "text": body.rstrip("\n")}
