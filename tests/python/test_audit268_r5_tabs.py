"""T-268 fix round 5: two tabs of one session no longer take each other's place (F-268-28).

The newest check wins per session and tab, and a check that lost its place ends with its own
code, `writing_assistance.superseded`, which the client does not retry.
"""

from __future__ import annotations

import heapq
import threading
import unittest
from unittest.mock import patch

from quiltor.delivery.http.routes import writing_assistance
from tests.python.test_audit268_identity_support import SESSION_COOKIE, HostedHarness
from tests.python.test_audit268_r2_c import CHECK, OK_RESULT

CHECK_SECONDS = 3.0
TAB_B_OFFSET = 2.0
WATCH_SECONDS = 240.0


def simulate_two_tabs() -> tuple[int, dict[str, bool]]:
    """The probe of the review (T-268-r4-probes/two_tabs_probe.py) on fake time.

    The limiter is the real one with a fake clock; the outcome of a check is decided the way
    the route decides it. Each tab follows the client rule: a result ends it, `superseded`
    ends it, `rate_limited` waits for Retry-After and checks again. Nobody types.
    """
    now = [0.0]
    limiter = writing_assistance.GrammarLimiter(clock=lambda: now[0])
    events: list[tuple[float, int, str, str, object]] = []
    order = [0]

    def schedule(at: float, kind: str, tab: str, slot: object = None) -> None:
        order[0] += 1
        heapq.heappush(events, (at, order[0], kind, tab, slot))

    calls = 0
    results = {"A": False, "B": False}
    schedule(0.0, "start", "A")
    schedule(TAB_B_OFFSET, "start", "B")
    while events:
        at, _, kind, tab, slot = heapq.heappop(events)
        if at > WATCH_SECONDS:
            break
        now[0] = at
        if kind == "start":
            granted = limiter.acquire("alice", writing_assistance.grammar_key("session", tab))
            if isinstance(granted, int):
                schedule(at + max(1, granted), "start", tab)  # rate_limited -> retry
                continue
            calls += 1
            schedule(at + CHECK_SECONDS, "end", tab, granted)
            continue
        assert isinstance(slot, writing_assistance.GrammarSlot)
        superseded = slot.superseded
        limiter.release(slot)
        if not superseded:
            results[tab] = True
        # superseded -> the tab stops; a newer check of its own is already under way
    return calls, results


class TwoTabsTests(unittest.TestCase):
    def test_two_tabs_without_typing_call_languagetool_at_most_twice(self) -> None:
        calls, results = simulate_two_tabs()
        self.assertEqual(results, {"A": True, "B": True})
        self.assertLessEqual(calls, 2)


class GrammarKeyTests(unittest.TestCase):
    def test_two_tabs_of_one_session_have_their_own_keys(self) -> None:
        key = writing_assistance.grammar_key
        self.assertNotEqual(key("s", "tab-a"), key("s", "tab-b"))
        self.assertNotEqual(key("s", "tab-a"), key("t", "tab-a"))

    def test_a_missing_or_invalid_tab_id_is_the_one_anonymous_key(self) -> None:
        key = writing_assistance.grammar_key
        anonymous = key("s", None)
        for invalid in ("", " ", "a b", "x" * 65, "ä", "a\nb", "../x"):
            self.assertEqual(key("s", invalid), anonymous, repr(invalid))
        self.assertNotEqual(key("s", "x" * 64), anonymous)


class TabHeaderThroughTheRouteTests(HostedHarness):
    def setUp(self) -> None:
        super().setUp()
        patcher = patch.object(
            writing_assistance, "grammar_limiter", writing_assistance.GrammarLimiter()
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _check(self, session: str, tab: str | None):
        headers = {writing_assistance.GRAMMAR_TAB_HEADER: tab} if tab is not None else None
        return self.json_request(
            "POST",
            CHECK,
            {"language": "de-DE", "text": "Hallo Welt.", "customWords": []},
            headers=headers,
            cookies={SESSION_COOKIE: session},
        )

    def _race(self, first_tab: str | None, second_tab: str | None):
        """The first check is held inside LanguageTool while the second one runs."""
        alice = self.login("alice")
        entered = threading.Event()
        release = threading.Event()
        calls: list[int] = []

        def check(language, text, words):
            calls.append(1)
            if len(calls) == 1:
                entered.set()
                release.wait(10)
            return OK_RESULT

        results: list[tuple[int, object, dict[str, str]]] = []

        def first() -> None:
            status, document, headers, _ = self._check(alice, first_tab)
            results.append((status, document, headers))

        with (
            patch.dict("os.environ", {"QUILTOR_GRAMMAR_MAX_CONCURRENT": "2"}),
            patch.object(self.application.writing_assistance, "check", check),
        ):
            thread = threading.Thread(target=first)
            thread.start()
            self.assertTrue(entered.wait(5))
            second = self._check(alice, second_tab)
            release.set()
            thread.join(10)
        return results[0], second

    def test_two_tabs_of_one_session_both_get_their_result(self) -> None:
        (status, document, _), second = self._race("tab-a", "tab-b")
        self.assertEqual(second[0], 200, second[1])
        self.assertEqual(status, 200, document)

    def test_the_older_check_of_one_tab_ends_as_superseded_without_retry_after(self) -> None:
        (status, document, headers), second = self._race("tab-a", "tab-a")
        self.assertEqual(second[0], 200, second[1])
        self.assertEqual(status, 429)
        assert isinstance(document, dict)
        self.assertEqual(document["error"]["code"], "writing_assistance.superseded")
        self.assertFalse(document["error"]["retryable"])
        self.assertNotIn("retry-after", {name.lower() for name in headers})

    def test_an_invalid_tab_id_shares_the_key_of_a_missing_one_without_an_error(self) -> None:
        (status, document, _), second = self._race(None, "not a token!")
        self.assertEqual(second[0], 200, second[1])
        self.assertEqual(status, 429)
        assert isinstance(document, dict)
        self.assertEqual(document["error"]["code"], "writing_assistance.superseded")


if __name__ == "__main__":
    unittest.main()
