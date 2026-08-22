from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
import unittest
import urllib.parse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from quiltor.infrastructure.identity.runtime import (
    MAX_OIDC_RESPONSE_BYTES,
    MAX_TOKEN_RESPONSE_BYTES,
    StdlibIdentityGateway,
)
from quiltor.modules.identity.auth import (
    IdentityConfiguration,
    PENDING_LOGIN_TTL,
    decode_id_token_claims,
    validate_claims,
)


class _LoopbackHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self._respond()

    def do_POST(self) -> None:
        self._respond()

    def _respond(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(length) if length else b""
        path = urllib.parse.urlsplit(self.path).path
        self.server.requests.append((self.command, path, request_body))
        status, headers, response_body = self.server.routes.get(
            (self.command, path),
            (404, {"Content-Type": "application/json"}, b"{}"),
        )
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        try:
            self.wfile.write(response_body)
        except (BrokenPipeError, ConnectionResetError):
            # An oversized-response rejection deliberately closes the connection
            # after reading its bounded prefix.
            pass

    def log_message(self, _format: str, *_args) -> None:
        pass


@contextmanager
def _loopback_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _LoopbackHandler)
    server.daemon_threads = True
    server.routes = {}
    server.requests = []
    host, port = server.server_address
    server.base_url = f"http://{host}:{port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _json_response(document: dict) -> tuple[int, dict[str, str], bytes]:
    return (
        200,
        {"Content-Type": "application/json; charset=utf-8"},
        json.dumps(document).encode("utf-8"),
    )


def _discovery_document(base_url: str) -> dict[str, str]:
    return {
        "issuer": base_url,
        "authorization_endpoint": f"{base_url}/authorize",
        "token_endpoint": f"{base_url}/token",
        "jwks_uri": f"{base_url}/jwks",
    }


class _Transport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, bytes | None, dict[str, str]]] = []
        self.tokens = {"access_token": "access", "refresh_token": "refresh"}

    def request(self, url, data=None, headers=None):
        self.calls.append((url, data, dict(headers or {})))
        if url.endswith("/.well-known/openid-configuration"):
            return {
                "issuer": "https://issuer.test",
                "authorization_endpoint": "https://issuer.test/authorize",
                "token_endpoint": "https://issuer.test/token",
                "jwks_uri": "https://issuer.test/jwks",
                "end_session_endpoint": "https://issuer.test/logout",
            }
        return dict(self.tokens)


class IdentityRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = 1_000.0
        self.serial = 0
        self.transport = _Transport()

        def token_factory(size: int) -> str:
            self.serial += 1
            return (f"token-{size}-{self.serial}-" + "x" * size)[: max(43, size)]

        self.runtime = StdlibIdentityGateway(
            IdentityConfiguration("https://issuer.test/", "quiltor-demo", "client-secret"),
            transport=self.transport,
            clock=lambda: self.now,
            token_factory=token_factory,
        )

    def test_configuration_is_injected_and_normalized(self) -> None:
        self.assertTrue(self.runtime.enabled)
        self.assertEqual(self.runtime.issuer, "https://issuer.test")
        self.assertEqual(self.runtime.client_id, "quiltor-demo")

    def test_discovery_is_instance_scoped_and_cached(self) -> None:
        first = self.runtime.discover()
        second = self.runtime.discover()
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        self.assertEqual(len(self.transport.calls), 1)

    def test_pkce_pair_has_the_expected_challenge_and_unique_state(self) -> None:
        verifier, challenge = self.runtime.new_pkce_pair()
        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
            .rstrip(b"=")
            .decode("ascii")
        )
        self.assertEqual(challenge, expected)
        self.assertNotEqual(self.runtime.new_state(), self.runtime.new_state())

    def test_start_login_records_single_use_state(self) -> None:
        url, state = self.runtime.start_login("https://app.test/auth/callback")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(query["state"], [state])
        self.assertEqual(query["client_id"], ["quiltor-demo"])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["nonce"], [self.runtime._pending[state]["nonce"]])
        pending = self.runtime.consume_pending_login(state)
        self.assertEqual(pending["redirect_uri"], "https://app.test/auth/callback")
        self.assertIsNone(self.runtime.consume_pending_login(state))

    def test_pending_login_expires_against_injected_clock(self) -> None:
        _, state = self.runtime.start_login("https://app.test/callback")
        self.now += PENDING_LOGIN_TTL + 1
        self.assertIsNone(self.runtime.consume_pending_login(state))

    def test_exchange_and_refresh_use_injected_transport(self) -> None:
        exchanged = self.runtime.exchange_code("code", "verifier", "https://app.test/cb")
        refreshed = self.runtime.refresh_tokens("refresh")
        self.assertEqual(exchanged["access_token"], "access")
        self.assertEqual(refreshed["refresh_token"], "refresh")
        exchange_fields = urllib.parse.parse_qs(self.transport.calls[-2][1].decode("ascii"))
        self.assertEqual(exchange_fields["code_verifier"], ["verifier"])
        self.assertEqual(exchange_fields["client_secret"], ["client-secret"])

    def test_session_lifecycle_and_owner_reuse_are_instance_scoped(self) -> None:
        first = self.runtime.create_session("alice", "a@example.test", "Alice")
        self.assertEqual(self.runtime.get_session(first).sub, "alice")
        owner_a, _ = self.runtime.owner_session("local-owner")
        owner_b, _ = self.runtime.owner_session("local-owner")
        self.assertEqual(owner_a, owner_b)
        other = StdlibIdentityGateway(IdentityConfiguration())
        self.assertIsNone(other.get_session(first))
        self.runtime.destroy_session(first)
        self.assertIsNone(self.runtime.get_session(first))

    def test_sessions_expire_against_injected_clock(self) -> None:
        session_id = self.runtime.create_session("alice", "", "", ttl=10)
        self.now += 11
        self.assertIsNone(self.runtime.get_session(session_id))

    def test_pending_and_session_stores_have_hard_caps(self) -> None:
        with patch("quiltor.infrastructure.identity.runtime.MAX_PENDING_LOGINS", 2):
            self.runtime.start_login("https://app.test/one")
            self.runtime.start_login("https://app.test/two")
            # Pending attempts evict the oldest bounded record, so attacker
            # traffic cannot grow memory without limit.
            self.runtime.start_login("https://app.test/three")
            self.assertEqual(len(self.runtime._pending), 2)
        with patch("quiltor.infrastructure.identity.runtime.MAX_SESSIONS", 2):
            self.runtime.create_session("one", "", "")
            self.runtime.create_session("two", "", "")
            with self.assertRaises(RuntimeError):
                self.runtime.create_session("three", "", "")

    def test_logout_url_comes_from_discovery(self) -> None:
        url = self.runtime.end_session_url(post_logout_redirect_uri="https://app.test/")
        self.assertTrue(url.startswith("https://issuer.test/logout?"))


