"""The backup login as a browser and the backup dialog actually meet it.

tests/backend/test_backup_login.py drives backend/backup_login.py directly; this
file drives the same flow through the real routes on a real server.Server, which
is where the two things the module cannot know about live: the loopback redirect
is built from the port this process is listening on, and the bearer token the
uploader ends up sending comes from `server._backup_token` rather than from the
module the login happens to be in.

Both deployments are exercised, because the token has two different origins and
one function: locally the stored browser login, hosted the access token the
session is already carrying. The hosted half is what pins the thread-local
carrier in server.py -- core's uploader is handed no session and asks
TOKEN_SOURCE, which has to find the right one out of however many requests are
in flight.

Real sockets throughout (the fake issuer, a fake endpoint, our own server): the
subject is wiring between parties, and a mocked transport would let a client
that never sends a header pass.
"""
import http.client
import json
import os
import tempfile
import threading
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

from backend import auth, backup_login, identity
from backend.core import storage
from backend.core.backup import remote
from fake_issuer import FakeIssuer
from test_backup_login import FakeBackupEndpoint

import server


class BackupRouteTestCase(unittest.TestCase):
    """A live Quiltor, a live issuer and a live backup endpoint, with
    QUILTOR_BACKUP_URL pointing at the last of the three."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_storage = (storage.DATA, storage.DB, storage.WORLDS)
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.WORLDS = root / "worlds"

        self.issuer = FakeIssuer().start()
        self.addCleanup(self.issuer.stop)
        self.endpoint = FakeBackupEndpoint(self.issuer.url)
        self.addCleanup(self.endpoint.stop)
        self.base = self.endpoint.url

        self.environment = patch.dict(os.environ, {"QUILTOR_BACKUP_URL": self.base})
        self.environment.start()

        auth._discovery_cache.clear()
        auth.SESSIONS.clear()
        backup_login.PENDING.clear()
        backup_login.forget_cache()

        self.original_identity = server.IDENTITY
        server.IDENTITY = self.identity()

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def identity(self):
        raise NotImplementedError

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        server.IDENTITY = self.original_identity
        self.environment.stop()
        auth._discovery_cache.clear()
        auth.SESSIONS.clear()
        backup_login.PENDING.clear()
        backup_login.forget_cache()
        storage.DATA, storage.DB, storage.WORLDS = self.original_storage
        self.temp.cleanup()

    # ------------------------------------------------------------- requesting

    def request(self, method: str, path: str, *, body=None, cookies=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        headers = {}
        if cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        if payload is not None:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=payload, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        result = (response.status, dict(response.getheaders()), raw)
        connection.close()
        return result

    def json_of(self, method: str, path: str, **kwargs) -> dict:
        status, _, raw = self.request(method, path, **kwargs)
        self.assertEqual(status, 200, raw[:400])
        return json.loads(raw)


class LocalLoginRouteTests(BackupRouteTestCase):
    """The desktop case: no accounts here, so the browser flow is this build's
    only way to a token."""

    def identity(self):
        return identity.LocalIdentity()

    def sign_in(self) -> dict:
        """POST /api/backup/login, play the browser, GET /backup/callback."""
        started = self.json_of("POST", "/api/backup/login", body={})
        self.assertTrue(started["ok"], started)
        code, state = self.issuer.authorize(started["authorizeUrl"])
        status, headers, _ = self.request("GET", f"/backup/callback?code={code}&state={state}")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/")
        return started

    # ---------- status ----------

    def test_before_signing_in_the_dialog_is_told_where_it_stands(self):
        answer = self.json_of("GET", "/api/backup/login")
        self.assertTrue(answer["ok"])
        self.assertTrue(answer["configured"])
        self.assertFalse(answer["hosted"])
        self.assertFalse(answer["signedIn"])
        self.assertEqual(answer["endpoint"], self.base)
        self.assertTrue(answer["issuerReachable"],
                        "the issuer is up, so 'you are not signed in' is the whole story")

    def test_without_an_endpoint_there_is_nothing_to_sign_in_to(self):
        """Not an error: a Quiltor that backs up nowhere is a normal Quiltor."""
        with patch.dict(os.environ, {"QUILTOR_BACKUP_URL": ""}):
            answer = self.json_of("GET", "/api/backup/login")
        self.assertTrue(answer["ok"])
        self.assertFalse(answer["configured"])
        self.assertFalse(answer["signedIn"])

    def test_after_signing_in_the_status_names_the_account(self):
        self.sign_in()
        answer = self.json_of("GET", "/api/backup/login")
        self.assertTrue(answer["signedIn"])
        self.assertEqual(answer["account"], "tester")
        self.assertEqual(answer["issuer"], self.issuer.url)

    # ---------- the flow ----------

    def test_the_authorization_url_comes_back_as_data_not_as_a_redirect(self):
        """The caller is a fetch from the dialog, not a page navigation: a 302
        would be followed by the fetch and the login form would land in a
        response body nobody ever sees."""
        started = self.json_of("POST", "/api/backup/login", body={})
        self.assertTrue(started["authorizeUrl"].startswith(f"{self.issuer.url}/authorize?"))
        self.assertEqual(started["redirectUri"], f"http://127.0.0.1:{self.port}/backup/callback")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(started["authorizeUrl"]).query)
        self.assertEqual(query["redirect_uri"], [started["redirectUri"]],
                         "the issuer must send the browser back to the port we are listening on")

    def test_the_whole_flow_over_the_real_routes_ends_signed_in(self):
        self.sign_in()
        token = backup_login.access_token(self.base)
        self.assertTrue(token)
        self.assertTrue(self.issuer.tokens[token]["active"],
                        "the endpoint would introspect exactly this token")

    def test_a_state_nobody_issued_is_refused_at_the_callback(self):
        self.json_of("POST", "/api/backup/login", body={})
        status, headers, raw = self.request("GET", "/backup/callback?code=stolen&state=made-up")
        self.assertEqual(status, 400)
        self.assertTrue(headers["Content-Type"].startswith("text/html"),
                        "a browser lands here, so it gets a page and not a JSON fragment")
        self.assertNotIn(b"Traceback", raw)
        self.assertFalse(self.json_of("GET", "/api/backup/login")["signedIn"])

    def test_a_callback_carrying_no_code_says_so_rather_than_failing_later(self):
        status, _, raw = self.request("GET", "/backup/callback")
        self.assertEqual(status, 400)
        self.assertIn("Code", raw.decode("utf-8"))

    def test_a_provider_that_refused_is_reported_as_such(self):
        status, _, raw = self.request("GET", "/backup/callback?error=access_denied")
        self.assertEqual(status, 400)
        self.assertIn("access_denied", raw.decode("utf-8"))

    # ---------- what the token is for ----------

    def test_after_signing_in_an_upload_carries_the_bearer_header(self):
        """The point of the whole file: a request that goes out through core's
        uploader arrives at the endpoint with the token the login produced."""
        self.sign_in()
        self.assertTrue(self.json_of("GET", "/api/backup/remote")["ok"])
        self.assertEqual(self.endpoint.header_for("/v1/worlds"),
                         f"Bearer {backup_login.access_token(self.base)}")

    def test_a_pasted_token_still_decides_when_nobody_has_signed_in(self):
        """QUILTOR_BACKUP_TOKEN is how a self-hosted endpoint has always been
        used, and hooking the login into TOKEN_SOURCE must not have taken it
        away -- server._backup_token falls back to core's own default."""
        with patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": "hand-issued"}):
            self.assertTrue(self.json_of("GET", "/api/backup/remote")["ok"])
        self.assertEqual(self.endpoint.header_for("/v1/worlds"), "Bearer hand-issued")

    def test_a_login_wins_over_the_pasted_token(self):
        """Someone who just signed in through the dialog means that login; the
        environment is the answer for when there is none."""
        self.sign_in()
        with patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": "hand-issued"}):
            self.json_of("GET", "/api/backup/remote")
        self.assertEqual(self.endpoint.header_for("/v1/worlds"),
                         f"Bearer {backup_login.access_token(self.base)}")

    def test_signing_out_forgets_the_credential(self):
        self.sign_in()
        self.assertTrue(self.json_of("POST", "/api/backup/logout", body={})["ok"])
        self.assertFalse(self.json_of("GET", "/api/backup/login")["signedIn"])
        self.assertEqual(backup_login.access_token(self.base), "")
        self.assertFalse(backup_login.path().exists())


