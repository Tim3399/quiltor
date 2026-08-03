from __future__ import annotations

import functools
import platform
import subprocess
import sys


@functools.lru_cache(maxsize=1)
def is_apple_silicon() -> bool:
    """True on an Apple Silicon Mac, including when running under Rosetta.

    platform.machine() reports "x86_64" for a Python interpreter running
    under Rosetta even on an M-series Mac -- ask the kernel directly rather
    than trust that. Cached: this can shell out to sysctl, and the answer
    can't change during the process's lifetime.
    """
    if platform.system() != "Darwin":
        return False
    if platform.machine().lower() in ("arm64", "aarch64"):
        return True
    try:
        result = subprocess.run(["sysctl", "-n", "sysctl.proc_translated"], capture_output=True, text=True, timeout=5)
        return result.returncode == 0 and result.stdout.strip() == "1"
    except Exception:
        return False


def force_utf8_streams() -> None:
    """Windows consoles default to a codepage (e.g. cp1252) that can't encode
    the box-drawing and umlaut characters this project prints to the
    console; force UTF-8 so output works without env vars.
    """
    for stream in (sys.stdout, sys.stderr):
        if stream and stream.encoding and stream.encoding.lower() != "utf-8":
            stream.reconfigure(encoding="utf-8")
