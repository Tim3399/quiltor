"""T-268 audit D1: the HTTP edge (checklist 1.11, 1.12, 1.13, 1.16, 1.17).

CSRF guard on every write route, the 503 login page, what the log carries, cache
headers on answers with user data, and HEAD. Gap tests are `@unittest.expectedFailure`
and name S268-<n>.
"""

from __future__ import annotations

import base64
import os
import struct
import tempfile
import threading
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.delivery.http import routes as api_routes
from quiltor.hosts.web import server
from quiltor.infrastructure.identity.runtime import ProviderUnavailable
from tests.python.test_audit268_identity_support import (
    PUBLIC_URL,
    SESSION_COOKIE,
    HostedHarness,
    assistant_fakes,
    make_directories,
)

api_routes.load()


def _png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    rows = b"".join(b"\x00" + b"\x80\x80\x80" * 64 for _ in range(64))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


class CsrfGuardHostedTests(HostedHarness):
    """1.11, hosted: the public URL is the only origin a write may name."""

    def test_every_write_route_refuses_a_foreign_origin_before_anything_runs(self) -> None:
        session = self.login("alice", roles=("premium",))
        world = self.create_world(session)
        before = self.json_request(
            "GET", f"/api/manuscript?world={world}", cookies={SESSION_COOKIE: session}
        )[1]
        refused = 0
        for path in sorted(api_routes.SAVE):
            for origin in (
                "https://evil.example",
                "null",
                "http://quiltor.audit.test",
                "https://quiltor.audit.test:8443",
                "https://quiltor.audit.test.evil.example",
            ):
                with self.subTest(path=path, origin=origin):
                    status, document, _, _ = self.json_request(
                        "POST",
                        f"{path}?world={world}",
                        {"worldId": world, "id": world},
                        headers={"Origin": origin},
                        cookies={SESSION_COOKIE: session},
                    )
                    self.assertEqual(status, 403)
                    self.assertEqual(document["error"]["code"], "request.untrusted_origin")
                    refused += 1
        self.assertGreaterEqual(refused, 5 * 30)
        after = self.json_request(
            "GET", f"/api/manuscript?world={world}", cookies={SESSION_COOKIE: session}
        )[1]
        self.assertEqual(before, after)
        status, document, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: session}
        )
        self.assertEqual([w["id"] for w in document["worlds"]], [world])

    def test_the_public_origin_itself_passes_the_guard(self) -> None:
        session = self.login("alice")
        for origin in (PUBLIC_URL, PUBLIC_URL.upper(), "https://quiltor.audit.test:443"):
            status, _, _, _ = self.json_request(
                "POST",
                "/api/worlds/create",
                {"title": "W"},
                headers={"Origin": origin},
                cookies={SESSION_COOKIE: session},
            )
            self.assertEqual(status, 200, origin)

    def test_no_write_route_takes_a_body_a_cross_site_form_can_send(self) -> None:
        """Without an Origin header the guard is silent (curl, CLI); the content type is
        what stops forms. text/plain, urlencoded and multipart must never be a 2xx."""
        session = self.login("alice")
        world = self.create_world(session)
        types = (
            "text/plain",
            "application/x-www-form-urlencoded",
            "multipart/form-data; boundary=x",
        )
        skip = {"/logout"}  # needs no body; its effect is the subject of the next test
        for path in sorted(api_routes.SAVE):
            if path in skip:
                continue
            for content_type in types:
                with self.subTest(path=path, content_type=content_type):
                    status, _, _, _ = self.request(
                        "POST",
                        f"{path}?world={world}",
                        headers={"Content-Type": content_type},
                        cookies={SESSION_COOKIE: session},
                        raw=b'{"worldId": "%s", "title": "x"}' % world.encode(),
                    )
                    self.assertGreaterEqual(status, 400, f"{path} accepted {content_type}")
        status, document, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: session}
        )
        self.assertEqual(len(document["worlds"]), 1)

    def test_logout_with_a_foreign_origin_does_not_log_anybody_out(self) -> None:
        session = self.login("alice")
        status, _, _, _ = self.json_request(
            "POST",
            "/logout",
            {},
            headers={"Origin": "https://evil.example"},
            cookies={SESSION_COOKIE: session},
        )
        self.assertEqual(status, 403)
        self.assertIsNotNone(self.gateway.get_session(session))

    def test_get_routes_have_no_side_effect_a_navigation_could_trigger(self) -> None:
        """A cross-site top-level GET carries the Lax cookie. None of the GET routes writes
        a world, a backup or a document (device_sync ones are refused on a hosted server)."""
        session = self.login("alice")
        world = self.create_world(session)
        for path in sorted(api_routes.GET):
            if path in {"/login", "/auth/callback"}:
                continue
            status, _, _, _ = self.request(
                "GET", f"{path}?world={world}", cookies={SESSION_COOKIE: session}
            )
            self.assertNotEqual(status, 500, path)
        _, document, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: session}
        )
        self.assertEqual(len(document["worlds"]), 1)
        _, document, _, _ = self.json_request(
            "GET", "/api/worlds/trash", cookies={SESSION_COOKIE: session}
        )
        self.assertEqual(document["worlds"], [])
        for path in ("/backup/callback", "/api/backup/login"):
            self.assertEqual(
                self.request("GET", path, cookies={SESSION_COOKIE: session})[0], 403, path
            )


