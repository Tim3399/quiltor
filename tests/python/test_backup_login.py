"""Signing in to a backup endpoint, end to end over real sockets.

Two fakes, both genuine HTTP servers: the issuer (tests/python/fake_issuer.py,
shared with the protocol tests) and a backup endpoint small enough to be nothing
but its RFC 9728 metadata document. Nothing here patches urllib -- the point of
these tests is the wiring between three parties, and a mocked transport would
let a client that never actually sends a header pass.
"""

import http.server
import json
import os
import socket
import stat
import tempfile
import threading
import time
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric import rsa

from quiltor.application.backups import BackupAuthorization
from quiltor.infrastructure.backup.login import BackupLoginRuntime
from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.backup import remote
from quiltor.infrastructure.platform.adapters.credentials import RestrictedFileCredentialVault
from tests.python.fake_issuer import FakeIssuer

REDIRECT = "http://127.0.0.1:53682/backup/callback"
SCOPE = "quiltor.backup"


class FakeBackupEndpoint:
    """Just enough backup endpoint to be discovered and talked to.

    Records the Authorization header of every request, because half of what is
    under test is which requests carry a token and which must not.
    """

    def __init__(self, issuer_url: str, *, serve_metadata: bool = True) -> None:
        self.issuer_url = issuer_url
        self.serve_metadata = serve_metadata
        self.seen: list[tuple[str, str]] = []
        self.redirect_to = ""
        self.metadata_resource = ""
        self.metadata_content_type = "application/json"
        self.metadata_padding = ""
        endpoint = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                endpoint.seen.append((self.path, self.headers.get("Authorization", "")))
                if self.path == remote.METADATA_PATH and not endpoint.serve_metadata:
                    return self.send_error(404)
                if self.path == remote.METADATA_PATH:
                    if endpoint.redirect_to:
                        self.send_response(302)
                        self.send_header("Location", endpoint.redirect_to)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    payload = {
                        "resource": endpoint.metadata_resource or endpoint.url,
                        "authorization_servers": [endpoint.issuer_url],
                        "scopes_supported": [SCOPE],
                        "bearer_methods_supported": ["header"],
                        "padding": endpoint.metadata_padding,
                    }
                else:
                    payload = {"worlds": []}
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", endpoint.metadata_content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args) -> None:
                pass

        self._httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_address[1]}"

    def header_for(self, path: str) -> str:
        return next(header for seen_path, header in self.seen if seen_path == path)

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join(timeout=5)


class BackupLoginTestCase(unittest.TestCase):
    def setUp(self):
        global backup_login
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        self.original_data = config.DATA
        config.DATA = self.data
        self.vault_path = self.data / "credential-vault.json"
        self.vault = RestrictedFileCredentialVault(self.vault_path)
        backup_login = BackupLoginRuntime(
            vault=self.vault,
            data_directory=self.data,
            allow_insecure_loopback=True,
        )

        self.issuer = FakeIssuer().start()
        self.endpoint = FakeBackupEndpoint(self.issuer.url)
        self.base = self.endpoint.url

        backup_login.forget_cache()

    def tearDown(self):
        config.DATA = self.original_data
        backup_login.close()
        self.endpoint.stop()
        self.issuer.stop()
        self.temp.cleanup()

    def _login(self) -> dict:
        """The whole flow once: authorize URL, browser, callback."""
        authorize_url = backup_login.begin(self.base, REDIRECT)
        code, state = self.issuer.authorize(authorize_url)
        return backup_login.complete(code, state, REDIRECT)

    def _stored(self) -> dict:
        secret = self.vault.read(backup_login.VAULT_SERVICE, backup_login.VAULT_ACCOUNT)
        self.assertIsNotNone(secret)
        return json.loads(secret)


