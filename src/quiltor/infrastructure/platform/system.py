"""Selected operating-system adapter.

This module is intentionally the only production module that branches on
``sys.platform``.  Distribution policy is *not* inferred here; it comes from a
build profile in :mod:`quiltor.infrastructure.platform.runtime_target`.
"""

from __future__ import annotations

import sys

from quiltor.infrastructure.platform.adapters import linux, macos, windows
from quiltor.infrastructure.platform.constants import APP_NAME


def _select():
    if sys.platform == "darwin":
        return macos
    if sys.platform == "win32":
        return windows
    return linux


_impl = _select()

TRAY_SUPPORTS_BACKGROUND_THREAD = _impl.TRAY_SUPPORTS_BACKGROUND_THREAD
app_directories = _impl.app_directories
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
    for stream in (sys.stdout, sys.stderr):
        if stream and stream.encoding and stream.encoding.lower() != "utf-8":
            stream.reconfigure(encoding="utf-8")


__all__ = [
    "APP_NAME",
    "TRAY_SUPPORTS_BACKGROUND_THREAD",
    "app_directories",
    "bind_child_lifetime",
    "executable_name",
    "force_utf8_streams",
    "in_os_app_package",
    "is_apple_silicon",
    "machine_arch",
    "os_name",
    "reveal_in_file_manager",
    "spawn_flags",
    "strip_quarantine",
]
