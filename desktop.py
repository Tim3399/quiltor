#!/usr/bin/env python3
"""Desktop launcher: runs the Quiltor server in the background and shows it in a
native OS window instead of a browser tab.

Optional `desktop` extra (`pip install -e ".[desktop]"`, or the PyInstaller-frozen
build built by packaging/) -- server.py and the plain `quiltor` CLI stay dependency-
free/stdlib-only without this file, same as before.

Platform differences (data directory, "reveal in file manager") live in
desktop_platform.py; this file and desktop_tray.py stay OS-agnostic.

    python desktop.py
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path

from desktop_platform import APP_NAME, data_home

DEFAULT_PORT = 8843


def _redirect_null_streams() -> None:
    """A windowed (console-less) frozen build may leave sys.stdin/stdout/stderr as
    None -- server.py prints status lines and installer.py checks sys.stdin.isatty()
    unconditionally, both of which would crash on None. Give them real, harmless
    file objects before anything downstream touches them."""
    for name in ("stdin", "stdout", "stderr"):
        if getattr(sys, name, None) is None:
            setattr(sys, name, open(os.devnull, "r" if name == "stdin" else "w"))


def _bundle_base() -> Path:
    """Directory holding server.py/backend/dist/VERSION: the frozen bundle's own
    directory under PyInstaller, or this file's directory when run from source."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", None) or Path(sys.executable).resolve().parent)
    return Path(__file__).resolve().parent


def _free_port(preferred: int = DEFAULT_PORT) -> int:
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return probe.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("Could not find a free local port to bind the Quiltor server to.")


def _wait_until_ready(port: int, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.25)
            try:
                probe.connect(("127.0.0.1", port))
                return
            except OSError:
                time.sleep(0.1)
    raise RuntimeError(f"Quiltor server did not start within {timeout:.0f}s.")


def main() -> None:
    _redirect_null_streams()

    bundle = _bundle_base()
    if str(bundle) not in sys.path:
        sys.path.insert(0, str(bundle))

    home = data_home()
    # Must be set before `import server` -- backend/storage.py reads QUILTOR_HOME at
    # module import time to resolve where the SQLite data directory lives.
    os.environ.setdefault("QUILTOR_HOME", str(home))

    import server
    from backend.render import render_pdf_system_browser

    server.RENDER_PDF = render_pdf_system_browser
    server.ensure_dirs()

    port = _free_port()
    server_thread = threading.Thread(
        target=server.run, kwargs={"port": port, "no_open": True}, daemon=True,
    )
    server_thread.start()
    _wait_until_ready(port)

    import webview

    window = webview.create_window(
        APP_NAME, f"http://127.0.0.1:{port}/",
        width=1280, height=860, min_size=(960, 640),
    )

    from desktop_tray import start_tray_icon

    tray_icon_path = bundle / "packaging" / "icons" / "tray.png"
    tray = start_tray_icon(
        tray_icon_path, home / "data",
        show_window=window.restore,
        quit_app=window.destroy,
    ) if tray_icon_path.exists() else None

    webview.start()  # blocks until the window closes

    if tray is not None:
        tray.stop()
    server.ASSISTANT.close()


if __name__ == "__main__":
    main()
