"""PDF export, in the three forms it can take.

Every renderer loads the app's own print view over loopback and returns PDF
bytes; they differ only in what does the rendering, and that is decided by the
host and the edition together:

  - **node_chromium** -- Docker and `npm run dev`. A Node subprocess driving
    Playwright's downloaded Chromium. Both already have Node and the browsers.
  - **system_browser** -- the desktop build wherever launching another
    application is permitted: the `.dmg`, the Inno Setup `.exe`, and the
    Microsoft Store's MSIX package.
  - **wkwebview** -- a sandboxed Mac App Store build, which may not launch
    anything outside its own bundle. Not implemented yet; see the module.

The host picks the family (a server has no window server to print through, a
desktop app has no Node), and the edition picks within it. Hence two entry
points rather than one selector: `server_renderer()` needs paths only the host
knows, and `desktop_renderer()` asks the edition.
"""
from __future__ import annotations

from pathlib import Path

from backend import edition, system
from backend.pdf import node_chromium, system_browser, wkwebview
from backend.pdf.contract import PdfRenderer
from backend.pdf.tokens import RENDER_TOKEN_TTL, issue_render_token, redeem_render_token

WKWEBVIEW = "wkwebview"
SYSTEM_BROWSER = "system_browser"


def server_renderer(script: Path, base: Path) -> PdfRenderer:
    """The renderer for a server process. Not an edition decision -- Docker and
    a source checkout are always `direct`, and a store build is never a server."""
    return node_chromium.renderer(script, base)


def desktop_renderer_name(os_name: str | None = None, sandboxed: bool | None = None) -> str:
    """Which renderer a windowed build uses. Split out from desktop_renderer()
    so packaging can ask the same question without duplicating the answer -- see
    packaging/bundle.py, which drops Playwright wherever this is not
    SYSTEM_BROWSER.

    macOS always prints through WKWebView, sandboxed or not. That is not a
    concession to the App Store: the window is a WKWebView, so printing with the
    same engine is what makes the PDF match what the author was looking at, and
    it removes any dependency on the reader having Chrome installed. "Install
    Google Chrome to export your book" is a poor thing for a local writing tool
    to say.

    Elsewhere the browser path stays until an equivalent exists -- WebView2's
    PrintToPdfAsync on Windows, WebKitGTK's print operation on Linux -- except
    in a sandbox, which may not launch anything outside the bundle at all.
    """
    if (os_name or system.os_name()) == "macos":
        return WKWEBVIEW
    is_sandboxed = edition.is_sandboxed() if sandboxed is None else sandboxed
    return WKWEBVIEW if is_sandboxed else SYSTEM_BROWSER


def desktop_renderer() -> PdfRenderer:
    """The renderer for this windowed process."""
    return wkwebview.render if desktop_renderer_name() == WKWEBVIEW else system_browser.render


__all__ = [
    "RENDER_TOKEN_TTL", "SYSTEM_BROWSER", "WKWEBVIEW", "PdfRenderer", "desktop_renderer",
    "desktop_renderer_name", "issue_render_token", "node_chromium", "redeem_render_token",
    "server_renderer", "system_browser", "wkwebview",
]
