#!/usr/bin/env python3
"""Desktop launcher: runs the Quiltor server in the background and shows it in a
native OS window instead of a browser tab.

Optional `desktop` extra (`pip install -e ".[desktop]"`, or the PyInstaller-frozen
build built by distribution/) -- server.py and the plain `quiltor` CLI keep the
small core dependency set without this file.

Platform differences (data directories, process lifecycle and file-manager
integration) live behind ``quiltor.infrastructure.platform`` ports; this host stays OS-agnostic.

    python -m quiltor.hosts.desktop.app     (or `quiltor-desktop`, or the frozen build)
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path

# Run as a script -- `python src/quiltor/hosts/desktop/app.py` -- Python puts
# the module directory on sys.path, not the src root, so ``quiltor`` would not be
# importable. `python -m quiltor.hosts.desktop.app`, the console script and the frozen
# build all resolve them fine; this is for the plain path invocation, which is
# the obvious thing to try. Same guard src/quiltor/hosts/mcp/quiltor_server.py has.
if not getattr(sys, "frozen", False):
    _SOURCE_ROOT = str(Path(__file__).resolve().parents[3])
    if _SOURCE_ROOT not in sys.path:
        sys.path.insert(0, _SOURCE_ROOT)

from quiltor import resources  # noqa: E402
from quiltor.infrastructure.platform import directories  # noqa: E402
from quiltor.infrastructure.platform.constants import APP_NAME  # noqa: E402

DEFAULT_PORT = 8843


def _redirect_null_streams() -> None:
    """A windowed (console-less) frozen build may leave sys.stdin/stdout/stderr as
    None -- server.py prints status lines and installer.py checks sys.stdin.isatty()
    unconditionally, both of which would crash on None. Give them real, harmless
    file objects before anything downstream touches them."""
    for name in ("stdin", "stdout", "stderr"):
        if getattr(sys, name, None) is None:
            setattr(sys, name, open(os.devnull, "r" if name == "stdin" else "w"))


def keep_pywebview_downloads_off(webview) -> None:
    """Make sure the window never routes a download through pywebview itself.

    Every export in Quiltor -- the book PDF, the whole manuscript, a single
    chapter, the figures JSON, the character profiles -- goes through the
    NativeBridge instead (src/quiltor/hosts/desktop/bridge/api.py, and `download()`
    in the focused packages/client/src/platform/http adapters on the page side).
    ALLOW_DOWNLOADS already defaults to False, so this asserts the default rather
    than changing it; it exists because
    turning it on looks like the obvious fix and is in fact the worse bug.

    On macOS pywebview's DownloadDelegate puts up an application-modal
    NSSavePanel and then fails to call WebKit's completion handler -- pyobjc
    cannot invoke the block, having no signature for it -- so the export
    produces nothing and the uncaught NSInternalInconsistencyException that
    follows terminates the app. The full trace is in the bridge's module
    docstring.

    Takes the module as an argument rather than importing it, so this stays
    testable without the desktop extra installed.
    """
    webview.settings["ALLOW_DOWNLOADS"] = False


def _bundle_base() -> Path:
    """Frozen extraction directory or repository root in a source checkout."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", None) or Path(sys.executable).resolve().parent)
    return resources.source_root()


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

    app_dirs = directories.current().ensure()
    # Existing releases used one QUILTOR_HOME root. Keep those durable paths
    # while exposing the remaining directory classes explicitly to new hosts.
    home = app_dirs.data.parent
    # Must be set before `import server` -- the SQLite path configuration reads QUILTOR_HOME at
    # module import time to resolve where the SQLite data directory lives.
    os.environ.setdefault("QUILTOR_RUNTIME_HOST", "desktop")
    os.environ.setdefault("QUILTOR_HOME", str(home))
    os.environ.setdefault("QUILTOR_DATA_DIR", str(app_dirs.data))

    from quiltor.hosts.web import server
    from quiltor.infrastructure.pdf import desktop_renderer

    # An installed Chrome/Edge where the edition permits launching one, and
    # WKWebView's own print operation in a sandboxed Mac App Store build.
    web_application = server.build_web_application(
        render_pdf=desktop_renderer(), app_directories=app_dirs
    )

    port = _free_port()
    server_thread = threading.Thread(
        target=server.run,
        kwargs={"port": port, "no_open": True, "application": web_application},
        daemon=True,
    )
    server_thread.start()
    _wait_until_ready(port)

    import webview

    from quiltor.hosts.desktop.bridge import NativeBridge

    keep_pywebview_downloads_off(webview)

    # The page hands its exports to this instead of downloading them itself.
    native_bridge = NativeBridge(web_application.capabilities)
    window = webview.create_window(
        APP_NAME,
        f"http://127.0.0.1:{port}/",
        width=1280,
        height=860,
        min_size=(960, 640),
        js_api=native_bridge,
    )
    native_bridge.attach(window)

    from quiltor.hosts.desktop.tray import start_tray_icon

    frozen_icon = bundle / "distribution" / "assets" / "icons" / "tray.png"
    tray_icon_path = frozen_icon if frozen_icon.is_file() else resources.icons() / "tray.png"
    tray = (
        start_tray_icon(
            tray_icon_path,
            home / "data",
            show_window=window.restore,
            quit_app=window.destroy,
        )
        if tray_icon_path.exists()
        else None
    )

    webview.start()  # blocks until the window closes

    if tray is not None:
        tray.stop()
    web_application.assistant.close()


if __name__ == "__main__":
    main()
