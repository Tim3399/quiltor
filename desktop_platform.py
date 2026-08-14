"""The small handful of things that genuinely differ per OS. Every other desktop
module (desktop.py, the tray icon) stays platform-agnostic and calls these instead
of branching on sys.platform itself -- adding a third OS, or changing how one of
these decisions is made, should only ever touch this one file.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

APP_NAME = "Quiltor"


def data_home() -> Path:
    """Per-user directory Quiltor's data/runtime/model files live under, following
    each OS's own convention -- mirrors backend/cli.py's ~/.quiltor default for the
    pip/pipx CLI, adapted per platform since a double-clicked app has no shell
    profile to set QUILTOR_HOME by hand.

    Deliberately has no App Sandbox branch, even though a Mac App Store build
    (backend/edition.py) must keep its data inside its container: macOS points HOME
    at ~/Library/Containers/<bundle-id>/Data for sandboxed processes, and
    Path.home() reads HOME, so the darwin path below already resolves into the
    container there. Adding an explicit branch would be dead code that only looks
    like it is doing something.
    """
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    if sys.platform == "win32":
        return Path.home() / APP_NAME
    return Path.home() / ".quiltor"


def reveal_in_file_manager(path: Path) -> None:
    """Opens `path` in the OS's file manager (Finder/Explorer/xdg-open)."""
    if sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    elif sys.platform == "win32":
        os.startfile(str(path))  # local, trusted path only
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


# pystray's darwin (AppKit/NSStatusItem) backend insists on owning the process's
# real main thread, same as pywebview's Cocoa backend does for the window --
# neither library will reliably share it with a background thread. Windows and
# Linux (GTK/AppIndicator) both tolerate running the tray icon from a background
# thread, which is what desktop.py does. Untested on macOS (no Mac available here)
# -- if the tray icon doesn't appear there, swap the arrangement: run pystray's
# Icon.run() on the main thread and move `webview.start()` into the thread that
# pystray's `setup=` callback receives instead.
TRAY_SUPPORTS_BACKGROUND_THREAD = sys.platform != "darwin"
