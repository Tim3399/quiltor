from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from backend.llm.runtimes import resolve_port, spawn_logged


def binary_name() -> str:
    return "llama-server.exe" if sys.platform == "win32" else "llama-server"


def start(base: Path, data: Path, url: str, binary_override: str | None, model_override: str | None) -> tuple[subprocess.Popen[str], Path] | None:
    """Spawn the bundled llama-server if a matching binary and model are present.

    Returns None (without raising) when nothing is installed yet -- that's
    a normal, expected state before the runtime has been set up (server.py
    offers to do this interactively on first launch; see
    backend/llm/installer.py), not an error. Otherwise returns the spawned
    process and the path of the log its output is captured to.
    """
    binary = Path(binary_override) if binary_override else base / "runtime" / binary_name()
    models = sorted((base / "models").glob("*.gguf")) if (base / "models").exists() else []
    model = Path(model_override) if model_override else (models[0] if models else None)
    if not binary.exists() or not model or not model.exists():
        return None
    port = resolve_port(url)
    argv = [str(binary), "-m", str(model), "--host", "127.0.0.1", "--port", str(port), "-c", "8192", "--jinja"]
    return spawn_logged(argv, data, "llama-server.log")
