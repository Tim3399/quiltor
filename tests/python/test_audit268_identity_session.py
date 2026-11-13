"""T-268 audit D1: session lifetime, role withdrawal, render tokens, master token
(checklist 1.7, 1.9, 1.10, 2.4e). Gap tests are `@unittest.expectedFailure` and name S268-<n>.
"""

from __future__ import annotations

import os
import re
import unittest
from typing import cast
from unittest.mock import MagicMock, patch

from quiltor.infrastructure.identity.render_tokens import InMemoryRenderTokenStore
from quiltor.infrastructure.identity.runtime import ROLE_FRESH_SECONDS
from tests.python.test_audit268_identity_support import SESSION_COOKIE, HostedHarness


class RoleAndAccountFollowTheProviderTests(HostedHarness):
    """1.7 and 2.4e."""

    def serverai(self, session: str) -> bool | None:
        status, document, _, _ = self.json_request(
            "GET", "/api/capabilities", cookies={SESSION_COOKIE: session}
        )
        return document["user"]["serverAi"] if status == 200 else None

    def whoami(self, session: str) -> int:
        return self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: session})[0]

    def job_status(self, session: str, world: str) -> int:
        return self.json_request(
            "POST",
            "/api/assistant/jobs",
            {"worldId": world, "question": "Q"},
            headers={"Idempotency-Key": f"k-{self.clock.now}"},
            cookies={SESSION_COOKIE: session},
        )[0]

    # ----- 1.7: the provider is asked again once the access token has run out

    def test_a_disabled_account_loses_the_session_within_one_access_token_lifetime(self) -> None:
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["disabled"] = True
        self.assertEqual(self.whoami(session), 200, "inside the window nothing is asked")
        self.clock.advance(300 - 30 + 1)
        self.assertEqual(self.whoami(session), 401)
        self.assertIsNone(self.gateway.get_session(session))

    def test_every_login_gets_a_fresh_session_id_and_the_old_one_is_not_reused(self) -> None:
        first = self.login("alice")
        second = self.login("alice")
        self.assertNotEqual(first, second)

    def test_the_quiltor_session_ends_after_24_hours_whatever_the_provider_says(self) -> None:
        session = self.login("alice")
        for _ in range(60):
            self.clock.advance(23 * 3600 / 60)
            self.whoami(session)
        self.clock.advance(3600 + 1)
        self.assertEqual(self.whoami(session), 401)

    # ----- 2.4e branch 1: role withdrawn, refresh brings a new id_token

    def test_branch1_a_withdrawn_role_counts_after_one_access_token_lifetime(self) -> None:
        session = self.login("alice", roles=("premium",))
        world = self.create_world(session)
        self.assertEqual(self.job_status(session, world), 202)
        self.provider.accounts["alice"]["roles"] = []
        self.assertTrue(self.serverai(session), "stale until the access token runs out")
        self.clock.advance(300 - 30 + 1)
        self.assertFalse(self.serverai(session))
        self.assertEqual(self.job_status(session, world), 403)

    def test_branch1_a_refresh_with_another_accounts_id_token_ends_the_session(self) -> None:
        session = self.login("alice", roles=("premium",))
        self.provider.add_account("bob", roles=("premium",))
        self.provider.refresh_id_token_for = "bob"
        self.clock.advance(300)
        self.assertEqual(self.whoami(session), 401)

    # ----- 2.4e branch 2: no refresh token or no expiry: nothing is ever asked again

    def test_branch2_a_session_without_refresh_token_keeps_the_session_but_not_the_roles(
        self,
    ) -> None:
        """S268-4: `_refresh_due` is False without refresh_token or access_expires_at, so the
        provider is never asked; the session lasts, the roles stop counting after the bound."""
        self.provider.grant_omits_refresh_token = True
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        self.provider.accounts["alice"]["disabled"] = True
        self.clock.advance(23 * 3600)
        self.assertEqual(self.whoami(session), 200)
        self.assertFalse(self.serverai(session))

    def test_branch2_a_session_without_token_lifetime_is_never_refreshed(self) -> None:
        self.provider.grant_omits_expires_in = True
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        self.clock.advance(23 * 3600)
        self.assertFalse(self.serverai(session))

    def test_branch2_a_withdrawn_role_is_noticed_even_without_a_refresh_token(self) -> None:
        """S268-4: a session that cannot be refreshed must not keep roles for 24 h, e.g.
        its entitlement expires with a short horizon, or the login is refused outright."""
        self.provider.grant_omits_refresh_token = True
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        self.clock.advance(3600)
        self.assertFalse(self.serverai(session))

    # ----- 2.4e branch 3: refresh answer without id_token

    def test_branch3_a_refresh_without_id_token_keeps_the_session(self) -> None:
        """S268-4: the roles are only re-read from a verified id_token; an answer without one
        renews the access token and the session stays."""
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        self.provider.refresh_omits_id_token = True
        for _ in range(5):
            self.clock.advance(300)
            self.assertEqual(self.whoami(session), 200)

    def test_branch3_a_refresh_without_id_token_does_not_confirm_the_roles(self) -> None:
        """S268-4: an answer that carries no id_token must not extend the trust in old roles."""
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        self.provider.refresh_omits_id_token = True
        for _ in range(5):
            self.clock.advance(300)
            self.whoami(session)
        self.assertFalse(self.serverai(session))

    # ----- 2.4e branch 4: the provider fails

    def test_branch4_a_failing_provider_keeps_the_session_but_not_the_roles(self) -> None:
        """S268-5: 5xx, timeout, invalid_client and every other non-invalid_grant answer
        keep the session; the roles stop counting once the bound has passed."""
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        for mode in ("5xx", "unreachable", "invalid_client"):
            with self.subTest(mode):
                self.provider.refresh_mode = mode
                self.clock.advance(3600)
                self.assertEqual(self.whoami(session), 200)
                self.assertFalse(self.serverai(session))

    def test_branch4_the_backoff_limits_requests_to_the_provider(self) -> None:
        session = self.login("alice", roles=("premium",))
        self.provider.refresh_mode = "5xx"
        self.clock.advance(300)
        before = len(self.provider.requests)
        for _ in range(10):
            self.whoami(session)
        self.assertEqual(len(self.provider.requests) - before, 1)
        self.clock.advance(61)
        self.whoami(session)
        self.assertEqual(len(self.provider.requests) - before, 2)

    def test_branch4_stale_roles_do_not_outlive_a_bound(self) -> None:
        """S268-5: after the provider has been unreachable for longer than a stated bound
        (hours at most) the session stops counting as premium."""
        session = self.login("alice", roles=("premium",))
        self.provider.accounts["alice"]["roles"] = []
        self.provider.refresh_mode = "5xx"
        self.clock.advance(6 * 3600)
        self.assertFalse(self.serverai(session))

    def test_invalid_grant_ends_the_session_for_good(self) -> None:
        session = self.login("alice", roles=("premium",))
        self.provider.refresh_mode = "invalid_grant"
        self.clock.advance(300)
        self.assertEqual(self.whoami(session), 401)
        self.provider.refresh_mode = "ok"
        self.assertEqual(self.whoami(session), 401)

    def test_a_granted_role_is_picked_up_without_a_new_login(self) -> None:
        session = self.login("alice", roles=())
        self.assertFalse(self.serverai(session))
        self.provider.accounts["alice"]["roles"] = ["premium"]
        self.clock.advance(300)
        self.assertTrue(self.serverai(session))

    def test_logout_drops_the_provider_tokens_but_not_queued_jobs(self) -> None:
        """Observation for D2: logging out destroys the session; nothing cancels a job that
        was queued before. (The job runner holds no roles: see report, section "an D2".)"""
        session = self.login("alice", roles=("premium",))
        self.json_request("POST", "/logout", {}, cookies={SESSION_COOKIE: session})
        self.assertIsNone(self.gateway.get_session(session))
        self.assertFalse(cast(MagicMock, self.application.assistant_services.jobs).cancel.called)


