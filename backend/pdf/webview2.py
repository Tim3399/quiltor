"""Renders through WebView2's own print engine on Windows.

**Written but never executed.** There is no Windows machine in the loop that
produced this, and the macOS equivalent needed five separate corrections that
only appeared when it ran. Treat a failure here as expected rather than
surprising, and see the escape hatch in backend/pdf/__init__.py:
`QUILTOR_PDF_RENDERER=system_browser` switches back to driving an installed
Edge without a new build.

Unlike the macOS renderer this does not build its own web view. A WebView2
needs an initialised environment and a window handle to attach to, and pywebview
already does that work -- so a hidden pywebview window is created, printed from,
and destroyed. That also means this only works inside the desktop host, which is
the only place it is ever selected.

`CoreWebView2.PrintToPdfAsync` returns a .NET Task. It is polled rather than
awaited: the calling thread is an HTTP handler thread, and there is no asyncio
loop here to hand the continuation to.
"""

from __future__ import annotations

import time
from pathlib import Path

from backend.pdf import page_numbers
from backend.pdf.hidden_window import PAPER_HEIGHT_INCHES, PAPER_WIDTH_INCHES, printable_window


def render(url: str, timeout: int = 90) -> bytes:
    with printable_window(url, timeout) as window:
        target = Path(_temporary_pdf())
        try:
            _print(window, target, timeout)
            data = target.read_bytes()
        finally:
            target.unlink(missing_ok=True)
    if not data:
        raise RuntimeError("Der PDF-Export hat eine leere Datei erzeugt.")
    return page_numbers.stamp(data)


def _temporary_pdf() -> str:
    import tempfile

    handle, name = tempfile.mkstemp(suffix=".pdf")
    import os

    os.close(handle)
    return name


def _print(window, target: Path, timeout: int) -> None:
    """Drive CoreWebView2.PrintToPdfAsync on the widget pywebview built."""
    control = getattr(window.native, "webview", None)
    if control is None or getattr(control, "CoreWebView2", None) is None:
        raise RuntimeError("Die WebView2-Komponente war nicht bereit.")
    core = control.CoreWebView2

    settings = core.Environment.CreatePrintSettings()
    # Inches, matching @page { size: 6in 9in } in src/styles.css. Margins are
    # zero here because the page's own @page rule owns them.
    settings.PageWidth = PAPER_WIDTH_INCHES
    settings.PageHeight = PAPER_HEIGHT_INCHES
    settings.MarginTop = settings.MarginBottom = 0.0
    settings.MarginLeft = settings.MarginRight = 0.0
    settings.ShouldPrintBackgrounds = True
    settings.ShouldPrintHeaderAndFooter = False

    task = core.PrintToPdfAsync(str(target), settings)
    deadline = time.monotonic() + timeout
    while not task.IsCompleted:
        if time.monotonic() > deadline:
            raise RuntimeError(f"PrintToPdfAsync hat nach {timeout}s nicht geantwortet.")
        time.sleep(0.05)
    if task.IsFaulted:
        raise RuntimeError(f"PrintToPdfAsync ist fehlgeschlagen: {task.Exception}")
    if task.Result is False:
        raise RuntimeError("WebView2 hat kein PDF erzeugt.")