class CsrfGuardLoopbackTests(HostedHarness):
    """1.11, hosted app bound to loopback: Host and Origin must both be loopback."""

    host_binding = "127.0.0.1"

    def test_foreign_host_or_origin_is_refused_for_reads_and_writes(self) -> None:
        session = self.login("alice")
        for method, path in (("GET", "/api/worlds"), ("POST", "/api/worlds/create")):
            for headers in (
                {"Host": "evil.example"},
                {"Host": "127.0.0.1.evil.example"},
                {"Origin": "https://evil.example"},
                {"Origin": "null"},
                {"Origin": "http://localhost@evil.example"},
            ):
                with self.subTest(method=method, headers=headers):
                    status, _, _, _ = self.request(
                        method,
                        path,
                        {"title": "W"} if method == "POST" else None,
                        headers=headers,
                        cookies={SESSION_COOKIE: session},
                    )
                    self.assertEqual(status, 403)

    def test_loopback_names_pass_whatever_the_port(self) -> None:
        session = self.login("alice")
        status, _, _, _ = self.request(
            "GET",
            "/api/worlds",
            headers={"Host": "localhost:5173", "Origin": "http://localhost:5173"},
            cookies={SESSION_COOKIE: session},
        )
        self.assertEqual(status, 200)


class LocalServerTests(unittest.TestCase):
    """1.10 / 1.11 for the local single-user server with a master token."""

    TOKEN = "T" * 43

    def _start(self, host: str):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        env = patch.dict(os.environ, {"QUILTOR_HOST": host})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("QUILTOR_PUBLIC_URL", None)
        identity = build_identity(False, master_token=self.TOKEN)
        with patch(
            "quiltor.bootstrap.web.build_assistant_services", return_value=assistant_fakes()
        ):
            app = build_web_application(
                identity=identity, app_directories=make_directories(Path(self.temp.name))
            )
        app.prepare()
        httpd = server.Server(("127.0.0.1", 0), server.Handler, app)
        thread = threading.Thread(
            target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        thread.start()

        def stop() -> None:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
            app.close()

        self.addCleanup(stop)
        self.port = httpd.server_address[1]

    def _get(self, path: str, headers: dict[str, str] | None = None):
        import http.client

        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            connection.request("GET", path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_a_publicly_bound_local_server_wants_the_token_and_strips_it_from_the_url(self) -> None:
        self._start("0.0.0.0")
        self.assertEqual(self._get("/api/whoami")[0], 401)
        self.assertEqual(self._get("/api/whoami", {"Authorization": "Bearer wrong"})[0], 401)
        self.assertEqual(self._get("/api/whoami?token=wrong")[0], 401)
        status, headers, _ = self._get(f"/api/whoami?token={self.TOKEN}&x=1")
        self.assertEqual(status, 302)
        self.assertNotIn(self.TOKEN, headers["Location"])
        self.assertEqual(headers["Location"], "/api/whoami?x=1")
        self.assertEqual(
            self._get("/api/whoami", {"Authorization": f"Bearer {self.TOKEN}"})[0], 200
        )

    def test_a_wrong_bearer_does_not_fall_back_to_loopback_trust(self) -> None:
        self._start("127.0.0.1")
        self.assertEqual(self._get("/api/whoami")[0], 200)
        self.assertEqual(self._get("/api/whoami", {"Authorization": "Bearer wrong"})[0], 401)

    def test_login_routes_do_not_exist_on_a_single_user_server(self) -> None:
        self._start("127.0.0.1")
        for path in ("/login", "/auth/callback"):
            self.assertEqual(self._get(path)[0], 404, path)


class LoginErrorPageTests(HostedHarness):
    """1.12."""

    def test_the_503_page_reflects_nothing_and_carries_the_policy(self) -> None:
        with patch.object(self.gateway, "discover", side_effect=ProviderUnavailable("down")):
            status, headers, body, cookies = self.request(
                "GET",
                "/login?ui_locales=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&x=%3Cb%3E",
                headers={"Accept-Language": "<script>"},
            )
        self.assertEqual(status, 503)
        text = body.decode("utf-8")
        self.assertNotIn("<script", text)
        self.assertNotIn("alert", text)
        self.assertIn('lang="de"', text)
        self.assertEqual(headers["cache-control"], "no-store")
        self.assertTrue(
            "content-security-policy" in headers or "content-security-policy-report-only" in headers
        )
        self.assertEqual(cookies, [])

    def test_a_malformed_discovery_is_an_error_answer_not_a_traceback(self) -> None:
        with patch.object(self.gateway, "discover", side_effect=ValueError("secret detail")):
            status, _, body, _ = self.request("GET", "/login")
        self.assertGreaterEqual(status, 400)
        self.assertNotIn(b"secret detail", body)
        self.assertNotIn(b"Traceback", body)

    def test_the_auth_error_redirect_only_carries_fixed_codes(self) -> None:
        _location, _state, cookie = self.begin_login()
        for query in ("error=%3Cscript%3E", "code=x&state=%3Cscript%3E"):
            status, headers, _, _ = self.request(
                "GET", f"/auth/callback?{query}", cookies={"quiltor_login_state": cookie}
            )
            self.assertEqual(status, 302)
            self.assertIn(headers["location"], {"/?authError=provider", "/?authError=state"})


class AccessLogTests(HostedHarness):
    """1.13."""

    def test_no_secret_a_request_carries_reaches_the_log(self) -> None:
        canaries = ["CNRYa" + "x" * 30, "CNRYb" + "y" * 30, "CNRYc" + "z" * 30, "CNRYd" + "w" * 30]
        self.request(
            "GET",
            f"/auth/callback?code={canaries[0]}&state={canaries[1]}",
            cookies={"quiltor_login_state": canaries[1]},
        )
        self.request("GET", f"/api/state?renderToken={canaries[2]}&token={canaries[3]}")
        self.request(
            "GET",
            "/api/whoami",
            headers={"Authorization": f"Bearer {canaries[0]}"},
            cookies={SESSION_COOKIE: canaries[1]},
        )
        self.request("GET", f"/api/nothing-{canaries[2]}")
        text = self.log.text()
        for canary in canaries:
            self.assertNotIn(canary, text)
        self.assertTrue(any(r.get("event") == "http.access" for r in self.log.records))


class CacheHeaderTests(HostedHarness):
    """1.16."""

    def test_answers_with_user_data_are_not_stored(self) -> None:
        session = self.login("alice")
        world = self.create_world(session)
        cookies = {SESSION_COOKIE: session}
        for path in (
            "/api/state",
            "/api/manuscript",
            "/api/storyboards",
            "/api/history",
            "/api/backups",
            "/api/backups/location",
            "/api/assistant/logs",
            "/api/assistant/status",
        ):
            status, headers, _, _ = self.request("GET", f"{path}?world={world}", cookies=cookies)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers["cache-control"], "no-store", path)
        for path in (
            "/api/worlds",
            "/api/worlds/trash",
            "/api/whoami",
            "/api/capabilities",
            "/api/diagnostics",
            f"/api/project-transfer/export?world={world}",
        ):
            status, headers, _, _ = self.request("GET", path, cookies=cookies)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers["cache-control"], "no-store", path)
        status, headers, _, _ = self.request("GET", "/api/whoami")
        self.assertEqual(headers["cache-control"], "no-store", "the 401 too")

    def _upload_map(self, session: str, world: str) -> str:

        status, document, _, _ = self.json_request(
            "POST",
            f"/api/place-maps?world={world}",
            {"data": base64.b64encode(_png()).decode("ascii")},
            cookies={SESSION_COOKIE: session},
        )
        self.assertEqual(status, 201, document)
        return document["id"]

    def test_a_map_image_is_private_nosniff_and_sandboxed(self) -> None:
        session = self.login("alice")
        world = self.create_world(session)
        image = self._upload_map(session, world)
        status, headers, _, _ = self.request(
            "GET", f"/api/place-map?world={world}&id={image}", cookies={SESSION_COOKIE: session}
        )
        self.assertEqual(status, 200)
        self.assertIn("private", headers["cache-control"])
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertIn("sandbox", headers["content-security-policy"])

    @unittest.expectedFailure
    def test_a_map_image_is_not_kept_for_a_year_in_the_browser(self) -> None:
        """S268-7: `max-age=31536000, immutable` keeps a user's map in the browser cache
        past logout; a shared computer's next user is served it without the server asking."""
        session = self.login("alice")
        world = self.create_world(session)
        image = self._upload_map(session, world)
        _, headers, _, _ = self.request(
            "GET", f"/api/place-map?world={world}&id={image}", cookies={SESSION_COOKIE: session}
        )
        self.assertNotIn("immutable", headers["cache-control"])

    def test_a_map_image_of_another_world_is_not_served(self) -> None:
        alice, bob = self.login("alice"), self.login("bob")
        world = self.create_world(alice)
        image = self._upload_map(alice, world)
        bobs = self.create_world(bob)
        status, _, _, _ = self.request(
            "GET", f"/api/place-map?world={bobs}&id={image}", cookies={SESSION_COOKIE: bob}
        )
        self.assertGreaterEqual(status, 400)
        status, _, _, _ = self.request(
            "GET", f"/api/place-map?world={world}&id={image}", cookies={SESSION_COOKIE: bob}
        )
        self.assertEqual(status, 403)


