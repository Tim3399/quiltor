"""The local-mode request guard in server.py.

The desktop/CLI build has no authentication at all, and loopback is not a
security boundary in a browser: any page the user visits can send us a
cross-origin request, and a plain HTML form is a CORS-"simple" request that
never triggers a preflight. These pin the three header checks that close
that -- Host, Origin, and Content-Type -- plus the fact that none of them fire
for the reverse-proxied deployment, which binds 0.0.0.0 and has OIDC in front.
"""
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from backend import storage
from backend.backup import SnapshotStore
import server


class _LiveLocalServerTestCase(unittest.TestCase):
    """A real server.Server in local mode: AUTH_ENABLED off, storage redirected
    into a temporary directory so world creation touches nothing real."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)

        self.original_storage = (storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID)
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""

        self.original_server = (server.AUTH_ENABLED, server.MANUSCRIPT_DIR, server.PROFILE_DIR,
                                server.WORLD_BACKUPS, server.BOUND_TO_LOOPBACK)
        server.AUTH_ENABLED = False
        server.MANUSCRIPT_DIR = root / "manuscripts"
        server.PROFILE_DIR = root / "profiles"
        server.WORLD_BACKUPS = SnapshotStore(root / "history")
        server.BOUND_TO_LOOPBACK = True

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        (server.AUTH_ENABLED, server.MANUSCRIPT_DIR, server.PROFILE_DIR,
         server.WORLD_BACKUPS, server.BOUND_TO_LOOPBACK) = self.original_server
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = self.original_storage
        self.temp.cleanup()

    def _request(self, method: str, path: str, body=None, headers=None, content_type="application/json"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = dict(headers or {})
        data = json.dumps(body).encode("utf-8") if body is not None else None
        if data is not None and content_type is not None:
            hdrs.setdefault("Content-Type", content_type)
        conn.request(method, path, body=data, headers=hdrs)
        response = conn.getresponse()
        status, raw = response.status, response.read()
        conn.close()
        return status, json.loads(raw) if raw else {}

    def _create_world(self, **kwargs):
        return self._request("POST", "/api/worlds/create", body={"title": "Testwelt", "backupUrl": ""}, **kwargs)


class RequestsFromTheAppItselfTests(_LiveLocalServerTestCase):
    def test_same_origin_post_is_accepted(self):
        status, body = self._create_world(headers={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_a_request_without_an_origin_still_works(self):
        """curl, the test suite, and the CLI send no Origin. They are not the
        threat being modelled -- a browser always sends one cross-origin."""
        status, body = self._create_world()
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_localhost_is_as_valid_a_host_as_the_loopback_ip(self):
        status, _ = self._request("GET", "/api/version", headers={"Host": f"localhost:{self.port}"})
        self.assertEqual(status, 200)

    def test_the_vite_dev_proxy_still_reaches_us(self):
        """`npm run dev` proxies /api without rewriting Host (changeOrigin is
        false by default), so requests arrive claiming localhost:5173 with a
        matching Origin. Comparing hostnames and ignoring ports is what keeps
        the everyday development workflow working."""
        status, body = self._create_world(headers={"Host": "localhost:5173", "Origin": "http://localhost:5173"})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])


class ForeignRequestTests(_LiveLocalServerTestCase):
    def test_cross_origin_post_is_refused(self):
        """The actual attack: a page on some other site posting to our loopback
        port. Browsers attach Origin to every cross-origin POST."""
        status, body = self._create_world(headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        self.assertFalse(body["ok"])

    def test_a_foreign_host_header_is_refused(self):
        """DNS rebinding: an attacker-controlled name pointed at 127.0.0.1 would
        otherwise be same-origin with us, which makes reads possible too."""
        status, body = self._request("GET", "/api/version", headers={"Host": "rebind.example"})
        self.assertEqual(status, 403)
        self.assertFalse(body["ok"])

    def test_a_null_origin_is_refused(self):
        """What a sandboxed iframe or a file:// page sends. Never us."""
        status, _ = self._create_world(headers={"Origin": "null"})
        self.assertEqual(status, 403)

    def test_the_guard_covers_reads_not_just_writes(self):
        status, _ = self._request("GET", "/api/worlds", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)


class BodyContentTypeTests(_LiveLocalServerTestCase):
    def test_a_form_content_type_is_refused(self):
        """An HTML form can only send text/plain, urlencoded or multipart, so
        insisting on application/json breaks the attack even without Origin."""
        for media_type in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data"):
            with self.subTest(media_type=media_type):
                status, body = self._create_world(content_type=media_type)
                self.assertEqual(status, 400)
                self.assertIn("Content-Type", body["fehler"])

    def test_a_charset_parameter_does_not_break_the_check(self):
        status, body = self._create_world(content_type="application/json; charset=utf-8")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])


class ProxiedDeploymentTests(_LiveLocalServerTestCase):
    """QUILTOR_HOST=0.0.0.0 means Docker behind a reverse proxy: the proxy owns
    the Host header and OIDC owns access, so the guard has to stay out of the
    way or every hosted request would 403."""

    def setUp(self):
        super().setUp()
        server.BOUND_TO_LOOPBACK = False

    def test_a_public_hostname_is_accepted_when_not_bound_to_loopback(self):
        status, _ = self._request("GET", "/api/version", headers={"Host": "quiltor.example.com"})
        self.assertEqual(status, 200)

    def test_a_cross_origin_request_is_not_blocked_when_not_bound_to_loopback(self):
        status, _ = self._request("GET", "/api/version", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
