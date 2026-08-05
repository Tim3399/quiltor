"""Where Quiltor keeps its files.

Two roots, deliberately separate so the same code runs from a source checkout and
from a pip-installed wheel:

- ``package_root()`` -- read-only shipped assets (the built ``dist/`` frontend,
  helper ``scripts/``). Lives next to the code.
- ``home()`` -- the writable base for runtime binaries, models and world data.
  In a source checkout this is the repo root, so dev behaviour is unchanged; when
  installed it is a per-user application-data directory (nobody wants a 2.5 GB
  model written into ``site-packages``).

Overridable with ``QUILTOR_HOME`` (whole tree) and ``QUILTOR_DATA_DIR`` (just the
world data), so a deployment can place them wherever it likes.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def _is_source_checkout() -> bool:
    # Markers a source tree has and an installed wheel does not.
    return (_ROOT / "package.json").exists() or (_ROOT / ".git").exists()


def package_root() -> Path:
    """Directory holding read-only shipped assets (dist/, scripts/)."""
    return _ROOT


def home() -> Path:
    """Writable base for runtime/, models/ and data/."""
    override = os.environ.get("QUILTOR_HOME")
    if override:
        return Path(override).expanduser().resolve()
    if _is_source_checkout():
        return _ROOT
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Quiltor"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Quiltor"
    return Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "quiltor"


def data_dir() -> Path:
    override = os.environ.get("QUILTOR_DATA_DIR")
    return Path(override).resolve() if override else home() / "data"


def runtime_dir() -> Path:
    return home() / "runtime"


def models_dir() -> Path:
    return home() / "models"
