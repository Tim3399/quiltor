"""Shared fixtures for the T-268 backup-server audit tests (package D3).

Nothing here is a test. The module only carries what the three audit files share:
a scripted introspection endpoint that can lie in every way the stock FakeIssuer
cannot (audience, authorized party, 5xx, timeouts, redirects, broken framing), a
fake clock, and an in-process backup server whose handler errors are recorded
instead of printed. Everything listens on loopback only, on ports the OS picks.
"""

from __future__ import annotations

import http.client
import http.server
import json
import tempfile
import threading
import unittest
import urllib.parse
from pathlib import Path
from typing import Any

from tests.python.module_loader import load_module_from_path

REFERENCE_SERVER = Path(__file__).resolve().parents[2] / "services" / "backup-server" / "server.py"
SCOPE = "quiltor.backup"
PUBLIC_URL = "https://backup.example.test"
CLIENT_TIMEOUT = 10


class FakeClock:
    """A settable replacement for the `time` module the server reads."""

    def __init__(self, now: float = 1_800_000_000.0) -> None:
        self.now = now

    def time(self) -> float:
        return self.now

    def __getattr__(self, name: str) -> Any:
        import time

        return getattr(time, name)


class ScriptedIssuer:
    """Discovery plus introspection with a script for how to misbehave.

    `tokens` maps a token to the exact introspection document to answer with, so a
    test decides which claims (`aud`, `azp`, `typ`, `exp`, ...) exist. `mode` picks
    the failure shape; "ok" answers from `tokens`, an unknown token is inactive.
    """

    def __init__(self) -> None:
        self.tokens: dict[str, Any] = {}
        self.mode = "ok"
        self.introspections = 0
        self.seen_client_ids: list[str] = []
        self.redirect_to = ""
        self.delay = 0.0
        self.discovery_introspection_endpoint: str | None = None
        self.discovery_issuer: str | None = None
        self._httpd: http.server.ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        assert self._httpd is not None
        return f"http://127.0.0.1:{self._httpd.server_address[1]}"

    def grant(self, token: str, *, sub: str = "account-a", **claims: Any) -> str:
        document: dict[str, Any] = {"active": True, "sub": sub, "scope": SCOPE}
        document.update(claims)
        self.tokens[token] = document
        return token

    def start(self) -> ScriptedIssuer:
        issuer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _send(self, status: int, body: bytes, extra: dict[str, str] | None = None) -> None:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for key, value in (extra or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                if self.path == "/.well-known/openid-configuration":
                    endpoint = issuer.discovery_introspection_endpoint or f"{issuer.url}/introspect"
                    document = {
                        "issuer": issuer.discovery_issuer or issuer.url,
                        "introspection_endpoint": endpoint,
                    }
                    return self._send(200, json.dumps(document).encode())
                self._send(404, b"{}")

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                fields = urllib.parse.parse_qs(self.rfile.read(length).decode("ascii"))
                issuer.introspections += 1
                issuer.seen_client_ids.append((fields.get("client_id") or [""])[0])
                if issuer.delay:
                    import time

                    time.sleep(issuer.delay)
                token = (fields.get("token") or [""])[0]
                mode = issuer.mode
                if mode == "redirect":
                    return self._send(302, b"{}", {"Location": issuer.redirect_to})
                if mode == "500":
                    return self._send(500, b'{"error":"boom"}')
                if mode == "bad_json":
                    return self._send(200, b"{not json")
                if mode == "list":
                    return self._send(200, b"[]")
                if mode == "huge":
                    return self._send(200, b'{"active":true,"pad":"' + b"x" * 70_000 + b'"}')
                if mode == "garbage":
                    self.close_connection = True
                    self.wfile.write(b"NOT-HTTP garbage\r\n\r\n")
                    return None
                document = issuer.tokens.get(token, {"active": False})
                if mode == "active_string":
                    document = {**document, "active": "true"}
                return self._send(200, json.dumps(document).encode())

            def log_message(self, format: str, *args: Any) -> None:
                pass

        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._httpd.daemon_threads = True
        self._thread = threading.Thread(
            target=self._httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)


class Recorder:
    """Collects the handler exceptions a Server subclass would otherwise print."""

    def __init__(self) -> None:
        self.errors: list[BaseException | None] = []


_module_counter = 0


def load_server(root: Path, issuer_url: str) -> Any:
    """The reference server as a fresh module, pointed at `root` and the issuer."""
    global _module_counter
    _module_counter += 1
    module = load_module_from_path(f"quiltor_audit268_backup_{_module_counter}", REFERENCE_SERVER)
    module.ROOT = root
    module.ISSUER = issuer_url
    module.CLIENT_ID = "quiltor-backup-server"
    module.CLIENT_SECRET = "not-a-real-secret"
    module.REQUIRED_SCOPE = SCOPE
    module.PUBLIC_URL = PUBLIC_URL
    module.ALLOW_INSECURE_LOOPBACK = True
    module.TRUSTED_ENDPOINT_ORIGINS = ()
    module.POLICY_FILE = ""
    module.POLICIES = {}
    module._discovery.clear()
    module._tokens.clear()
    module._account_locks.clear()
    return module


class BackupServerCase(unittest.TestCase):
    """An in-process backup server with a scripted issuer, torn down per test."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / "served"
        self.root.mkdir()
        self.issuer = ScriptedIssuer().start()
        self.addCleanup(self.issuer.stop)
        self.server_module = load_server(self.root, self.issuer.url)
        self.recorder = Recorder()
        self.httpd = self._make_server()
        self.thread = threading.Thread(
            target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self.thread.start()
        self.addCleanup(self._stop_server)
        self.port = self.httpd.server_address[1]

    def _make_server(self):
        module = self.server_module
        recorder = self.recorder

        class RecordingServer(module.Server):
            def handle_error(self, request, client_address) -> None:
                import sys

                recorder.errors.append(sys.exc_info()[1])

        return RecordingServer(("127.0.0.1", 0), module.Handler)

    def _stop_server(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        token: str | None = "token-a",
        headers: dict[str, str] | None = None,
        timeout: float = CLIENT_TIMEOUT,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        try:
            sent = dict(headers or {})
            if token is not None:
                sent["Authorization"] = f"Bearer {token}"
            connection.request(method, path, body=body, headers=sent)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def stored_files(self) -> list[Path]:
        return sorted(p for p in self.root.rglob("*") if p.is_file())
