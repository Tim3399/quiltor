import threading
import time
import unittest
from unittest.mock import patch

from backend.llm import installer


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
