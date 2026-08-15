"""macOS. See backend/system/contract.py for the surface."""
from __future__ import annotations

import functools
import os
import platform
import subprocess
from pathlib import Path

from backend.system.contract import APP_NAME

TRAY_SUPPORTS_BACKGROUND_THREAD = False


def data_home() -> Path:
    """Deliberately has no App Sandbox branch, even though a Mac App Store build
    (backend/edition/) must keep its data inside its container: macOS points HOME
    at ~/Library/Containers/<bundle-id>/Data for sandboxed processes, and
    Path.home() reads HOME, so this already resolves into the container there.
    An explicit branch would be dead code that only looks like it does something.
    """
    return Path.home() / "Library" / "Application Support" / APP_NAME


def reveal_in_file_manager(path: Path) -> None:
    """Show `path` in the Finder.

    NSWorkspace first, because it is the route the App Sandbox actually permits
    -- `/usr/bin/open` is a LaunchServices client and asking it to launch the
    Finder from inside a container is denied. It also needs no entitlement:
    revealing a file the user already owns is not a privileged operation.

    The subprocess stays as a fallback for the source checkout and the CLI,
    where pyobjc is not installed (it arrives with the `desktop` extra). That
    branch is never reached in a sandboxed build, which always has it.
    """
    try:
        from AppKit import NSURL, NSWorkspace
    except ImportError:
        subprocess.run(["open", str(path)], check=False)
        return
    NSWorkspace.sharedWorkspace().activateFileViewerSelectingURLs_(
        [NSURL.fileURLWithPath_(str(path))])


def spawn_flags() -> int:
    return 0


def bind_child_lifetime(process: object) -> None:
    """No-op: POSIX process groups already tie the child to us."""


def executable_name(stem: str) -> str:
    return stem


def strip_quarantine(path: Path) -> None:
    """macOS quarantines downloaded executables; without this they fail to launch
    behind an unhelpful Gatekeeper dialog."""
    subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(path)], capture_output=True)


@functools.lru_cache(maxsize=1)
def is_apple_silicon() -> bool:
    """platform.machine() reports "x86_64" for an interpreter running under
    Rosetta even on an M-series Mac -- ask the kernel rather than trust it.
    Cached: this shells out, and the answer cannot change while we run."""
    if platform.machine().lower() in ("arm64", "aarch64"):
        return True
    try:
        result = subprocess.run(["sysctl", "-n", "sysctl.proc_translated"], capture_output=True, text=True, timeout=5)
        return result.returncode == 0 and result.stdout.strip() == "1"
    except Exception:
        return False


def in_os_app_package() -> bool:
    """macOS exports APP_SANDBOX_CONTAINER_ID into every sandboxed process, and
    the App Sandbox is mandatory for Mac App Store apps -- so its presence is
    the signal, and one build can behave correctly in either context without a
    compile-time flag."""
    return bool(os.environ.get("APP_SANDBOX_CONTAINER_ID"))


def os_name() -> str:
    return "macos"


def machine_arch() -> str:
    return "arm64" if is_apple_silicon() else "x64"