class ConcreteOidcTransportSecurityTests(unittest.TestCase):
    @staticmethod
    def _runtime(server, *, client_secret: str = "client-secret") -> StdlibIdentityGateway:
        return StdlibIdentityGateway(
            IdentityConfiguration(
                server.base_url,
                "quiltor-test",
                client_secret,
                allow_insecure_loopback=True,
            )
        )

    @staticmethod
    def _exercise(runtime: StdlibIdentityGateway, endpoint: str):
        if endpoint == "discovery":
            return runtime.discover()
        if endpoint == "token":
            return runtime.exchange_code(
                "authorization-code",
                "pkce-verifier",
                "http://127.0.0.1/callback",
            )
        if endpoint == "jwks":
            return runtime._load_jwks(runtime.issuer)
        raise AssertionError(f"unknown test endpoint {endpoint}")

    def _assert_response_rejected(
        self,
        endpoint: str,
        *,
        content_type: str = "application/json",
        oversized: bool = False,
    ) -> None:
        with _loopback_server() as issuer:
            documents = {
                "discovery": _discovery_document(issuer.base_url),
                "token": {"access_token": "access", "expires_in": 300},
                "jwks": {"keys": [{"kid": "test-key"}]},
            }
            if oversized:
                limit = MAX_TOKEN_RESPONSE_BYTES if endpoint == "token" else MAX_OIDC_RESPONSE_BYTES
                documents[endpoint]["padding"] = "x" * (limit + 1)
            response = (
                200,
                {"Content-Type": content_type},
                json.dumps(documents[endpoint]).encode("utf-8"),
            )
            discovery_path = "/.well-known/openid-configuration"
            issuer.routes[("GET", discovery_path)] = _json_response(
                _discovery_document(issuer.base_url)
            )
            method = "GET"
            route_path = discovery_path
            if endpoint == "token":
                method, route_path = "POST", "/token"
            elif endpoint == "jwks":
                route_path = "/jwks"
            issuer.routes[(method, route_path)] = response

            runtime = self._runtime(issuer)
            with self.assertRaises(ValueError):
                self._exercise(runtime, endpoint)

            self.assertIn(
                (method, route_path),
                [(request_method, path) for request_method, path, _body in issuer.requests],
            )

    def test_plain_http_loopback_requires_explicit_opt_in(self) -> None:
        with _loopback_server() as issuer:
            issuer.routes[("GET", "/.well-known/openid-configuration")] = _json_response(
                _discovery_document(issuer.base_url)
            )
            with self.assertRaises(ValueError):
                StdlibIdentityGateway(IdentityConfiguration(issuer.base_url, "quiltor-test"))
            opted_in = self._runtime(issuer)
            self.assertEqual(opted_in.discover()["issuer"], issuer.base_url)

    def test_discovery_and_jwks_redirects_are_not_followed(self) -> None:
        for endpoint in ("discovery", "jwks"):
            with (
                self.subTest(endpoint=endpoint),
                _loopback_server() as issuer,
                _loopback_server() as sink,
            ):
                discovery_path = "/.well-known/openid-configuration"
                issuer.routes[("GET", discovery_path)] = _json_response(
                    _discovery_document(issuer.base_url)
                )
                route_path = discovery_path if endpoint == "discovery" else "/jwks"
                issuer.routes[("GET", route_path)] = (
                    307,
                    {"Location": f"{sink.base_url}/capture"},
                    b"",
                )

                runtime = self._runtime(issuer)
                with self.assertRaises(ValueError):
                    self._exercise(runtime, endpoint)

                self.assertEqual(sink.requests, [])
                self.assertIn(
                    ("GET", route_path),
                    [(method, path) for method, path, _body in issuer.requests],
                )

    def test_token_redirect_never_replays_client_secret_or_tokens(self) -> None:
        with _loopback_server() as issuer, _loopback_server() as sink:
            issuer.routes[("GET", "/.well-known/openid-configuration")] = _json_response(
                _discovery_document(issuer.base_url)
            )
            issuer.routes[("POST", "/token")] = (
                307,
                {"Location": f"{sink.base_url}/capture"},
                b"",
            )
            runtime = self._runtime(issuer, client_secret="do-not-replay-client-secret")

            with self.assertRaises(ValueError):
                runtime.exchange_code(
                    "do-not-replay-code",
                    "do-not-replay-verifier",
                    "http://127.0.0.1/callback",
                )
            with self.assertRaises(ValueError):
                runtime.refresh_tokens("do-not-replay-refresh-token")

            posted = [
                body
                for method, path, body in issuer.requests
                if (method, path) == ("POST", "/token")
            ]
            self.assertEqual(len(posted), 2)
            exchange = urllib.parse.parse_qs(posted[0].decode("ascii"))
            refresh = urllib.parse.parse_qs(posted[1].decode("ascii"))
            self.assertEqual(exchange["client_secret"], ["do-not-replay-client-secret"])
            self.assertEqual(exchange["code"], ["do-not-replay-code"])
            self.assertEqual(refresh["client_secret"], ["do-not-replay-client-secret"])
            self.assertEqual(refresh["refresh_token"], ["do-not-replay-refresh-token"])
            self.assertEqual(sink.requests, [])

    def test_wrong_content_type_is_rejected_at_every_json_endpoint(self) -> None:
        for endpoint in ("discovery", "token", "jwks"):
            with self.subTest(endpoint=endpoint):
                self._assert_response_rejected(endpoint, content_type="text/plain")

    def test_oversized_json_is_rejected_at_discovery_token_and_jwks(self) -> None:
        for endpoint in ("discovery", "token", "jwks"):
            with self.subTest(endpoint=endpoint):
                self._assert_response_rejected(endpoint, oversized=True)


