"""How a request becomes a session, driven without a running HTTP server.

`Identity.resolve()` only ever asks a handler for four things: its path, its
headers, whether the server is bound to loopback, and somewhere to queue a
cookie. FakeHandler below provides exactly those, which is the point -- if this
file ever needs a real socket, src/quiltor/modules/identity/service.py has grown a dependency on
server.py that it is not supposed to have.
"""

import http.server
import json
import os
import threading
import time
import unittest
from typing import Any, cast
from unittest import mock

from quiltor.bootstrap import build_identity
from quiltor.infrastructure.identity import InMemoryRenderTokenStore, SQLiteOwnerIdentityStore
from quiltor.infrastructure.identity.runtime import (
    REFRESH_BACKOFF_SECONDS,
    StdlibIdentityGateway,
    TokenEndpointRejected,
    UrllibJsonTransport,
)
from quiltor.infrastructure.persistence.sqlite import config
from quiltor.modules.identity import service as identity
from quiltor.modules.identity.auth import IdentityConfiguration
from tests.python.narrowing import present


def local_identity(master_token: str | None = None, gateway=None, render_tokens=None):
    return identity.LocalIdentity(
        SQLiteOwnerIdentityStore(),
        gateway or StdlibIdentityGateway(IdentityConfiguration()),
        render_tokens or InMemoryRenderTokenStore(),
        master_token or "generated-local-token-which-is-long-enough",
    )


def oidc_identity(gateway=None, render_tokens=None):
    return identity.OidcIdentity(
        gateway or StdlibIdentityGateway(IdentityConfiguration()),
        render_tokens or InMemoryRenderTokenStore(),
    )


class FakeHandler:
    """The whole surface an Identity is allowed to use."""

    def __init__(self, path="/", *, cookies=None, headers=None, loopback=True):
        self.path = path
        self.cookies = dict(cookies or {})
        self.headers = dict(headers or {})
        self.loopback = loopback
        self._pending_cookies = []

    def get_cookie(self, name):
        return self.cookies.get(name)

    def cookie_header(self, name, value, max_age=None):
        return ("Set-Cookie", f"{name}={value}; Max-Age={max_age}; Path=/")

    def server_bound_to_loopback(self):
        return self.loopback

    # -- test conveniences, not part of the contract --
    @property
    def cookie_values(self):
        return [value for _, value in self._pending_cookies]


class IdentityTestCase(unittest.TestCase):
    def setUp(self):
        self.render_tokens = InMemoryRenderTokenStore()


