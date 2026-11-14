"""T-269 phase 2, package C: evidence for the local server and the desktop host.

Audit only. Nothing here fixes anything. A passing test pins a property the
audit found intact ("checked, no finding"); a test marked `expectedFailure`
records a gap with its finding id (S269-n in implementer/T-269-audit-client.md)
and turns into an unexpected success -- a red run -- once the gap is closed, so
whoever fixes it in phase 4 drops the marker in the same change.
"""

import base64
import http.client
import io
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import LOOPBACK_HOSTS, build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.bootstrap.web import DESKTOP, HOSTED, LOCAL, content_security_policy, csp_mode
from quiltor.hosts.desktop import app as desktop_app
from quiltor.hosts.desktop.bridge import BRIDGE_VERSION, FILE_SAVE, NativeBridge
from quiltor.hosts.web import server
from quiltor.infrastructure.platform.ports import AppDirectories
from quiltor.modules.identity.service import LocalIdentity
from tests.python import test_backup_routes as backup_routes
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

    def test_s269_1_hosted_enforces_without_any_variable(self):
        """S269-1, D-198: the default comes from the operation profile, not from the infra."""
        self.assertEqual(csp_mode("", HOSTED), "enforce")
        # The documented way out in docker-compose.yml stays open.
        self.assertEqual(csp_mode("report-only", HOSTED), "report-only")

    def test_s269_1_a_web_instance_without_identity_enforces_by_default(self):
        """S269-1, D-198: local and self-hosted enforce; report-only stays the way out."""
        self.assertEqual(csp_mode("", LOCAL), "enforce")
        self.assertEqual(csp_mode("report-only", LOCAL), "report-only")

    def test_s269_1_the_desktop_window_stays_report_only(self):
        """D-207: under enforce WKWebView refuses pywebview's evaluate_js, and with it the bridge
        (CI run 43605654505). Turning the desktop to enforce needs a bridge without eval first."""
        self.assertEqual(csp_mode("", DESKTOP), "report-only")


class ResponseHeaderTests(_LocalServer):
    """5.4"""

    def test_json_answers_are_never_cached(self):
        status, headers, _ = self._get("/api/worlds")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-store")

    def test_s269_2_the_page_cannot_be_framed_by_another_site(self):
        """S269-2: X-Frame-Options on every page, whatever the CSP mode (test_server_csp)."""
        status, headers, _ = self._get("/")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("X-Frame-Options"), "DENY")

    def test_json_answers_carry_no_frame_header(self):
        """Only pages can be framed; the header stays where it means something."""
        _, headers, _ = self._get("/api/worlds")
        self.assertNotIn("X-Frame-Options", headers)


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
    """6.3, S269-4: the desktop window and `quiltor run` prove the owner with the token."""

    def setUp(self):
        super().setUp()
        identity = cast(LocalIdentity, self.application.identity)
        identity.require_token()
        self.token = identity.token

    def _cookie_from(self, headers: dict[str, str]) -> str:
        cookie = headers.get("Set-Cookie", "")
        self.assertIn("quiltor_session=", cookie)
        return cookie.split(";", 1)[0]

    def test_s269_4_a_request_without_origin_or_token_gets_no_session(self):
        """Another OS account reaches the same port; it no longer gets the owner's worlds."""
        for path in ("/api/worlds", "/"):
            with self.subTest(path=path):
                status, headers, _ = self._get(path)
                self.assertIn(status, (401, 403))
                self.assertNotIn("Set-Cookie", headers)

    def test_a_wrong_token_gets_no_session(self):
        status, headers, _ = self._get("/?token=falsch")
        self.assertIn(status, (401, 403))
        self.assertNotIn("Set-Cookie", headers)

    def test_the_own_window_trades_its_token_for_a_session(self):
        """The window opens owner_url(): one redirect sets the cookie, then it works."""
        status, headers, _ = self._get(f"/?token={self.token}")
        self.assertEqual(status, 302)
        self.assertEqual(headers.get("Location"), "/")
        cookie = self._cookie_from(headers)
        status, _, _ = self._get("/api/worlds", {"Cookie": cookie})
        self.assertEqual(status, 200)

    def test_scripts_with_the_bearer_token_still_work(self):
        status, _, _ = self._get("/api/worlds", {"Authorization": f"Bearer {self.token}"})
        self.assertEqual(status, 200)


