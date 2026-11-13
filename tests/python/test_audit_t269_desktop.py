"""T-269 phase 2, package C: evidence for the local server and the desktop host.

Audit only. Nothing here fixes anything. A passing test pins a property the
audit found intact ("checked, no finding"); a test marked `expectedFailure`
records a gap with its finding id (S269-n in implementer/T-269-audit-client.md)
and turns into an unexpected success -- a red run -- once the gap is closed, so
whoever fixes it in phase 4 drops the marker in the same change.
"""

import base64
import http.client
import os
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import LOOPBACK_HOSTS, build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.bootstrap.web import content_security_policy, csp_mode
from quiltor.hosts.desktop import app as desktop_app
from quiltor.hosts.desktop.bridge import BRIDGE_VERSION, FILE_SAVE, NativeBridge
from quiltor.hosts.web import server
from quiltor.infrastructure.platform.ports import AppDirectories
from tests.python.request_timeout import REQUEST_TIMEOUT


def _directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root,
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


class _LocalServer(unittest.TestCase):
    """A real loopback server with the local identity and the default CSP mode."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        environment = patch.dict(
            os.environ,
            {
                "QUILTOR_HOST": "127.0.0.1",
                "QUILTOR_PUBLIC_URL": "",
                "QUILTOR_CSP": "",
                "QUILTOR_CSP_CONNECT_EXTRA": "",
                "QUILTOR_TEST_HOOKS": "",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        with patch(
            "quiltor.bootstrap.web.build_assistant_services",
            return_value=AssistantServices(MagicMock(), MagicMock()),
        ):
            self.application = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                app_directories=_directories(Path(self.temp.name)),
            )
        self.application.prepare()
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(
            target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.application.close()
        self.temp.cleanup()

    def _get(self, path: str, headers: dict[str, str] | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=REQUEST_TIMEOUT)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        answer = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return answer

    def _raw_status(self, request: bytes) -> int:
        with socket.create_connection(("127.0.0.1", self.port), timeout=REQUEST_TIMEOUT) as raw:
            raw.sendall(request)
            head = raw.recv(64)
        return int(head.split(b" ", 2)[1])


class ContentSecurityPolicyTests(unittest.TestCase):
    """5.3"""

    def test_the_design_gallery_extra_never_reaches_the_server_policy(self):
        for mode in ("enforce", "report-only"):
            for hooks in (False, True):
                with self.subTest(mode=mode, test_hooks=hooks):
                    policy = content_security_policy(mode, test_hooks=hooks)
                    assert policy is not None
                    script_src = next(
                        part for part in policy[1].split("; ") if part.startswith("script-src ")
                    )
                    self.assertNotIn("'unsafe-inline'", script_src)
                    self.assertNotIn("'unsafe-eval'", script_src)

    def test_connect_extra_refuses_wildcards_and_plain_http(self):
        from quiltor.bootstrap.web import csp_connect_extra

        for origin in ("https://*.example.com", "http://example.com", "https://a.example/p", "*"):
            with self.subTest(origin=origin), self.assertRaises(RuntimeError):
                csp_connect_extra(origin)

    @unittest.expectedFailure
    def test_s269_1_an_unconfigured_instance_enforces_its_policy(self):
        """S269-1: QUILTOR_CSP unset means report-only, for hosted as well."""
        self.assertEqual(csp_mode(""), "enforce")


class ResponseHeaderTests(_LocalServer):
    """5.4"""

    def test_json_answers_are_never_cached(self):
        status, headers, _ = self._get("/api/worlds")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-store")

    @unittest.expectedFailure
    def test_s269_2_the_page_cannot_be_framed_by_another_site(self):
        """S269-2: frame-ancestors is only reported, and no X-Frame-Options is sent."""
        status, headers, _ = self._get("/")
        self.assertEqual(status, 200)
        enforced = headers.get("Content-Security-Policy", "")
        self.assertTrue(
            "frame-ancestors 'none'" in enforced or headers.get("X-Frame-Options") == "DENY",
            headers,
        )


class HostGuardTests(_LocalServer):
    """6.2: DNS rebinding."""

    def test_foreign_and_lookalike_hosts_are_refused(self):
        for host in (
            "evil.test",
            f"127.0.0.1.nip.io:{self.port}",
            f"localhost.:{self.port}",
            f"LOCALHOST:{self.port}",
            f"[::ffff:127.0.0.1]:{self.port}",
        ):
            with self.subTest(host=host):
                status, _, _ = self._get("/api/version", {"Host": host})
                self.assertEqual(status, 403)

    def test_loopback_hosts_pass(self):
        for host in (f"127.0.0.1:{self.port}", f"localhost:{self.port}", f"[::1]:{self.port}"):
            with self.subTest(host=host):
                status, _, _ = self._get("/api/version", {"Host": host})
                self.assertEqual(status, 200)

    def test_a_missing_host_header_passes_but_no_browser_sends_one(self):
        """Recorded, not a finding: every browser request carries Host."""
        status = self._raw_status(b"GET /api/version HTTP/1.0\r\n\r\n")
        self.assertEqual(status, 200)


class LocalProcessTests(_LocalServer):
    """6.3: another process on this machine."""

    @unittest.expectedFailure
    def test_s269_4_a_request_without_origin_or_token_gets_no_session(self):
        """S269-4: whoever reaches the loopback port is the owner, other OS users too."""
        status, _, _ = self._get("/api/worlds")
        self.assertIn(status, (401, 403))


class DesktopBindingTests(unittest.TestCase):
    """6.1"""

    def test_the_window_loads_the_loopback_address(self):
        source = Path(desktop_app.__file__).read_text(encoding="utf-8")
        self.assertIn('f"http://127.0.0.1:{port}/"', source)

    def test_the_port_probe_binds_loopback(self):
        bound: list[tuple[str, int]] = []

        class Probe:
            def __init__(self, *_args):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def bind(self, address):
                bound.append(address)

            def getsockname(self):
                return ("127.0.0.1", 8000)

        with patch.object(desktop_app.socket, "socket", Probe):
            desktop_app._free_port()
        self.assertEqual(bound[0][0], "127.0.0.1")

    @unittest.expectedFailure
    def test_s269_3_the_desktop_binds_loopback_whatever_the_environment_says(self):
        """S269-3: the desktop hands server.run an inherited QUILTOR_HOST unchecked."""

        class Started(Exception):
            pass

        class Thread:
            def __init__(self, **_kwargs):
                pass

            def start(self):
                raise Started

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dirs = SimpleNamespace(data=root / "data", logs=root / "logs")
            with (
                patch.dict(os.environ, {"QUILTOR_HOST": "0.0.0.0"}),
                patch.object(desktop_app, "_redirect_null_streams", return_value=False),
                patch.object(desktop_app.directories, "current") as current,
                patch.object(desktop_app, "_free_port", return_value=1),
                patch.object(desktop_app.threading, "Thread", Thread),
                patch("quiltor.hosts.web.server.build_web_application"),
                patch("quiltor.infrastructure.pdf.desktop_renderer"),
            ):
                current.return_value.ensure.return_value = dirs
                with self.assertRaises(Started):
                    desktop_app.main()
                host = os.environ.get("QUILTOR_HOST", "127.0.0.1")
        self.assertIn(host, LOOPBACK_HOSTS)


class NativeBridgeTests(unittest.TestCase):
    """6.4"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / "chosen.pdf"
        capabilities = MagicMock()
        capabilities.is_available.return_value = True
        self.bridge = NativeBridge(capabilities, directory=Path(self.temp.name))
        self.asked: list[str] = []

        def choose(name: str):
            self.asked.append(name)
            return str(self.target)

        self.bridge.choose_path = choose  # type: ignore[method-assign]

    def _save(self, name: str):
        return self.bridge.invoke(
            {
                "version": BRIDGE_VERSION,
                "id": "audit",
                "operation": FILE_SAVE,
                "payload": {
                    "name": name,
                    "content": base64.b64encode(b"x").decode("ascii"),
                    "encoding": "base64",
                },
            }
        )

    def test_names_with_a_path_never_reach_the_dialog(self):
        self.bridge.attach(SimpleNamespace())
        for name in ("..\\evil.exe", "../evil.sh", "C:\\Windows\\evil.dll", "/etc/x", "a\0b"):
            with self.subTest(name=name):
                answer = self._save(name)
                self.assertFalse(answer["ok"])
                self.assertEqual(answer["error"]["code"], "file.invalid_payload")
        self.assertEqual(self.asked, [])

    def test_a_bare_dot_dot_only_suggests_a_name_and_the_dialog_decides(self):
        self.bridge.attach(SimpleNamespace())
        answer = self._save("..")
        self.assertTrue(answer["ok"])
        self.assertEqual(self.asked, [".."])
        self.assertEqual(self.target.read_bytes(), b"x")

    def test_only_invoke_is_published_to_the_page(self):
        published = {
            name
            for name in dir(NativeBridge)
            if not name.startswith("_")
            and getattr(getattr(NativeBridge, name), "_serializable", True)
        }
        self.assertEqual(published, {"invoke"})

    @unittest.expectedFailure
    def test_s269_5_a_page_on_a_foreign_origin_cannot_use_the_bridge(self):
        """S269-5: invoke never asks which page is calling."""
        self.bridge.attach(SimpleNamespace(get_current_url=lambda: "https://evil.example/"))
        answer = self._save("book.pdf")
        self.assertFalse(answer["ok"])


if __name__ == "__main__":
    unittest.main()
