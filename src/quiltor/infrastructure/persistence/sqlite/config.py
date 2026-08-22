"""Immutable SQLite path sets for composed persistence adapters."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from quiltor import resources


BASE = resources.source_root()
# QUILTOR_DATA_DIR wins outright (Docker sets it explicitly); QUILTOR_HOME is
# the packaged CLI's per-user default. Tests and embedded hosts may relocate
# these values after import, so every adapter reads this module dynamically.
_HOME = Path(os.environ.get("QUILTOR_HOME", str(BASE)))
DATA = Path(os.environ.get("QUILTOR_DATA_DIR", str(_HOME / "data"))).resolve()
DB = DATA / ".no-active-world.sqlite3"
BACKUPS = DATA / "backups"
WORLDS = DATA / "worlds"


@dataclass(frozen=True, slots=True)
class SQLitePaths:
    """Immutable persistence locations owned by one composed application."""

    data: Path
    database: Path
    backups: Path
    worlds: Path

    @classmethod
    def from_data_directory(cls, data: Path) -> "SQLitePaths":
        root = data.expanduser().resolve()
        return cls(
            data=root,
            database=root / ".no-active-world.sqlite3",
            backups=root / "backups",
            worlds=root / "worlds",
        )

    @classmethod
    def from_environment(cls) -> "SQLitePaths":
        home = Path(os.environ.get("QUILTOR_HOME", str(BASE)))
        data = Path(os.environ.get("QUILTOR_DATA_DIR", str(home / "data")))
        return cls.from_data_directory(data)


# Reserved, non-empty subject for the one local user. OIDC subjects are barred
# from the ``quiltor-internal:`` namespace, so an external account can never
# collide with or claim locally owned worlds.
LOCAL_OWNER = "quiltor-internal:local-owner"


__all__ = [
    "BACKUPS",
    "BASE",
    "DATA",
    "DB",
    "LOCAL_OWNER",
    "SQLitePaths",
    "WORLDS",
]
