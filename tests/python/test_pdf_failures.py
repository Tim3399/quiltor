"""What a failed PDF render says about itself (T-269 round 2, F-269-13).

The Node renderer's stderr can quote the render URL with its one-shot token, so a
failure leaves the renderer as a category and an exit code and nothing else. No real
Chromium runs here: the renderer's `_run` is patched.
"""

import io
import json
import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from quiltor.application import PdfRendererError
from quiltor.delivery.http import errors as http_errors
from quiltor.delivery.http.routes import Request
from quiltor.delivery.http.routes.documents import book_pdf
from quiltor.hosts.web import server as web_server
from quiltor.infrastructure import pdf
from quiltor.infrastructure.observability import StdlibStructuredLogger
from quiltor.infrastructure.pdf import node_chromium

TOKEN = "tok-SECRET-9f3a1c"
URL = f"http://127.0.0.1:8010/?world=w1&renderToken={TOKEN}&bookRender=1"

STDERR_BY_CATEGORY = {
    "sandbox_unavailable": (
        "[FATAL:sandbox_host_linux.cc(41)] No usable sandbox! Update your kernel\n"
        f"    at page.goto({URL})"
    ),
    "browser_launch_failed": (
        f"browserType.launch: Target page, context or browser has been closed\n  url={URL}"
    ),
    "timeout": f"TimeoutError: page.waitForFunction: Timeout 90000ms exceeded.\n  {URL}",
    "page_error": f"Error: page.goto: net::ERR_CONNECTION_REFUSED at {URL}",
    "unknown": f"something nobody planned for, with {URL} in it",
}


def _failing_run(stderr: str, returncode: int = 1):
    def run(argv, **kwargs):
        return subprocess.CompletedProcess(argv, returncode, stdout="", stderr=stderr)

    return run


def _render(stderr: str, returncode: int = 1):
    rendered = node_chromium.renderer(Path("render.mjs"), Path("."))
    with patch("quiltor.infrastructure.pdf.node_chromium._run", _failing_run(stderr, returncode)):
        rendered(URL)


