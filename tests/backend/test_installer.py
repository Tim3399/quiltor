import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.llm import installer


class _FakeResponse:
    """Minimal stand-in for the object urllib.request.urlopen()'s context manager
    yields -- just enough of the interface download() actually uses."""

    def __init__(self, body: bytes, status: int, content_length: int | None = None):
        self._remaining = body
        self.status = status
        self.headers = {
            "Content-Length": str(content_length if content_length is not None else len(body))
        }

    def read(self, n: int = -1) -> bytes:
        chunk, self._remaining = (
            self._remaining[:n] if n >= 0 else self._remaining,
            self._remaining[n:] if n >= 0 else b"",
        )
        return chunk

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class _FailingMidwayResponse:
    """Serves one chunk successfully, then raises -- simulates a dropped connection
    partway through a download, after some bytes have already reached disk."""

    def __init__(self, first_chunk: bytes, total_len: int):
        self._first_chunk = first_chunk
        self._served = False
        self.status = 200
        self.headers = {"Content-Length": str(total_len)}

    def read(self, n: int = -1) -> bytes:
        if not self._served:
            self._served = True
            return self._first_chunk
        raise ConnectionError("dropped")

    def __enter__(self) -> "_FailingMidwayResponse":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class DownloadResumeTest(unittest.TestCase):
    """download() used to always urlretrieve() from byte 0 -- for a multi-GB model
    download, an app closed (or a connection dropped) before it finished meant every
    later attempt silently redownloaded the whole thing again, forever. It now resumes
    a leftover .part file via an HTTP Range request instead.
    """

    def test_resumes_a_partial_download_via_range_request(self):
        full_content = b"x" * 30 + b"y" * 20
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "model.gguf"
            dest.with_name(dest.name + ".part").write_bytes(full_content[:30])
            remaining = full_content[30:]
            fake = _FakeResponse(remaining, status=206, content_length=len(remaining))
            requests: list[object] = []

            def fake_urlopen(request, timeout=30):
                requests.append(request)
                return fake

            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                installer.download("http://example.test/model.gguf", dest, "model.gguf")

            self.assertEqual(dest.read_bytes(), full_content)
            self.assertFalse(dest.with_name(dest.name + ".part").exists())
            self.assertEqual(dict(requests[0].header_items()).get("Range"), "bytes=30-")

    def test_restarts_clean_if_the_server_ignores_the_range_request(self):
        full_content = b"z" * 50
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "model.gguf"
            dest.with_name(dest.name + ".part").write_bytes(b"stale, unrelated leftover bytes")
            fake = _FakeResponse(full_content, status=200, content_length=len(full_content))

            with patch("urllib.request.urlopen", return_value=fake):
                installer.download("http://example.test/model.gguf", dest, "model.gguf")

            self.assertEqual(dest.read_bytes(), full_content)

    def test_keeps_the_partial_file_on_failure_so_a_retry_can_resume_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "model.gguf"
            partial = dest.with_name(dest.name + ".part")
            fake = _FailingMidwayResponse(b"partial-bytes-already-on-disk", total_len=1000)

            with patch("urllib.request.urlopen", return_value=fake):
                with self.assertRaises(ConnectionError):
                    installer.download("http://example.test/model.gguf", dest, "model.gguf")

            self.assertTrue(partial.exists())
            self.assertEqual(partial.read_bytes(), b"partial-bytes-already-on-disk")
            self.assertFalse(dest.exists())


class InstallAsyncTest(unittest.TestCase):
    """install_async() drives backend/llm/installer.py's real install() in a
    background thread -- these tests replace install() with a fake so nothing
    here touches the network or downloads anything.
    """

    def setUp(self):
        # Reset the module-level state a previous test (or a real run) may have
        # left behind, so tests don't depend on execution order.
        with installer._async_lock:
            installer._async_state.update(running=False, phase="", percent=0, error="")

    def test_reports_progress_and_completion(self):
        started_event = threading.Event()

        def fake_install(runtime, *, on_progress=None, **kwargs):
            started_event.set()
            if on_progress:
                on_progress("Runtime", 50)

        with patch.object(installer, "install", fake_install):
            self.assertTrue(installer.install_async("llamacpp"))
            self.assertTrue(started_event.wait(timeout=2), "background thread never started")
            self._wait_until_idle()

        state = installer.read_install_state()
        self.assertFalse(state["running"])
        self.assertEqual(state["percent"], 100)
        self.assertEqual(state["error"], "")

    def test_second_call_while_running_is_a_no_op(self):
        release = threading.Event()

        def blocking_install(runtime, *, on_progress=None, **kwargs):
            release.wait(timeout=2)

        with patch.object(installer, "install", blocking_install):
            self.assertTrue(installer.install_async("llamacpp"))
            self._wait_until_running()
            self.assertFalse(installer.install_async("llamacpp"))
            release.set()
            self._wait_until_idle()

    def test_failure_is_reported_without_crashing(self):
        def failing_install(runtime, *, on_progress=None, **kwargs):
            raise SystemExit("no network")

        with patch.object(installer, "install", failing_install):
            self.assertTrue(installer.install_async("llamacpp"))
            self._wait_until_idle()

        state = installer.read_install_state()
        self.assertFalse(state["running"])
        self.assertIn("no network", state["error"])

    def _wait_until_idle(self, timeout: float = 2.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not installer.read_install_state()["running"]:
                return
            time.sleep(0.02)
        self.fail("install_async() never finished")

    def _wait_until_running(self, timeout: float = 2.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if installer.read_install_state()["running"]:
                return
            time.sleep(0.02)
        self.fail("install_async() never started")


if __name__ == "__main__":
    unittest.main()
