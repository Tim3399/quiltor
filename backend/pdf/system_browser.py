"""Renders by driving the OS's already-installed Chrome or Edge.

The desktop build's renderer wherever launching another application is allowed
-- the Developer ID `.dmg`, the Inno Setup `.exe`, and the Microsoft Store's
MSIX package, which is not sandboxed the way a Mac App Store app is.

Playwright for Python bundles a small driver of its own, so no system Node.js is
needed, and `channel="chrome"/"msedge"` reuses the installed browser instead of
downloading a dedicated Chromium -- worth ~250-300 MB in the frozen build.

Not usable in a Mac App Store build: the sandbox refuses to launch an executable
outside our own bundle, and "requires another app to be installed" is its own
review problem. wkwebview.py is the answer there.
"""

from __future__ import annotations

CHANNELS = ("chrome", "msedge")


def render(url: str, timeout: int = 90) -> bytes:
    from playwright.sync_api import sync_playwright  # local import: `desktop` extra only

    last_error: Exception | None = None
    with sync_playwright() as p:
        for channel in CHANNELS:
            try:
                browser = p.chromium.launch(channel=channel, headless=True)
            except Exception as exc:
                last_error = exc
                continue
            try:
                page = browser.new_page()
                page.goto(url, wait_until="networkidle", timeout=timeout * 1000)
                # Waits for the editor to exist, i.e. the app has finished
                # hydrating and the chapters are on the page.
                #
                # This matches a *German* aria-label and only works because each
                # render gets a fresh browser profile with empty localStorage and
                # the UI defaults to German. If that default ever becomes
                # locale-detection, this silently turns into a 90 s timeout.
                # Whatever replaces this path must not reintroduce the dependency.
                page.get_by_label("Kapiteltext").wait_for(timeout=timeout * 1000)
                page.emulate_media(media="print")
                return page.pdf(
                    prefer_css_page_size=True, print_background=True, display_header_footer=False
                )
            finally:
                browser.close()
    raise RuntimeError(
        "Für den PDF-Export wurde weder Google Chrome noch Microsoft Edge gefunden. "
        f"Bitte einen der beiden Browser installieren und erneut versuchen ({last_error})."
    )
