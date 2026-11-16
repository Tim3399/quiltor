"""Shared fixtures for the T-268 identity and authorization audit (package D1).

No test lives here. The audit files import `HostedHarness`, which stands a real
`server.Server` up on a loopback port with the OIDC identity installed, the way the
hosted Docker image runs it, and replaces the identity provider by `FakeProvider`:
a transport that answers discovery, JWKS and the token endpoint in-process, signs
real RS256 ID tokens, checks PKCE and the redirect URI like a provider does, and
can be told to misbehave (5xx, missing fields, withdrawn roles, disabled account).

The gateway's clock is a `FakeClock`, so session lifetimes and refreshes are
driven by `clock.advance()` and no test waits. PyJWT checks `exp`/`iat` against the
real clock, which is why every token is minted around real "now" and the fake clock
only ever moves forward a few hours from the same origin.

Nothing here touches the network, port 8010 or a live host.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import logging
import os
import tempfile
import threading
import time
import unittest
import urllib.parse
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.application import AssistantServices
from quiltor.hosts.web import server
from quiltor.infrastructure.identity.runtime import (
    ProviderUnavailable,
    StdlibIdentityGateway,
    TokenEndpointRejected,
)
from quiltor.infrastructure.platform.ports import AppDirectories
from quiltor.modules.identity.auth import IdentityConfiguration

ISSUER = "https://kc.audit.test/realms/quiltor"
CLIENT_ID = "quiltor-audit"
PUBLIC_URL = "https://quiltor.audit.test"
SESSION_COOKIE = "quiltor_session"
STATE_COOKIE = "quiltor_login_state"
REQUEST_TIMEOUT = 20


class FakeClock:
    """Seconds since the epoch, moved by hand. Starts at the real "now"."""

    def __init__(self) -> None:
        self.start = time.time()
        self.now = self.start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class FakeProvider:
    """Keycloak in a box, speaking the transport interface of the identity gateway."""

    def __init__(self) -> None:
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = "audit-key"
        self.accounts: dict[str, dict[str, Any]] = {}
        self.authorizations: dict[str, dict[str, Any]] = {}
        self.codes: dict[str, dict[str, Any]] = {}
        self.refresh_tokens: dict[str, str] = {}
        self.requests: list[tuple[str, dict[str, str]]] = []
        # How refreshes behave. Each field is read at the moment of the request.
        self.refresh_mode = "ok"  # ok | 5xx | unreachable | invalid_grant | invalid_client
        self.refresh_omits_id_token = False
        self.refresh_omits_refresh_token = False
        self.refresh_omits_expires_in = False
        # The same, for the first exchange at the end of the login.
        self.grant_omits_refresh_token = False
        self.grant_omits_expires_in = False
        self.refresh_id_token_for: str | None = None  # another account's token
        self.access_lifespan = 300
        self.token_claims_override: dict[str, Any] = {}
        self.token_alg_header: str | None = None
        self.sign_with_other_key = False
        self.aud_override: Any = None
        self.issuer_override: str | None = None
        self.omit_nonce = False

    # ------------------------------------------------------------- accounts

    def add_account(
        self, sub: str, *, roles: tuple[str, ...] = (), email: str = "", name: str = ""
    ) -> None:
        self.accounts[sub] = {
            "roles": list(roles),
            "email": email or f"{sub}@audit.test",
            "name": name or sub,
            "disabled": False,
        }

    # ----------------------------------------------------------------- keys

    def _uint(self, value: int) -> str:
        return b64url(value.to_bytes((value.bit_length() + 7) // 8, "big"))

    def jwk(self) -> dict[str, Any]:
        numbers = self.private_key.public_key().public_numbers()
        return {
            "kty": "RSA",
            "kid": self.kid,
            "use": "sig",
            "alg": "RS256",
            "n": self._uint(numbers.n),
            "e": self._uint(numbers.e),
        }

    def sign(self, claims: dict[str, Any], *, kid: str | None = None) -> str:
        key = (
            rsa.generate_private_key(public_exponent=65537, key_size=2048)
            if self.sign_with_other_key
            else self.private_key
        )
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": kid or self.kid})

    def id_token(self, sub: str, *, nonce: str | None) -> str:
        account = self.accounts[sub]
        real_now = int(time.time())
        claims: dict[str, Any] = {
            "iss": self.issuer_override or ISSUER,
            "aud": CLIENT_ID if self.aud_override is None else self.aud_override,
            "sub": sub,
            "iat": real_now,
            "exp": real_now + 7 * 24 * 3600,
            "email": account["email"],
            "name": account["name"],
            "roles": list(account["roles"]),
        }
        if nonce is not None and not self.omit_nonce:
            claims["nonce"] = nonce
        claims.update(self.token_claims_override)
        return self.sign(claims)

    # ------------------------------------------------------------- endpoints

    def discovery(self) -> dict[str, Any]:
        origin = "https://kc.audit.test"
        return {
            "issuer": ISSUER,
            "authorization_endpoint": f"{origin}/auth",
            "token_endpoint": f"{origin}/token",
            "jwks_uri": f"{origin}/certs",
            "end_session_endpoint": f"{origin}/logout",
        }

    def authorize(self, authorize_url: str, sub: str) -> str:
        """Play the browser at the provider: remember the request, hand out a code."""
        query = {
            k: v[0]
            for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(authorize_url).query).items()
        }
        code = f"code-{len(self.codes) + 1}"
        self.codes[code] = {"sub": sub, "request": query}
        self.authorizations[query["state"]] = query
        return code

    def request(
        self, url: str, data: bytes | None = None, headers: dict[str, str] | None = None
    ) -> dict[str, Any]:
        if url.endswith("/.well-known/openid-configuration"):
            self.requests.append(("discovery", {}))
            return self.discovery()
        if url.endswith("/certs"):
            self.requests.append(("jwks", {}))
            return {"keys": [self.jwk()]}
        if url.endswith("/token") and data is not None:
            fields = {k: v[0] for k, v in urllib.parse.parse_qs(data.decode("ascii")).items()}
            self.requests.append((fields.get("grant_type", ""), fields))
            if fields["grant_type"] == "authorization_code":
                return self._code_grant(fields)
            if fields["grant_type"] == "refresh_token":
                return self._refresh_grant(fields)
        raise AssertionError(f"unexpected provider request {url}")

    def _code_grant(self, fields: dict[str, str]) -> dict[str, Any]:
        entry = self.codes.pop(fields["code"], None)
        if entry is None:
            raise TokenEndpointRejected("invalid_grant")
        request = entry["request"]
        challenge = b64url(hashlib.sha256(fields["code_verifier"].encode("ascii")).digest())
        if request.get("code_challenge_method") != "S256" or challenge != request["code_challenge"]:
            raise TokenEndpointRejected("invalid_grant")
        if fields["redirect_uri"] != request["redirect_uri"]:
            raise TokenEndpointRejected("invalid_grant")
        sub = entry["sub"]
        refresh = f"rt-{len(self.refresh_tokens) + 1}"
        self.refresh_tokens[refresh] = sub
        answer: dict[str, Any] = {
            "access_token": f"at-{sub}-{len(self.refresh_tokens)}",
            "id_token": self.id_token(sub, nonce=request.get("nonce")),
        }
        if not self.grant_omits_refresh_token:
            answer["refresh_token"] = refresh
        if not self.grant_omits_expires_in:
            answer["expires_in"] = self.access_lifespan
        return answer

    def _refresh_grant(self, fields: dict[str, str]) -> dict[str, Any]:
        mode = self.refresh_mode
        if mode == "5xx":
            raise ProviderUnavailable("OIDC provider returned HTTP 503.")
        if mode == "unreachable":
            raise ProviderUnavailable("OIDC provider is unreachable.")
        if mode == "invalid_client":
            raise TokenEndpointRejected("invalid_client")
        sub = self.refresh_tokens.pop(fields["refresh_token"], None)
        if sub is None or mode == "invalid_grant" or self.accounts[sub]["disabled"]:
            raise TokenEndpointRejected("invalid_grant")
        answer: dict[str, Any] = {"access_token": f"at-{sub}-r{len(self.requests)}"}
        if not self.refresh_omits_refresh_token:
            refresh = f"rt-{len(self.refresh_tokens) + 100}-{len(self.requests)}"
            self.refresh_tokens[refresh] = sub
            answer["refresh_token"] = refresh
        if not self.refresh_omits_expires_in:
            answer["expires_in"] = self.access_lifespan
        if not self.refresh_omits_id_token:
            answer["id_token"] = self.id_token(self.refresh_id_token_for or sub, nonce=None)
        return answer


class LogCapture(logging.Handler):
    """Collects every structured event the `quiltor` logger emits."""

    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.records: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        fields = getattr(record, "structured_fields", {}) or {}
        self.records.append({"event": record.getMessage(), **fields})

    def text(self) -> str:
        return json.dumps(self.records, default=str)


def make_directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root,
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


def assistant_fakes() -> AssistantServices:
    """A runtime whose status serialises and a job queue that accepts every job."""
    runtime = MagicMock()
    runtime.status.return_value = {"available": False, "reason": ""}
    jobs = MagicMock()
    jobs.submit.return_value = ({"id": "job-1", "status": "queued"}, True)
    return AssistantServices(runtime, jobs)


class HostedHarness(unittest.TestCase):
    """A hosted server (OIDC, public URL, bound to 0.0.0.0) driven over real HTTP.

    Subclasses add `test_*` methods; this class has none of its own. Set the class
    attribute `host_binding = "127.0.0.1"` to run the loopback-bound variant.
    """

    host_binding = "0.0.0.0"
    public_url = PUBLIC_URL

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        env = {
            "QUILTOR_HOST": self.host_binding,
            "QUILTOR_PUBLIC_URL": self.public_url,
            "QUILTOR_LOG_LEVEL": "debug",
        }
        self.env_patch = patch.dict(os.environ, env)
        self.env_patch.start()
        self.clock = FakeClock()
        self.provider = FakeProvider()
        self.gateway = StdlibIdentityGateway(
            IdentityConfiguration(issuer=ISSUER, client_id=CLIENT_ID, client_secret="audit-secret"),
            transport=self.provider,
            clock=self.clock,
            sleep=lambda _seconds: None,
        )
        identity = build_identity(True, gateway=self.gateway)
        with patch(
            "quiltor.bootstrap.web.build_assistant_services", return_value=assistant_fakes()
        ):
            self.application = build_web_application(
                identity=identity,
                ensure_assistant_installed=False,
                app_directories=make_directories(self.root),
            )
        self.application.prepare()
        self.log = LogCapture()
        logging.getLogger("quiltor").addHandler(self.log)
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(
            target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        logging.getLogger("quiltor").removeHandler(self.log)
        self.gateway.clear()
        self.application.close()
        self.env_patch.stop()
        self.temp.cleanup()

    # ----------------------------------------------------------------- HTTP

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        headers: dict[str, str] | None = None,
        cookies: dict[str, str] | None = None,
        raw: bytes | None = None,
    ) -> tuple[int, dict[str, str], bytes, list[str]]:
        """One request on a fresh connection: status, headers (lower-cased), body, Set-Cookie."""
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=REQUEST_TIMEOUT)
        sent = dict(headers or {})
        if cookies:
            sent["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        payload = raw
        if payload is None and body is not None:
            payload = json.dumps(body).encode("utf-8")
            sent.setdefault("Content-Type", "application/json")
        try:
            connection.request(method, path, body=payload, headers=sent)
            response = connection.getresponse()
            data = response.read()
            pairs = response.getheaders()
        finally:
            connection.close()
        set_cookies = [value for key, value in pairs if key.lower() == "set-cookie"]
        return response.status, {k.lower(): v for k, v in pairs}, data, set_cookies

    def json_request(
        self, method: str, path: str, body: Any = None, **kwargs: Any
    ) -> tuple[int, Any, dict[str, str], list[str]]:
        status, headers, data, cookies = self.request(method, path, body, **kwargs)
        try:
            document = json.loads(data) if data else None
        except ValueError:
            document = None
        return status, document, headers, cookies

    # ---------------------------------------------------------------- login

    def begin_login(self, query: str = "") -> tuple[str, str, str]:
        """GET /login: the authorize URL, the state, and the state cookie's value."""
        status, headers, _, cookies = self.request("GET", "/login" + query)
        self.assertEqual(status, 302)
        state_cookie = next(c for c in cookies if c.startswith(STATE_COOKIE + "="))
        value = state_cookie.split(";", 1)[0].split("=", 1)[1]
        location = headers["location"]
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)["state"][0]
        return location, state, value

    def login(self, sub: str, *, roles: tuple[str, ...] = ()) -> str:
        """A complete login as `sub`; the session cookie's value."""
        if sub not in self.provider.accounts:
            self.provider.add_account(sub, roles=roles)
        location, state, state_cookie = self.begin_login()
        code = self.provider.authorize(location, sub)
        status, _, _, cookies = self.request(
            "GET",
            f"/auth/callback?code={code}&state={state}",
            cookies={STATE_COOKIE: state_cookie},
        )
        self.assertEqual(status, 302)
        session = next((c for c in cookies if c.startswith(SESSION_COOKIE + "=")), None)
        self.assertIsNotNone(session, "the callback must set a session cookie")
        assert session is not None
        return session.split(";", 1)[0].split("=", 1)[1]

    def create_world(self, session: str, title: str = "Welt") -> str:
        status, document, _, _ = self.json_request(
            "POST",
            "/api/worlds/create",
            {"title": title, "backupUrl": ""},
            cookies={SESSION_COOKIE: session},
        )
        self.assertEqual(status, 200, document)
        return document["world"]["id"]
