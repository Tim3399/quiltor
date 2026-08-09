from __future__ import annotations

import subprocess
from pathlib import Path

from backend.llm.runtimes import resolve_port, spawn_logged


def start(base: Path, data: Path, url: str, binary_override: str | None, model_override: str | None) -> tuple[subprocess.Popen[str], Path] | None:
    """Spawn the MLX bridge server if a venv and a model are present.

    Mirrors backend/llm/runtimes/llamacpp.py's start() shape exactly, so
    backend/llm/select.py can treat every runtime interchangeably. Here,
    QUILTOR_AI_BINARY means "the Python interpreter to run the bridge
    with" (the MLX venv's python3) rather than a standalone executable,
    and QUILTOR_AI_MODEL means an MLX model directory rather than a
    .gguf file.

    Returns None (without raising) when nothing is installed yet -- MLX
    hasn't been set up (server.py offers this interactively, or run
    `python3 -m backend.llm.installer --runtime mlx` directly), which is a
    normal, expected state, not an error. select.py falls back to the
    llama.cpp runtime in that case. Otherwise returns the spawned process
    and the path of the log its output is captured to.
    """
    python = Path(binary_override) if binary_override else base / "runtime" / "mlx-venv" / "bin" / "python3"
    bridge = base / "scripts" / "llm-runtime" / "mlx_bridge.py"
    models_dir = base / "models" / "mlx"
    models = sorted(p for p in models_dir.glob("*") if (p / "config.json").exists()) if models_dir.exists() else []
    model = Path(model_override) if model_override else (models[0] if models else None)
    if not python.exists() or not bridge.exists() or not model or not model.exists():
        return None
    port = resolve_port(url)
    argv = [str(python), str(bridge), "--model", str(model), "--host", "127.0.0.1", "--port", str(port), "--max-prompt-tokens", "8192"]
    return spawn_logged(argv, data, "mlx-server.log")
