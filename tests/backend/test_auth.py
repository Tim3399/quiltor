import base64
import hashlib
import io
import json
import time
import unittest
import urllib.error
from unittest.mock import patch

from backend import auth


def _fake_response(payload: dict, status: int = 200):
    body = json.dumps(payload).encode("utf-8")

    class _Response:
        def read(self):
            return body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    return _Response()


class AuthConfigTestCase(unittest.TestCase):
    """Base class that patches the module-level OIDC config, following the
    existing convention (see test_storage.py) of monkeypatching module globals
    instead of relying on env vars + reimport."""

    def setUp(self):
        self.original = (auth.ISSUER, auth.CLIENT_ID, auth.CLIENT_SECRET, auth.OIDC_ENABLED)
        auth.ISSUER = "https://kc.example.com/realms/quiltor"
        auth.CLIENT_ID = "quiltor-demo"
        auth.CLIENT_SECRET = "s3cret"
        auth.OIDC_ENABLED = True
        auth._discovery_cache.clear()
        auth.SESSIONS.clear()
        auth.PENDING_LOGINS.clear()

    def tearDown(self):
        auth.ISSUER, auth.CLIENT_ID, auth.CLIENT_SECRET, auth.OIDC_ENABLED = self.original
        auth._discovery_cache.clear()
        auth.SESSIONS.clear()
        auth.PENDING_LOGINS.clear()


class PkceAndStateTests(unittest.TestCase):
    def test_pkce_verifier_is_within_spec_length_and_charset(self):
        verifier, challenge = auth.new_pkce_pair()
        self.assertTrue(43 <= len(verifier) <= 128)
        self.assertTrue(
            set(verifier) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        )
        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
            .rstrip(b"=")
            .decode("ascii")
        )
        self.assertEqual(challenge, expected)

    def test_pkce_pairs_are_unique(self):
        first = auth.new_pkce_pair()
        second = auth.new_pkce_pair()
        self.assertNotEqual(first, second)

    def test_state_values_are_unique(self):
        self.assertNotEqual(auth.new_state(), auth.new_state())


class DiscoveryAndLoginTests(AuthConfigTestCase):
    def test_discover_fetches_and_caches_the_configuration_document(self):
        document = {
            "authorization_endpoint": "https://kc.example.com/auth",
            "token_endpoint": "https://kc.example.com/token",
        }
        with patch(
            "backend.auth.urllib.request.urlopen", return_value=_fake_response(document)
        ) as mocked:
            first = auth.discover()
            second = auth.discover()
        self.assertEqual(first, document)
        self.assertEqual(second, document)
        mocked.assert_called_once()  # second call served from cache

    def test_start_login_registers_a_pending_login_and_builds_the_authorize_url(self):
        document = {
            "authorization_endpoint": "https://kc.example.com/auth",
            "token_endpoint": "https://kc.example.com/token",
        }
        with patch("backend.auth.urllib.request.urlopen", return_value=_fake_response(document)):
            authorize_url, state = auth.start_login("https://demo.example.com/auth/callback")
        self.assertIn("https://kc.example.com/auth?", authorize_url)
        self.assertIn(f"state={state}", authorize_url)
        self.assertIn("code_challenge_method=S256", authorize_url)
        self.assertIn(state, auth.PENDING_LOGINS)

    def test_consume_pending_login_is_single_use(self):
        auth.PENDING_LOGINS["abc"] = {
            "verifier": "v",
            "redirect_uri": "r",
            "created_at": time.time(),
        }
        first = auth.consume_pending_login("abc")
        second = auth.consume_pending_login("abc")
        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_consume_pending_login_rejects_expired_entries(self):
        auth.PENDING_LOGINS["stale"] = {
            "verifier": "v",
            "redirect_uri": "r",
            "created_at": time.time() - auth.PENDING_LOGIN_TTL - 1,
        }
        self.assertIsNone(auth.consume_pending_login("stale"))

    def test_consume_pending_login_rejects_unknown_state(self):
        self.assertIsNone(auth.consume_pending_login("never-issued"))


class ExchangeCodeTests(AuthConfigTestCase):
    def test_exchange_code_posts_to_the_token_endpoint_and_returns_tokens(self):
        discovery = {
            "authorization_endpoint": "https://kc.example.com/auth",
            "token_endpoint": "https://kc.example.com/token",
        }
        tokens = {"access_token": "at", "id_token": "it", "token_type": "Bearer"}
        responses = [_fake_response(discovery), _fake_response(tokens)]
        with patch("backend.auth.urllib.request.urlopen", side_effect=responses):
            result = auth.exchange_code(
                "the-code", "the-verifier", "https://demo.example.com/auth/callback"
            )
        self.assertEqual(result, tokens)

    def test_exchange_code_raises_on_http_error_from_the_provider(self):
        discovery = {
            "authorization_endpoint": "https://kc.example.com/auth",
            "token_endpoint": "https://kc.example.com/token",
        }

        def side_effect(request, timeout=15, context=None):
            if "well-known" in request.full_url:
                return _fake_response(discovery)
            raise urllib.error.HTTPError(
                request.full_url,
                400,
                "Bad Request",
                hdrs=None,
                fp=io.BytesIO(b'{"error":"invalid_grant"}'),
            )

        with patch("backend.auth.urllib.request.urlopen", side_effect=side_effect):
            with self.assertRaises(ValueError):
                auth.exchange_code("bad-code", "verifier", "https://demo.example.com/auth/callback")


