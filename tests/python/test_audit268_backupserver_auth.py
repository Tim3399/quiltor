"""T-268 audit, package D3: how the backup server decides who is calling (B.1-B.5).

Tests marked @unittest.expectedFailure prove a gap and name the finding in a comment.
After the fix of that finding the decorator has to go; an "unexpected success" is the
reminder. Everything runs in-process against a scripted loopback issuer.
"""

from __future__ import annotations

import json
import os
import threading
import unittest
from pathlib import Path

from tests.python.test_audit268_backupserver_support import (
    BackupServerCase,
    FakeClock,
    ScriptedIssuer,
)

ACCOUNT_PATH = "/v1/account"
DIGEST = "0" * 64


class IntrospectionFailClosedTest(BackupServerCase):
    """B.1: nothing is accepted unless the issuer said active:true, properly framed."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")
        self.server_module.HTTP_TIMEOUT = 0.4

    def assertRefused(self, label: str) -> None:
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertIn(status, {401, 403}, f"{label}: expected refusal, got {status}")

    def test_control_active_token_is_accepted(self) -> None:
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 200)

    def test_issuer_error_shapes_are_refused(self) -> None:
        for mode in ("500", "bad_json", "list", "huge", "active_string"):
            with self.subTest(mode=mode):
                self.server_module._tokens.clear()
                self.issuer.mode = mode
                self.assertRefused(mode)

    def test_inactive_expired_or_foreign_issuer_claims_are_refused(self) -> None:
        cases = {
            "inactive": {"active": False},
            "exp past": {"exp": 1},
            "exp bool": {"exp": True},
            "exp string": {"exp": "9999999999"},
            "foreign iss": {"iss": "https://elsewhere.example.test"},
        }
        for label, claims in cases.items():
            with self.subTest(case=label):
                self.server_module._tokens.clear()
                self.issuer.grant("token-a", **claims)
                self.assertRefused(label)

    def test_unreachable_issuer_is_refused(self) -> None:
        self.issuer.stop()
        self.assertRefused("issuer down")

    def test_slow_issuer_times_out_and_is_refused(self) -> None:
        self.issuer.delay = 1.5
        self.assertRefused("issuer timeout")

    def test_failed_introspection_is_not_cached_as_success(self) -> None:
        self.issuer.mode = "500"
        self.assertRefused("5xx")
        self.issuer.mode = "ok"
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 200)

    def test_missing_and_malformed_bearer_never_reach_the_issuer(self) -> None:
        before = self.issuer.introspections
        for header in ("", "Basic abc", "Bearer", "Bearer   ", "bearer"):
            with self.subTest(header=header):
                status, _, _ = self.request(
                    "GET", ACCOUNT_PATH, token=None, headers={"Authorization": header}
                )
                self.assertEqual(status, 401)
        self.assertEqual(self.issuer.introspections, before)

    # S268-204: a framing error from the issuer is an exception class introspect() does
    # not catch (http.client.HTTPException is not an OSError), so the caller gets a
    # dropped connection and a traceback instead of the 401 the other failures get.
    @unittest.expectedFailure
    def test_s268_204_garbage_status_line_from_issuer_answers_401(self) -> None:
        self.issuer.mode = "garbage"
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 401)

    def test_garbage_status_line_from_issuer_is_still_fail_closed(self) -> None:
        self.issuer.mode = "garbage"
        with self.assertRaises(OSError):
            status, _, _ = self.request("GET", ACCOUNT_PATH)
            self.fail(f"a garbled issuer answer must not yield a response, got {status}")
        self.assertEqual(self.stored_files(), [])


class AudienceAndAuthorizedPartyTest(BackupServerCase):
    """B.2: the only gate beyond `active` is the scope string."""

    def test_control_token_of_the_intended_client_is_accepted(self) -> None:
        self.issuer.grant("token-a", azp="quiltor-desktop", aud="quiltor-backup-server")
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 200)

    def test_token_without_the_scope_is_refused_whatever_its_audience(self) -> None:
        self.issuer.grant(
            "token-a", scope="openid email", azp="quiltor-desktop", aud="quiltor-backup-server"
        )
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 403)

    # S268-200: a token minted for another client and another audience opens the
    # account as soon as it carries the scope string. introspect() (server.py:478-489)
    # looks at active, iss and exp only; _account (:561-566) at the scope only.
    @unittest.expectedFailure
    def test_s268_200_token_for_a_foreign_audience_and_client_is_refused(self) -> None:
        self.issuer.grant(
            "token-a", azp="some-third-party-app", aud=["account", "some-third-party-app"]
        )
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertIn(status, {401, 403})

    # S268-200 (write side): the same foreign token may also store backups.
    @unittest.expectedFailure
    def test_s268_200_foreign_client_token_cannot_write_either(self) -> None:
        self.issuer.grant("token-a", azp="some-third-party-app", aud="account")
        import hashlib

        payload = b"written by a foreign client"
        digest = hashlib.sha256(payload).hexdigest()
        status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload)
        self.assertIn(status, {401, 403})
        self.assertEqual(self.stored_files(), [])

    # S268-200 (token type): introspection of a refresh or ID token is also active:true.
    # Nothing looks at `typ` or `token_type`, so such a token works as a bearer.
    @unittest.expectedFailure
    def test_s268_200_refresh_or_id_token_type_is_refused(self) -> None:
        for token_type in ("Refresh", "ID"):
            with self.subTest(typ=token_type):
                self.server_module._tokens.clear()
                self.issuer.grant("token-a", typ=token_type, azp="quiltor-desktop")
                status, _, _ = self.request("GET", ACCOUNT_PATH)
                self.assertIn(status, {401, 403})


class SecretHandlingTest(BackupServerCase):
    """B.3: the client secret only ever goes to the issuer's own origin, with no redirects."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")
        self.other = ScriptedIssuer().start()
        self.addCleanup(self.other.stop)

    def test_control_secret_reaches_the_issuer(self) -> None:
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 200)
        self.assertEqual(self.issuer.seen_client_ids, ["quiltor-backup-server"])

    def test_redirect_from_the_introspection_endpoint_is_not_followed(self) -> None:
        self.issuer.mode = "redirect"
        self.issuer.redirect_to = f"{self.other.url}/introspect"
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertIn(status, {401, 403})
        self.assertEqual(self.other.introspections, 0)

    def test_discovery_cannot_point_introspection_to_another_origin(self) -> None:
        self.issuer.discovery_introspection_endpoint = f"{self.other.url}/introspect"
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertIn(status, {401, 403})
        self.assertEqual(self.other.introspections, 0)
        self.assertEqual(self.issuer.introspections, 0)

    def test_discovery_issuer_must_match_the_configured_issuer(self) -> None:
        self.issuer.discovery_issuer = "https://impostor.example.test"
        status, _, _ = self.request("GET", ACCOUNT_PATH)
        self.assertIn(status, {401, 403})
        self.assertEqual(self.issuer.introspections, 0)