class CategoryTests(unittest.TestCase):
    def test_every_category_is_read_from_typical_stderr(self):
        for category, stderr in STDERR_BY_CATEGORY.items():
            with self.subTest(category=category):
                with self.assertRaises(PdfRendererError) as caught:
                    _render(stderr, 7)
                self.assertEqual(caught.exception.category, category)
                self.assertEqual(caught.exception.exit_code, 7)

    def test_a_subprocess_timeout_is_a_timeout(self):
        def run(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, 90, stderr=URL)

        rendered = node_chromium.renderer(Path("render.mjs"), Path("."))
        with patch("quiltor.infrastructure.pdf.node_chromium._run", run):
            with self.assertRaises(PdfRendererError) as caught:
                rendered(URL)
        self.assertEqual(caught.exception.category, "timeout")
        self.assertIsNone(caught.exception.exit_code)

    def test_a_missing_node_is_a_launch_failure(self):
        def run(argv, **kwargs):
            raise FileNotFoundError(2, "No such file", "node")

        rendered = node_chromium.renderer(Path("render.mjs"), Path("."))
        with patch("quiltor.infrastructure.pdf.node_chromium._run", run):
            with self.assertRaises(PdfRendererError) as caught:
                rendered(URL)
        self.assertEqual(caught.exception.category, "browser_launch_failed")

    def test_only_the_sandbox_category_asks_the_operator_to_act(self):
        sandbox = PdfRendererError("sandbox_unavailable", 1)
        self.assertEqual(sandbox.code, "pdf.sandbox_unavailable")
        self.assertFalse(sandbox.retryable)
        other = PdfRendererError("timeout", 1)
        self.assertEqual(other.code, "pdf.render_failed")
        self.assertTrue(other.retryable)

    def test_a_retry_is_never_made_here(self):
        calls = []

        def run(argv, **kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(
                argv, 1, stdout="", stderr=STDERR_BY_CATEGORY["browser_launch_failed"]
            )

        rendered = node_chromium.renderer(Path("render.mjs"), Path("."))
        with patch("quiltor.infrastructure.pdf.node_chromium._run", run):
            with self.assertRaises(PdfRendererError):
                rendered(URL)
        self.assertEqual(len(calls), 1)


class NoUrlOrTokenTests(unittest.TestCase):
    def _app(self, stream):
        def render_pdf(url):
            _render(STDERR_BY_CATEGORY[self.category], 1)

        # The route logs through its own slice (DocumentRouteServices.observability), never
        # through the full application composition (test_architecture_contracts).
        logger = StdlibStructuredLogger(name="quiltor.test.pdf", stream=stream)
        return SimpleNamespace(
            issue_render_token=lambda sub: TOKEN,
            render_pdf=render_pdf,
            observability=SimpleNamespace(logger=logger),
        )

    def _handler_class(self, stream):
        class Handler:
            server = SimpleNamespace(server_address=("127.0.0.1", 8010))

            def _read_json_body(self):
                return {"worldId": "w1"}

            def world_from_body(self, session, payload):
                return SimpleNamespace(id="w1")

            def send_pdf(self, data):
                raise AssertionError("a failed render sends no PDF")

        return Handler

    def test_category_log_event_and_response_carry_neither_url_nor_token(self):
        for category in STDERR_BY_CATEGORY:
            with self.subTest(category=category):
                self.category = category
                stream = io.StringIO()
                app = self._app(stream)
                request = Request("/api/book.pdf", session=SimpleNamespace(sub="author"))
                with self.assertRaises(PdfRendererError) as caught:
                    book_pdf(self._handler_class(stream)(), request, app)
                error = caught.exception
                response = http_errors.from_exception(error).payload()
                traceback = web_server._safe_traceback(error)
                everything = "\n".join(
                    [
                        error.category,
                        repr(error.params),
                        stream.getvalue(),
                        json.dumps(response),
                        web_server._exception_text(error),
                        traceback,
                    ]
                )
                for secret in (TOKEN, "renderToken", "127.0.0.1", "http://", "nobody planned"):
                    self.assertNotIn(secret, everything)
                logged = json.loads(stream.getvalue().strip().splitlines()[-1])
                self.assertEqual(logged["category"], category)
                self.assertEqual(logged["exit_code"], 1)
                self.assertEqual(response["error"]["params"], {"category": category})


class SandboxSwitchTests(unittest.TestCase):
    def test_off_disables_the_sandbox_and_warns_at_start(self):
        stream = io.StringIO()
        logger = StdlibStructuredLogger(name="quiltor.test.pdf.switch", stream=stream)
        with patch.dict(os.environ, {"QUILTOR_PDF_SANDBOX": "off"}):
            self.assertTrue(node_chromium.sandbox_disabled())
            self.assertTrue(pdf.warn_if_sandbox_disabled(logger))
        self.assertIn("pdf.sandbox_disabled", stream.getvalue())

    def test_without_the_switch_the_sandbox_stays_on_and_nothing_is_logged(self):
        stream = io.StringIO()
        logger = StdlibStructuredLogger(name="quiltor.test.pdf.switch2", stream=stream)
        for value in (None, "", "on", "0", "false"):
            with self.subTest(value=value):
                env = {} if value is None else {"QUILTOR_PDF_SANDBOX": value}
                with patch.dict(os.environ, env, clear=True):
                    self.assertFalse(node_chromium.sandbox_disabled())
                    self.assertFalse(pdf.warn_if_sandbox_disabled(logger))
        self.assertEqual(stream.getvalue(), "")

    def test_the_sidecar_honours_the_switch_and_defaults_to_the_sandbox(self):
        script = (
            Path(node_chromium.__file__).resolve().parents[2]
            / "resources"
            / "sidecars"
            / "pdf"
            / "render-book-pdf.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn("QUILTOR_PDF_SANDBOX", script)
        self.assertIn('!== "off"', script)
        self.assertIn("chromiumSandbox: sandbox", script)


if __name__ == "__main__":
    unittest.main()


def _alive(pid: int) -> bool:
    if os.name == "posix":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        # A killed child of ours may linger as a zombie until reaped; ask ps.
        state = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, check=False
        ).stdout.strip()
        return bool(state) and not state.startswith("Z")
    listing = (
        subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"],
            capture_output=True,
            text=True,
            errors="replace",
            check=False,
        ).stdout
        or ""
    )
    return f'"{pid}"' in listing


HANGING_RENDERER = """
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
// Stands in for Chromium, started the way Playwright starts it: detached, so it is
// in a process group of its own and outlives a plain kill of its parent.
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  detached: true,
});
writeFileSync(process.env.PID_FILE, `${process.pid} ${child.pid}`);
setInterval(() => {}, 1000);
"""


class HangingRendererTests(unittest.TestCase):
    """T-370: a renderer that never finishes ends at the limit, and leaves nothing running."""

    def test_a_hanging_renderer_ends_with_a_timeout_and_its_whole_tree_is_gone(self):
        import shutil
        import tempfile
        import time

        if shutil.which("node") is None:
            self.skipTest("node is not installed")
        with tempfile.TemporaryDirectory() as root:
            script = Path(root) / "hang.mjs"
            script.write_text(HANGING_RENDERER, encoding="utf-8")
            pid_file = Path(root) / "pids"
            rendered = node_chromium.renderer(script, Path(root))
            started = time.monotonic()
            with patch.dict(os.environ, {"PID_FILE": str(pid_file)}):
                with self.assertRaises(PdfRendererError) as caught:
                    rendered(URL, timeout=3)
            self.assertEqual(caught.exception.category, "timeout")
            self.assertLess(time.monotonic() - started, 15)
            pids = [int(pid) for pid in pid_file.read_text().split()]
            self.assertEqual(len(pids), 2)
            for _ in range(50):
                if not any(_alive(pid) for pid in pids):
                    break
                time.sleep(0.1)
            for pid in pids:
                self.assertFalse(_alive(pid), f"process {pid} survived the timeout")
