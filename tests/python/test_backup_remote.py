"""The upload protocol, exercised end to end: src/quiltor/infrastructure/backup/remote.py talking to
the reference endpoint in services/backup-server/ over a real socket.

Testing the two against each other is the point. Either alone could drift into a
private interpretation of the protocol and still pass; together they pin the thing
a self-hoster actually has to reimplement.
"""

import hashlib
import http.server
import importlib.util
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from unittest.mock import MagicMock

from quiltor.application.backups import BackupAuthorization, BackupGatewayError
from quiltor.infrastructure.backup import SnapshotStore
from quiltor.infrastructure.backup import remote
from quiltor.infrastructure.backup.adapters import HttpRemoteBackupGateway
from tests.python.fake_issuer import FakeIssuer

REFERENCE_SERVER = Path(__file__).resolve().parents[2] / "services" / "backup-server" / "server.py"

TOKEN = "test-token"
# The account is the token's subject now, not a name the client picks. Keeping
# the old value as the sub means these tests still assert about the same
# directory -- what changed is who decides it.
ACCOUNT = "tester"
SCOPE = "quiltor.backup"


def _load_reference_server(root: Path, issuer_url: str):
    """Imported by path: services/backup-server is deliberately independent, since
    product modules may not depend on the deployed service implementation."""
    os.environ["QUILTOR_BACKUP_ROOT"] = str(root)
    spec = importlib.util.spec_from_file_location("quiltor_backup_reference", REFERENCE_SERVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Reassigned after import, the same way ROOT always was: the module reads its
    # configuration once, so a test points it somewhere instead of arranging the
    # environment before the import.
    module.ROOT = root
    module.ISSUER = issuer_url
    module.CLIENT_ID = "quiltor-backup"
    module.CLIENT_SECRET = "shhh"
    module.REQUIRED_SCOPE = SCOPE
    module.PUBLIC_URL = "https://backup.example.test"
    module.ALLOW_INSECURE_LOOPBACK = True
    module.TRUSTED_ENDPOINT_ORIGINS = ()
    module._discovery.clear()
    module._tokens.clear()
    return module


class BackupProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.served = self.root / "served"
        self.issuer = FakeIssuer().start()
        self.issuer.issue(TOKEN, sub=ACCOUNT)
        self.reference = _load_reference_server(self.served, self.issuer.url)

        self.httpd = self.reference.Server(("127.0.0.1", 0), self.reference.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"http://127.0.0.1:{self.port}"

        self.store = SnapshotStore(
            self.root / "history",
            HttpRemoteBackupGateway(self.endpoint, self._allowed_capabilities()),
        )

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.issuer.stop()
        self.temp.cleanup()

    def _world(self, world_id="world-a", endpoint=None):
        database = self.root / f"{world_id}.sqlite3"
        manuscripts = self.root / "manuscripts" / world_id
        profiles = self.root / "profiles" / world_id
        manuscripts.mkdir(parents=True)
        profiles.mkdir(parents=True)
        sqlite3.connect(database).close()
        return self.store.context(
            world_id,
            self.endpoint if endpoint is None else endpoint,
            database,
            manuscripts,
            profiles,
        )

    def _stored(self, world="world-a", kind="blobs"):
        directory = self.served / ACCOUNT / world / kind
        return sorted(p.name for p in directory.iterdir()) if directory.exists() else []

    @staticmethod
    def _authorization(ctx, token: str = TOKEN) -> BackupAuthorization:
        return BackupAuthorization(ctx.endpoint_url, token)

    @staticmethod
    def _allowed_capabilities():
        capabilities = MagicMock()
        capabilities.is_available.return_value = True
        return capabilities

    def test_commit_with_push_uploads_blobs_and_the_manifest(self):
        ctx = self._world()
        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nText.\n", encoding="utf-8")
        result = self.store.commit(
            ctx, "Erster Stand", push=True, authorization=self._authorization(ctx)
        )

        self.assertTrue(result["ok"], result.get("grund"))
        self.assertIn("Snapshot uploaded to the backup endpoint.", result["log"])

        entry = self.store.entries(ctx)[-1]
        self.assertEqual(
            set(self._stored()),
            {record["sha256"] for record in entry["files"].values()},
        )
        self.assertEqual(self._stored(kind="snapshots"), [f"{entry['id']}.json"])

    def test_uploaded_snapshots_are_readable_back(self):
        ctx = self._world()
        chapter = ctx.manuscripts / "01 - Kapitel.md"
        chapter.write_text("Der Sturm.\n", encoding="utf-8")
        self.store.commit(ctx, "Erster Stand", push=True, authorization=self._authorization(ctx))

        manifests = remote.snapshots(ctx, self._authorization(ctx))
        self.assertEqual(len(manifests), 1)
        self.assertEqual(manifests[0]["message"], "Erster Stand")
        digest = manifests[0]["files"]["manuscripts/01 - Kapitel.md"]["sha256"]
        self.assertEqual(
            remote.fetch_blob(ctx, digest, self._authorization(ctx)),
            chapter.read_bytes(),
        )

    def test_unchanged_blobs_are_not_re_uploaded(self):
        """A second backup must not re-send a multi-megabyte database that has not
        changed -- that is the difference between a usable backup over a slow link
        and an unusable one."""
        ctx = self._world()
        (ctx.manuscripts / "01 - Eins.md").write_text("unveraendert\n", encoding="utf-8")
        (ctx.manuscripts / "02 - Zwei.md").write_text("erste fassung\n", encoding="utf-8")
        self.store.commit(ctx, "eins", push=True, authorization=self._authorization(ctx))

        (ctx.manuscripts / "02 - Zwei.md").write_text("zweite fassung\n", encoding="utf-8")
        with patch.object(remote, "_request", wraps=remote._request) as spy:
            self.store.commit(ctx, "zwei", push=True, authorization=self._authorization(ctx))
        uploaded = [
            call.args[2]
            for call in spy.call_args_list
            if call.args[0] == "PUT" and "/blobs/" in call.args[2]
        ]

        unchanged = self.store.entries(ctx)[0]["files"]["manuscripts/01 - Eins.md"]["sha256"]
        self.assertFalse(
            [path for path in uploaded if unchanged in path],
            "an unchanged file was uploaded a second time",
        )

    def test_a_wrong_token_is_rejected(self):
        ctx = self._world()
        (ctx.manuscripts / "01 - Kapitel.md").write_text("Text.\n", encoding="utf-8")
        with self.assertRaises(BackupGatewayError) as caught:
            self.store.commit(
                ctx,
                "eins",
                push=True,
                authorization=self._authorization(ctx, "wrong"),
            )
        self.assertEqual(
            caught.exception.params,
            {"operation": "upload", "snapshotCreated": True},
        )
        self.assertEqual(self._stored(), [])

    def test_an_unreachable_endpoint_reports_clearly_and_keeps_local_history(self):
        ctx = self._world(endpoint="http://127.0.0.1:1")
        (ctx.manuscripts / "01 - Kapitel.md").write_text("Text.\n", encoding="utf-8")
        with self.assertRaises(BackupGatewayError) as caught:
            self.store.commit(
                ctx,
                "eins",
                push=True,
                authorization=BackupAuthorization(ctx.endpoint_url, TOKEN),
            )

        self.assertEqual(caught.exception.code, "backup.gateway_failed")
        self.assertEqual(
            len(self.store.history(ctx)), 1, "local history must survive a failed upload"
        )

    def test_the_server_refuses_content_that_does_not_match_its_digest(self):
        """Content addressing is only a guarantee if the server enforces it."""
        ctx = self._world()
        fake = "0" * 64
        with self.assertRaises(RuntimeError) as caught:
            remote._request(
                "PUT",
                self.endpoint,
                f"/v1/worlds/world-a/blobs/{fake}",
                b"not the content that hashes to zeros",
                "application/octet-stream",
                10,
                self._authorization(ctx),
            )
        self.assertIn("400", str(caught.exception))

    def test_redirects_never_replay_authorization_to_another_origin(self):
        received: list[str] = []

        class Destination(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get("Authorization", ""))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args):
                pass

        destination = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Destination)
        destination_thread = threading.Thread(target=destination.serve_forever, daemon=True)
        destination_thread.start()
        destination_url = f"http://127.0.0.1:{destination.server_address[1]}"

        class Redirect(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", f"{destination_url}/stolen")
                self.end_headers()

            def log_message(self, *_args):
                pass

        redirect = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        redirect_thread = threading.Thread(target=redirect.serve_forever, daemon=True)
        redirect_thread.start()
        redirect_url = f"http://127.0.0.1:{redirect.server_address[1]}"
        try:
            with self.assertRaises(RuntimeError):
                remote._request(
                    "GET",
                    redirect_url,
                    "/redirect",
                    None,
                    "",
                    10,
                    BackupAuthorization(redirect_url, "never-forward"),
                )
            self.assertEqual(received, [])
        finally:
            redirect.shutdown()
            redirect.server_close()
            redirect_thread.join(timeout=5)
            destination.shutdown()
            destination.server_close()
            destination_thread.join(timeout=5)

    def test_the_server_refuses_a_manifest_whose_blobs_are_missing(self):
        """Keeps the store consistent: a manifest is a promise its content can be
        retrieved, so it may only land after the blobs it names."""
        ctx = self._world()
        from quiltor.application.backup_manifest import manifest_identifier

        body = {
            "format": 1,
            "encryption": "none",
            "created": "2026-01-01T00:00:00",
            "world": "world-a",
            "title": "Missing",
            "message": "Missing",
            "parent": "",
            "files": {"world.sqlite3": "a" * 64},
        }
        snapshot_id = manifest_identifier(body, 1)
        manifest = json.dumps({**body, "id": snapshot_id}).encode()
        with self.assertRaises(RuntimeError) as caught:
            remote._request(
                "PUT",
                self.endpoint,
                f"/v1/worlds/world-a/snapshots/{snapshot_id}",
                manifest,
                "application/json",
                10,
                self._authorization(ctx),
            )
        self.assertIn("400", str(caught.exception))

    def test_worlds_are_stored_separately_at_the_endpoint(self):
        for world_id, text in (("world-a", "Welt A.\n"), ("world-b", "Welt B.\n")):
            ctx = self._world(world_id)
            (ctx.manuscripts / "01 - Kapitel.md").write_text(text, encoding="utf-8")
            self.store.commit(ctx, world_id, push=True, authorization=self._authorization(ctx))
        self.assertEqual(len(self._stored("world-a", "snapshots")), 1)
        self.assertEqual(len(self._stored("world-b", "snapshots")), 1)

    # ------------------------------------------------------------- identity
    #
    # The endpoint derives the account from the token instead of being told it.
    # These pin that it really does, because the whole ownership story rests on
    # it: a client that could name its own account could name someone else's.

    def _raw(self, method: str, path: str, token: str | None = None, body: bytes | None = None):
        """One request without going through remote.py, so the HTTP details
        (status, WWW-Authenticate) can be asserted directly."""
        request = urllib.request.Request(f"{self.endpoint}{path}", data=body, method=method)
        if token is not None:
            request.add_header("Authorization", f"Bearer {token}")
        if body is not None:
            request.add_header("Content-Type", "application/octet-stream")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def test_a_request_without_a_token_is_refused_and_points_at_the_metadata(self):
        status, headers, _ = self._raw("GET", "/v1/worlds")
        self.assertEqual(status, 401)
        self.assertIn("resource_metadata", headers.get("WWW-Authenticate", ""))
        self.assertIn("/.well-known/oauth-protected-resource", headers["WWW-Authenticate"])

    def test_a_token_without_the_required_scope_is_forbidden_not_unauthorized(self):
        """403, not 401, and the difference is a diagnosis: logging in again
        cannot help, so telling the client to would misdescribe the problem."""
        self.issuer.issue("scopeless", sub="someone-else", scopes="openid profile")
        status, _, body = self._raw("GET", "/v1/worlds", token="scopeless")
        self.assertEqual(status, 403)
        self.assertIn("scope", json.loads(body)["error"])

    def test_the_metadata_document_names_the_issuer_without_a_token(self):
        status, _, body = self._raw("GET", "/.well-known/oauth-protected-resource")
        self.assertEqual(status, 200)
        document = json.loads(body)
        self.assertEqual(document["authorization_servers"], [self.issuer.url])
        self.assertIn(SCOPE, document["scopes_supported"])

    def test_two_subjects_cannot_see_or_overwrite_each_others_worlds(self):
        ctx = self._world()
        (ctx.manuscripts / "01 - Kapitel.md").write_text("Geheim.\n", encoding="utf-8")
        self.store.commit(ctx, "eins", push=True, authorization=self._authorization(ctx))

        self.issuer.issue("other-token", sub="somebody-else")
        status, _, body = self._raw("GET", "/v1/worlds", token="other-token")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["worlds"], [], "another account saw these worlds")

        _, _, manifests = self._raw("GET", "/v1/worlds/world-a/snapshots", token="other-token")
        self.assertEqual(
            json.loads(manifests)["snapshots"], [], "another account read this world's manifests"
        )

        # ...and writing under the same world id lands in the other account's own
        # tree, not in this one.
        payload = b"fremd"
        digest = hashlib.sha256(payload).hexdigest()
        self._raw("PUT", f"/v1/worlds/world-a/blobs/{digest}", token="other-token", body=payload)
        self.assertNotIn(digest, self._stored())

    def test_the_verdict_on_a_token_is_cached_and_expires(self):
        self._raw("GET", "/v1/worlds", token=TOKEN)
        after_first = self.issuer.introspections
        self._raw("GET", "/v1/worlds", token=TOKEN)
        self.assertEqual(
            self.issuer.introspections,
            after_first,
            "the endpoint asked the issuer again inside the cache window",
        )

        self.reference.TOKEN_TTL = 0.0
        self.reference._tokens.clear()
        self._raw("GET", "/v1/worlds", token=TOKEN)
        self._raw("GET", "/v1/worlds", token=TOKEN)
        self.assertGreater(
            self.issuer.introspections,
            after_first + 1,
            "an expired cache entry must be re-checked, or revocation never lands",
        )

    def test_oidc_configuration_rejects_remote_plain_http(self):
        with patch.object(self.reference, "ISSUER", "http://identity.example.test"):
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                self.reference.validate_configuration()

    def test_discovery_must_match_the_configured_issuer_and_trusted_origin(self):
        issuer = "https://identity.example.test/realms/quiltor"
        self.reference.ISSUER = issuer
        self.reference.ALLOW_INSECURE_LOOPBACK = False
        self.reference._discovery.clear()
        with patch.object(
            self.reference,
            "_get_json",
            return_value={
                "issuer": "https://different.example.test/realms/quiltor",
                "introspection_endpoint": f"{issuer}/introspect",
            },
        ):
            with self.assertRaisesRegex(ValueError, "does not match"):
                self.reference.discover()

        self.reference._discovery.clear()
        with patch.object(
            self.reference,
            "_get_json",
            return_value={
                "issuer": issuer,
                "introspection_endpoint": "https://tokens.example.test/introspect",
            },
        ):
            with self.assertRaisesRegex(ValueError, "trusted OIDC origin"):
                self.reference.discover()


if __name__ == "__main__":
    unittest.main()