class CryptographicIdTokenTests(unittest.TestCase):
    ISSUER = "https://issuer.test"
    CLIENT = "quiltor-demo"

    class Transport:
        def __init__(self, owner) -> None:
            self.owner = owner
            self.keys = [owner.jwk(owner.private_key, "key-1")]
            self.jwks_calls = 0

        def request(self, url, data=None, headers=None):
            if url.endswith("/.well-known/openid-configuration"):
                return {
                    "issuer": self.owner.ISSUER,
                    "authorization_endpoint": f"{self.owner.ISSUER}/authorize",
                    "token_endpoint": f"{self.owner.ISSUER}/token",
                    "jwks_uri": f"{self.owner.ISSUER}/jwks",
                }
            if url.endswith("/jwks"):
                self.jwks_calls += 1
                return {"keys": list(self.keys)}
            return {"access_token": "fresh", "expires_in": 300}

    def setUp(self) -> None:
        self.now = time.time()
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.transport = self.Transport(self)
        self.runtime = StdlibIdentityGateway(
            IdentityConfiguration(self.ISSUER, self.CLIENT),
            transport=self.transport,
            clock=lambda: self.now,
        )

    @staticmethod
    def _uint(value: int) -> str:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    @classmethod
    def jwk(cls, key, kid: str) -> dict:
        numbers = key.public_key().public_numbers()
        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": kid,
            "n": cls._uint(numbers.n),
            "e": cls._uint(numbers.e),
        }

    def claims(self, **updates) -> dict:
        claims = {
            "iss": self.ISSUER,
            "sub": "alice",
            "aud": self.CLIENT,
            "exp": int(self.now) + 300,
            "iat": int(self.now),
            "nonce": "expected-nonce",
        }
        claims.update(updates)
        return claims

    def token(self, claims=None, *, key=None, kid="key-1", algorithm="RS256") -> str:
        return jwt.encode(
            claims or self.claims(),
            key or self.private_key,
            algorithm=algorithm,
            headers={"kid": kid},
        )

    def test_valid_signature_and_nonce_are_required(self) -> None:
        verified = self.runtime.verify_id_token(self.token(), "expected-nonce")
        self.assertEqual(verified["sub"], "alice")
        with self.assertRaises(ValueError):
            self.runtime.verify_id_token(self.token(), "wrong-nonce")

    def test_forged_signature_none_and_hmac_confusion_fail_closed(self) -> None:
        forged_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        attacks = [
            self.token(key=forged_key),
            jwt.encode(self.claims(), key="", algorithm="none", headers={"kid": "key-1"}),
            jwt.encode(
                self.claims(),
                key="not-an-rsa-key-but-long-enough-1234",
                algorithm="HS256",
                headers={"kid": "key-1"},
            ),
        ]
        for token in attacks:
            with self.subTest(header=jwt.get_unverified_header(token)):
                with self.assertRaises(ValueError):
                    self.runtime.verify_id_token(token, "expected-nonce")

    def test_unknown_and_duplicate_kids_are_rejected(self) -> None:
        self.runtime.verify_id_token(self.token(), "expected-nonce")
        self.now += 31
        with self.assertRaises(ValueError):
            self.runtime.verify_id_token(self.token(kid="unknown"), "expected-nonce")
        self.assertEqual(self.transport.jwks_calls, 2)

        duplicate = self.jwk(self.private_key, "duplicate")
        self.runtime.clear()
        self.transport.keys = [duplicate, dict(duplicate)]
        with self.assertRaises(ValueError):
            self.runtime.verify_id_token(self.token(kid="duplicate"), "expected-nonce")

    def test_same_kid_key_rotation_refetches_once_after_signature_failure(self) -> None:
        self.runtime.verify_id_token(self.token(), "expected-nonce")
        rotated = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.transport.keys = [self.jwk(rotated, "key-1")]
        self.now += 31
        verified = self.runtime.verify_id_token(self.token(key=rotated), "expected-nonce")
        self.assertEqual(verified["sub"], "alice")
        self.assertEqual(self.transport.jwks_calls, 2)

    def test_claim_boundaries_reject_cross_tenant_or_ambiguous_identity(self) -> None:
        invalid = [
            self.claims(iss="https://evil.test"),
            self.claims(aud="other"),
            self.claims(aud=[self.CLIENT, "other"]),
            self.claims(aud=[self.CLIENT, "other"], azp="other"),
            self.claims(sub=""),
            self.claims(sub="quiltor-internal:local-owner"),
            self.claims(exp=int(self.now) - 120),
            self.claims(iat=int(self.now) + 120),
            self.claims(exp=float(int(self.now) + 300)),
            self.claims(iat=float(int(self.now))),
            self.claims(nbf=float(int(self.now))),
        ]
        for claims in invalid:
            with self.subTest(claims=claims), self.assertRaises(ValueError):
                self.runtime.verify_id_token(self.token(claims), "expected-nonce")


