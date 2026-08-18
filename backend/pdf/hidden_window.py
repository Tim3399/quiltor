"""An offscreen pywebview window holding a fully rendered book, for the
renderers that print through a widget rather than build one themselves.

Windows and Linux use this. macOS does not: backend/pdf/wkwebview.py creates its
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

#: 6 x 9 inch, matching @page in src/styles.css.
PAPER_WIDTH_INCHES = 6.0
PAPER_HEIGHT_INCHES = 9.0
POLL_INTERVAL_SECONDS = 0.25

#: True once the app has rendered the book into the DOM. An expression, because
#: that is what evaluate_js evaluates. Deliberately not the German aria-label
#: the Chromium path waits on -- that only holds while the UI defaults to German.
READY_JS = """
(function () {
  var root = document.querySelector('.print-document');
  return !!(root && root.textContent && root.textContent.trim().length > 0);
})();
"""


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
        raise RuntimeError("Der PDF-Export benötigt die Desktop-Komponenten (pywebview).") from exc

    window = webview.create_window(
        "Quiltor PDF",
        url,
        hidden=True,
        width=int(PAPER_WIDTH_INCHES * 96),
        height=int(PAPER_HEIGHT_INCHES * 96),
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
        try:
            if window.evaluate_js(READY_JS):
                return
        except Exception:  # noqa: BLE001 - the page may not be loaded yet
            pass
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError(f"Die Buchansicht war nach {timeout}s nicht fertig aufgebaut.")
