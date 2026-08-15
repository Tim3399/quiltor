"""Linux, and the fallback for any OS without its own module here. See
backend/system/contract.py for the surface."""
from __future__ import annotations

import platform
import subprocess
from pathlib import Path

TRAY_SUPPORTS_BACKGROUND_THREAD = True


def data_home() -> Path:
    """Matches the ~/.quiltor default the pip/pipx CLI already uses."""
    return Path.home() / ".quiltor"


def reveal_in_file_manager(path: Path) -> None:
    subprocess.run(["xdg-open", str(path)], check=False)


def spawn_flags() -> int:
    return 0


def bind_child_lifetime(process: object) -> None:
    """No-op: POSIX process groups already tie the child to us."""


def executable_name(stem: str) -> str:
    return stem


def strip_quarantine(path: Path) -> None:
    """No-op: Linux has no quarantine attribute."""


def is_apple_silicon() -> bool:
    return False


def in_os_app_package() -> bool:
    """No Linux store build exists. Flatpak/Snap would be the equivalent if one
    ever does."""
    return False


def os_name() -> str:
    return "linux"


def machine_arch() -> str:
    return "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