class PremiumConfirmedTests(HostedHarness):
    """S268-100: the port method the job runner asks, never the session's stale roles."""

    def test_a_fresh_premium_session_is_confirmed(self) -> None:
        self.login("alice", roles=("premium",))
        self.assertTrue(self.gateway.premium_confirmed("alice", "premium"))

    def test_a_fresh_session_without_premium_is_not_confirmed(self) -> None:
        self.login("alice", roles=("other",))
        self.assertFalse(self.gateway.premium_confirmed("alice", "premium"))

    def test_a_stale_confirmation_is_not_enough(self) -> None:
        self.provider.grant_omits_refresh_token = True
        self.login("alice", roles=("premium",))
        self.clock.advance(ROLE_FRESH_SECONDS - 1)
        self.assertTrue(self.gateway.premium_confirmed("alice", "premium"))
        self.clock.advance(2)
        self.assertFalse(self.gateway.premium_confirmed("alice", "premium"))

    def test_a_refresh_confirms_again(self) -> None:
        session = self.login("alice", roles=("premium",))
        for _ in range(4):
            self.clock.advance(300)
            self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: session})
            self.assertTrue(self.gateway.premium_confirmed("alice", "premium"))

    def test_no_session_logout_and_unknown_account_are_not_confirmed(self) -> None:
        self.assertFalse(self.gateway.premium_confirmed("nobody", "premium"))
        session = self.login("alice", roles=("premium",))
        self.assertFalse(self.gateway.premium_confirmed("bob", "premium"))
        self.json_request("POST", "/logout", {}, cookies={SESSION_COOKIE: session})
        self.assertFalse(self.gateway.premium_confirmed("alice", "premium"))

    def test_an_expired_session_is_not_confirmed(self) -> None:
        self.login("alice", roles=("premium",))
        self.clock.advance(24 * 3600 + 1)
        self.assertFalse(self.gateway.premium_confirmed("alice", "premium"))


