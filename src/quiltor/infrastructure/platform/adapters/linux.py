"""Linux host primitives and POSIX fallback."""

from __future__ import annotations

import os
import platform
import subprocess
import tempfile
from pathlib import Path

from quiltor.infrastructure.platform.constants import APP_NAME
from quiltor.infrastructure.platform.ports import AppDirectories

TRAY_SUPPORTS_BACKGROUND_THREAD = True


def app_directories() -> AppDirectories:
    home = Path.home()
    legacy = home / ".quiltor"
    return AppDirectories(
        data=legacy / "data",
        config=Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "quiltor",
        cache=Path(os.environ.get("XDG_CACHE_HOME", home / ".cache")) / "quiltor",
        models=legacy / "models",
        logs=Path(os.environ.get("XDG_STATE_HOME", home / ".local" / "state")) / "quiltor" / "logs",
        temp=Path(tempfile.gettempdir()) / APP_NAME,
    )


def reveal_in_file_manager(path: Path) -> None:
    subprocess.run(["xdg-open", str(path)], check=False)


def spawn_flags() -> int:
    return 0


def bind_child_lifetime(process: object) -> None:
    return None


def executable_name(stem: str) -> str:
    return stem


def strip_quarantine(path: Path) -> None:
    return None


def is_apple_silicon() -> bool:
    return False


def in_os_app_package() -> bool:
    return False


def os_name() -> str:
    return "linux"


def machine_arch() -> str:
    return "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
