"""Where the local assistant's model files live.

Without ``QUILTOR_MODELS_DIR`` the layout is the historical one under
``<home>/models`` (GGUF files directly in it, MLX models in ``mlx/``). With it,
the variable names a shared model root and the convention below it is
``<root>/gguf/*.gguf`` and ``<root>/mlx/<model>/`` (with ``config.json``), so
another tool can point at the same files. The runtime (``runtime/``,
llama-server, mlx-venv) always stays under the home directory.

Every place that needs a model folder asks this module; nothing else builds
``<base> / "models"``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

MODELS_DIR_ENV = "QUILTOR_MODELS_DIR"


class ModelsDirError(ValueError):
    """QUILTOR_MODELS_DIR is set but does not name an existing directory."""


@dataclass(frozen=True, slots=True)
class ModelStore:
    gguf: Path
    mlx: Path


def models_dir_override() -> Path | None:
    """The configured model root, or None when the variable is unset or blank."""
    raw = os.environ.get(MODELS_DIR_ENV, "").strip()
    if not raw:
        return None
    root = Path(raw).expanduser().resolve()
    if not root.is_dir():
        raise ModelsDirError(
            f"{MODELS_DIR_ENV} points at {root}, which is not an existing directory. "
            f"Create it (or fix the path), or unset {MODELS_DIR_ENV} to use <home>/models."
        )
    return root


def model_store(home: Path) -> ModelStore:
    root = models_dir_override()
    if root is not None:
        return ModelStore(gguf=root / "gguf", mlx=root / "mlx")
    models = home / "models"
    return ModelStore(gguf=models, mlx=models / "mlx")
