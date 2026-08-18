import base64
import http.client
import json
import tempfile
import threading
import time
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

from backend import auth, identity
from backend.core import storage
from backend.pdf import tokens as render
import server


def _make_id_token(claims: dict) -> str:
    def b64(segment: dict) -> str:
        return (
            base64.urlsafe_b64encode(json.dumps(segment).encode("utf-8"))
            .rstrip(b"=")
            .decode("ascii")
        )

    return f"{b64({'alg': 'RS256'})}.{b64(claims)}.signature-not-checked"


def _cookie_name_value(set_cookie_header: str) -> tuple[str, str]:
    first = set_cookie_header.split(";", 1)[0]
    name, value = first.split("=", 1)
    return name, value


class _LiveAuthServerTestCase(unittest.TestCase):
    """Base class only — no test_* methods here, so it contributes no tests of its
    own. Spins up a real server.Server with the OIDC identity installed and
    Keycloak mocked at the auth.discover/auth.exchange_code boundary; subclasses
    add tests that share this fixture via self._request/self._login."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_storage = (
            storage.DATA,
            storage.DB,
            storage.BACKUPS,
            storage.WORLDS,
            storage.ACTIVE_WORLD_ID,
        )
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""

        self.original_identity = server.IDENTITY
        server.IDENTITY = identity.OidcIdentity()
        self.original_issuer_config = (auth.ISSUER, auth.CLIENT_ID, auth.CLIENT_SECRET)
        auth.ISSUER = "https://kc.example.com/realms/quiltor"
        auth.CLIENT_ID = "quiltor-demo"
        auth.CLIENT_SECRET = "s3cret"
        auth._discovery_cache.clear()
        auth.SESSIONS.clear()
        auth.PENDING_LOGINS.clear()
        render._tokens.clear()

        self.discovery = {
            "authorization_endpoint": "https://kc.example.com/auth",
            "token_endpoint": "https://kc.example.com/token",
        }
        self.discover_patch = patch.object(auth, "discover", return_value=self.discovery)
        self.discover_patch.start()

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.discover_patch.stop()
        server.IDENTITY = self.original_identity
        auth.ISSUER, auth.CLIENT_ID, auth.CLIENT_SECRET = self.original_issuer_config
        auth._discovery_cache.clear()
        auth.SESSIONS.clear()
        auth.PENDING_LOGINS.clear()
        render._tokens.clear()
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = (
            self.original_storage
        )
        self.temp.cleanup()

    def _request(self, method: str, path: str, body=None, headers=None, cookies=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = dict(headers or {})
        if cookies:
            hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        data = json.dumps(body).encode("utf-8") if body is not None else None
        if data is not None:
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        response_headers = resp.getheaders()
        set_cookies = [v for k, v in response_headers if k.lower() == "set-cookie"]
        conn.close()
        return resp.status, dict(response_headers), raw, set_cookies

    def _login(self, sub: str, email: str = "user@example.com", name: str = "Tester") -> str:
        status, headers, _, set_cookies = self._request("GET", "/login")
        self.assertEqual(status, 302)
        login_state_cookie = next(c for c in set_cookies if c.startswith("quiltor_login_state="))
        _, state_cookie_value = _cookie_name_value(login_state_cookie)
        location = headers["Location"]
        state = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)["state"][0]
        self.assertEqual(state, state_cookie_value)

        claims = {
            "sub": sub,
            "email": email,
            "name": name,
            "iss": auth.ISSUER,
            "aud": auth.CLIENT_ID,
            "exp": time.time() + 300,
        }
        id_token = _make_id_token(claims)
        with patch.object(
            auth, "exchange_code", return_value={"id_token": id_token, "access_token": "at"}
        ):
            status, headers, _, set_cookies = self._request(
                "GET",
                f"/auth/callback?code=abc&state={state}",
                cookies={"quiltor_login_state": state_cookie_value},
            )
        self.assertEqual(status, 302)
        session_cookie = next(c for c in set_cookies if c.startswith("quiltor_session="))
        _, session_value = _cookie_name_value(session_cookie)
        return session_value


class ServerAuthRouteTests(_LiveAuthServerTestCase):
    """Exercises /login, /auth/callback, /logout, /api/whoami, and per-user world
    isolation against a real server.Server, following the pattern in
    test_server_assistant.py (real HTTP requests to a background-thread server)."""

    # ---------- Unauthenticated access ----------

    def test_unauthenticated_root_loads_the_app_shell(self):
        """No session, no API route -- the app shell itself (dist/index.html)
        is not gated, so React gets to run and show its own sign-in screen
        (SignInGate) instead of the browser bouncing to Keycloak before a
        single line of app code executes. See _dispatch's `registration is
        None and IDENTITY.multi_user` branch."""
        status, headers, _, _ = self._request("GET", "/")
        self.assertEqual(status, 200)
        content_type = next(v for k, v in headers.items() if k.lower() == "content-type")
        self.assertIn("text/html", content_type)

    def test_unauthenticated_api_call_gets_401_json_not_a_redirect(self):
        status, _, body, _ = self._request("GET", "/api/worlds")
        self.assertEqual(status, 401)
        self.assertFalse(json.loads(body)["ok"])

    # ---------- Login flow ----------

    def test_login_sets_a_state_cookie_matching_the_redirect_url(self):
        status, headers, _, set_cookies = self._request("GET", "/login")
        self.assertEqual(status, 302)
        self.assertTrue(headers["Location"].startswith("https://kc.example.com/auth?"))
        self.assertIn("code_challenge_method=S256", headers["Location"])
        self.assertTrue(any(c.startswith("quiltor_login_state=") for c in set_cookies))

    def test_callback_with_mismatched_state_is_rejected_without_creating_a_session(self):
        """Sent back to the app, not a JSON dead end -- SignInGate reads
        ?authError off the URL and shows something to read and a retry."""
        status, _, _, set_cookies = self._request("GET", "/login")
        login_state_cookie = next(c for c in set_cookies if c.startswith("quiltor_login_state="))
        _, cookie_value = _cookie_name_value(login_state_cookie)
        status, headers, _, _ = self._request(
            "GET",
            "/auth/callback?code=abc&state=wrong-state",
            cookies={"quiltor_login_state": cookie_value},
        )
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/?authError=state")
        self.assertEqual(len(auth.SESSIONS), 0)

    def test_callback_with_a_provider_error_redirects_with_a_reason(self):
        status, headers, _, _ = self._request("GET", "/auth/callback?error=access_denied")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/?authError=provider")

    def test_login_then_whoami_returns_the_session_identity(self):
        session_value = self._login("user-alice", email="alice@example.com", name="Alice")
        status, _, body, _ = self._request(
            "GET", "/api/whoami", cookies={"quiltor_session": session_value}
        )
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["sub"], "user-alice")
        self.assertEqual(payload["email"], "alice@example.com")

    def test_the_session_keeps_the_tokens_the_provider_handed_back(self):
        """The hosted deployment's backup endpoint is guarded by this very
        issuer, so the access token that just arrived is the one that endpoint
        wants. Kept on the session, it is what server._backup_token hands to the
        uploader -- and why a hosted user never meets a second login."""
        session_value = self._login("user-alice")
        session = auth.get_session(session_value)
        self.assertEqual(session.access_token, "at")
        self.assertEqual(
            session.refresh_token,
            "",
            "the exchange returned none, and inventing one would be a lie",
        )

    def test_logout_clears_the_session(self):
        session_value = self._login("user-alice")
        status, _, body, _ = self._request(
            "POST", "/logout", body={}, cookies={"quiltor_session": session_value}
        )
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        status, _, body, _ = self._request(
            "GET", "/api/whoami", cookies={"quiltor_session": session_value}
        )
        # /api/whoami is no longer anonymous: with the session gone, the request
        # has no identity at all and the dispatch answers before the route runs.
        self.assertEqual(status, 401)
        self.assertFalse(json.loads(body)["ok"])

    # ---------- Per-user world isolation ----------

    def test_worlds_are_isolated_between_users(self):
        alice = self._login("user-alice")
        bob = self._login("user-bob")

        status, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": "Alice's World", "backupUrl": ""},
            cookies={"quiltor_session": alice},
        )
        self.assertEqual(status, 200)
        world = json.loads(body)["world"]

        status, _, body, _ = self._request("GET", "/api/worlds", cookies={"quiltor_session": alice})
        self.assertEqual([w["id"] for w in json.loads(body)["worlds"]], [world["id"]])

        status, _, body, _ = self._request("GET", "/api/worlds", cookies={"quiltor_session": bob})
        self.assertEqual(json.loads(body)["worlds"], [])

    def test_bob_cannot_open_alices_world(self):
        alice = self._login("user-alice")
        bob = self._login("user-bob")
        _, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": "Alice's World", "backupUrl": ""},
            cookies={"quiltor_session": alice},
        )
        world = json.loads(body)["world"]

        status, _, _, _ = self._request(
            "POST", "/api/worlds/open", body={"id": world["id"]}, cookies={"quiltor_session": bob}
        )
        self.assertIn(status, (403, 404))

    def test_bob_cannot_write_to_alices_manuscript_and_alices_data_is_unchanged(self):
        alice = self._login("user-alice")
        bob = self._login("user-bob")
        _, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": "Alice's World", "backupUrl": ""},
            cookies={"quiltor_session": alice},
        )
        world = json.loads(body)["world"]

        status, _, _, _ = self._request(
            "PUT",
            "/api/manuscript",
            body={
                "chapters": [{"id": "c1", "title": "X", "body": "Bob's sneaky edit", "note": ""}],
                "worldId": world["id"],
            },
            headers={"If-Match": '"0"'},
            cookies={"quiltor_session": bob},
        )
        self.assertIn(status, (403, 404))

        status, _, body, _ = self._request(
            "GET", f"/api/manuscript?world={world['id']}", cookies={"quiltor_session": alice}
        )
        self.assertEqual(status, 200)
        manuscript = json.loads(body)
        self.assertEqual(manuscript["chapters"][0]["body"], "")

    def test_alice_can_write_to_her_own_manuscript(self):
        alice = self._login("user-alice")
        _, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": "Alice's World", "backupUrl": ""},
            cookies={"quiltor_session": alice},
        )
        world = json.loads(body)["world"]

        status, _, body, _ = self._request(
            "PUT",
            "/api/manuscript",
            body={
                "chapters": [{"id": "c1", "title": "X", "body": "Alice's own text", "note": ""}],
                "worldId": world["id"],
            },
            headers={"If-Match": '"0"'},
            cookies={"quiltor_session": alice},
        )
        self.assertEqual(status, 200)

        status, _, body, _ = self._request(
            "GET", f"/api/manuscript?world={world['id']}", cookies={"quiltor_session": alice}
        )
        manuscript = json.loads(body)
        self.assertEqual(manuscript["chapters"][0]["body"], "Alice's own text")


class RenderTokenTests(unittest.TestCase):
    """The PDF export's headless-browser subprocess can't do an interactive
    Keycloak login, so it's handed a short-lived token that redeems into a real
    session on its first request — see issue_render_token/redeem_render_token
    and the do_GET renderToken handling."""

    def setUp(self):
        render._tokens.clear()

    def tearDown(self):
        render._tokens.clear()

    def test_token_redeems_to_the_issuing_users_sub(self):
        token = server.issue_render_token("user-alice")
        self.assertEqual(server.redeem_render_token(token), "user-alice")

    def test_token_is_single_use(self):
        token = server.issue_render_token("user-alice")
        server.redeem_render_token(token)
        self.assertIsNone(server.redeem_render_token(token))

    def test_unknown_token_does_not_redeem(self):
        self.assertIsNone(server.redeem_render_token("never-issued"))

    def test_expired_token_does_not_redeem(self):
        token = server.issue_render_token("user-alice")
        sub, _ = render._tokens[token]
        render._tokens[token] = (sub, time.time() - 1)
        self.assertIsNone(server.redeem_render_token(token))


class RenderTokenHttpTests(_LiveAuthServerTestCase):
    def test_render_token_in_query_grants_a_session_cookie_on_first_request(self):
        token = server.issue_render_token("user-alice")
        status, _, body, set_cookies = self._request("GET", f"/api/whoami?renderToken={token}")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        self.assertEqual(json.loads(body)["sub"], "user-alice")
        self.assertTrue(any(c.startswith("quiltor_session=") for c in set_cookies))

    def test_render_token_is_consumed_after_first_use(self):
        token = server.issue_render_token("user-alice")
        self._request("GET", f"/api/whoami?renderToken={token}")
        status, _, body, _ = self._request("GET", f"/api/whoami?renderToken={token}")
        # Second use has no valid session and no valid token left, so the
        # request has no identity and never reaches the route.
        self.assertEqual(status, 401)
        self.assertFalse(json.loads(body)["ok"])


class LocalIdentityServerTest(unittest.TestCase):
    """The other half of the same server, wired to the local identity.

    Not "auth off": there is a session here too, it just belongs to the one
    person at this machine. What is genuinely absent is the *choice* of account,
    which is why /login stays a 404 while /api/whoami now always answers.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_storage = (
            storage.DATA,
            storage.DB,
            storage.BACKUPS,
            storage.WORLDS,
            storage.ACTIVE_WORLD_ID,
        )
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""
        storage.initialize()

        auth.SESSIONS.clear()
        self.addCleanup(auth.SESSIONS.clear)
        self.original_server = (server.IDENTITY, server.BOUND_TO_LOOPBACK)
        server.IDENTITY = identity.LocalIdentity()
        self.token = server.IDENTITY.token
        server.BOUND_TO_LOOPBACK = True

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        server.IDENTITY, server.BOUND_TO_LOOPBACK = self.original_server
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = (
            self.original_storage
        )
        self.temp.cleanup()

    def _get(self, path: str, headers: dict | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", path, headers=dict(headers or {}))
        resp = conn.getresponse()
        status, raw = resp.status, resp.read()
        conn.close()
        try:
            return status, json.loads(raw)
        except ValueError:
            return status, {}  # a 404 comes from the static fallback as HTML

    def test_a_loopback_request_needs_no_header_at_all(self):
        """The everyday desktop case: whoever reaches the port is the user."""
        status, body = self._get("/api/worlds")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_whoami_answers_and_says_there_is_only_one_user(self):
        status, body = self._get("/api/whoami")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertFalse(body["multiUser"])
        self.assertEqual(body["sub"], identity.LocalIdentity.MASTER_SUB)

    def test_the_account_routes_still_do_not_exist(self):
        """There is exactly one identity, so there is nothing to log in to or
        out of. A 404 says that; a redirect would imply an account system."""
        for path in ("/login", "/auth/callback"):
            with self.subTest(path=path):
                self.assertEqual(self._get(path)[0], 404)

    def test_a_bearer_token_is_accepted_when_loopback_is_not_available(self):
        server.BOUND_TO_LOOPBACK = False
        status, body = self._get("/api/whoami", headers={"Authorization": f"Bearer {self.token}"})
        self.assertEqual(status, 200)
        self.assertEqual(body["sub"], identity.LocalIdentity.MASTER_SUB)

    def test_without_loopback_and_without_a_token_there_is_no_identity(self):
        """A published instance without accounts is not open to everyone: the
        loopback shortcut is what falls away, and the token is what remains."""
        server.BOUND_TO_LOOPBACK = False
        status, body = self._get("/api/whoami")
        self.assertEqual(status, 401)
        self.assertFalse(body["ok"])

    def test_a_browser_request_without_an_identity_gets_403_not_a_login_redirect(self):
        """There is no login page to send anyone to, so a non-API request has to
        be refused outright rather than bounced to a route that does not exist."""
        server.BOUND_TO_LOOPBACK = False
        status, body = self._get("/")
        self.assertEqual(status, 403)
        self.assertFalse(body["ok"])

    def test_a_query_token_logs_in_and_bounces_the_secret_out_of_the_url(self):
        server.BOUND_TO_LOOPBACK = False
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", f"/api/whoami?token={self.token}")
        resp = conn.getresponse()
        status, headers = resp.status, resp.getheaders()
        resp.read()
        conn.close()
        self.assertEqual(status, 302)
        self.assertEqual(dict(headers)["Location"], "/api/whoami")
        # The redirect has to carry the cookie, or the bounced request arrives
        # with neither the token nor a session and loops.
        self.assertTrue(
            any(k.lower() == "set-cookie" and v.startswith("quiltor_session=") for k, v in headers)
        )


if __name__ == "__main__":
    unittest.main()