class OwnerRoleTests(unittest.TestCase):
    """S269-4: which process gives up loopback trust is decided by its role."""

    def _identity_for(self, role: str | None):
        environment = {"QUILTOR_RUNTIME_HOST": role} if role else {}
        with (
            tempfile.TemporaryDirectory() as temp,
            patch.dict(os.environ, environment),
            patch(
                "quiltor.bootstrap.web.build_assistant_services",
                return_value=AssistantServices(MagicMock(), MagicMock()),
            ),
        ):
            if not role:
                os.environ.pop("QUILTOR_RUNTIME_HOST", None)
            application = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                app_directories=_directories(Path(temp)),
            )
            application.close()
            return cast(LocalIdentity, application.identity)

    def test_the_desktop_and_quiltor_run_require_the_token(self):
        for role in ("desktop", "cli"):
            with self.subTest(role=role):
                self.assertFalse(self._identity_for(role).trust_loopback)

    def test_the_source_checkout_server_keeps_loopback_trust(self):
        self.assertTrue(self._identity_for("server").trust_loopback)

    def test_quiltor_run_opens_the_browser_with_the_token_and_never_prints_it(self):
        identity = SimpleNamespace(multi_user=False, trust_loopback=False, token="geheim/1")
        app = MagicMock(identity=identity)
        opened: list[str] = []

        class Timer:
            def __init__(self, _delay, callback):
                self.callback = callback

            def start(self):
                self.callback()

        printed = io.StringIO()
        httpd = MagicMock()
        httpd.__enter__.return_value.serve_forever.side_effect = KeyboardInterrupt
        with (
            patch.object(server, "Server", return_value=httpd),
            patch.object(server.threading, "Timer", Timer),
            patch.object(server.webbrowser, "open", opened.append),
            redirect_stdout(printed),
        ):
            server.run(port=8000, no_open=False, application=app)
        self.assertEqual(opened, ["http://localhost:8000/?token=geheim%2F1"])
        self.assertNotIn("geheim", printed.getvalue())


class OwnerSessionRenewalTests(unittest.TestCase):
    """Without loopback trust the cookie is the window's only proof, and it must not lapse."""

    def setUp(self):
        from quiltor.modules.identity.auth import SessionData

        self.SessionData = SessionData
        self.auth = MagicMock(session_ttl=86_400)
        self.auth.create_session.return_value = "neu"
        self.auth.get_session.side_effect = lambda value: (
            self.session if value == "alt" else self.fresh if value == "neu" else None
        )
        self.fresh = SessionData("owner", "", "", time.time(), time.time() + 86_400)
        owner_store = SimpleNamespace(local_owner_id="owner")
        self.identity = LocalIdentity(cast(Any, owner_store), self.auth, MagicMock(), "token")
        self.identity.require_token()
        self.handler = SimpleNamespace(
            get_cookie=lambda _name: "alt",
            _pending_cookies=[],
            cookie_header=lambda name, value, max_age: ("Set-Cookie", f"{name}={value}"),
            headers={},
            path="/api/worlds",
        )

    def _resolve(self, created_ago: float, left: float, sub: str = "owner"):
        now = time.time()
        self.session = self.SessionData(sub, "", "", now - created_ago, now + left)
        return self.identity.resolve(self.handler)

    def test_a_session_in_its_second_half_is_renewed(self):
        self.assertIs(self._resolve(80_000, 6_400), self.fresh)
        self.assertEqual(self.handler._pending_cookies, [("Set-Cookie", "quiltor_session=neu")])

    def test_a_session_in_its_first_half_is_kept(self):
        self._resolve(1_000, 85_400)
        self.auth.create_session.assert_not_called()

    def test_a_render_session_stays_short(self):
        self._resolve(10, 50)
        self.auth.create_session.assert_not_called()

    def test_another_subject_is_never_renewed(self):
        self._resolve(80_000, 6_400, sub="someone-else")
        self.auth.create_session.assert_not_called()


