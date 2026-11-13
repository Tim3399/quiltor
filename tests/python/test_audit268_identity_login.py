"""T-268 audit D1: the OIDC login flow (checklist 1.1-1.6, 1.8, 1.14, 1.15).

Every test drives a real hosted server over HTTP against the in-process provider of
`test_audit268_identity_support`. A test that proves a gap is marked
`@unittest.expectedFailure` and names its finding (S268-<n>); when the fix lands
the decorator is the thing that has to go.
"""

from __future__ import annotations

import time
import unittest
import urllib.parse
from typing import Any

from tests.python.test_audit268_identity_support import (
    CLIENT_ID,
    ISSUER,
    PUBLIC_URL,
    SESSION_COOKIE,
    STATE_COOKIE,
    HostedHarness,
)


def _query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()}


class StateAndPkceTests(HostedHarness):
    """1.1 state, 1.2 nonce, 1.3 PKCE, 1.4 redirect_uri."""

    def _callback(self, code: str, state: str, state_cookie: str | None):
        cookies = {STATE_COOKIE: state_cookie} if state_cookie is not None else None
        return self.request("GET", f"/auth/callback?code={code}&state={state}", cookies=cookies)

    def test_state_is_single_use(self) -> None:
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        first = self._callback(code, state, cookie)
        self.assertEqual(first[1]["location"], "/")
        # Replaying the very same callback: state is consumed, so no second session.
        code2 = self.provider.authorize(location, "alice")
        second = self._callback(code2, state, cookie)
        self.assertEqual(second[1]["location"], "/?authError=expired")
        self.assertFalse([c for c in second[3] if c.startswith(SESSION_COOKIE + "=")])

    def test_state_in_the_query_must_match_the_browsers_own_cookie(self) -> None:
        """Login CSRF: someone else's callback link, opened in a browser that never
        started that login, creates no session."""
        self.provider.add_account("mallory")
        location, state, _cookie = self.begin_login()
        code = self.provider.authorize(location, "mallory")
        for cookie in (None, "", "another-state"):
            with self.subTest(cookie=cookie):
                status, headers, _, set_cookies = self._callback(code, state, cookie)
                self.assertEqual(status, 302)
                self.assertEqual(headers["location"], "/?authError=state")
                self.assertFalse([c for c in set_cookies if c.startswith(SESSION_COOKIE + "=")])
        # The refusal did not burn the pending login: the right browser can still finish.
        status, headers, _, _ = self._callback(code, state, state)
        self.assertEqual(headers["location"], "/")

    def test_state_expires_after_ten_minutes(self) -> None:
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        self.clock.advance(601)
        _, headers, _, _ = self._callback(code, state, cookie)
        self.assertEqual(headers["location"], "/?authError=expired")

    def test_state_cookie_lives_ten_minutes_and_is_cleared_after_the_callback(self) -> None:
        _location, _state, _cookie = self.begin_login()
        _, _, _, cookies = self.request("GET", "/login")
        state_cookie = next(c for c in cookies if c.startswith(STATE_COOKIE + "="))
        self.assertIn("Max-Age=600", state_cookie)
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        _, _, _, set_cookies = self._callback(code, state, cookie)
        cleared = next(c for c in set_cookies if c.startswith(STATE_COOKIE + "="))
        self.assertIn("Max-Age=0", cleared)

    def test_a_token_without_the_nonce_or_with_another_one_is_refused(self) -> None:
        for label, change in (
            ("no nonce", lambda p: setattr(p, "omit_nonce", True)),
            ("other nonce", lambda p: p.token_claims_override.update({"nonce": "not-mine"})),
        ):
            with self.subTest(label):
                self.provider.omit_nonce = False
                self.provider.token_claims_override = {}
                self.provider.add_account("alice")
                location, state, cookie = self.begin_login()
                code = self.provider.authorize(location, "alice")
                change(self.provider)
                _, headers, _, set_cookies = self._callback(code, state, cookie)
                self.assertEqual(headers["location"], "/?authError=exchange")
                self.assertFalse([c for c in set_cookies if c.startswith(SESSION_COOKIE + "=")])

    def test_authorize_url_uses_s256_and_the_verifier_never_leaves_the_server(self) -> None:
        location, state, cookie = self.begin_login()
        query = _query(location)
        self.assertEqual(query["code_challenge_method"], "S256")
        self.assertEqual(query["response_type"], "code")
        self.assertEqual(query["client_id"], CLIENT_ID)
        verifier = self.gateway._pending[state]["verifier"]
        self.assertGreaterEqual(len(verifier), 43)
        self.assertNotIn(verifier, location)
        self.assertNotIn(verifier, cookie)
        self.assertNotEqual(query["code_challenge"], verifier)
        # The provider checked the challenge during the exchange: a full login works.
        self.provider.add_account("alice")
        code = self.provider.authorize(location, "alice")
        _, headers, _, set_cookies = self._callback(code, state, cookie)
        self.assertEqual(headers["location"], "/")
        self.assertNotIn(verifier, "".join(set_cookies))

    def test_the_client_secret_is_only_sent_to_the_token_endpoint(self) -> None:
        location, _state, _cookie = self.begin_login()
        self.assertNotIn("secret", location)
        self.assertNotIn("audit-secret", location)

    def test_redirect_uri_comes_from_the_public_url_not_from_request_headers(self) -> None:
        hostile = {
            "Host": "evil.example",
            "X-Forwarded-Host": "evil.example",
            "X-Forwarded-Proto": "http",
            "Forwarded": "host=evil.example;proto=http",
            "Origin": "https://evil.example",
        }
        _, headers, _, _ = self.request("GET", "/login", headers=hostile)
        self.assertEqual(_query(headers["location"])["redirect_uri"], f"{PUBLIC_URL}/auth/callback")

    def test_without_a_public_url_an_oidc_server_does_not_start(self) -> None:
        import os
        from unittest.mock import patch

        from quiltor.bootstrap import build_identity
        from quiltor.bootstrap.web import _validated_public_url

        with patch.dict(os.environ):
            os.environ.pop("QUILTOR_PUBLIC_URL", None)
            with self.assertRaises(RuntimeError):
                _validated_public_url(build_identity(True, gateway=self.gateway))

    def test_the_exchange_uses_the_redirect_uri_of_the_login_not_a_later_one(self) -> None:
        _location, state, _cookie = self.begin_login()
        self.assertEqual(
            self.gateway._pending[state]["redirect_uri"], f"{PUBLIC_URL}/auth/callback"
        )