class TokenCacheTest(BackupServerCase):
    """B.4: a revoked token lives for at most TOKEN_TTL; the cache is bounded."""

    def setUp(self) -> None:
        super().setUp()
        self.clock = FakeClock()
        self.server_module.time = self.clock
        # A small cap keeps the flood short; the eviction logic does not depend on its size.
        self.server_module.TOKEN_CACHE_MAX = 16

    def test_revoked_token_works_for_the_ttl_and_not_beyond(self) -> None:
        self.issuer.grant("token-a")
        self.assertEqual(self.request("GET", ACCOUNT_PATH)[0], 200)
        self.issuer.tokens.pop("token-a")
        self.clock.now += self.server_module.TOKEN_TTL - 1
        self.assertEqual(self.request("GET", ACCOUNT_PATH)[0], 200, "inside the 60 s window")
        self.clock.now += 2
        self.assertEqual(self.request("GET", ACCOUNT_PATH)[0], 401, "after the window")
        self.assertEqual(self.issuer.introspections, 2)

    def test_cache_lifetime_is_capped_by_the_token_expiry(self) -> None:
        self.issuer.grant("token-a", exp=self.clock.now + 10)
        self.assertEqual(self.request("GET", ACCOUNT_PATH)[0], 200)
        self.clock.now += 11
        self.assertEqual(self.request("GET", ACCOUNT_PATH)[0], 401)

    def test_cache_is_keyed_by_digest_and_never_holds_the_token(self) -> None:
        self.issuer.grant("token-a")
        self.request("GET", ACCOUNT_PATH)
        self.assertTrue(self.server_module._tokens)
        self.assertNotIn("token-a", self.server_module._tokens)

    def test_cache_never_grows_past_its_cap(self) -> None:
        for index in range(self.server_module.TOKEN_CACHE_MAX + 40):
            self.server_module.introspect(f"anonymous-{index}")
        self.assertLessEqual(len(self.server_module._tokens), self.server_module.TOKEN_CACHE_MAX)

    # S268-205: every anonymous request with a fresh random bearer costs one round trip
    # to the issuer (and the shared login realm); there is no shape check on the token
    # and no limiter. Unique garbage also evicts the cached verdicts of real users.
    @unittest.expectedFailure
    def test_s268_205_garbage_tokens_do_not_all_reach_the_issuer(self) -> None:
        flood = self.server_module.TOKEN_CACHE_MAX + 24
        for index in range(flood):
            self.server_module.introspect(f"garbage-{index}")
        self.assertLess(self.issuer.introspections, flood)

    # S268-205 (eviction half): the flood pushes a real user's verdict out of the cache.
    @unittest.expectedFailure
    def test_s268_205_garbage_flood_does_not_evict_a_real_users_verdict(self) -> None:
        self.issuer.grant("token-a")
        self.server_module.introspect("token-a")
        self.assertEqual(self.issuer.introspections, 1)
        for index in range(self.server_module.TOKEN_CACHE_MAX + 8):
            self.server_module.introspect(f"garbage-{index}")
        before = self.issuer.introspections
        self.server_module.introspect("token-a")
        self.assertEqual(self.issuer.introspections, before, "the victim had to ask again")


