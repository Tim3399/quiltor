"""PDF export: short-lived, single-use tokens that let the internal headless-browser
render subprocess act as the requesting user for one render (it can't do an interactive
Keycloak login itself), and the subprocess invocation that turns a URL into PDF bytes."""

from __future__ import annotations

import os
import secrets
import subprocess
import tempfile
import threading
import time
from pathlib import Path

RENDER_TOKEN_TTL = 90

_lock = threading.Lock()
_tokens: dict[str, tuple[str, float]] = {}


def issue_render_token(sub: str) -> str:
    token = secrets.token_urlsafe(24)
    now = time.time()
    with _lock:
        for key in [k for k, (_, expires) in _tokens.items() if expires < now]:
            _tokens.pop(key, None)
        _tokens[token] = (sub, now + RENDER_TOKEN_TTL)
    return token


def redeem_render_token(token: str) -> str | None:
    with _lock:
        entry = _tokens.pop(token, None)
    if entry and entry[1] > time.time():
        return entry[0]
    return None


def render_pdf(script: Path, base: Path, url: str, timeout: int = 90) -> bytes:
    """Run the headless-browser render subprocess and return the resulting PDF bytes.

    `url` carries the one-shot render token; it travels via the environment rather than
    argv so it doesn't show up in `ps`/Task Manager for the subprocess's lifetime.
    """
    target_name = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as target:
            target_name = target.name
        result = subprocess.run(
            ["node", str(script), target_name],
            cwd=base, capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "QUILTOR_RENDER_URL": url},
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "PDF-Renderer fehlgeschlagen.").strip())
        return Path(target_name).read_bytes()
    finally:
        if target_name:
            Path(target_name).unlink(missing_ok=True)


def render_pdf_system_browser(url: str, timeout: int = 90) -> bytes:
    """Desktop-app PDF render path: drives the OS's already-installed Chrome or Edge
    through Playwright for Python instead of shelling out to render_pdf()'s Node/
    Playwright-JS script. Playwright for Python bundles its own small driver (no system
    Node.js needed) and `channel="chrome"/"msedge"` reuses the installed browser instead
    of downloading a dedicated Chromium (~250-300MB saved in the frozen desktop build).
    Only used by desktop.py; Docker/dev keep using render_pdf() above unchanged.
    """
    from playwright.sync_api import sync_playwright  # local import: `desktop` extra only

    last_error: Exception | None = None
    with sync_playwright() as p:
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel, headless=True)
            except Exception as exc:
                last_error = exc
                continue
            try:
                page = browser.new_page()
                page.goto(url, wait_until="networkidle", timeout=timeout * 1000)
                page.get_by_label("Kapiteltext").wait_for(timeout=timeout * 1000)
                page.emulate_media(media="print")
                return page.pdf(prefer_css_page_size=True, print_background=True, display_header_footer=False)
            finally:
                browser.close()
    raise RuntimeError(
        "Für den PDF-Export wurde weder Google Chrome noch Microsoft Edge gefunden. "
        f"Bitte einen der beiden Browser installieren und erneut versuchen ({last_error})."
    )