class IdTokenVerificationTests(HostedHarness):
    """1.5: a token that is not the provider's, not for us, or not valid now gives no session."""

    def _attempt(self, mutate: Any) -> tuple[str, list[str]]:
        self.provider.add_account("alice", roles=("premium",))
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        mutate()
        _, headers, _, set_cookies = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        return headers["location"], [c for c in set_cookies if c.startswith(SESSION_COOKIE + "=")]

    def _reset(self) -> None:
        self.provider.token_claims_override = {}
        self.provider.sign_with_other_key = False
        self.provider.aud_override = None
        self.provider.issuer_override = None

    def test_claims_that_do_not_belong_to_this_login_are_refused(self) -> None:
        now = int(time.time())
        cases = {
            "wrong audience": lambda: setattr(self.provider, "aud_override", "someone-else"),
            "audience list without azp": lambda: setattr(
                self.provider, "aud_override", [CLIENT_ID, "backup"]
            ),
            "wrong issuer": lambda: setattr(self.provider, "issuer_override", ISSUER + "/evil"),
            "expired": lambda: self.provider.token_claims_override.update(
                {"exp": now - 3600, "iat": now - 7200}
            ),
            "issued in the future": lambda: self.provider.token_claims_override.update(
                {"iat": now + 3600}
            ),
            "not yet valid": lambda: self.provider.token_claims_override.update(
                {"nbf": now + 3600}
            ),
            "other azp": lambda: self.provider.token_claims_override.update({"azp": "other"}),
            "reserved internal subject": lambda: self.provider.token_claims_override.update(
                {"sub": "quiltor-internal:local-owner"}
            ),
            "empty subject": lambda: self.provider.token_claims_override.update({"sub": ""}),
            "signed with another key": lambda: setattr(self.provider, "sign_with_other_key", True),
        }
        for label, mutate in cases.items():
            with self.subTest(label):
                self._reset()
                location, cookies = self._attempt(mutate)
                self.assertEqual(location, "/?authError=exchange")
                self.assertEqual(cookies, [])

    def test_unsigned_and_symmetric_tokens_are_refused(self) -> None:
        import jwt

        real_now = int(time.time())
        claims = {
            "iss": ISSUER,
            "aud": CLIENT_ID,
            "sub": "alice",
            "iat": real_now,
            "exp": real_now + 3600,
            "roles": ["premium"],
        }
        forged = {
            "alg none": lambda nonce: jwt.encode(
                {**claims, "nonce": nonce},
                key=None,  # pyright: ignore[reportArgumentType]
                algorithm="none",
                headers={"kid": self.provider.kid},
            ),
            "HS256 with the public JWK as secret": lambda nonce: jwt.encode(
                {**claims, "nonce": nonce},
                key=str(self.provider.jwk()["n"]).encode("ascii") * 4,
                algorithm="HS256",
                headers={"kid": self.provider.kid},
            ),
            "unknown kid": lambda nonce: self.provider.sign(
                {**claims, "nonce": nonce}, kid="not-published"
            ),
        }
        for label, build in forged.items():
            with self.subTest(label):
                self.provider.add_account("alice", roles=("premium",))
                location, state, cookie = self.begin_login()
                code = self.provider.authorize(location, "alice")
                nonce = _query(location)["nonce"]
                original = self.provider.id_token
                self.provider.id_token = lambda sub, *, nonce=None, _b=build, _n=nonce: _b(_n)  # type: ignore[method-assign]
                try:
                    _, headers, _, set_cookies = self.request(
                        "GET",
                        f"/auth/callback?code={code}&state={state}",
                        cookies={STATE_COOKIE: cookie},
                    )
                finally:
                    self.provider.id_token = original  # type: ignore[method-assign]
                self.assertEqual(headers["location"], "/?authError=exchange")
                self.assertFalse([c for c in set_cookies if c.startswith(SESSION_COOKIE + "=")])

    def test_an_exchange_without_an_id_token_gives_no_session(self) -> None:
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        original = self.provider._code_grant

        def without_id_token(fields):
            answer = original(fields)
            answer.pop("id_token")
            return answer

        self.provider._code_grant = without_id_token  # type: ignore[method-assign]
        _, headers, _, set_cookies = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        self.assertEqual(headers["location"], "/?authError=exchange")
        self.assertFalse([c for c in set_cookies if c.startswith(SESSION_COOKIE + "=")])

    def test_discovery_endpoints_on_a_foreign_origin_are_refused(self) -> None:
        """A poisoned discovery document cannot send the browser or the client secret elsewhere."""
        from quiltor.infrastructure.identity.runtime import StdlibIdentityGateway

        for name in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
            with self.subTest(name):
                document = {**self.provider.discovery(), name: "https://evil.example/x"}

                class Poisoned:
                    def request(self, url, data=None, headers=None, _d=document):
                        return _d

                gateway = StdlibIdentityGateway(
                    self.gateway.configuration, transport=Poisoned(), clock=self.clock
                )
                with self.assertRaises(ValueError):
                    gateway.discover()

    def test_the_session_roles_come_from_the_flat_claim_only(self) -> None:
        self.provider.token_claims_override = {"realm_access": {"roles": ["premium"]}}
        session = self.login("alice", roles=())
        status, document, _, _ = self.json_request(
            "GET", "/api/capabilities", cookies={SESSION_COOKIE: session}
        )
        self.assertEqual(status, 200)
        self.assertFalse(document["user"]["serverAi"])


