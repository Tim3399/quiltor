"""The OS layer: the one place in the codebase that knows which operating
system it is running on.

There used to be a convention that desktop_platform.py was that one place. It
did not hold -- by the time this package was written there were thirteen
sys.platform / platform.system() branches scattered across six other modules
(the LLM installer, both runtime launchers, the grammar service), each one a
small correct decision made in the wrong file. With a Mac App Store and a
Microsoft Store build coming, that was going to get worse rather than better.

So the rule is now checkable instead of aspirational: nothing outside this
package branches on the OS, and tests/backend/test_system.py enforces it. Code
that needs a per-OS answer asks here and gets one.

Adding an OS means adding one module next to macos/windows/linux and one line
below -- nothing else in the tree changes.
"""
from __future__ import annotations

import sys

from backend.system import linux, macos, windows
from backend.system.contract import APP_NAME, SystemModule


def _select() -> SystemModule:
    if sys.platform == "darwin":
        return macos
    if sys.platform == "win32":
        return windows
    return linux  # also the fallback for the BSDs and anything else POSIX-ish


_impl = _select()

TRAY_SUPPORTS_BACKGROUND_THREAD = _impl.TRAY_SUPPORTS_BACKGROUND_THREAD

data_home = _impl.data_home
reveal_in_file_manager = _impl.reveal_in_file_manager
spawn_flags = _impl.spawn_flags
bind_child_lifetime = _impl.bind_child_lifetime
executable_name = _impl.executable_name
strip_quarantine = _impl.strip_quarantine
is_apple_silicon = _impl.is_apple_silicon
in_os_app_package = _impl.in_os_app_package
os_name = _impl.os_name
machine_arch = _impl.machine_arch


def force_utf8_streams() -> None:
    """Windows consoles default to a codepage (cp1252 and friends) that cannot
    encode the box-drawing characters and umlauts this project prints. Lives
    here rather than in windows.py because it branches on the stream's actual
    encoding, not on the OS -- a Windows terminal already set to UTF-8 needs
    nothing done to it.
    """
    for stream in (sys.stdout, sys.stderr):
        if stream and stream.encoding and stream.encoding.lower() != "utf-8":
            stream.reconfigure(encoding="utf-8")


__all__ = [
    "APP_NAME", "SystemModule", "TRAY_SUPPORTS_BACKGROUND_THREAD",
    "bind_child_lifetime", "data_home", "executable_name", "force_utf8_streams",
    "in_os_app_package", "is_apple_silicon", "machine_arch", "os_name",
    "reveal_in_file_manager", "spawn_flags", "strip_quarantine",
]
