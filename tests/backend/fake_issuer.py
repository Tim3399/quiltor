"""A stand-in for Keycloak, over a real socket.

The backup endpoint verifies tokens by asking its issuer (RFC 7662
introspection), which means the test cannot simply patch a function the way
tests/backend/test_server_auth.py patches `auth.discover`: the endpoint runs as
its own module loaded by path and makes genuine HTTP calls. So it gets a genuine
issuer to call, small enough to reason about.

It counts the introspections it serves, which is what lets a test tell "the
endpoint cached that answer" apart from "the endpoint asked again".
"""
from __future__ import annotations

import http.server
import json
import threading
import urllib.parse


class FakeIssuer:
    """Serves /.well-known/openid-configuration and an introspection endpoint."""

    def __init__(self) -> None:
        self.tokens: dict[str, dict] = {}
        self.introspections = 0
        self._httpd: http.server.HTTPServer | None = None
        self._thread: threading.Thread | None = None

    # ---------------------------------------------------------------- tokens

    def issue(self, token: str, *, sub: str, scopes: str = "quiltor.backup") -> str:
        """Register a token the issuer will call active. Returns it, for brevity."""
        self.tokens[token] = {"active": True, "sub": sub, "scope": scopes}
        return token

    def revoke(self, token: str) -> None:
        self.tokens.pop(token, None)

    # ----------------------------------------------------------------- serve

    @property
    def url(self) -> str:
        assert self._httpd is not None, "start() first"
        return f"http://127.0.0.1:{self._httpd.server_address[1]}"

    def start(self) -> "FakeIssuer":
        issuer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _json(self, payload: dict) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                if self.path == "/.well-known/openid-configuration":
                    return self._json({"issuer": issuer.url,
                                       "introspection_endpoint": f"{issuer.url}/introspect"})
                self.send_error(404)

            def do_POST(self) -> None:
                if self.path != "/introspect":
                    return self.send_error(404)
                length = int(self.headers.get("Content-Length") or 0)
                fields = urllib.parse.parse_qs(self.rfile.read(length).decode("ascii"))
                token = (fields.get("token") or [""])[0]
                issuer.introspections += 1
                # An unknown token gets the same answer a real provider gives for
                # an expired or revoked one: active is false, and nothing else.
                return self._json(issuer.tokens.get(token, {"active": False}))

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