class HeadRequestTests(HostedHarness):
    """1.17: `Handler` has no `do_HEAD` of its own; SimpleHTTPRequestHandler's answers."""

    def test_head_never_returns_api_data_or_metadata(self) -> None:
        session = self.login("alice")
        world = self.create_world(session)
        for path in (
            f"/api/state?world={world}",
            "/api/worlds",
            "/api/whoami",
            "/login",
            "/logout",
        ):
            for cookies in (None, {SESSION_COOKIE: session}):
                status, headers, body, set_cookies = self.request("HEAD", path, cookies=cookies)
                self.assertEqual(status, 404, path)
                self.assertEqual(body, b"")
                self.assertNotIn("etag", headers)
                self.assertEqual(set_cookies, [])

    def test_head_of_the_app_shell_equals_the_unauthenticated_get(self) -> None:
        head = self.request("HEAD", "/")
        get = self.request("GET", "/")
        self.assertEqual(head[0], get[0])
        self.assertEqual(head[1]["content-length"], str(len(get[2])))

    def test_head_cannot_leave_the_client_directory(self) -> None:
        for path in (
            "/../pyproject.toml",
            "/%2e%2e/pyproject.toml",
            "/..%5cpyproject.toml",
            "/data/worlds",
            "/src/quiltor/hosts/web/server.py",
        ):
            status, headers, body, _ = self.request("HEAD", path)
            self.assertEqual(body, b"")
            if status == 301:
                # A skipped `..` leaves the client root itself, which gets its trailing slash.
                # The target must stay a single-slash path on this origin.
                target = headers["location"]
                self.assertTrue(target.startswith("/") and not target.startswith("//"), target)
            else:
                self.assertEqual(status, 404, path)

    def test_head_redeems_no_render_token_and_sets_no_session(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        self.application.render_pdf = lambda target: b"%PDF"
        token = self.application.issue_render_token("alice")
        _status, _, _, cookies = self.request("HEAD", f"/?world={world}&renderToken={token}")
        self.assertEqual(cookies, [])
        self.assertEqual(
            self.request("GET", f"/api/state?world={world}&renderToken={token}")[0], 200
        )

    @unittest.expectedFailure
    def test_head_passes_the_same_guard_as_get(self) -> None:
        """S268-8: HEAD skips `_dispatch`: no session check (404 where GET says 401), no
        Host/Origin guard, and no access-log line."""
        status, _, _, _ = self.request("HEAD", "/api/worlds")
        self.assertEqual(status, 401)

    @unittest.expectedFailure
    def test_head_is_logged_like_every_other_request(self) -> None:
        """S268-8: a scan by HEAD leaves no trace in the access log."""
        before = len([r for r in self.log.records if r.get("event") == "http.access"])
        self.request("HEAD", "/api/worlds")
        after = len([r for r in self.log.records if r.get("event") == "http.access"])
        self.assertEqual(after, before + 1)

    def test_head_skips_the_host_guard_on_a_loopback_bound_server_but_only_for_public_files(
        self,
    ) -> None:
        status, _, _, _ = self.request("HEAD", "/", headers={"Host": "evil.example"})
        self.assertEqual(status, 200, "the shell is public in a hosted server anyway")


if __name__ == "__main__":
    unittest.main()