class CookieAndLogoutTests(HostedHarness):
    """1.6 cookie flags, 1.8 logout."""

    def _session_cookie_header(self) -> str:
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        _, _, _, cookies = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        return next(c for c in cookies if c.startswith(SESSION_COOKIE + "="))

    def test_the_session_cookie_is_httponly_lax_secure_and_a_day_long(self) -> None:
        header = self._session_cookie_header()
        attributes = {part.strip().lower() for part in header.split(";")[1:]}
        self.assertIn("httponly", attributes)
        self.assertIn("secure", attributes)
        self.assertIn("samesite=lax", attributes)
        self.assertIn("path=/", attributes)
        self.assertIn("max-age=86400", attributes)
        self.assertFalse([a for a in attributes if a.startswith("domain")], header)

    def test_secure_follows_the_https_public_url_and_cannot_be_switched_off(self) -> None:
        import os
        from unittest.mock import patch

        from quiltor.bootstrap import build_identity
        from quiltor.bootstrap.web import _validated_public_url

        with patch.dict(os.environ, {"QUILTOR_COOKIE_SECURE": "0"}):
            with self.assertRaises(RuntimeError):
                _validated_public_url(build_identity(True, gateway=self.gateway))

    def test_the_session_id_has_enough_entropy_and_is_new_on_every_login(self) -> None:
        first = self.login("alice")
        second = self.login("alice")
        self.assertNotEqual(first, second)
        self.assertGreaterEqual(len(first), 40)

    def test_logout_destroys_the_session_clears_cookies_and_names_only_the_public_url(self) -> None:
        session = self.login("alice")
        status, document, _headers, cookies = self.json_request(
            "POST",
            "/logout",
            {},
            cookies={SESSION_COOKIE: session},
            headers={"Host": "evil.example"},
        )
        self.assertEqual(status, 200)
        self.assertTrue(all("Max-Age=0" in c for c in cookies), cookies)
        logout = urllib.parse.urlsplit(document["logoutUrl"])
        self.assertEqual(f"{logout.scheme}://{logout.netloc}", "https://kc.audit.test")
        query = urllib.parse.parse_qs(logout.query)
        # `_validate_secure_url` strips the trailing slash the handler appended.
        self.assertEqual(query["post_logout_redirect_uri"], [PUBLIC_URL])
        self.assertIn("id_token_hint", query)
        status, _, _, _ = self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: session})
        self.assertEqual(status, 401)

    def test_logout_without_a_session_still_answers_and_hints_nothing(self) -> None:
        status, document, _, _ = self.json_request("POST", "/logout", {})
        self.assertEqual(status, 200)
        self.assertNotIn("id_token_hint", document["logoutUrl"])

    def test_a_get_on_logout_does_nothing(self) -> None:
        session = self.login("alice")
        status, _, _, _ = self.request("GET", "/logout", cookies={SESSION_COOKIE: session})
        self.assertEqual(status, 404)
        status, _, _, _ = self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: session})
        self.assertEqual(status, 200)

    @unittest.expectedFailure
    def test_cookie_names_carry_the_host_prefix(self) -> None:
        """S268-1: without `__Host-` a sibling subdomain can toss `quiltor_login_state`
        (Domain=quiltor.app) and so pin a victim's callback to the attacker's login."""
        header = self._session_cookie_header()
        self.assertTrue(header.startswith("__Host-"), header.split("=", 1)[0])


