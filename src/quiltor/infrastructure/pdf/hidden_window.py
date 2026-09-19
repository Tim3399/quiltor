"""An offscreen pywebview window holding a fully rendered book, for the
renderers that print through a widget rather than build one themselves.

Windows and Linux use this. macOS does not: src/quiltor/infrastructure/pdf/wkwebview.py creates its
own WKWebView, which is verified working and needs nothing from pywebview. The
other two would each have to reproduce work pywebview already does -- a WebView2
needs an initialised environment and a window handle, and a WebKitGTK view needs
a running GTK main loop -- so they borrow a window instead of building one.

Consequence worth knowing: this only works inside the desktop host, where
`webview.start()` is already running. That is the only place these renderers are
ever selected.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

from quiltor.infrastructure.pdf.book_document import RENDER_STATE_JS, render_state

POLL_INTERVAL_SECONDS = 0.25


@contextmanager
def printable_window(url: str, timeout: int):
    """Yield a hidden pywebview window showing `url`, once the book has rendered.

    Destroyed on the way out, including when the caller raises -- a leaked
    hidden window would keep a whole browser process alive for the rest of the
    session.
    """
    try:
        import webview
    except ImportError as exc:  # pragma: no cover - desktop extra only
        raise RuntimeError("PDF export requires the desktop components (pywebview).") from exc

    window = webview.create_window(
        "Quiltor PDF",
        url,
        hidden=True,
        width=800,
        height=1000,
    )
    try:
        _wait_until_rendered(window, timeout)
        yield window
    finally:
        try:
            window.destroy()
        except Exception:  # noqa: BLE001 - never mask the real error
            pass


def _wait_until_rendered(window, timeout: int) -> None:
    """Poll the DOM until the book is on the page.

    Four times a second, not as fast as possible: hammering the web view with
    evaluate_js starves the content process, and the app then never gets far
    enough to render -- a mistake already made once against WKWebView.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = "waiting"
        try:
            state = render_state(window.evaluate_js(RENDER_STATE_JS))
            if state == "ready":
                return
            if state == "error":
                raise RuntimeError("The book view reported a pagination error.")
        except Exception:  # noqa: BLE001 - the page may not be loaded yet
            if state == "error":
                raise
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError(f"The book view was not ready after {timeout}s.")