class IdTokenClaimTests(unittest.TestCase):
    @staticmethod
    def _make_id_token(claims: dict) -> str:
        def b64(segment: dict) -> str:
            return (
                base64.urlsafe_b64encode(json.dumps(segment).encode("utf-8"))
                .rstrip(b"=")
                .decode("ascii")
            )

        return f"{b64({'alg': 'RS256'})}.{b64(claims)}.signature-not-checked"

    def test_decode_id_token_claims_reads_the_payload_segment(self):
        token = self._make_id_token(
            {"sub": "user-1", "email": "a@example.com", "exp": time.time() + 60}
        )
        claims = auth.decode_id_token_claims(token)
        self.assertEqual(claims["sub"], "user-1")

    def test_decode_id_token_claims_rejects_malformed_tokens(self):
        with self.assertRaises(ValueError):
            auth.decode_id_token_claims("not-a-jwt")

    def test_validate_claims_accepts_matching_issuer_audience_and_future_expiry(self):
        claims = {
            "iss": "https://kc.example.com/realms/quiltor",
            "aud": "quiltor-demo",
            "exp": time.time() + 60,
        }
        auth.validate_claims(
            claims, issuer="https://kc.example.com/realms/quiltor", client_id="quiltor-demo"
        )  # no raise

    def test_validate_claims_accepts_audience_as_a_list(self):
        claims = {
            "iss": "https://kc.example.com/realms/quiltor",
            "aud": ["other", "quiltor-demo"],
            "exp": time.time() + 60,
        }
        auth.validate_claims(
            claims, issuer="https://kc.example.com/realms/quiltor", client_id="quiltor-demo"
        )  # no raise

    def test_validate_claims_rejects_wrong_issuer(self):
        claims = {"iss": "https://evil.example.com", "aud": "quiltor-demo", "exp": time.time() + 60}
        with self.assertRaises(ValueError):
            auth.validate_claims(
                claims, issuer="https://kc.example.com/realms/quiltor", client_id="quiltor-demo"
            )

    def test_validate_claims_rejects_wrong_audience(self):
        claims = {
            "iss": "https://kc.example.com/realms/quiltor",
            "aud": "someone-else",
            "exp": time.time() + 60,
        }
        with self.assertRaises(ValueError):
            auth.validate_claims(
                claims, issuer="https://kc.example.com/realms/quiltor", client_id="quiltor-demo"
            )

    def test_validate_claims_rejects_expired_token(self):
        claims = {
            "iss": "https://kc.example.com/realms/quiltor",
            "aud": "quiltor-demo",
            "exp": time.time() - 60,
        }
        with self.assertRaises(ValueError):
            auth.validate_claims(
                claims, issuer="https://kc.example.com/realms/quiltor", client_id="quiltor-demo"
            )


class SessionStoreTests(AuthConfigTestCase):
    def test_create_get_destroy_round_trip(self):
        session_id = auth.create_session("user-1", "a@example.com", "Alice")
        session = auth.get_session(session_id)
        self.assertIsNotNone(session)
        self.assertEqual(session.sub, "user-1")
        auth.destroy_session(session_id)
        self.assertIsNone(auth.get_session(session_id))

    def test_get_session_returns_none_for_unknown_id(self):
        self.assertIsNone(auth.get_session("does-not-exist"))
        self.assertIsNone(auth.get_session(None))

    def test_get_session_expires_stale_sessions(self):
        session_id = auth.create_session("user-1", "a@example.com", "Alice")
        auth.SESSIONS[session_id].expires_at = time.time() - 1
        self.assertIsNone(auth.get_session(session_id))
        self.assertNotIn(session_id, auth.SESSIONS)

    def test_create_session_with_custom_ttl_expires_early(self):
        session_id = auth.create_session("user-1", "a@example.com", "Alice", ttl=0.01)
        time.sleep(0.02)
        self.assertIsNone(auth.get_session(session_id))

    def test_two_sessions_get_distinct_ids(self):
        first = auth.create_session("user-1", "a@example.com", "Alice")
        second = auth.create_session("user-2", "b@example.com", "Bob")
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
