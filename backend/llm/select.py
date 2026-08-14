from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Protocol

from backend.edition import is_store_build
from backend.llm.runtimes import llamacpp, mlx
from backend.llm.shared.platform import is_apple_silicon


class Runtime(Protocol):
    def start(self, base: Path, data: Path, url: str, binary_override: str | None, model_override: str | None) -> tuple[subprocess.Popen[str], Path] | None: ...


RUNTIMES: dict[str, Runtime] = {"llamacpp": llamacpp, "mlx": mlx}


def _preference_order() -> tuple[Runtime, ...]:
    # MLX is materially faster on Apple Silicon (Metal-native, unified
    # memory) but only starts if it was actually installed (backend.llm.installer
    # --runtime mlx); llama.cpp (Metal-accelerated on macOS by default) is
    # the dependable fallback everywhere, including a Mac where MLX was
    # never installed.
    # A Store build has no MLX venv to start -- backend/llm/installer.py refuses to
    # create one there (guideline 2.5.2) -- so don't even probe for it.
    if is_apple_silicon() and not is_store_build():
        return (mlx, llamacpp)
    return (llamacpp,)


def start_runtime(base: Path, data: Path, url: str) -> tuple[subprocess.Popen[str], Path] | None:
    """Choose and launch a local runtime backend for the current platform.

    Honours the QUILTOR_AI_* environment overrides. This is the seam
    where a platform-specific backend plugs in as a sibling of
    backend/llm/runtimes/llamacpp.py -- neither backend/assistant.py nor
    backend/llm/shared/contract.py need to change, since both only ever
    speak the shared HTTP contract. Returns the spawned process and its
    log path, or None if nothing is installed.
    """
    if os.environ.get("QUILTOR_AI_URL"):
        # An explicit URL means an endpoint already exists somewhere
        # (local or remote); spawning our own server anyway would, at
        # best, waste resources, and at worst bind the same port a
        # remote QUILTOR_AI_URL's host/port coincidentally shares.
        return None
    binary, model = os.environ.get("QUILTOR_AI_BINARY"), os.environ.get("QUILTOR_AI_MODEL")
    forced = os.environ.get("QUILTOR_AI_RUNTIME")
    if forced:
        runtime = RUNTIMES.get(forced)
        if runtime is None:
            raise SystemExit(f"Unknown QUILTOR_AI_RUNTIME={forced!r}. Expected one of: {', '.join(RUNTIMES)}")
        return runtime.start(base, data, url, binary, model)
    for runtime in _preference_order():
        started = runtime.start(base, data, url, binary, model)
        if started is not None:
            return started
    return None
