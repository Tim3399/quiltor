"""What every OS module in backend/system/ has to provide.

Written down as a Protocol rather than left implicit, because the failure mode
here is specific: a Windows-only or Linux-only implementation is never imported
on a Mac, so a typo in it survives every local test run and every CI job that
isn't running that OS. tests/backend/test_system.py asserts all three modules
satisfy this on whatever machine happens to run it.

Keep this surface small. It is for things the OS genuinely decides -- where
per-user files belong, how to launch a child process, what an executable is
called. It is deliberately *not* for third-party conventions that merely vary
by OS (llama.cpp's release asset names, say); those belong with the code that
knows about that third party, and use os_name()/machine_arch() from here.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

APP_NAME = "Quiltor"


@runtime_checkable
class SystemModule(Protocol):
    """The per-OS surface. backend/system/__init__.py picks one implementation
    once, at import time, and re-exports it."""

    #: pystray's macOS backend insists on owning the process's real main thread,
    #: the same one pywebview's Cocoa backend wants for the window. Windows and
    #: Linux tolerate a background thread, which is what the desktop host uses.
    TRAY_SUPPORTS_BACKGROUND_THREAD: bool

    def data_home(self) -> Path:
        """Per-user directory Quiltor's data, runtime and model files live under,
        following this OS's own convention."""

    def reveal_in_file_manager(self, path: Path) -> None:
        """Show `path` in the OS's file manager."""

    def spawn_flags(self) -> int:
        """Extra `creationflags` for subprocess.Popen. Non-zero only on Windows,
        where a console-less parent otherwise pops up a terminal per child."""

    def bind_child_lifetime(self, process: object) -> None:
        """Ask the OS to kill `process` if this process dies, including on a
        force-kill our own cleanup code never sees. A no-op where the OS already
        does this."""

    def executable_name(self, stem: str) -> str:
        """`stem` with whatever suffix an executable carries here."""

    def strip_quarantine(self, path: Path) -> None:
        """Clear the downloaded-file quarantine flag, where the OS sets one."""

    def is_apple_silicon(self) -> bool:
        """True on Apple Silicon, Rosetta included."""

    def in_os_app_package(self) -> bool:
        """True when this process runs inside the OS's own app container -- the
        macOS App Sandbox, or an MSIX package on Windows. An OS-level fact, so
        it lives here; backend/edition/ is what turns it into a distribution."""

    def os_name(self) -> str:
        """"macos" | "windows" | "linux" -- our own vocabulary, so callers never
        have to remember whether the answer is "Darwin" or "darwin"."""

    def machine_arch(self) -> str:
        """"arm64" | "x64" -- likewise normalised."""