class LoginCapacityTests(HostedHarness):
    """1.14 pending logins, 1.15 session capacity."""

    def test_anonymous_login_starts_evict_the_oldest_pending_login(self) -> None:
        """S268-2: 257 anonymous `GET /login` bring another browser's login down."""
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        for _ in range(256):
            self.begin_login()
        _, headers, _, _ = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        # Documents the present behaviour: the victim's login is gone.
        self.assertEqual(headers["location"], "/?authError=expired")

    @unittest.expectedFailure
    def test_an_anonymous_flood_of_login_starts_does_not_break_a_login_in_progress(self) -> None:
        """S268-2: this has to turn green once logins of other browsers are not evicted
        (a per-address cap, or pending entries that expire the flooder first)."""
        self.provider.add_account("alice")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "alice")
        for _ in range(300):
            self.begin_login()
        _, headers, _, _ = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        self.assertEqual(headers["location"], "/")

    def test_a_flood_does_not_cost_a_provider_request_per_start(self) -> None:
        self.begin_login()
        before = len(self.provider.requests)
        for _ in range(50):
            self.begin_login()
        self.assertEqual(len(self.provider.requests), before, "discovery is cached")

    def test_pending_logins_never_exceed_the_cap_and_expire(self) -> None:
        for _ in range(300):
            self.begin_login()
        self.assertLessEqual(len(self.gateway._pending), 256)
        self.clock.advance(601)
        self.begin_login()
        self.assertEqual(len(self.gateway._pending), 1)

    def _fill_sessions(self, count: int) -> None:
        for index in range(count):
            self.gateway.create_session(f"filler-{index}", "", "")

    def test_a_full_session_store_turns_the_callback_into_a_500_without_interna(self) -> None:
        """S268-3: one account that logs in 4096 times locks everybody else out."""
        self._fill_sessions(4096)
        self.provider.add_account("bob")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "bob")
        status, _headers, body, set_cookies = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        self.assertEqual(status, 500)
        self.assertNotIn(b"capacity", body.lower())
        self.assertNotIn(b"Traceback", body)
        self.assertFalse([c for c in set_cookies if c.startswith(SESSION_COOKIE + "=")])

    @unittest.expectedFailure
    def test_one_account_cannot_fill_the_session_store_for_everybody(self) -> None:
        """S268-3: sessions of one `sub` are capped, or the oldest session of the same
        `sub` is replaced, so the global capacity cannot be taken by one account."""
        for _ in range(4100):
            try:
                self.gateway.create_session("greedy", "", "")
            except RuntimeError:
                break
        self.provider.add_account("bob")
        location, state, cookie = self.begin_login()
        code = self.provider.authorize(location, "bob")
        _, headers, _, _ = self.request(
            "GET", f"/auth/callback?code={code}&state={state}", cookies={STATE_COOKIE: cookie}
        )
        self.assertEqual(headers["location"], "/")

    def test_sessions_of_expired_logins_make_room_again(self) -> None:
        self._fill_sessions(4096)
        self.clock.advance(24 * 3600 + 1)
        self.provider.add_account("bob")
        self.assertTrue(self.login("bob"))


if __name__ == "__main__":
    unittest.main()
