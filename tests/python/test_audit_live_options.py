"""T-271 audit L2, check L-L2: OPTIONS against a hosted Quiltor answers no CORS.

The live test sends only GET and HEAD (F-268-4), so the preflight a browser would send
is checked here, against a hosted server (OIDC on, public URL set, secure cookies).
`Handler` defines no `do_OPTIONS`, so the standard library answers 501; what matters
is that no `Access-Control-*` header grants a foreign origin anything.

L-L1 (Origin guard) and L-L3 (HEAD) are covered by T-268 (1.11, S268-8) and are not
repeated here.
"""

from __future__ import annotations

import http.client
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.delivery.http import routes as api_routes
from quiltor.hosts.web import server
from quiltor.infrastructure.platform.ports import AppDirectories

api_routes.load()

PUBLIC_URL = "https://quiltor.audit.test"
FOREIGN = "https://evil.example"


class OptionsPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.env = patch.dict(
            os.environ,
            {"QUILTOR_PUBLIC_URL": PUBLIC_URL, "QUILTOR_COOKIE_SECURE": "1"},
        )
        self.env.start()
        inference = MagicMock(identity="audit-inference")
        inference.status.return_value = {"available": False, "mode": "local", "reason": "test"}
        identity = build_identity(
            True,
            issuer="https://issuer.audit.invalid/realms/quiltor",
            client_id="quiltor",
            client_secret="audit-only",
        )
        self.app = build_web_application(
            identity=identity,
            ensure_assistant_installed=False,
            inference=inference,
            app_directories=AppDirectories(
                data=root,
                config=root / "config",
                cache=root / "cache",
                models=root / "models",
                logs=root / "logs",
                temp=root / "temp",
            ),
        )
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.app)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.app.close()
        self.env.stop()
        self.temp.cleanup()

    def preflight(self, path: str) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(
                "OPTIONS",
                path,
                headers={
                    "Host": "quiltor.audit.test",
                    "Origin": FOREIGN,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            response = connection.getresponse()
            headers = {k.lower(): v for k, v in response.getheaders()}
            return response.status, headers, response.read()
        finally:
            connection.close()

    def test_a_preflight_from_a_foreign_origin_is_granted_nothing(self) -> None:
        for path in ("/api/version", "/api/state", "/api/whoami", "/logout", "/"):
            with self.subTest(path=path):
                status, headers, _ = self.preflight(path)
                self.assertEqual(status, 501, path)
                granted = sorted(k for k in headers if k.startswith("access-control-"))
                self.assertEqual(granted, [], path)
                self.assertNotIn("set-cookie", headers, path)

    def test_the_501_body_names_no_interpreter_or_path(self) -> None:
        _, headers, body = self.preflight("/api/state")
        text = body.decode("utf-8", "replace")
        for leak in ("Traceback", 'File "', "src/quiltor", "\\quiltor\\"):
            self.assertNotIn(leak, text)
        # The stdlib Server header carries the Python version; that is S271 material
        # for the live report (L-Q2), recorded here so a local run shows it too.
        self.assertIn("server", headers)


if __name__ == "__main__":
    unittest.main()