class DiscoveryTests(BackupLoginTestCase):
    def test_the_issuer_and_scope_come_from_the_endpoints_own_metadata(self):
        """Nobody configures an issuer twice: the endpoint names the login it
        accepts, and that answer is the only one the client uses."""
        self.assertEqual(backup_login.issuer_for(self.base), (self.issuer.url, SCOPE))

    def test_an_endpoint_that_publishes_nothing_cannot_be_logged_into(self):
        silent = FakeBackupEndpoint(self.issuer.url, serve_metadata=False)
        self.addCleanup(silent.stop)
        with self.assertRaises(RuntimeError) as caught:
            backup_login.issuer_for(silent.url)
        self.assertIn("issuer", str(caught.exception))

    def test_an_unreachable_endpoint_yields_empty_metadata_rather_than_an_error(self):
        """remote.resource_metadata leaves the reading of a failure to its caller,
        which is what lets status() report it instead of crashing a page."""
        self.assertEqual(remote.resource_metadata("http://127.0.0.1:1"), {})

    def test_metadata_is_origin_bound_bounded_json_and_never_follows_redirects(self):
        target = FakeBackupEndpoint(self.issuer.url)
        self.addCleanup(target.stop)

        self.endpoint.metadata_resource = target.url
        self.assertEqual(remote.resource_metadata(self.base), {})
        self.endpoint.metadata_resource = ""

        self.endpoint.metadata_content_type = "text/plain"
        self.assertEqual(remote.resource_metadata(self.base), {})
        self.endpoint.metadata_content_type = "application/json"

        self.endpoint.metadata_padding = "x" * (remote.MAX_METADATA_BYTES + 1)
        self.assertEqual(remote.resource_metadata(self.base), {})
        self.endpoint.metadata_padding = ""

        self.endpoint.redirect_to = f"{target.url}{remote.METADATA_PATH}"
        before = list(target.seen)
        self.assertEqual(remote.resource_metadata(self.base), {})
        self.assertEqual(target.seen, before)


class BackupLoginTokenSecurityTests(BackupLoginTestCase):
    def _callback(self) -> tuple[str, str]:
        authorize_url = backup_login.begin(self.base, REDIRECT)
        return self.issuer.authorize(authorize_url)

    def test_forged_signature_wrong_nonce_unknown_kid_and_reserved_sub_are_rejected(self):
        attacks = (
            lambda: setattr(
                self.issuer,
                "signing_key_override",
                rsa.generate_private_key(public_exponent=65537, key_size=2048),
            ),
            lambda: self.issuer.claim_overrides.update(nonce="wrong"),
            lambda: setattr(self.issuer, "token_kid", "unknown-key"),
            lambda: self.issuer.claim_overrides.update(sub="quiltor-internal:local-owner"),
        )
        for attack in attacks:
            self.issuer.signing_key_override = None
            self.issuer.token_kid = self.issuer.kid
            self.issuer.claim_overrides.clear()
            attack()
            code, state = self._callback()
            with self.subTest(attack=attack), self.assertRaises(ValueError):
                backup_login.complete(code, state, REDIRECT)
            self.assertIsNone(
                self.vault.read(backup_login.VAULT_SERVICE, backup_login.VAULT_ACCOUNT)
            )

    def test_pending_login_store_is_bounded_and_fails_closed(self):
        with patch("quiltor.infrastructure.backup.login.MAX_PENDING", 2):
            backup_login.begin(self.base, REDIRECT)
            backup_login.begin(self.base, REDIRECT)
            with self.assertRaises(RuntimeError):
                backup_login.begin(self.base, REDIRECT)
        self.assertEqual(backup_login.pending_count, 2)