class BackupCallbackTests(backup_routes.BackupRouteTestCase):
    """D-203: the callback is anonymous and bound only to the state of a login this
    process began -- the desktop login returns in the system browser, without a cookie."""

    NEUTRAL = "Bitte starte die Anmeldung in Quiltor noch einmal."

    def identity(self):
        identity = cast(LocalIdentity, build_identity(False))
        identity.require_token()
        return identity

    def _owner(self) -> dict[str, str]:
        status, headers, _ = self.request(
            "GET", f"/api/version?token={cast(LocalIdentity, self.app.identity).token}"
        )
        self.assertEqual(status, 302)
        name, value = headers["Set-Cookie"].split(";", 1)[0].split("=", 1)
        return {name: value}

    def _start(self) -> str:
        status, _, raw = self.request("POST", "/api/backup/login", body={}, cookies=self._owner())
        self.assertEqual(status, 200, raw[:300])
        return json.loads(raw)["authorizeUrl"]

    def _begin(self) -> tuple[str, str]:
        return self.issuer.authorize(self._start())

    def _callback(self, query: str):
        return self.request("GET", f"/backup/callback{query}")

    def _signed_in(self) -> bool:
        status, _, raw = self.request("GET", "/api/backup/login", cookies=self._owner())
        self.assertEqual(status, 200)
        return json.loads(raw)["signedIn"]

    def test_the_system_browser_completes_the_login_without_a_session(self):
        code, state = self._begin()
        status, headers, raw = self._callback(f"?code={code}&state={state}")
        self.assertEqual(status, 200)
        self.assertIn("Anmeldung abgeschlossen", raw.decode("utf-8"))
        self.assertNotIn("Set-Cookie", headers, "the callback creates no session")
        self.assertTrue(self._signed_in())

    def test_every_refusal_is_the_same_neutral_page(self):
        code, _state = self._begin()
        answers = {
            "no state": self._callback(f"?code={code}"),
            "wrong state": self._callback(f"?code={code}&state=erfunden"),
            "provider error": self._callback("?error=access_denied&state=x"),
        }
        bodies = set()
        for reason, (status, headers, raw) in answers.items():
            with self.subTest(reason=reason):
                self.assertEqual(status, 400)
                self.assertIn(self.NEUTRAL, raw.decode("utf-8"))
                self.assertNotIn("Set-Cookie", headers)
                bodies.add(raw)
        self.assertEqual(len(bodies), 1, "the page must not tell the reasons apart")
        self.assertFalse(self._signed_in())

    def test_a_state_works_once(self):
        """A second code for the same state -- a fresh one, so the provider would take it --
        is refused: the state was used up by the first callback."""
        authorize_url = self._start()
        code, state = self.issuer.authorize(authorize_url)
        second_code, same_state = self.issuer.authorize(authorize_url)
        self.assertEqual(state, same_state)
        self.assertEqual(self._callback(f"?code={code}&state={state}")[0], 200)
        status, _, raw = self._callback(f"?code={second_code}&state={state}")
        self.assertEqual(status, 400)
        self.assertIn(self.NEUTRAL, raw.decode("utf-8"))

    def test_a_state_past_its_ttl_is_refused(self):
        login = backup_routes.backup_login
        code, state = self._begin()
        started = time.time()
        login._clock = lambda: started + login.PENDING_TTL + 1
        status, _, raw = self._callback(f"?code={code}&state={state}")
        self.assertEqual(status, 400)
        self.assertIn(self.NEUTRAL, raw.decode("utf-8"))
        self.assertFalse(self._signed_in())


class DesktopBindingTests(unittest.TestCase):
    """6.1"""

    def test_the_window_loads_the_loopback_address_with_the_process_token(self):
        identity = SimpleNamespace(token="a/b+c")
        self.assertEqual(
            desktop_app.owner_url(8843, identity), "http://127.0.0.1:8843/?token=a%2Fb%2Bc"
        )
        source = Path(desktop_app.__file__).read_text(encoding="utf-8")
        self.assertIn("owner_url(port, web_application.identity)", source)

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
