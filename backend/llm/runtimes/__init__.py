"""Platform-specific runtime launchers. Each module here knows how to find and
start one concrete local LLM backend; all of them are expected to end up
serving the same OpenAI-compatible contract defined in backend/llm/shared.

This package's own __init__ holds the two bits every launcher needs and
would otherwise duplicate: resolving the port to listen on, and spawning a
subprocess with its output captured to a log file instead of discarded.
"""

from __future__ import annotations

import subprocess
import urllib.parse
from pathlib import Path


def resolve_port(url: str, default: int = 11435) -> int:
    return urllib.parse.urlsplit(url).port or default


def spawn_logged(argv: list[str], data: Path, log_name: str) -> tuple[subprocess.Popen[str], Path]:
    """Spawn argv with stdout/stderr captured to data/log_name. Returns the process and the log path."""
    log_path = data / log_name
    log = open(log_path, "a", encoding="utf-8")
    return subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, text=True), log_path
