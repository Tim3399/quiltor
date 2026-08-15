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

from backend import edition
from backend.pdf import node_chromium, system_browser, wkwebview
from backend.pdf.contract import PdfRenderer
from backend.pdf.tokens import RENDER_TOKEN_TTL, issue_render_token, redeem_render_token


def server_renderer(script: Path, base: Path) -> PdfRenderer:
    """The renderer for a server process. Not an edition decision -- Docker and
    a source checkout are always `direct`, and a store build is never a server."""
    return node_chromium.renderer(script, base)


def desktop_renderer() -> PdfRenderer:
    """The renderer for a windowed desktop process.

    `allows_external_process()` is the whole question: driving an installed
    Chrome or Edge means launching an executable outside our bundle, which only
    the sandbox refuses. The Microsoft Store build keeps the browser path.
    """
    if edition.allows_external_process():
        return system_browser.render
    return wkwebview.render


__all__ = [
    "RENDER_TOKEN_TTL", "PdfRenderer", "desktop_renderer", "issue_render_token",
    "node_chromium", "redeem_render_token", "server_renderer", "system_browser", "wkwebview",
]
