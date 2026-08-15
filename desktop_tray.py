"""System tray / menu bar icon for the desktop app. One implementation for both
OSes -- pystray abstracts the actual Windows-notification-area-vs-macOS-menu-bar
difference internally, so nothing here branches on the OS (backend/system/ is
where the few things that still have to do it live).

The tray icon lives only as long as the app is running -- closing the window still
quits the whole app (matches the rest of desktop.py; this isn't a "minimize to
tray and keep running in the background" feature, just quick actions while open).
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

from backend.system import APP_NAME, TRAY_SUPPORTS_BACKGROUND_THREAD, reveal_in_file_manager


def start_tray_icon(icon_path: Path, data_dir: Path, show_window: Callable[[], None], quit_app: Callable[[], None]) -> "pystray.Icon | None":  # noqa: F821
    """Starts the tray icon and returns it (so callers can .stop() it on quit), or
    None if pystray/PIL aren't available -- the desktop app works fine without a
    tray icon, so a missing optional dependency shouldn't block startup."""
    try:
        import pystray
        from PIL import Image
    except ImportError:
        return None

    image = Image.open(icon_path)

    def _show(icon, item):
        show_window()

    def _open_data_dir(icon, item):
        reveal_in_file_manager(data_dir)

    def _quit(icon, item):
        icon.stop()
        quit_app()

    menu = pystray.Menu(
        pystray.MenuItem("Quiltor öffnen", _show, default=True),
        pystray.MenuItem("Datenordner öffnen", _open_data_dir),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Beenden", _quit),
    )
    if not TRAY_SUPPORTS_BACKGROUND_THREAD:
        # macOS: pystray's AppKit backend needs the process's real main thread,
        # same as pywebview's Cocoa window does for webview.start() right after
        # this returns -- calling icon.run() (blocking) here would just hang
        # before the window ever opens. No Mac available to verify a fix, so
        # skip the tray there for now rather than ship something untested that
        # would break app startup outright; see backend/system/macos.py for the
        # restructuring this needs (pystray owning main, webview in a thread).
        return None

    icon = pystray.Icon(APP_NAME, image, APP_NAME, menu)
    threading.Thread(target=icon.run, daemon=True).start()
    return icon