class LoginFlowTests(BackupLoginTestCase):
    def test_a_full_pkce_login_produces_a_token_the_endpoint_would_accept(self):
        result = self._login()

        self.assertTrue(result["signedIn"])
        self.assertEqual(result["account"], "tester")
        self.assertEqual(result["issuer"], self.issuer.url)

        token = backup_login.access_token(self.base)
        self.assertTrue(token)
        # The same token the issuer would call active, with the scope the backup
        # endpoint demands -- that is the whole handshake, verified from both ends.
        self.assertTrue(self.issuer.tokens[token]["active"])
        self.assertIn(SCOPE, self.issuer.tokens[token]["scope"])

    def test_the_authorization_request_pins_the_code_to_this_process(self):
        url = backup_login.begin(self.base, REDIRECT)
        self.assertIn("code_challenge_method=S256", url)
        self.assertIn("response_type=code", url)
        self.assertIn("offline_access", url, "without it there is no refresh token to renew with")
        self.assertNotIn(
            next(iter(backup_login._pending.values()))["verifier"],
            url,
            "the PKCE verifier must never leave this process",
        )

    def test_a_state_nobody_issued_is_refused(self):
        url = backup_login.begin(self.base, REDIRECT)
        code, _ = self.issuer.authorize(url)
        with self.assertRaises(ValueError):
            backup_login.complete(code, "state-from-somewhere-else", REDIRECT)
        self.assertFalse(backup_login.status(self.base)["signedIn"])

    def test_an_expired_state_is_refused(self):
        url = backup_login.begin(self.base, REDIRECT)
        code, state = self.issuer.authorize(url)
        for entry in backup_login._pending.values():
            entry["created_at"] = time.time() - backup_login.PENDING_TTL - 1
        with self.assertRaises(ValueError):
            backup_login.complete(code, state, REDIRECT)

    def test_a_state_works_exactly_once(self):
        """A replayed callback finds nothing the second time -- single-use by
        construction (pop), the same way auth.consume_pending_login is."""
        url = backup_login.begin(self.base, REDIRECT)
        code, state = self.issuer.authorize(url)
        backup_login.complete(code, state, REDIRECT)
        with self.assertRaises(ValueError):
            backup_login.complete(code, state, REDIRECT)

    def test_a_callback_on_a_different_redirect_is_refused(self):
        url = backup_login.begin(self.base, REDIRECT)
        code, state = self.issuer.authorize(url)
        with self.assertRaises(ValueError):
            backup_login.complete(code, state, "http://127.0.0.1:1/elsewhere")

    def test_status_separates_not_signed_in_from_no_issuer_to_sign_in_at(self):
        before = backup_login.status(self.base)
        self.assertFalse(before["signedIn"])
        self.assertTrue(before["issuerReachable"])

        self.issuer.stop()
        # Both caches, for the same reason: status() reuses its answer about the
        # endpoint for PROBE_TTL seconds, and this test moves the world faster
        # than a person ever could.
        backup_login.forget_cache()
        unreachable = backup_login.status(self.base)
        # False, not None: a refused connection is an answer, and the dialog may
        # act on it. None is reserved for "the lookup has not come back".
        self.assertIs(unreachable["issuerReachable"], False)


class StatusCacheTests(BackupLoginTestCase):
    """status() is what the backup dialog calls on every open, and behind it are
    two network requests. Caching them is not about speed but about an endpoint
    that has gone away not making the dialog unusable."""

    def test_a_second_look_costs_no_further_requests(self):
        backup_login.status(self.base)
        asked = len([1 for path, _ in self.endpoint.seen if path == remote.METADATA_PATH])
        backup_login.status(self.base)
        backup_login.status(self.base)
        self.assertEqual(
            len([1 for path, _ in self.endpoint.seen if path == remote.METADATA_PATH]),
            asked,
            "the endpoint was asked again within PROBE_TTL",
        )

    def test_signing_out_shows_at_once_although_the_endpoint_answer_is_cached(self):
        """Only the part that costs network calls is cached. The signed-in half
        comes off the disk every time, or the dialog would keep showing an
        account that was just put down."""
        self._login()
        self.assertTrue(backup_login.status(self.base)["signedIn"])
        backup_login.sign_out(self.base)
        self.assertFalse(backup_login.status(self.base)["signedIn"])

    def test_an_endpoint_that_never_answers_does_not_hang_the_dialog(self):
        """A socket that accepts and then says nothing -- the worst case, and the
        one a timeout alone would answer only after 15 seconds per request."""
        dead = socket.socket()
        dead.bind(("127.0.0.1", 0))
        dead.listen(1)
        self.addCleanup(dead.close)
        base = f"http://127.0.0.1:{dead.getsockname()[1]}"

        started = time.monotonic()
        first = backup_login.status(base)
        waited = time.monotonic() - started
        # None, not False, and the distinction is the whole point: nothing has
        # refused here, the question is simply still open. Answering False would
        # tell the dialog to hide the sign-in button over a verdict nobody
        # reached -- and this socket may yet turn out to be a slow live issuer.
        self.assertIsNone(first["issuerReachable"])
        self.assertLess(
            waited,
            backup_login.PROBE_PATIENCE + 2,
            "the first open waits for the probe, but only for PROBE_PATIENCE",
        )

        # And every open after it answers straight away: the probe from before is
        # still out there, and nobody waits on it twice.
        started = time.monotonic()
        self.assertIsNone(backup_login.status(base)["issuerReachable"])
        self.assertLess(time.monotonic() - started, 0.5)


