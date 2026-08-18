"""PDF export.

Every renderer loads the app's own print view over loopback and returns PDF
bytes. They differ only in what does the rendering:

  - **wkwebview / webview2 / webkitgtk** -- the desktop build on macOS, Windows
    and Linux respectively, each printing through the engine already drawing the
    window. Nothing to install, nothing to launch, and the PDF matches what the
    author was looking at.
  - **system_browser** -- Playwright driving an installed Chrome or Edge. No
    longer chosen anywhere by default; kept as the fallback
    `QUILTOR_PDF_RENDERER=system_browser` selects, since only the macOS native
    path has actually been executed.
  - **node_chromium** -- Docker and `npm run dev`, which have Node and the
    Playwright browsers anyway and no window server to print through.

Two entry points rather than one selector, because the questions differ:
`server_renderer()` needs filesystem paths only the host knows, while
`desktop_renderer()` needs the platform.
"""

from __future__ import annotations

from pathlib import Path

import os

from backend import system
from backend.pdf import node_chromium, system_browser, webkitgtk, webview2, wkwebview
from backend.pdf.contract import PdfRenderer
from backend.pdf.tokens import RENDER_TOKEN_TTL, issue_render_token, redeem_render_token

SYSTEM_BROWSER = "system_browser"

#: The platform's own print engine -- no second browser, nothing to install.
NATIVE_RENDERERS = {
    "macos": "wkwebview",
    "windows": "webview2",
    "linux": "webkitgtk",
}

_BY_NAME = {
    "wkwebview": wkwebview.render,
    "webview2": webview2.render,
    "webkitgtk": webkitgtk.render,
    SYSTEM_BROWSER: system_browser.render,
}


def server_renderer(script: Path, base: Path) -> PdfRenderer:
    """The renderer for a server process. Not an edition decision -- Docker and
    a source checkout are always `direct`, and a store build is never a server."""
    return node_chromium.renderer(script, base)


def desktop_renderer_name(os_name: str | None = None, sandboxed: bool | None = None) -> str:
    """Which renderer a windowed build uses. Split out from desktop_renderer()
    so packaging can ask the same question rather than duplicate the answer --
    see packaging/bundle.py, which drops Playwright wherever this is not
    SYSTEM_BROWSER.

    Every platform prints with its own engine. The window is already a web view;
    printing through the same one is what makes the PDF match what the author
    was looking at, and it asks nothing of the reader's machine. "Install Google
    Chrome to export your book" is a poor answer from a local writing tool, and
    on Linux it is not even a reliable one -- no browser is guaranteed there.

    QUILTOR_PDF_RENDERER overrides the choice. That exists because only the
    macOS path has actually been run: setting it to `system_browser` restores
    the old behaviour on a machine where the native path misbehaves, without
    waiting for a new build. It needs the `browser-pdf` extra installed.
    """
    override = os.environ.get("QUILTOR_PDF_RENDERER", "").strip()
    if override:
        if override not in _BY_NAME:
            raise SystemExit(
                f"Unknown QUILTOR_PDF_RENDERER={override!r}. "
                f"Expected one of: {', '.join(sorted(_BY_NAME))}"
            )
        return override
    return NATIVE_RENDERERS.get(os_name or system.os_name(), SYSTEM_BROWSER)


def desktop_renderer() -> PdfRenderer:
    """The renderer for this windowed process."""
    return _BY_NAME[desktop_renderer_name()]


__all__ = [
    "NATIVE_RENDERERS",
    "RENDER_TOKEN_TTL",
    "SYSTEM_BROWSER",
    "PdfRenderer",
    "desktop_renderer",
    "desktop_renderer_name",
    "issue_render_token",
    "node_chromium",
    "redeem_render_token",
    "server_renderer",
    "system_browser",
    "webkitgtk",
    "webview2",
    "wkwebview",
]