class LongLivedAccessTokenTests(HostedHarness):
    """F-268-17: an access token that outlives ROLE_FRESH_SECONDS must not cost the role."""

    def setUp(self) -> None:
        super().setUp()
        self.provider.access_lifespan = 3600

    def test_the_role_is_confirmed_again_before_the_bound_runs_out(self) -> None:
        session = self.login("alice", roles=("premium",))
        for step in (500, 200, 2800):  # t = 500, 700, 3500
            self.clock.advance(step)
            self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: session})
            self.assertTrue(self.gateway.premium_confirmed("alice", "premium"), step)

    def test_the_job_runner_refreshes_without_any_request(self) -> None:
        self.login("alice", roles=("premium",))
        self.clock.advance(700)
        self.assertTrue(self.gateway.premium_confirmed("alice", "premium"))
        self.clock.advance(2800)
        self.assertTrue(self.gateway.premium_confirmed("alice", "premium"))

    def test_a_broken_provider_still_empties_the_roles_after_the_bound(self) -> None:
        session = self.login("alice", roles=("premium",))
        self.provider.refresh_mode = "5xx"
        self.clock.advance(ROLE_FRESH_SECONDS + 100)
        self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: session})
        self.assertFalse(self.gateway.premium_confirmed("alice", "premium"))
        self.clock.advance(2800)
        self.assertFalse(self.gateway.premium_confirmed("alice", "premium"))