class DiscoveryTrustTests(unittest.TestCase):
    def test_discovery_must_match_issuer_and_keep_every_endpoint_on_a_trusted_origin(self):
        base = {
            "issuer": "https://issuer.test",
            "authorization_endpoint": "https://issuer.test/authorize",
            "token_endpoint": "https://issuer.test/token",
            "jwks_uri": "https://issuer.test/jwks",
        }

        class Transport:
            document = dict(base)

            def request(self, *args, **kwargs):
                return dict(self.document)

        transport = Transport()
        for changed in (
            {"issuer": "https://evil.test"},
            {"token_endpoint": "https://evil.test/token"},
            {"jwks_uri": "http://issuer.test/jwks"},
            {"authorization_endpoint": "https://user@issuer.test/authorize"},
        ):
            transport.document = {**base, **changed}
            runtime = StdlibIdentityGateway(
                IdentityConfiguration("https://issuer.test", "client"),
                transport=transport,
            )
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                runtime.discover()


class PureClaimTests(unittest.TestCase):
    @staticmethod
    def _token(claims: dict) -> str:
        def encoded(value: dict) -> str:
            return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()

        return f"{encoded({'alg': 'RS256'})}.{encoded(claims)}.signature"

    def test_decode_and_validate_matching_claims(self) -> None:
        claims = decode_id_token_claims(
            self._token({"sub": "alice", "iss": "issuer", "aud": ["app"], "exp": 20, "iat": 5})
        )
        self.assertEqual(claims["sub"], "alice")
        validate_claims(claims, issuer="issuer", client_id="app", now=10)

    def test_claim_validation_rejects_each_security_boundary(self) -> None:
        valid = {"sub": "alice", "iss": "issuer", "aud": "app", "exp": 20, "iat": 5}
        cases = (
            ({**valid, "iss": "evil"}, "issuer"),
            ({**valid, "aud": "other"}, "audience"),
            ({**valid, "exp": -100}, "expired"),
        )
        for claims, _ in cases:
            with self.subTest(claims=claims), self.assertRaises(ValueError):
                validate_claims(claims, issuer="issuer", client_id="app", now=10)

    def test_malformed_id_token_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            decode_id_token_claims("not-a-token")


if __name__ == "__main__":
    unittest.main()
