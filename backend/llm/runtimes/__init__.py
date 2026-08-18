"""Platform-specific runtime launchers. Each module here knows how to find and
start one concrete local LLM backend; all of them are expected to end up
serving the same OpenAI-compatible contract defined in backend/llm/shared.

This package's own __init__ holds the two bits every launcher needs and
would otherwise duplicate: resolving the port to listen on, and spawning a
subprocess with its output captured to a log file instead of discarded.
"""

from __future__ import annotations

import subprocess
import sys
import urllib.parse
from pathlib import Path

from backend import system


def resolve_port(url: str, default: int = 11435) -> int:
    return urllib.parse.urlsplit(url).port or default


def bundled_runtime_dir() -> Path | None:
    """Directory holding an LLM runtime shipped *inside* the frozen app bundle,
    or None when there is none (a source checkout, Docker, or a build that
    downloads its runtime the usual way).

    This is what lets a Mac App Store build satisfy guideline 2.5.2: the
    executable is already there and signed with our Team ID, so nothing
    executable ever gets downloaded (see backend/edition.py). Lives here rather
    than in installer.py because llamacpp.py needs it too, and installer.py
    already imports llamacpp -- the other direction would be a cycle.
    """
    if not getattr(sys, "frozen", False):
        return None
    base = Path(getattr(sys, "_MEIPASS", None) or Path(sys.executable).resolve().parent)
    candidate = base / "runtime"
    return candidate if candidate.is_dir() else None


def spawn_logged(argv: list[str], data: Path, log_name: str) -> tuple[subprocess.Popen[str], Path]:
    """Spawn argv with stdout/stderr captured to data/log_name. Returns the process and the log path.

    bind_child_lifetime() is what stops a force-killed Quiltor from leaving the
    model loaded in an orphaned runtime process; see backend/system/windows.py
    for why that needs doing at all.
    """
    log_path = data / log_name
    log = open(log_path, "a", encoding="utf-8")
    process = subprocess.Popen(
        argv, stdout=log, stderr=subprocess.STDOUT, text=True, creationflags=system.spawn_flags()
    )
    system.bind_child_lifetime(process)
    return process, log_path