class LocalTokenTests(IdentityTestCase):
    def test_a_token_is_invented_when_the_environment_has_none(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUILTOR_MASTER_TOKEN", None)
            local = cast(identity.LocalIdentity, build_identity(False))
        self.assertTrue(local.token)
        self.assertGreaterEqual(len(local.token), 32)

    def test_the_environment_overrides_the_generated_token(self):
        configured = "secure-local-token-" + "xY7_" * 8
        with mock.patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": configured}):
            self.assertEqual(cast(identity.LocalIdentity, build_identity(False)).token, configured)

    def test_a_short_configured_master_token_fails_closed(self):
        with mock.patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": "vorgegeben"}):
            with self.assertRaises(ValueError):
                build_identity(False)

    def test_an_empty_configured_master_token_fails_closed(self):
        with mock.patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": ""}):
            with self.assertRaises(ValueError):
                build_identity(False)

    def test_two_instances_do_not_share_a_token(self):
        """Nothing is persisted, so every start -- and every instance -- gets a
        fresh secret. A token that survived a restart would be a stored
        credential, which is exactly what this design avoids."""
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUILTOR_MASTER_TOKEN", None)
            first = cast(identity.LocalIdentity, build_identity(False))
            second = cast(identity.LocalIdentity, build_identity(False))
            self.assertNotEqual(first.token, second.token)

    def test_the_local_user_owns_the_local_worlds(self):
        self.assertEqual(local_identity().master_sub, config.LOCAL_OWNER)

    def test_the_contract_answers_are_what_the_two_deployments_need(self):
        self.assertIsNone(identity.LocalIdentity.login_url)
        self.assertFalse(identity.LocalIdentity.multi_user)
        self.assertEqual(identity.OidcIdentity.login_url, "/login")
        self.assertTrue(identity.OidcIdentity.multi_user)


class LocalResolveTests(IdentityTestCase):
    def setUp(self):
        super().setUp()
        self.local = local_identity("geheim-123")

    def test_a_correct_bearer_token_yields_the_master_session(self):
        handler = FakeHandler(
            "/api/worlds", headers={"Authorization": "Bearer geheim-123"}, loopback=False
        )
        session = present(self.local.resolve(handler))
        self.assertIsNotNone(session)
        self.assertEqual(session.sub, self.local.master_sub)

    def test_a_wrong_bearer_token_is_refused_even_on_loopback(self):
        """An explicit credential that does not match is an answer, not an
        invitation to fall through to the loopback shortcut."""
        handler = FakeHandler(
            "/api/worlds", headers={"Authorization": "Bearer falsch"}, loopback=True
        )
        self.assertIsNone(self.local.resolve(handler))
        self.assertEqual(handler._pending_cookies, [])

    def test_a_token_in_the_query_logs_in_and_asks_for_a_redirect(self):
        handler = FakeHandler("/welt?token=geheim-123&world=abc", loopback=False)
        session = self.local.resolve(handler)
        self.assertIsNotNone(session)
        # The cookie carries the session from here on, so the secret can leave
        # the URL before it reaches the history or a Referer header.
        self.assertTrue(any(identity.SESSION_COOKIE in value for value in handler.cookie_values))
        self.assertEqual(getattr(handler, identity.REDIRECT_ATTR), "/welt?world=abc")

    def test_a_query_token_that_is_wrong_gets_nothing_and_no_redirect(self):
        handler = FakeHandler("/welt?token=falsch", loopback=False)
        self.assertIsNone(self.local.resolve(handler))
        self.assertIsNone(getattr(handler, identity.REDIRECT_ATTR, None))

    def test_a_loopback_request_is_the_local_user_without_any_token(self):
        handler = FakeHandler("/api/worlds", loopback=True)
        session = present(self.local.resolve(handler))
        self.assertIsNotNone(session)
        self.assertEqual(session.sub, self.local.master_sub)
        # The cookie means the next request needs no shortcut at all.
        self.assertTrue(any(identity.SESSION_COOKIE in value for value in handler.cookie_values))
        self.assertIsNone(getattr(handler, identity.REDIRECT_ATTR, None))

    def test_a_non_loopback_request_without_a_token_has_no_identity(self):
        handler = FakeHandler("/api/worlds", loopback=False)
        self.assertIsNone(self.local.resolve(handler))
        self.assertEqual(handler._pending_cookies, [])

    def test_an_existing_session_cookie_wins_before_any_token_is_looked_at(self):
        session_id = self.local.auth.create_session("alice", "a@example.org", "Alice")
        handler = FakeHandler(
            "/api/worlds", cookies={identity.SESSION_COOKIE: session_id}, loopback=True
        )
        session = present(self.local.resolve(handler))
        self.assertEqual(session.sub, "alice")
        self.assertEqual(handler._pending_cookies, [])


class SharedBaseTests(IdentityTestCase):
    """The cookie/render-token step belongs to both deployments: the PDF render
    always issues a token, and the headless browser cannot log in for itself."""

    def test_a_session_cookie_resolves_for_both_implementations(self):
        gateway = StdlibIdentityGateway(IdentityConfiguration())
        session_id = gateway.create_session("alice", "a@example.org", "Alice")
        for who in (oidc_identity(gateway), local_identity(gateway=gateway)):
            with self.subTest(identity=type(who).__name__):
                handler = FakeHandler(
                    "/", cookies={identity.SESSION_COOKIE: session_id}, loopback=False
                )
                self.assertEqual(present(who.resolve(handler)).sub, "alice")

    def test_a_render_token_resolves_for_both_implementations(self):
        for factory in (oidc_identity, local_identity):
            store = InMemoryRenderTokenStore()
            who = factory(render_tokens=store)
            with self.subTest(identity=type(who).__name__):
                token = who.issue_render_token("alice")
                handler = FakeHandler(f"/?renderToken={token}", loopback=False)
                session = present(who.resolve(handler))
                self.assertEqual(session.sub, "alice")
                self.assertTrue(any(identity.SESSION_COOKIE in v for v in handler.cookie_values))

    def test_a_spent_render_token_is_not_a_second_login(self):
        store = InMemoryRenderTokenStore()
        who = oidc_identity(render_tokens=store)
        token = who.issue_render_token("alice")
        first = FakeHandler(f"/?renderToken={token}", loopback=False)
        self.assertIsNotNone(who.resolve(first))
        second = FakeHandler(f"/?renderToken={token}", loopback=False)
        self.assertIsNone(who.resolve(second))

    def test_render_token_store_is_instance_scoped_and_bounded(self):
        serial = iter(("token-one", "token-two", "token-three"))
        store = InMemoryRenderTokenStore(capacity=2, token_factory=lambda _size: next(serial))
        store.issue("alice")
        store.issue("bob")
        with self.assertRaises(RuntimeError):
            store.issue("carol")
        self.assertIsNone(InMemoryRenderTokenStore().redeem("token-one"))


class OidcRefusesTheMasterTokenTests(IdentityTestCase):
    """The master token is an unauthenticated bearer secret by design. Honouring
    it in the hosted deployment would be a straight bypass of the provider."""

    def setUp(self):
        super().setUp()
        self.oidc = oidc_identity()
        self.local = local_identity("geheim-123")

    def test_a_bearer_master_token_gets_nothing(self):
        handler = FakeHandler(
            "/api/worlds", headers={"Authorization": "Bearer geheim-123"}, loopback=False
        )
        self.assertIsNone(self.oidc.resolve(handler))
        self.assertEqual(handler._pending_cookies, [])
        # ...while the very same request would have worked locally.
        self.assertIsNotNone(
            self.local.resolve(
                FakeHandler(
                    "/api/worlds", headers={"Authorization": "Bearer geheim-123"}, loopback=False
                )
            )
        )

    def test_a_query_master_token_gets_nothing(self):
        handler = FakeHandler("/?token=geheim-123", loopback=False)
        self.assertIsNone(self.oidc.resolve(handler))
        self.assertIsNone(getattr(handler, identity.REDIRECT_ATTR, None))

    def test_loopback_alone_is_not_a_login_when_there_are_accounts(self):
        handler = FakeHandler("/api/worlds", loopback=True)
        self.assertIsNone(self.oidc.resolve(handler))


ISSUER = "https://kc.example.test/realms/quiltor"


def _id_token(claims: dict[str, Any]) -> str:
    """An opaque stand-in for a signed ID token; verify_id_token is replaced in
    these tests, signatures are covered in test_auth.py."""
    return "idt:" + json.dumps(claims)


class _RefreshProvider:
    """The token endpoint, scripted per request. Refresh tokens are single-use,
    like the realm's: a token that was already redeemed gets `invalid_grant`."""

    def __init__(self) -> None:
        self.token_requests = 0
        self.roles: list[str] | None = ["premium"]
        self.sub = "alice"
        self.failure: Exception | None = None
        self.include_id_token = True
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self._valid = {"refresh-0"}
        self._serial = 0

    def request(self, url, data=None, headers=None):
        if url.endswith("/.well-known/openid-configuration"):
            return {
                "issuer": ISSUER,
                "authorization_endpoint": f"{ISSUER}/auth",
                "token_endpoint": f"{ISSUER}/token",
                "jwks_uri": f"{ISSUER}/certs",
            }
        self.token_requests += 1
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(5)
        if self.failure is not None:
            raise self.failure
        fields = dict(part.split("=", 1) for part in (data or b"").decode("ascii").split("&"))
        presented = fields.get("refresh_token", "")
        if presented not in self._valid:
            raise TokenEndpointRejected("invalid_grant")
        self._valid.discard(presented)
        self._serial += 1
        fresh = f"refresh-{self._serial}"
        self._valid.add(fresh)
        answer: dict[str, Any] = {
            "access_token": f"access-{self._serial}",
            "refresh_token": fresh,
            "expires_in": 300,
        }
        if self.include_id_token:
            claims: dict[str, Any] = {"sub": self.sub}
            if self.roles is not None:
                claims["roles"] = list(self.roles)
            answer["id_token"] = _id_token(claims)
        return answer


class RefreshSessionTests(unittest.TestCase):
    """The session follows the provider (T-58 P2): roles are re-read on refresh,
    `invalid_grant` ends the session, every other failure backs off."""

    def setUp(self):
        self.now = 10_000.0
        self.provider = _RefreshProvider()
        self.gateway = StdlibIdentityGateway(
            IdentityConfiguration(ISSUER, "quiltor-web", "secret"),
            transport=self.provider,
            clock=lambda: self.now,
        )
        patcher = mock.patch.object(
            self.gateway,
            "verify_id_token",
            side_effect=lambda token, nonce, **_: json.loads(token[4:]),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.session_id = self.gateway.create_session("alice", "", "")
        self.gateway.store_session_tokens(
            self.session_id,
            {"access_token": "access-0", "refresh_token": "refresh-0", "expires_in": 300},
            verified_claims={"sub": "alice", "roles": ["premium"]},
        )

    def _expire(self):
        self.now += 300

    def _refresh(self):
        return self.gateway.refresh_session(self.session_id)

    def test_a_valid_token_is_not_refreshed(self):
        session = present(self._refresh())
        self.assertEqual(session.access_token, "access-0")
        self.assertEqual(self.provider.token_requests, 0)

    def test_a_withdrawn_role_is_gone_after_the_refresh(self):
        self.provider.roles = []
        self._expire()
        session = present(self._refresh())
        self.assertEqual(session.roles, ())
        self.assertEqual(session.access_token, "access-1")

    def test_a_granted_role_counts_after_the_refresh(self):
        self.gateway.store_session_tokens(
            self.session_id,
            {"access_token": "access-0", "refresh_token": "refresh-0", "expires_in": 300},
            verified_claims={"sub": "alice", "roles": []},
        )
        self.provider.roles = ["premium", "beta"]
        self._expire()
        self.assertEqual(present(self._refresh()).roles, ("premium", "beta"))

    def test_the_new_refresh_token_is_kept(self):
        self._expire()
        self.assertEqual(present(self._refresh()).refresh_token, "refresh-1")
        self._expire()
        self.assertEqual(present(self._refresh()).access_token, "access-2")

    def test_a_refresh_without_an_id_token_keeps_the_roles(self):
        self.provider.include_id_token = False
        self._expire()
        session = present(self._refresh())
        self.assertEqual(session.roles, ("premium",))
        self.assertEqual(session.access_token, "access-1")

    def test_an_id_token_for_another_account_ends_the_session(self):
        self.provider.sub = "mallory"
        self._expire()
        self.assertIsNone(self._refresh())
        self.assertIsNone(self.gateway.get_session(self.session_id))

    def test_invalid_grant_ends_the_session(self):
        self.provider.failure = TokenEndpointRejected("invalid_grant")
        self._expire()
        self.assertIsNone(self._refresh())
        self.assertIsNone(self.gateway.get_session(self.session_id))

    def test_invalid_client_keeps_the_session_and_backs_off(self):
        self.provider.failure = TokenEndpointRejected("invalid_client")
        self._expire()
        session = present(self._refresh())
        self.assertEqual(session.roles, ("premium",))
        self.assertEqual(session.refresh_token, "refresh-0")
        self.assertEqual(session.refresh_retry_at, self.now + REFRESH_BACKOFF_SECONDS)

    def test_a_network_error_keeps_session_tokens_and_roles(self):
        self.provider.failure = ValueError("OIDC provider returned an invalid response.")
        self._expire()
        session = present(self._refresh())
        self.assertEqual(session.access_token, "access-0")
        self.assertEqual(session.refresh_token, "refresh-0")
        self.assertEqual(session.roles, ("premium",))

    def test_no_token_request_during_the_backoff(self):
        self.provider.failure = ValueError("down")
        self._expire()
        self._refresh()
        self.assertEqual(self.provider.token_requests, 1)
        self.now += REFRESH_BACKOFF_SECONDS - 1
        self._refresh()
        self.assertEqual(self.gateway.session_access_token(self.session_id), "")
        self.assertEqual(self.provider.token_requests, 1)

    def test_after_the_backoff_the_refresh_happens_and_updates_the_roles(self):
        """F-58-2: one network error used to stop every later refresh."""
        self.provider.failure = ValueError("down")
        self._expire()
        self._refresh()
        self.provider.failure = None
        self.provider.roles = []
        self.now += REFRESH_BACKOFF_SECONDS
        session = present(self._refresh())
        self.assertEqual(self.provider.token_requests, 2)
        self.assertEqual(session.access_token, "access-1")
        self.assertEqual(session.roles, ())
        self.assertEqual(session.refresh_retry_at, 0.0)

    def test_a_network_error_then_invalid_grant_ends_the_session(self):
        self.provider.failure = ValueError("down")
        self._expire()
        self.assertIsNotNone(self._refresh())
        self.provider.failure = TokenEndpointRejected("invalid_grant")
        self.now += REFRESH_BACKOFF_SECONDS
        self.assertIsNone(self._refresh())
        self.assertIsNone(self.gateway.get_session(self.session_id))

    def test_backups_get_the_refreshed_token(self):
        self._expire()
        self.assertEqual(self.gateway.session_access_token(self.session_id), "access-1")

    def test_two_concurrent_refreshes_make_one_token_request(self):
        """Refresh tokens are single-use (D-96): a second request with the same
        token would be `invalid_grant` and sign the person out."""
        self.provider.gate = threading.Event()
        self._expire()
        results: list[Any] = []

        def refresh():
            results.append(self._refresh())

        first = threading.Thread(target=refresh)
        first.start()
        self.assertTrue(self.provider.entered.wait(5))
        second = threading.Thread(target=refresh)
        second.start()
        time.sleep(0.2)  # the second caller is now waiting on the session's lock
        self.provider.gate.set()
        first.join(5)
        second.join(5)
        self.assertEqual(self.provider.token_requests, 1)
        self.assertEqual(len(results), 2)
        self.assertEqual([present(r).access_token for r in results], ["access-1", "access-1"])
        self.assertIsNotNone(self.gateway.get_session(self.session_id))

    def test_oidc_resolve_refreshes_and_reads_the_new_roles(self):
        oidc = oidc_identity(gateway=self.gateway)
        self.provider.roles = []
        self._expire()
        handler = FakeHandler(cookies={identity.SESSION_COOKIE: self.session_id}, loopback=False)
        session = present(oidc.resolve(handler))
        self.assertEqual(session.roles, ())
        self.assertFalse(oidc.is_premium(session))

    def test_oidc_resolve_has_no_session_after_invalid_grant(self):
        oidc = oidc_identity(gateway=self.gateway)
        self.provider.failure = TokenEndpointRejected("invalid_grant")
        self._expire()
        handler = FakeHandler(cookies={identity.SESSION_COOKIE: self.session_id}, loopback=False)
        self.assertIsNone(oidc.resolve(handler))
        self.assertIsNone(oidc.resolve(handler))


class TokenEndpointRejectionTests(unittest.TestCase):
    """The transport names the OAuth error of a refused token request."""

    def _serve(self, status: int, body: bytes):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}/token"

    def _post(self, url: str):
        return UrllibJsonTransport().request(url, data=b"grant_type=refresh_token")

    def test_400_names_the_error(self):
        for status, code in ((400, "invalid_grant"), (401, "invalid_client")):
            with self.subTest(status=status):
                url = self._serve(status, json.dumps({"error": code}).encode())
                with self.assertRaises(TokenEndpointRejected) as raised:
                    self._post(url)
                self.assertEqual(raised.exception.error, code)

    def test_a_body_without_an_error_code_is_still_a_rejection_without_a_name(self):
        url = self._serve(400, b"not json")
        with self.assertRaises(TokenEndpointRejected) as raised:
            self._post(url)
        self.assertEqual(raised.exception.error, "")

    def test_a_server_error_is_no_rejection(self):
        url = self._serve(503, json.dumps({"error": "invalid_grant"}).encode())
        with self.assertRaises(ValueError) as raised:
            self._post(url)
        self.assertNotIsInstance(raised.exception, TokenEndpointRejected)


if __name__ == "__main__":
    unittest.main()
