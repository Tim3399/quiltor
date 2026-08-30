"""The backup login as a browser and the backup dialog actually meet it.

tests/python/test_backup_login.py drives src/quiltor/infrastructure/backup/login.py directly; this
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
import time
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.application.backups import BackupGatewayError
from quiltor.bootstrap import build_identity, build_web_application
from quiltor.modules.identity import service as identity
from quiltor.infrastructure.backup.adapters import OidcBackupLoginGateway
from quiltor.infrastructure.backup.login import BackupLoginRuntime
from quiltor.infrastructure.backup import remote
from quiltor.infrastructure.platform.adapters.credentials import InMemoryCredentialVault
from quiltor.infrastructure.platform.ports import AppDirectories
from tests.python.fake_issuer import FakeIssuer
from tests.python.test_backup_login import FakeBackupEndpoint

from quiltor.hosts.web import server


class BackupRouteTestCase(unittest.TestCase):
    """A live Quiltor, a live issuer and a live backup endpoint, with
    QUILTOR_BACKUP_URL pointing at the last of the three."""

    def setUp(self):
        global backup_login
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.directories = AppDirectories(
            data=root,
            config=root / "config",
            cache=root / "cache",
            models=root / "models",
            logs=root / "logs",
            temp=root / "temp",
        )
        self.vault = InMemoryCredentialVault()
        backup_login = BackupLoginRuntime(
            vault=self.vault,
            data_directory=root,
            allow_insecure_loopback=True,
        )

        self.issuer = FakeIssuer().start()
        self.addCleanup(self.issuer.stop)
        self.endpoint = FakeBackupEndpoint(self.issuer.url)
        self.addCleanup(self.endpoint.stop)
        self.base = self.endpoint.url

        self.environment = patch.dict(
            os.environ,
            {
                "QUILTOR_BACKUP_URL": self.base,
                "QUILTOR_OIDC_ALLOW_INSECURE_LOOPBACK": "1",
                "QUILTOR_PUBLIC_URL": "http://127.0.0.1",
            },
        )
        self.environment.start()

        backup_login.forget_cache()

        inference = MagicMock(identity="test-inference")
        inference.status.return_value = {
            "available": False,
            "mode": "local",
            "reason": "test",
        }
        self.app = build_web_application(
            identity=self.identity(),
            ensure_assistant_installed=False,
            inference=inference,
            app_directories=self.directories,
        )
        self.app.application.backups._login = OidcBackupLoginGateway(backup_login)

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.app)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def identity(self):
        raise NotImplementedError

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.app.identity.auth.clear()
        self.app.close()
        self.environment.stop()
        backup_login.close()
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
        return build_identity(False)

    def sign_in(self) -> dict:
        """POST /api/backup/login, play the browser, GET /backup/callback."""
        started = self.json_of("POST", "/api/backup/login", body={})
        self.assertTrue(started["ok"], started)
        code, state = self.issuer.authorize(started["authorizeUrl"])
        status, headers, _ = self.request("GET", f"/backup/callback?code={code}&state={state}")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/")
        return started

    def create_world(self) -> str:
        answer = self.json_of(
            "POST",
            "/api/worlds/create",
            body={"title": "Backup wire", "backupUrl": ""},
        )
        return answer["world"]["id"]

    # ---------- status ----------

    def test_before_signing_in_the_dialog_is_told_where_it_stands(self):
        answer = self.json_of("GET", "/api/backup/login")
        self.assertTrue(answer["ok"])
        self.assertTrue(answer["configured"])
        self.assertFalse(answer["hosted"])
        self.assertFalse(answer["signedIn"])
        self.assertEqual(answer["endpoint"], self.base)
        self.assertTrue(
            answer["issuerReachable"],
            "the issuer is up, so 'you are not signed in' is the whole story",
        )

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
        self.assertEqual(
            query["redirect_uri"],
            [started["redirectUri"]],
            "the issuer must send the browser back to the port we are listening on",
        )

    def test_the_whole_flow_over_the_real_routes_ends_signed_in(self):
        self.sign_in()
        token = backup_login.access_token(self.base)
        self.assertTrue(token)
        self.assertTrue(
            self.issuer.tokens[token]["active"], "the endpoint would introspect exactly this token"
        )

    def test_a_state_nobody_issued_is_refused_at_the_callback(self):
        self.json_of("POST", "/api/backup/login", body={})
        status, headers, raw = self.request("GET", "/backup/callback?code=stolen&state=made-up")
        self.assertEqual(status, 400)
        self.assertTrue(
            headers["Content-Type"].startswith("text/html"),
            "a browser lands here, so it gets a page and not a JSON fragment",
        )
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
        self.assertEqual(
            self.endpoint.header_for("/v1/worlds"), f"Bearer {backup_login.access_token(self.base)}"
        )

    def test_a_pasted_token_still_decides_when_nobody_has_signed_in(self):
        """QUILTOR_BACKUP_TOKEN is how a self-hosted endpoint has always been
        used; composition binds it to the configured endpoint."""
        with patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": "hand-issued"}):
            self.assertTrue(self.json_of("GET", "/api/backup/remote")["ok"])
        self.assertEqual(self.endpoint.header_for("/v1/worlds"), "Bearer hand-issued")

    def test_a_login_wins_over_the_pasted_token(self):
        """Someone who just signed in through the dialog means that login; the
        environment is the answer for when there is none."""
        self.sign_in()
        with patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": "hand-issued"}):
            self.json_of("GET", "/api/backup/remote")
        self.assertEqual(
            self.endpoint.header_for("/v1/worlds"), f"Bearer {backup_login.access_token(self.base)}"
        )

    def test_signing_out_forgets_the_credential(self):
        self.sign_in()
        self.assertTrue(self.json_of("POST", "/api/backup/logout", body={})["ok"])
        self.assertFalse(self.json_of("GET", "/api/backup/login")["signedIn"])
        self.assertEqual(backup_login.access_token(self.base), "")
        self.assertFalse(backup_login.path().exists())

    def test_gateway_failure_uses_the_shared_structured_error_fixture(self):
        world_id = self.create_world()
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "contracts/fixtures/application-api/structured-error/backup-gateway.v1.json"
            ).read_text(encoding="utf-8")
        )
        failure = BackupGatewayError(params={"operation": "upload", "snapshotCreated": True})
        with patch.object(self.app.application.backups, "commit", side_effect=failure):
            status, _, raw = self.request(
                "POST",
                "/api/backup",
                body={"worldId": world_id, "message": "Test", "push": True},
            )

        self.assertEqual(status, 502)
        body = json.loads(raw)
        self.assertEqual(body["error"], fixture)
        self.assertNotIn("grund", body)

    def test_history_wire_failures_are_never_http_200(self):
        world_id = self.create_world()
        status, _, raw = self.request(
            "GET", f"/api/history/diff?world={world_id}&ref=does-not-exist"
        )
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(raw)["error"]["code"], "history.revision_not_found")

        status, _, raw = self.request("GET", f"/api/history/chapter-text?world={world_id}&ref=WORK")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "history.request_invalid")

        status, _, raw = self.request(
            "GET", f"/api/history/chapter-comparison?world={world_id}&ref=WORK"
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "history.request_invalid")


class HostedTokenTests(BackupRouteTestCase):
    """The hosted case: the session already carries a token from the very issuer
    that guards the endpoint, so there is no browser flow here at all."""

    def identity(self):
        return build_identity(
            True, issuer=self.issuer.url, client_id="quiltor-web", client_secret=""
        )

    def session_for(self, token: str, sub: str = "hosted-person") -> str:
        session_id = self.app.identity.auth.create_session(
            sub, f"{sub}@example.test", "Hosted Person"
        )
        self.app.identity.auth.store_session_tokens(session_id, {"access_token": token})
        return session_id

    def test_the_status_route_reports_signed_in_without_any_local_login(self):
        cookie = {identity.SESSION_COOKIE: self.session_for("session-token")}
        answer = self.json_of("GET", "/api/backup/login", cookies=cookie)
        self.assertTrue(answer["signedIn"])
        self.assertTrue(answer["hosted"])
        self.assertEqual(answer["account"], "hosted-person")
        self.assertFalse(
            backup_login.path().exists(),
            "nothing was stored on disk -- the session is the credential",
        )

    def test_a_session_without_a_usable_token_is_not_called_signed_in(self):
        """A session can carry no credential at all -- one minted by a render
        token never had provider tokens. Claiming "signed in" for it meant the
        dialog offered an upload that could only 401, with nothing on screen
        saying why."""
        session_id = self.app.identity.auth.create_session("hosted-person", "", "")  # no tokens
        answer = self.json_of(
            "GET", "/api/backup/login", cookies={identity.SESSION_COOKIE: session_id}
        )
        self.assertFalse(answer["signedIn"])
        self.assertTrue(answer["hosted"])
        self.assertEqual(
            answer.get("reasonCode"),
            "backup.session_token_unavailable",
        )

    def test_a_lapsed_session_token_is_renewed_before_the_upload(self):
        """A session lives 24h, its access token commonly five minutes. Handing
        the stored string out regardless is why a hosted upload would start
        failing a few minutes after signing in."""
        # The renewal goes to the identity gateway's configured issuer -- in a hosted
        # deployment that is the same realm the endpoint trusts, which is
        # exactly why the session's token is usable there at all.
        session_id = self.app.identity.auth.create_session("hosted-person", "", "")
        session = self.app.identity.auth.get_session(session_id)
        self.issuer.sign_in_as("hosted-person")
        granted = self.issuer._grant("quiltor.backup")
        self.app.identity.auth.store_session_tokens(
            session.session_id, {**granted, "expires_in": 0}
        )  # already lapsed
        stale = self.app.identity.auth.get_session(session_id).access_token

        fresh = self.app.session_backup_token(session)
        self.assertTrue(fresh)
        self.assertNotEqual(fresh, stale, "the lapsed token was handed out unchanged")
        self.assertGreater(
            self.app.identity.auth.get_session(session_id).access_expires_at,
            time.time(),
            "the renewed token was filed without an expiry, so it lapses instantly",
        )

    def test_a_dead_refresh_token_clears_the_session_rather_than_pretending(self):
        session_id = self.app.identity.auth.create_session("hosted-person", "", "")
        session = self.app.identity.auth.get_session(session_id)
        self.app.identity.auth.store_session_tokens(
            session.session_id,
            {"access_token": "stale", "refresh_token": "no-such-thing", "expires_in": 0},
        )
        self.assertEqual(
            self.app.session_backup_token(session),
            "",
            "a token known to be stale must not be sent anyway",
        )
        answer = self.json_of(
            "GET", "/api/backup/login", cookies={identity.SESSION_COOKIE: session_id}
        )
        self.assertFalse(answer["signedIn"], "and the dialog is told the same thing")

    def test_there_is_no_browser_flow_to_start(self):
        """A rejected operation always crosses the HTTP error boundary."""
        status, _, raw = self.request(
            "POST",
            "/api/backup/login",
            body={},
            cookies={identity.SESSION_COOKIE: self.session_for("t")},
        )
        self.assertEqual(status, 409)
        answer = json.loads(raw)
        self.assertFalse(answer["ok"])
        self.assertEqual(answer["error"]["code"], "backup.login_not_applicable")
        self.assertFalse(answer["error"]["retryable"])

    def test_a_request_carries_its_own_sessions_token_to_the_endpoint(self):
        """The explicit request capability never inherits another session."""
        self.json_of(
            "GET",
            "/api/backup/remote",
            cookies={identity.SESSION_COOKIE: self.session_for("alice-token", "alice")},
        )
        self.assertEqual(self.endpoint.header_for("/v1/worlds"), "Bearer alice-token")

        self.json_of(
            "GET",
            "/api/backup/remote",
            cookies={identity.SESSION_COOKIE: self.session_for("bob-token", "bob")},
        )
        headers = [header for path, header in self.endpoint.seen if path == "/v1/worlds"]
        self.assertEqual(
            headers[-1],
            "Bearer bob-token",
            "the second request must not have inherited the first one's token",
        )

    def test_the_local_login_is_not_consulted_here(self):
        """Even with a browser login stored on this machine, a hosted request
        sends the session's token: the local one belongs to whoever runs the
        process, not to the person whose request this is."""
        backup_login.complete(*self._local_login())
        self.assertTrue(backup_login.access_token(self.base))

        session = self.app.identity.auth.get_session(self.session_for("session-token"))
        authorization = self.app.backup_authorization(self.base, session)
        self.assertEqual(authorization.bearer_token, "session-token")
        self.assertNotEqual(authorization.bearer_token, backup_login.access_token(self.base))

    def test_a_request_without_a_session_gets_no_token_at_all(self):
        """Rather than falling back to some other credential: the endpoint then
        answers 401 and names the issuer it wants, which is the honest outcome
        for a caller who never presented anything."""
        authorization = self.app.backup_authorization(self.base, None)
        self.assertEqual(authorization.bearer_token, "")

    def test_session_token_is_never_authorized_for_an_unconfigured_origin(self):
        evil = FakeBackupEndpoint(self.issuer.url)
        self.addCleanup(evil.stop)
        session = self.app.identity.auth.get_session(self.session_for("session-secret"))

        with self.assertRaises(PermissionError):
            self.app.backup_authorization(evil.url, session)

        self.assertEqual(evil.seen, [], "an attacker-controlled endpoint was contacted")

    def _local_login(self):
        redirect = f"http://127.0.0.1:{self.port}/backup/callback"
        code, state = self.issuer.authorize(backup_login.begin(self.base, redirect))
        return code, state, redirect


class AuthorizationWiringTests(unittest.TestCase):
    def test_transport_has_no_global_token_hook(self):
        self.assertFalse(hasattr(remote, "TOKEN_SOURCE"))
        self.assertFalse(hasattr(server, "_REQUEST"))
        self.assertFalse(hasattr(server, "_backup_token"))


if __name__ == "__main__":
    unittest.main()
