"""Start a child in a process group of its own and kill it with everything it started.

Used by the PDF renderer (T-370): a timeout that killed only `node` left the
Chromium it had launched running.
"""

from __future__ import annotations

import contextlib
import os
import subprocess
from pathlib import Path
from typing import Any


def own_group_options() -> dict[str, Any]:
    """`Popen` keyword arguments that put the child in a process group of its own."""
    if os.name == "posix":
        return {"start_new_session": True}
    return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}


def _descendants(pid: int) -> list[int]:
    """Every process below `pid`, read from /proc (Linux) or `ps` (macOS)."""
    parents: dict[int, list[int]] = {}
    proc = Path("/proc")
    if proc.is_dir():
        for entry in proc.iterdir():
            if not entry.name.isdigit():
                continue
            try:
                stat = (entry / "stat").read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            # `pid (comm) state ppid ...`; comm may contain spaces and parentheses.
            fields = stat.rsplit(")", 1)[-1].split()
            if len(fields) > 1 and fields[1].isdigit():
                parents.setdefault(int(fields[1]), []).append(int(entry.name))
    else:
        try:
            listing = subprocess.run(
                ["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True, check=False
            ).stdout
        except OSError:
            listing = ""
        for line in listing.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                parents.setdefault(int(parts[1]), []).append(int(parts[0]))
    found: list[int] = []
    pending = [pid]
    while pending:
        for child in parents.get(pending.pop(), []):
            if child not in found:
                found.append(child)
                pending.append(child)
    return found


def kill(process: subprocess.Popen) -> None:
    """Kill the renderer and every process it started (Chromium and its helpers).

    Killing only `node` is what left seven idle chrome-headless-shell processes
    behind on a hosted server after a timeout (T-370). Its own process group is
    not enough either: Playwright starts Chromium detached, in a group of its own,
    so the descendants are collected one by one before anything is killed.
    """
    if os.name == "posix":
        import signal

        for pid in [*_descendants(process.pid), process.pid]:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.kill(pid, signal.SIGKILL)
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGKILL)
    else:
        # /T follows parent ids, so it reaches detached children as well.
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            capture_output=True,
            check=False,
        )
    process.kill()
