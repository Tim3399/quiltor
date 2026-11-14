"""Renders via a Node subprocess driving Playwright's own downloaded Chromium.

The Docker image and `npm run dev` path: both already have Node and the
Playwright browsers, so there is nothing to bundle and nothing to find on the
user's machine. Never used by the desktop builds -- shipping a Node runtime and
a ~300 MB Chromium inside a `.app` is exactly what system_browser.py avoids.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

from quiltor.application.errors import PdfRendererError

#: `off` runs Chromium without its sandbox, for hosts that grant no user namespaces.
#: Never the fallback of a failure -- only an operator's explicit choice.
SANDBOX_ENV = "QUILTOR_PDF_SANDBOX"

# Ordered: the first match wins. A launch that times out says "browserType.launch:
# Timeout", so launch comes before timeout.
_STDERR_CATEGORIES = (
    (
        "sandbox_unavailable",
        re.compile(
            r"no usable sandbox|sandbox_host_linux|setuid sandbox|namespace sandbox"
            r"|Running as root without --no-sandbox",
            re.IGNORECASE,
        ),
    ),
    (
        "browser_launch_failed",
        re.compile(
            r"browserType\.launch|Failed to launch|Executable doesn't exist"
            r"|Target page, context or browser has been closed|spawn .* ENOENT",
            re.IGNORECASE,
        ),
    ),
    ("timeout", re.compile(r"Timeout \d+ms|TimeoutError", re.IGNORECASE)),
    (
        "page_error",
        re.compile(
            r"page\.(?:goto|waitForFunction|pdf)|net::ERR_|book view reported", re.IGNORECASE
        ),
    ),
)


def sandbox_disabled() -> bool:
    return os.environ.get(SANDBOX_ENV, "").strip().lower() == "off"


def classify_failure(stderr: str) -> str:
    """The category of a failed render, read from its stderr.

    The text itself is dropped here: it can quote the render URL with its one-shot
    token or a path. What leaves this function is one of a fixed set of names, and
    `unknown` never carries any of the text.
    """
    for category, pattern in _STDERR_CATEGORIES:
        if pattern.search(stderr or ""):
            return category
    return "unknown"


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
            try:
                result = subprocess.run(
                    ["node", str(script), target_name],
                    cwd=base,
                    capture_output=True,
                    text=True,
                    errors="replace",
                    timeout=timeout,
                    env={**os.environ, "QUILTOR_RENDER_URL": url},
                )
            except subprocess.TimeoutExpired:
                raise PdfRendererError("timeout") from None
            except FileNotFoundError:
                raise PdfRendererError("browser_launch_failed") from None
            if result.returncode != 0:
                raise PdfRendererError(
                    classify_failure(f"{result.stderr or ''}\n{result.stdout or ''}"),
                    result.returncode,
                ) from None
            return Path(target_name).read_bytes()
        finally:
            if target_name:
                Path(target_name).unlink(missing_ok=True)

    return render
