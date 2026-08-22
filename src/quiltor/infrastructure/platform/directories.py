"""Resolve host-owned writable locations with backwards-compatible overrides."""

from __future__ import annotations

import os
from pathlib import Path

from quiltor.infrastructure.platform import system
from quiltor.infrastructure.platform.ports import AppDirectories


def from_legacy_home(home: Path) -> AppDirectories:
    """Map the historical ``QUILTOR_HOME`` root onto explicit locations.

    Keeping ``data``/``models`` exactly where older releases put them avoids a
    migration just for adopting the new port.  Hosts without that legacy can
    provide all six paths directly.
    """
    root = home.expanduser().resolve()
    return AppDirectories(
        data=root / "data",
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


def current() -> AppDirectories:
    home = os.environ.get("QUILTOR_HOME", "").strip()
    directories = from_legacy_home(Path(home)) if home else system.app_directories()
    data_override = os.environ.get("QUILTOR_DATA_DIR", "").strip()
    if data_override:
        directories = AppDirectories(
            data=Path(data_override).expanduser().resolve(),
            config=directories.config,
            cache=directories.cache,
            models=directories.models,
            logs=directories.logs,
            temp=directories.temp,
        )
    return directories


__all__ = ["AppDirectories", "current", "from_legacy_home"]
