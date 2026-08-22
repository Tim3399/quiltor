"""macOS host primitives. Importable on every operating system."""

from __future__ import annotations

import functools
import os
import platform
import subprocess
import tempfile
from pathlib import Path

from quiltor.infrastructure.platform.constants import APP_NAME
from quiltor.infrastructure.platform.ports import AppDirectories

TRAY_SUPPORTS_BACKGROUND_THREAD = False


def app_directories() -> AppDirectories:
    home = Path.home()
    support = home / "Library" / "Application Support" / APP_NAME
    return AppDirectories(
        data=support / "data",
        config=home / "Library" / "Preferences" / APP_NAME,
        cache=home / "Library" / "Caches" / APP_NAME,
        models=support / "models",
        logs=home / "Library" / "Logs" / APP_NAME,
        temp=Path(tempfile.gettempdir()) / APP_NAME,
    )


def reveal_in_file_manager(path: Path) -> None:
    try:
        from AppKit import NSURL, NSWorkspace
    except ImportError:
        subprocess.run(["open", str(path)], check=False)
        return
    NSWorkspace.sharedWorkspace().activateFileViewerSelectingURLs_(
        [NSURL.fileURLWithPath_(str(path))]
    )


def spawn_flags() -> int:
    return 0


def bind_child_lifetime(process: object) -> None:
    return None


def executable_name(stem: str) -> str:
    return stem


def strip_quarantine(path: Path) -> None:
    subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(path)], capture_output=True)


@functools.lru_cache(maxsize=1)
def is_apple_silicon() -> bool:
    if platform.machine().lower() in ("arm64", "aarch64"):
        return True
    try:
        result = subprocess.run(
            ["sysctl", "-n", "sysctl.proc_translated"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0 and result.stdout.strip() == "1"
    except Exception:
        return False


def in_os_app_package() -> bool:
    return bool(os.environ.get("APP_SANDBOX_CONTAINER_ID"))


def os_name() -> str:
    return "macos"


def machine_arch() -> str:
    return "arm64" if is_apple_silicon() else "x64"
