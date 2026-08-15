"""Renders via a Node subprocess driving Playwright's own downloaded Chromium.

The Docker image and `npm run dev` path: both already have Node and the
Playwright browsers, so there is nothing to bundle and nothing to find on the
user's machine. Never used by the desktop builds -- shipping a Node runtime and
a ~300 MB Chromium inside a `.app` is exactly what system_browser.py avoids.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


def renderer(script: Path, base: Path):
    """Bind the script and working directory, returning a PdfRenderer.

    A factory rather than a plain function because those two are the host's
    business (where the checkout lives), while the contract every caller sees is
    just `(url, timeout) -> bytes`.
    """

    def render(url: str, timeout: int = 90) -> bytes:
        # The URL carries the one-shot render token, so it travels via the
        # environment rather than argv -- otherwise it would sit in `ps` output
        # for the subprocess's lifetime.
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

    return render
