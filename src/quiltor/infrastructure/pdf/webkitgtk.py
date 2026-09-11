"""Renders through WebKitGTK's print operation on Linux.

**Written but never executed.** No Linux machine was in the loop, and the macOS
equivalent needed five corrections that only appeared when it ran. Treat a
failure here as expected rather than surprising; `QUILTOR_PDF_RENDERER=system_browser`
switches back to driving an installed Chrome without a new build.

Linux is where removing the browser dependency actually matters. Windows ships
Edge and macOS now prints natively, but a Linux desktop guarantees no browser at
all -- so "install Chrome to export your book" was a real dead end rather than a
theoretical one.

Like the Windows renderer this borrows a hidden pywebview window rather than
building its own view, because a WebKitGTK view needs a running GTK main loop
and pywebview already owns one.
"""

from __future__ import annotations

import queue
import tempfile
from pathlib import Path

from quiltor.infrastructure.pdf.book_document import PAPER_GEOMETRY_JS, validate_paper_mm
from quiltor.infrastructure.pdf.hidden_window import printable_window


def render(url: str, timeout: int = 90) -> bytes:
    with printable_window(url, timeout) as window:
        paper_mm = validate_paper_mm(window.evaluate_js(PAPER_GEOMETRY_JS))
        target = Path(tempfile.mkstemp(suffix=".pdf")[1])
        try:
            _print(window, target, timeout, paper_mm)
            data = target.read_bytes()
        finally:
            target.unlink(missing_ok=True)
    if not data:
        raise RuntimeError("PDF export produced an empty file.")
    return data


def _find_webview(widget):
    """The WebKit2.WebView inside pywebview's window.

    Found by walking the widget tree rather than by reaching for a private
    attribute: `window.native` is the Gtk.Window, and what sits between it and
    the view is pywebview's business, not ours.
    """
    import gi

    gi.require_version("WebKit2", "4.1")
    from gi.repository import WebKit2

    if isinstance(widget, WebKit2.WebView):
        return widget
    for child in getattr(widget, "get_children", lambda: [])():
        found = _find_webview(child)
        if found is not None:
            return found
    return None


def _print(window, target: Path, timeout: int, paper_mm: tuple[float, float]) -> None:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gtk, WebKit2

    view = _find_webview(window.native)
    if view is None:
        raise RuntimeError("The WebKitGTK component was not found.")

    settings = Gtk.PrintSettings()
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, target.resolve().as_uri())
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf")

    paper = Gtk.PaperSize.new_custom(
        "quiltor-book",
        "Quiltor book",
        paper_mm[0],
        paper_mm[1],
        Gtk.Unit.MM,
    )
    setup = Gtk.PageSetup()
    setup.set_paper_size(paper)
    for edge in ("top", "bottom", "left", "right"):
        getattr(setup, f"set_{edge}_margin")(0, Gtk.Unit.MM)

    operation = WebKit2.PrintOperation.new(view)
    operation.set_print_settings(settings)
    operation.set_page_setup(setup)

    outcome: queue.Queue = queue.Queue(maxsize=1)
    operation.connect("finished", lambda _op: outcome.put(("ok", None)))
    operation.connect("failed", lambda _op, error: outcome.put(("error", str(error))))
    # print() is non-interactive -- print_dialog() is the one that would show UI.
    operation.print()

    # The GTK main loop is pywebview's and is already turning, so this thread
    # only has to wait for the signal rather than pump anything itself.
    try:
        kind, payload = outcome.get(timeout=timeout)
    except queue.Empty:
        raise RuntimeError(f"The print operation did not respond within {timeout}s.") from None
    if kind == "error":
        raise RuntimeError(f"The print operation failed: {payload}")