class RenderTokenTests(HostedHarness):
    """1.9."""

    def setUp(self) -> None:
        super().setUp()
        self.application.identity._render_tokens = InMemoryRenderTokenStore(clock=self.clock)
        self.targets: list[str] = []
        self.application.render_pdf = lambda target: self.targets.append(target) or b"%PDF-1.4"

    def issue(self, session: str, world: str) -> str:
        status, headers, _, _ = self.request(
            "POST", "/api/book.pdf", {"worldId": world}, cookies={SESSION_COOKIE: session}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["cache-control"], "no-store")
        match = re.search(r"renderToken=([^&]+)", self.targets[-1])
        assert match is not None
        return match.group(1)

    def test_the_token_is_single_use_and_ninety_seconds_long(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        token = self.issue(alice, world)
        status, _, _, cookies = self.request("GET", f"/api/state?world={world}&renderToken={token}")
        self.assertEqual(status, 200)
        cookie = next(c for c in cookies if c.startswith(SESSION_COOKIE + "="))
        self.assertIn("Max-Age=90", cookie)
        self.assertEqual(
            self.request("GET", f"/api/state?world={world}&renderToken={token}")[0], 401
        )
        late = self.issue(alice, world)
        self.clock.advance(91)
        self.assertEqual(
            self.request("GET", f"/api/state?world={world}&renderToken={late}")[0], 401
        )

    def test_the_session_made_from_a_token_dies_after_ninety_seconds_and_has_no_roles(self) -> None:
        alice = self.login("alice", roles=("premium",))
        world = self.create_world(alice)
        token = self.issue(alice, world)
        _, _, _, cookies = self.request("GET", f"/api/state?world={world}&renderToken={token}")
        value = (
            next(c for c in cookies if c.startswith(SESSION_COOKIE + "="))
            .split(";")[0]
            .split("=")[1]
        )
        _status, document, _, _ = self.json_request(
            "GET", "/api/capabilities", cookies={SESSION_COOKIE: value}
        )
        self.assertFalse(document["user"]["serverAi"])
        self.clock.advance(91)
        self.assertEqual(
            self.json_request("GET", "/api/whoami", cookies={SESSION_COOKIE: value})[0], 401
        )

    def test_a_token_is_bound_to_the_issuing_account(self) -> None:
        alice, bob = self.login("alice"), self.login("bob")
        alices_world, bobs_world = self.create_world(alice), self.create_world(bob)
        token = self.issue(alice, alices_world)
        status, _, _, _ = self.request("GET", f"/api/state?world={bobs_world}&renderToken={token}")
        self.assertEqual(status, 403)

    def test_a_forged_or_empty_token_gives_nothing(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        for token in ("", "x", "A" * 32):
            self.assertEqual(
                self.request("GET", f"/api/state?world={world}&renderToken={token}")[0], 401
            )

    def test_the_token_does_not_reach_the_log(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        token = self.issue(alice, world)
        self.request("GET", f"/api/state?world={world}&renderToken={token}")
        self.assertNotIn(token, self.log.text())

    @unittest.expectedFailure
    def test_a_redeemed_token_opens_only_the_read_routes_of_its_world(self) -> None:
        """S268-6: the 90 s session made from a render token can write, delete and export,
        although the render only reads one world."""
        alice = self.login("alice")
        world = self.create_world(alice)
        token = self.issue(alice, world)
        status, _, _, _ = self.request(
            "POST", f"/api/worlds/delete?renderToken={token}", {"id": world}
        )
        self.assertEqual(status, 401)

    def test_capacity_of_the_token_store_is_bounded(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        self.application.identity._render_tokens = InMemoryRenderTokenStore(
            clock=self.clock, capacity=3
        )
        for _ in range(3):
            self.issue(alice, world)
        status, _, _, _ = self.request(
            "POST", "/api/book.pdf", {"worldId": world}, cookies={SESSION_COOKIE: alice}
        )
        self.assertEqual(status, 500, "a full store answers 500 until tokens expire")


class MasterTokenTests(HostedHarness):
    """1.10: the local owner's token means nothing to a hosted server."""

    def test_the_master_token_is_not_accepted_under_oidc(self) -> None:
        secret = "A" * 43
        with patch.dict(os.environ, {"QUILTOR_MASTER_TOKEN": secret}):
            for path, headers in (
                ("/api/whoami", {"Authorization": f"Bearer {secret}"}),
                (f"/api/whoami?token={secret}", {}),
            ):
                status, _, _, cookies = self.request("GET", path, headers=headers)
                self.assertEqual(status, 401, path)
                self.assertFalse([c for c in cookies if c.startswith(SESSION_COOKIE + "=")])

    def test_a_query_token_never_reaches_the_log_under_oidc(self) -> None:
        self.request("GET", "/api/whoami?token=CNRYtokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        self.assertNotIn("CNRYtoken", self.log.text())


if __name__ == "__main__":
    unittest.main()
