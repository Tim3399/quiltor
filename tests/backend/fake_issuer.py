"""A stand-in for Keycloak, over a real socket.

The backup endpoint verifies tokens by asking its issuer (RFC 7662
introspection), which means the test cannot simply patch a function the way
tests/backend/test_server_auth.py patches `auth.discover`: the endpoint runs as
its own module loaded by path and makes genuine HTTP calls. So it gets a genuine
issuer to call, small enough to reason about.

It serves both halves of the provider a client meets: the authorization and
token endpoints a login goes through (backend/backup_login.py), and the
introspection endpoint the backup server checks the result with. One fake for
both is the point -- a token minted here really is a token the endpoint accepts,
so a test can drive a login and then upload with what it produced, instead of
asserting that two separate fakes agree with each other.

It counts the introspections and token grants it serves, which is what lets a
test tell "that answer was cached" apart from "it asked again", and "the client
refreshed" apart from "the client reused what it had".
"""
from __future__ import annotations

import base64
import hashlib
import http.server
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def _b64(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).rstrip(b"=").decode("ascii")


class FakeIssuer:
    """Serves discovery, /authorize, /token and /introspect."""

    def __init__(self) -> None:
        self.tokens: dict[str, dict] = {}
        self.introspections = 0
        self.token_grants = 0
        #: Codes handed out by /authorize, keyed by the code itself.
        self.codes: dict[str, dict] = {}
        #: Refresh tokens still good, mapped to the account they belong to.
        self.refresh_tokens: dict[str, dict] = {}
        #: How long an access token this issuer mints stays valid. A test that
        #: wants to exercise the refresh path sets this to 0.
        self.access_ttl = 300
        #: Who the browser signs in as. There is no login form -- /authorize
        #: hands out a code straight away, because what is under test is the
        #: client's half of the exchange, not Keycloak's.
        self.account = {"sub": "tester", "email": "tester@example.test", "name": "Test Person"}
        self._httpd: http.server.HTTPServer | None = None
        self._thread: threading.Thread | None = None

    # ---------------------------------------------------------------- tokens

    def issue(self, token: str, *, sub: str, scopes: str = "quiltor.backup") -> str:
        """Register a token the issuer will call active. Returns it, for brevity."""
        self.tokens[token] = {"active": True, "sub": sub, "scope": scopes}
        return token

    def revoke(self, token: str) -> None:
        self.tokens.pop(token, None)

    def sign_in_as(self, sub: str, email: str = "", name: str = "") -> None:
        """Who the next authorization will be granted for."""
        self.account = {"sub": sub, "email": email, "name": name}

    # ------------------------------------------------------------ the browser

    def authorize(self, authorize_url: str) -> tuple[str, str]:
        """Play the browser: open the authorization URL and read the code and
        state off the redirect it answers with, without following it -- the
        redirect points at a loopback port the test is not listening on."""
        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(authorize_url, timeout=10) as response:
                location = response.headers["Location"]
        except urllib.error.HTTPError as exc:
            if exc.code >= 400:
                raise AssertionError(f"authorize refused: {exc.code} {exc.read().decode()}") from exc
            location = exc.headers["Location"]
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)
        return (query.get("code") or [""])[0], (query.get("state") or [""])[0]

    # ----------------------------------------------------------------- serve

    @property
    def url(self) -> str:
        assert self._httpd is not None, "start() first"
        return f"http://127.0.0.1:{self._httpd.server_address[1]}"

    def _grant(self, scope: str) -> dict:
        """Mint an access/refresh/id-token triple for the current account."""
        access = secrets.token_urlsafe(16)
        refresh = secrets.token_urlsafe(16)
        self.issue(access, sub=self.account["sub"], scopes=scope)
        self.refresh_tokens[refresh] = {"scope": scope, "account": dict(self.account)}
        claims = {"iss": self.url, "aud": "quiltor-desktop", "exp": time.time() + 3600,
                  **self.account}
        return {"access_token": access, "refresh_token": refresh, "token_type": "Bearer",
                "expires_in": self.access_ttl, "scope": scope,
                # Unsigned on purpose: the client decodes it without checking a
                # signature (see backend/auth.decode_id_token_claims), so a real
                # signature here would test nothing the client looks at.
                "id_token": f"{_b64({'alg': 'RS256'})}.{_b64(claims)}.signature-not-checked"}

    def start(self) -> "FakeIssuer":
        issuer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _json(self, payload: dict, status: int = 200) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                parts = urllib.parse.urlsplit(self.path)
                if parts.path == "/.well-known/openid-configuration":
                    return self._json({"issuer": issuer.url,
                                       "authorization_endpoint": f"{issuer.url}/authorize",
                                       "token_endpoint": f"{issuer.url}/token",
                                       "introspection_endpoint": f"{issuer.url}/introspect"})
                if parts.path == "/authorize":
                    return self._authorize(urllib.parse.parse_qs(parts.query))
                self.send_error(404)

            def _authorize(self, query: dict) -> None:
                def field(name: str) -> str:
                    return (query.get(name) or [""])[0]

                redirect_uri, state = field("redirect_uri"), field("state")
                if not redirect_uri or not field("client_id"):
                    return self._json({"error": "invalid_request"}, 400)
                if field("code_challenge_method") != "S256" or not field("code_challenge"):
                    # A public client without PKCE is exactly the case this
                    # provider must not let through.
                    return self._json({"error": "invalid_request", "detail": "PKCE required"}, 400)
                code = secrets.token_urlsafe(12)
                issuer.codes[code] = {"challenge": field("code_challenge"), "redirect_uri": redirect_uri,
                                      "scope": field("scope")}
                location = f"{redirect_uri}?{urllib.parse.urlencode({'code': code, 'state': state})}"
                self.send_response(302)
                self.send_header("Location", location)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                fields = urllib.parse.parse_qs(self.rfile.read(length).decode("ascii"))
                if self.path == "/introspect":
                    return self._introspect(fields)
                if self.path == "/token":
                    return self._token(fields)
                self.send_error(404)

            def _introspect(self, fields: dict) -> None:
                token = (fields.get("token") or [""])[0]
                issuer.introspections += 1
                # An unknown token gets the same answer a real provider gives for
                # an expired or revoked one: active is false, and nothing else.
                return self._json(issuer.tokens.get(token, {"active": False}))

            def _token(self, fields: dict) -> None:
                def field(name: str) -> str:
                    return (fields.get(name) or [""])[0]

                issuer.token_grants += 1
                grant = field("grant_type")
                if grant == "authorization_code":
                    pending = issuer.codes.pop(field("code"), None)   # single use
                    if pending is None:
                        return self._json({"error": "invalid_grant"}, 400)
                    digest = hashlib.sha256(field("code_verifier").encode("ascii")).digest()
                    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
                    if challenge != pending["challenge"] or field("redirect_uri") != pending["redirect_uri"]:
                        return self._json({"error": "invalid_grant"}, 400)
                    return self._json(issuer._grant(pending["scope"]))
                if grant == "refresh_token":
                    old = issuer.refresh_tokens.pop(field("refresh_token"), None)
                    if old is None:
                        return self._json({"error": "invalid_grant"}, 400)
                    previous, issuer.account = issuer.account, old["account"]
                    try:
                        return self._json(issuer._grant(old["scope"]))
                    finally:
                        issuer.account = previous
                return self._json({"error": "unsupported_grant_type"}, 400)

            def log_message(self, *args) -> None:
                pass

        self._httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)
