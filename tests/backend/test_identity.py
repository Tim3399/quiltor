"""How a request becomes a session, driven without a running HTTP server.

`Identity.resolve()` only ever asks a handler for four things: its path, its
headers, whether the server is bound to loopback, and somewhere to queue a
cookie. FakeHandler below provides exactly those, which is the point -- if this
file ever needs a real socket, backend/identity.py has grown a dependency on
server.py that it is not supposed to have.
"""
import os
import unittest
from unittest import mock

from backend import auth, identity
from backend.core import storage
from backend.pdf import issue_render_token


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
        auth.SESSIONS.clear()
        self.addCleanup(auth.SESSIONS.clear)


class LocalTokenTests(IdentityTestCase):
    def test_a_token_is_invented_when_the_environment_has_none(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUILTOR_MASTER_TOKEN", None)
            local = identity.LocalIdentity()
        self.assertTrue(local.token)
        self.assertGreaterEqual(len(local.token), 32)

    def test_the_environment_overrides_the_generated_token(self):
        with mock.patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": "vorgegeben"}):
            self.assertEqual(identity.LocalIdentity().token, "vorgegeben")

    def test_two_instances_do_not_share_a_token(self):
        """Nothing is persisted, so every start -- and every instance -- gets a
        fresh secret. A token that survived a restart would be a stored
        credential, which is exactly what this design avoids."""
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUILTOR_MASTER_TOKEN", None)
            self.assertNotEqual(identity.LocalIdentity().token, identity.LocalIdentity().token)

    def test_the_local_user_owns_the_local_worlds(self):
        self.assertEqual(identity.LocalIdentity.MASTER_SUB, storage.LOCAL_OWNER)

    def test_the_contract_answers_are_what_the_two_deployments_need(self):
        self.assertIsNone(identity.LocalIdentity.login_url)
        self.assertFalse(identity.LocalIdentity.multi_user)
        self.assertEqual(identity.OidcIdentity.login_url, "/login")
        self.assertTrue(identity.OidcIdentity.multi_user)


class LocalResolveTests(IdentityTestCase):
    def setUp(self):
        super().setUp()
        with mock.patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": "geheim-123"}):
            self.local = identity.LocalIdentity()

    def test_a_correct_bearer_token_yields_the_master_session(self):
        handler = FakeHandler("/api/worlds", headers={"Authorization": "Bearer geheim-123"}, loopback=False)
        session = self.local.resolve(handler)
        self.assertIsNotNone(session)
        self.assertEqual(session.sub, identity.LocalIdentity.MASTER_SUB)

    def test_a_wrong_bearer_token_is_refused_even_on_loopback(self):
        """An explicit credential that does not match is an answer, not an
        invitation to fall through to the loopback shortcut."""
        handler = FakeHandler("/api/worlds", headers={"Authorization": "Bearer falsch"}, loopback=True)
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
        session = self.local.resolve(handler)
        self.assertIsNotNone(session)
        self.assertEqual(session.sub, identity.LocalIdentity.MASTER_SUB)
        # The cookie means the next request needs no shortcut at all.
        self.assertTrue(any(identity.SESSION_COOKIE in value for value in handler.cookie_values))
        self.assertIsNone(getattr(handler, identity.REDIRECT_ATTR, None))

    def test_a_non_loopback_request_without_a_token_has_no_identity(self):
        handler = FakeHandler("/api/worlds", loopback=False)
        self.assertIsNone(self.local.resolve(handler))
        self.assertEqual(handler._pending_cookies, [])

    def test_an_existing_session_cookie_wins_before_any_token_is_looked_at(self):
        session_id = auth.create_session("alice", "a@example.org", "Alice")
        handler = FakeHandler("/api/worlds", cookies={identity.SESSION_COOKIE: session_id}, loopback=True)
        session = self.local.resolve(handler)
        self.assertEqual(session.sub, "alice")
        self.assertEqual(handler._pending_cookies, [])


class SharedBaseTests(IdentityTestCase):
    """The cookie/render-token step belongs to both deployments: the PDF render
    always issues a token, and the headless browser cannot log in for itself."""

    def test_a_session_cookie_resolves_for_both_implementations(self):
        session_id = auth.create_session("alice", "a@example.org", "Alice")
        for who in (identity.OidcIdentity(), identity.LocalIdentity()):
            with self.subTest(identity=type(who).__name__):
                handler = FakeHandler("/", cookies={identity.SESSION_COOKIE: session_id}, loopback=False)
                self.assertEqual(who.resolve(handler).sub, "alice")

    def test_a_render_token_resolves_for_both_implementations(self):
        for who in (identity.OidcIdentity(), identity.LocalIdentity()):
            with self.subTest(identity=type(who).__name__):
                token = issue_render_token("alice")
                handler = FakeHandler(f"/?renderToken={token}", loopback=False)
                session = who.resolve(handler)
                self.assertEqual(session.sub, "alice")
                self.assertTrue(any(identity.SESSION_COOKIE in v for v in handler.cookie_values))

    def test_a_spent_render_token_is_not_a_second_login(self):
        token = issue_render_token("alice")
        first = FakeHandler(f"/?renderToken={token}", loopback=False)
        self.assertIsNotNone(identity.OidcIdentity().resolve(first))
        second = FakeHandler(f"/?renderToken={token}", loopback=False)
        self.assertIsNone(identity.OidcIdentity().resolve(second))


class OidcRefusesTheMasterTokenTests(IdentityTestCase):
    """The master token is an unauthenticated bearer secret by design. Honouring
    it in the hosted deployment would be a straight bypass of the provider."""

    def setUp(self):
        super().setUp()
        with mock.patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": "geheim-123"}):
            self.oidc = identity.OidcIdentity()
            self.local = identity.LocalIdentity()

    def test_a_bearer_master_token_gets_nothing(self):
        handler = FakeHandler("/api/worlds", headers={"Authorization": "Bearer geheim-123"}, loopback=False)
        self.assertIsNone(self.oidc.resolve(handler))
        self.assertEqual(handler._pending_cookies, [])
        # ...while the very same request would have worked locally.
        self.assertIsNotNone(self.local.resolve(FakeHandler(
            "/api/worlds", headers={"Authorization": "Bearer geheim-123"}, loopback=False)))

    def test_a_query_master_token_gets_nothing(self):
        handler = FakeHandler("/?token=geheim-123", loopback=False)
        self.assertIsNone(self.oidc.resolve(handler))
        self.assertIsNone(getattr(handler, identity.REDIRECT_ATTR, None))

    def test_loopback_alone_is_not_a_login_when_there_are_accounts(self):
        handler = FakeHandler("/api/worlds", loopback=True)
        self.assertIsNone(self.oidc.resolve(handler))


if __name__ == "__main__":
    unittest.main()