class HostedTokenTests(BackupRouteTestCase):
    """The hosted case: the session already carries a token from the very issuer
    that guards the endpoint, so there is no browser flow here at all."""

    def identity(self):
        return identity.OidcIdentity()

    def session_for(self, token: str, sub: str = "hosted-person") -> str:
        session_id = auth.create_session(sub, f"{sub}@example.test", "Hosted Person")
        auth.get_session(session_id).access_token = token
        return session_id

    def test_the_status_route_reports_signed_in_without_any_local_login(self):
        cookie = {identity.SESSION_COOKIE: self.session_for("session-token")}
        answer = self.json_of("GET", "/api/backup/login", cookies=cookie)
        self.assertTrue(answer["signedIn"])
        self.assertTrue(answer["hosted"])
        self.assertEqual(answer["account"], "hosted-person")
        self.assertFalse(backup_login.path().exists(),
                         "nothing was stored on disk -- the session is the credential")

    def test_there_is_no_browser_flow_to_start(self):
        """Refused, but with 200 and ok=False like every other refusal this route
        can answer. The caller did nothing wrong -- it asked a reasonable question
        of a deployment that has no browser flow -- and a 4xx would force the
        dialog to catch an exception for one refusal and read a field for the
        next, for the same class of answer."""
        status, _, raw = self.request("POST", "/api/backup/login", body={},
                                      cookies={identity.SESSION_COOKIE: self.session_for("t")})
        self.assertEqual(status, 200)
        answer = json.loads(raw)
        self.assertFalse(answer["ok"])
        self.assertTrue(answer.get("grund"), "a refusal has to say why")

    def test_a_request_carries_its_own_sessions_token_to_the_endpoint(self):
        """The thread-local carrier, end to end: core's uploader is handed no
        session and asks TOKEN_SOURCE, which has to find the session of the
        request being served on this thread."""
        self.json_of("GET", "/api/backup/remote",
                     cookies={identity.SESSION_COOKIE: self.session_for("alice-token", "alice")})
        self.assertEqual(self.endpoint.header_for("/v1/worlds"), "Bearer alice-token")

        self.json_of("GET", "/api/backup/remote",
                     cookies={identity.SESSION_COOKIE: self.session_for("bob-token", "bob")})
        headers = [header for path, header in self.endpoint.seen if path == "/v1/worlds"]
        self.assertEqual(headers[-1], "Bearer bob-token",
                         "the second request must not have inherited the first one's token")

    def test_the_local_login_is_not_consulted_here(self):
        """Even with a browser login stored on this machine, a hosted request
        sends the session's token: the local one belongs to whoever runs the
        process, not to the person whose request this is."""
        backup_login.complete(*self._local_login())
        self.assertTrue(backup_login.access_token(self.base))

        session = auth.get_session(self.session_for("session-token"))
        server._REQUEST.session = session
        self.addCleanup(setattr, server._REQUEST, "session", None)
        self.assertEqual(server._backup_token(self.base), "session-token")
        self.assertNotEqual(server._backup_token(self.base), backup_login.access_token(self.base))

    def test_a_request_without_a_session_gets_no_token_at_all(self):
        """Rather than falling back to some other credential: the endpoint then
        answers 401 and names the issuer it wants, which is the honest outcome
        for a caller who never presented anything."""
        server._REQUEST.session = None
        self.assertEqual(server._backup_token(self.base), "")

    def _local_login(self):
        redirect = f"http://127.0.0.1:{self.port}/backup/callback"
        code, state = self.issuer.authorize(backup_login.begin(self.base, redirect))
        return code, state, redirect


class TokenSourceWiringTests(unittest.TestCase):
    def test_importing_the_server_hooks_the_host_into_core(self):
        """The same seam as server.RENDER_PDF: core describes the protocol and
        the host supplies the capability. Wired at import, so every path that
        reaches the uploader gets it without arranging for it."""
        self.assertIs(remote.TOKEN_SOURCE, server._backup_token)
        self.assertIs(server._ENVIRONMENT_TOKEN, remote._token_from_environment,
                      "core's default has to survive being replaced -- it is the fallback")


if __name__ == "__main__":
    unittest.main()