class RefreshTests(BackupLoginTestCase):
    def test_an_expired_access_token_is_renewed_with_the_refresh_token(self):
        self.issuer.access_ttl = 0  # expired the moment it is issued
        self._login()
        first = self._stored()
        stored = first["endpoints"][self.base]["access_token"]

        grants = self.issuer.token_grants
        renewed = backup_login.access_token(self.base)

        self.assertTrue(renewed)
        self.assertNotEqual(renewed, stored, "the expired token was handed out again")
        self.assertGreater(self.issuer.token_grants, grants)
        self.assertTrue(self.issuer.tokens[renewed]["active"])
        after = self._stored()
        self.assertEqual(
            after["endpoints"][self.base]["access_token"],
            renewed,
            "the renewed token has to be kept, or every request repeats the refresh",
        )

    def test_a_valid_token_is_reused_rather_than_refreshed(self):
        self._login()
        grants = self.issuer.token_grants
        backup_login.access_token(self.base)
        backup_login.access_token(self.base)
        self.assertEqual(self.issuer.token_grants, grants)

    def test_a_refresh_token_the_issuer_rejects_signs_this_endpoint_out(self):
        """Dead is dead: keeping the record would mean every later upload repeats
        a call that cannot start working again."""
        self.issuer.access_ttl = 0
        self._login()
        self.issuer.refresh_tokens.clear()

        self.assertEqual(backup_login.access_token(self.base), "")
        self.assertFalse(backup_login.status(self.base)["signedIn"])

    def test_concurrent_access_refreshes_exactly_once(self):
        self.issuer.access_ttl = 0
        self._login()
        self.issuer.access_ttl = 300
        grants = self.issuer.token_grants
        results: list[str] = []
        threads = [
            threading.Thread(target=lambda: results.append(backup_login.access_token(self.base)))
            for _ in range(8)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertEqual(len(set(results)), 1)
        self.assertTrue(results[0])
        self.assertEqual(self.issuer.token_grants, grants + 1)

    def test_sign_out_during_refresh_cannot_resurrect_the_record(self):
        self.issuer.access_ttl = 0
        self._login()
        self.issuer.access_ttl = 300
        started = threading.Event()
        resume = threading.Event()
        original_refresh = backup_login._refresh

        def delayed(record):
            started.set()
            self.assertTrue(resume.wait(5))
            return original_refresh(record)

        with patch.object(backup_login, "_refresh", side_effect=delayed):
            worker = threading.Thread(target=backup_login.access_token, args=(self.base,))
            worker.start()
            self.assertTrue(started.wait(5))
            backup_login.sign_out(self.base)
            resume.set()
            worker.join(timeout=10)
        self.assertFalse(backup_login.status(self.base)["signedIn"])


class StorageTests(BackupLoginTestCase):
    @unittest.skipIf(
        os.name == "nt",
        "Windows protects the user profile with ACLs; st_mode does not expose owner-only access",
    )
    def test_the_credential_file_is_readable_only_by_its_owner(self):
        self._login()
        mode = stat.S_IMODE(os.stat(self.vault_path).st_mode)
        self.assertEqual(mode, 0o600, f"credential file is {oct(mode)}")

    def test_a_restart_stays_signed_in(self):
        global backup_login
        self._login()
        expected = backup_login.access_token(self.base)
        grants = self.issuer.token_grants

        # A genuinely fresh module against the same data directory: nothing in
        # memory survives, so what answers below came off the disk.
        self.vault = RestrictedFileCredentialVault(self.vault_path)
        backup_login = BackupLoginRuntime(
            vault=self.vault,
            data_directory=self.data,
            allow_insecure_loopback=True,
        )

        self.assertTrue(backup_login.status(self.base)["signedIn"])
        self.assertEqual(backup_login.access_token(self.base), expected)
        self.assertEqual(
            self.issuer.token_grants, grants, "a restart must not need another trip to the issuer"
        )

    def test_the_legacy_plaintext_store_is_migrated_then_removed(self):
        self._login()
        expected = backup_login.access_token(self.base)
        legacy = self._stored()
        self.vault.delete(backup_login.VAULT_SERVICE, backup_login.VAULT_ACCOUNT)
        backup_login.path().write_text(json.dumps(legacy), encoding="utf-8")
        backup_login.forget_cache()

        self.assertEqual(backup_login.access_token(self.base), expected)
        self.assertFalse(backup_login.path().exists())
        self.assertEqual(
            json.loads(
                self.vault.read(backup_login.VAULT_SERVICE, backup_login.VAULT_ACCOUNT) or "{}"
            ),
            legacy,
        )

    def test_sign_out_removes_the_file(self):
        self._login()
        self.assertTrue(self.vault_path.exists())
        self.assertFalse(backup_login.path().exists(), "legacy plaintext must not be recreated")

        backup_login.sign_out(self.base)

        self.assertFalse(self.vault_path.exists())
        self.assertEqual(backup_login.access_token(self.base), "")
        self.assertFalse(backup_login.status(self.base)["signedIn"])

    def test_two_endpoints_are_kept_apart(self):
        other = FakeBackupEndpoint(self.issuer.url)
        self.addCleanup(other.stop)
        self._login()
        self.issuer.sign_in_as("someone-else")
        second = backup_login.begin(other.url, REDIRECT)
        code, state = self.issuer.authorize(second)
        backup_login.complete(code, state, REDIRECT)

        self.assertNotEqual(
            backup_login.access_token(self.base), backup_login.access_token(other.url)
        )
        self.assertEqual(backup_login.status(other.url)["account"], "someone-else")

        backup_login.sign_out(other.url)
        self.assertTrue(
            backup_login.status(self.base)["signedIn"], "signing out of one hit the other"
        )


class EndpointAuthorizationTests(BackupLoginTestCase):
    def test_environment_token_is_bound_by_the_composed_authorizer(self):
        from quiltor.infrastructure.backup.authorization import (
            EndpointBoundBackupAuthorizer,
        )

        with patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": "hand-issued"}):
            authorizer = EndpointBoundBackupAuthorizer(
                default_endpoint=self.base,
                environment_token=lambda: os.environ.get("QUILTOR_BACKUP_TOKEN", ""),
            )
            self.assertEqual(
                authorizer.authorize_local(self.base).bearer_token,
                "hand-issued",
            )

    def test_authorization_matches_exact_origin_port_and_path_prefix(self):
        from quiltor.infrastructure.backup.authorization import (
            EndpointBoundBackupAuthorizer,
        )

        configured = f"{self.base}/tenant/quiltor"
        authorizer = EndpointBoundBackupAuthorizer(
            default_endpoint=configured,
            environment_token="bound-secret",
        )
        self.assertEqual(
            authorizer.authorize_local(f"{configured}/").bearer_token,
            "bound-secret",
        )
        parsed = urllib.parse.urlsplit(self.base)
        different_port = f"http://{parsed.hostname}:{parsed.port + 1}/tenant/quiltor"
        for endpoint in (different_port, f"{self.base}/tenant/other"):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(PermissionError):
                    authorizer.authorize_local(endpoint)

    def test_explicit_login_authorization_supplies_the_bearer_header(self):
        self._login()
        remote._request(
            "GET",
            self.base,
            "/v1/worlds",
            None,
            "",
            10,
            BackupAuthorization(self.base, backup_login.access_token(self.base)),
        )
        self.assertEqual(
            self.endpoint.header_for("/v1/worlds"), f"Bearer {backup_login.access_token(self.base)}"
        )

    def test_the_metadata_lookup_never_carries_a_token(self):
        """It is the document read *before* there is a token, so asking the token
        source for one here would call back into the login reading it."""
        self._login()
        self.assertTrue(remote.resource_metadata(self.base))
        self.assertEqual(self.endpoint.header_for(remote.METADATA_PATH), "")


if __name__ == "__main__":
    unittest.main()