class SubjectIsolationTest(BackupServerCase):
    """B.5: the account directory is the token's `sub`, checked against NAME_RE."""

    def _upload(self, token: str, world: str, payload: bytes) -> int:
        import hashlib

        digest = hashlib.sha256(payload).hexdigest()
        path = f"/v1/worlds/{world}/blobs/{digest}"
        return self.request("PUT", path, payload, token=token)[0]

    def test_unusable_subjects_are_refused_and_create_nothing(self) -> None:
        bad = [
            "",
            ".",
            "..",
            "../evil",
            "a/b",
            "a\\b",
            ".hidden",
            "-lead",
            "has space",
            "new\nline",
            "x" * 129,
            "a%2fb",
            "ärger",
        ]
        for sub in bad:
            with self.subTest(sub=sub):
                self.issuer.grant("token-a", sub=sub)
                self.server_module._tokens.clear()
                status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{DIGEST}", b"")
                self.assertEqual(status, 403)
        self.assertEqual(self.stored_files(), [])
        self.assertEqual([p for p in self.root.iterdir()], [])

    def test_valid_but_odd_subjects_stay_inside_root(self) -> None:
        for sub in ("a..b", "a.b", "A-b_c", "7", "x" * 128):
            with self.subTest(sub=sub):
                self.issuer.grant("token-a", sub=sub)
                self.server_module._tokens.clear()
                self.assertEqual(self._upload("token-a", "w", b"data-" + sub.encode()), 201)
        for path in self.stored_files():
            path.resolve().relative_to(self.root.resolve())

    def test_two_accounts_do_not_see_each_others_worlds_or_blobs(self) -> None:
        import hashlib

        self.issuer.grant("token-a", sub="account-a")
        self.issuer.grant("token-b", sub="account-b")
        payload = b"private manuscript bytes"
        digest = hashlib.sha256(payload).hexdigest()
        self.assertEqual(self._upload("token-a", "shared-name", payload), 201)
        status, _, body = self.request("GET", "/v1/worlds/shared-name/blobs", token="token-b")
        self.assertEqual((status, json.loads(body)), (200, {"blobs": []}))
        status, _, _ = self.request(
            "GET", f"/v1/worlds/shared-name/blobs/{digest}", token="token-b"
        )
        self.assertEqual(status, 404)
        status, _, body = self.request("GET", ACCOUNT_PATH, token="token-b")
        self.assertEqual(json.loads(body)["usedBytes"], 0)

    def _case_insensitive_volume(self) -> bool:
        probe = self.root / "CaseProbe"
        probe.mkdir()
        try:
            return (self.root / "caseprobe").exists()
        finally:
            probe.rmdir()

    def _two_subjects_share_storage(self, first: str, second: str) -> bool:
        self.issuer.grant("token-a", sub=first)
        self.issuer.grant("token-b", sub=second)
        payload = b"owned by the first subject"
        self.assertEqual(self._upload("token-a", "w", payload), 201)
        status, _, body = self.request("GET", "/v1/worlds/w/blobs", token="token-b")
        return status == 200 and bool(json.loads(body)["blobs"])

    # S268-208: the subject is used as a directory name without normalisation. On a
    # case-insensitive volume "Alice" and "alice" are one folder. Keycloak emits lower-case
    # UUIDs on Linux, so this is hardening; it needs another issuer or a Windows/macOS host.
    @unittest.expectedFailure
    def test_s268_208_subjects_differing_in_case_do_not_share_a_folder(self) -> None:
        if not self._case_insensitive_volume():
            self.skipTest("case-sensitive volume: the collision cannot occur here")
        self.assertFalse(self._two_subjects_share_storage("Alice", "alice"))

    # S268-208 (Windows): a trailing dot is dropped by the Win32 path layer.
    @unittest.expectedFailure
    def test_s268_208_trailing_dot_subject_does_not_alias_the_plain_name(self) -> None:
        if os.name != "nt":
            self.skipTest("trailing-dot aliasing is a Windows path rule")
        self.assertFalse(self._two_subjects_share_storage("alice.", "alice"))


class ConcurrentAccountsTest(BackupServerCase):
    """B.5: concurrent writers of different accounts stay in their own folders."""

    def test_parallel_uploads_land_in_their_own_account_folder(self) -> None:
        import hashlib

        for name in ("one", "two", "three"):
            self.issuer.grant(f"token-{name}", sub=f"account-{name}")
        errors: list[str] = []

        def put(name: str) -> None:
            payload = f"payload {name}".encode()
            digest = hashlib.sha256(payload).hexdigest()
            status, _, _ = self.request(
                "PUT", f"/v1/worlds/w/blobs/{digest}", payload, token=f"token-{name}"
            )
            if status != 201:
                errors.append(f"{name}: {status}")

        threads = [threading.Thread(target=put, args=(n,)) for n in ("one", "two", "three")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        self.assertEqual(errors, [])
        owners = {Path(p).relative_to(self.root).parts[0] for p in self.stored_files()}
        self.assertEqual(owners, {"account-one", "account-two", "account-three"})


if __name__ == "__main__":
    unittest.main()
