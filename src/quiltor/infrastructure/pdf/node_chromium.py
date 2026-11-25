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

#: How long the server waits for one render before it gives up and kills the
#: renderer with everything it started. Below the 90 s a reverse proxy commonly
#: allows (Nginx Proxy Manager's default), so the server's own 502 with its
#: category reaches the client instead of a proxy error racing it (T-370).
RENDER_TIMEOUT_SECONDS = 80

#: The Node script gets less than that, so a page that never gets ready is
#: reported by the script itself -- with Chromium closed by its own `finally` --
#: before the server has to kill anything.
SCRIPT_DEADLINE_MARGIN_SECONDS = 10

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


def _descendants(pid: int) -> list[int]:
    """Every process below `pid`, read from /proc (Linux) or `ps` (macOS)."""
    parents: dict[int, list[int]] = {}
    proc = Path("/proc")
    if proc.is_dir():
        for entry in proc.iterdir():
            if not entry.name.isdigit():
                continue
            try:
                stat = (entry / "stat").read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            # `pid (comm) state ppid ...`; comm may contain spaces and parentheses.
            fields = stat.rsplit(")", 1)[-1].split()
            if len(fields) > 1 and fields[1].isdigit():
                parents.setdefault(int(fields[1]), []).append(int(entry.name))
    else:
        try:
            listing = subprocess.run(
                ["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True, check=False
            ).stdout
        except OSError:
            listing = ""
        for line in listing.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                parents.setdefault(int(parts[1]), []).append(int(parts[0]))
    found: list[int] = []
    pending = [pid]
    while pending:
        for child in parents.get(pending.pop(), []):
            if child not in found:
                found.append(child)
                pending.append(child)
    return found


def _kill_tree(process: subprocess.Popen) -> None:
    """Kill the renderer and every process it started (Chromium and its helpers).

    Killing only `node` is what left seven idle chrome-headless-shell processes
    behind on a hosted server after a timeout (T-370). Its own process group is
    not enough either: Playwright starts Chromium detached, in a group of its own,
    so the descendants are collected one by one before anything is killed.
    """
    if os.name == "posix":
        import signal

        for pid in [*_descendants(process.pid), process.pid]:
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    else:
        # /T follows parent ids, so it reaches detached children as well.
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            capture_output=True,
            check=False,
        )
    process.kill()


def _run(argv: list[str], *, timeout: float, **kwargs) -> subprocess.CompletedProcess:
    """`subprocess.run` with one difference: a timeout kills the whole process tree."""
    group = (
        {"start_new_session": True}
        if os.name == "posix"
        else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    )
    with subprocess.Popen(
        argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **group, **kwargs
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(process)
            process.communicate()
            raise
    return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)


def renderer(script: Path, base: Path):
    """Bind the script and working directory, returning a PdfRenderer.

    A factory rather than a plain function because those two are the host's
    business (where the checkout lives), while the contract every caller sees is
    just `(url, timeout) -> bytes`.
    """

    def render(url: str, timeout: int = RENDER_TIMEOUT_SECONDS) -> bytes:
        # The URL carries the one-shot render token, so it travels via the
        # environment rather than argv -- otherwise it would sit in `ps` output
        # for the subprocess's lifetime.
        target_name = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as target:
                target_name = target.name
            try:
                script_deadline = max(timeout - SCRIPT_DEADLINE_MARGIN_SECONDS, 1)
                result = _run(
                    ["node", str(script), target_name],
                    cwd=base,
                    text=True,
                    errors="replace",
                    timeout=timeout,
                    env={
                        **os.environ,
                        "QUILTOR_RENDER_URL": url,
                        "QUILTOR_RENDER_DEADLINE_MS": str(script_deadline * 1000),
                    },
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
