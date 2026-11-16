"""The relay routes: the browser picks up a model call and answers it (T-61 Teil 3).

A real server under OIDC, a real job queue and the real ticket store. The job's runtime
makes one model call through the relay engine, so a test plays the browser by polling
`relay/next` and posting to `relay/answer`.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any
from unittest.mock import MagicMock

from quiltor.bootstrap.application import AssistantServices
from quiltor.infrastructure.inference.relay import RelayInferenceEngine, RelayTicketStore
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.modules.assistant.jobs import AssistantJobRunner
from tests.python import late_body
from tests.python.test_assistant_jobs import (
    FakeInteractionLogger,
    SilentLogger,
    TestMetrics,
)
from tests.python.test_assistant_relay_engine import PAYLOAD
from tests.python.test_server_auth import _LiveAuthServerTestCase

LIMIT = 256 * 1024


class _AnyWorld:
    """Every world the route created exists; the runner only asks."""

    def exists(self, owner_sub: str, world_id: str) -> bool:
        return True

    def revision(self, owner_sub: str, world_id: str) -> int:
        return 0

    def revisions(self, owner_sub: str, world_id: str) -> dict[str, int]:
        # A fresh world, as the route snapshotted it: nothing changed while it worked.
        return {"manuscript": 0, "figures": 0, "storyboards": 0}


class _OneCallRuntime:
    """A job runtime whose answer is one model call through the relay engine."""

    def __init__(self, engine: RelayInferenceEngine) -> None:
        self.engine = engine

    def reload(self) -> None:
        pass

    def complete(self, question, *args, **kwargs):
        reply = self.engine.invoke(PAYLOAD)
        reply.pop("_runtime", None)
        return {"message": str(reply.get("message", "")), "proposals": [], "sources": []}

    def close(self) -> None:
        self.engine.close()


class RelayRouteTestCase(_LiveAuthServerTestCase):
    def setUp(self):
        super().setUp()
        self.application.assistant_client_ai = True
        self.tickets = RelayTicketStore()
        data = self.directories.data

        def runtime(job: dict[str, Any], request: dict[str, Any]) -> _OneCallRuntime:
            engine = request.get("engine") or {"kind": job["engine"]}
            return _OneCallRuntime(RelayInferenceEngine(self.tickets, str(job["id"]), engine))

        self.runner = AssistantJobRunner(
            MagicMock(),
            store_factory=lambda: AssistantJobStore(data / "assistant-jobs.sqlite3"),
            interaction_logger=FakeInteractionLogger(),
            world_access=_AnyWorld(),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
            client_runtime_factory=runtime,
        )
        self.addCleanup(self.runner.close)
        self.application.assistant_services = AssistantServices(
            MagicMock(), self.runner, self.tickets
        )
        self.alice = self._login("alice", roles=())
        self.world = self._world(self.alice)

    # ---------- helpers ----------

    def _world(self, session: str) -> str:
        status, _, raw, _ = self._request(
            "POST",
            "/api/worlds/create",
            {"title": "Welt", "backupUrl": ""},
            cookies={"quiltor_session": session},
        )
        self.assertEqual(status, 200, raw)
        return json.loads(raw)["world"]["id"]

    def _job(self, session: str | None = None, world: str | None = None, engine=None) -> str:
        session, world = session or self.alice, world or self.world
        status, _, raw, _ = self._request(
            "POST",
            "/api/assistant/jobs",
            {
                "worldId": world,
                "question": "Wer ist Tarek?",
                "engine": engine or {"kind": "webllm"},
            },
            headers={"Idempotency-Key": f"key-{time.monotonic_ns()}"},
            cookies={"quiltor_session": session},
        )
        self.assertIn(status, {200, 202}, raw)
        return json.loads(raw)["job"]["id"]

    def _next(self, job: str, session: str | None = None, world: str | None = None):
        status, _, raw, _ = self._request(
            "GET",
            f"/api/assistant/relay/next?world={world or self.world}&job={job}",
            cookies={"quiltor_session": session or self.alice},
        )
        body: dict[str, Any] = json.loads(raw) if raw else {}
        return status, body

    def _answer(self, body: Any, session: str | None = None, world: str | None = None, raw=None):
        headers = {"Content-Type": "application/json"}
        session = session or self.alice
        data = raw if raw is not None else json.dumps(body).encode("utf-8")
        answer = late_body.send(
            self.port,
            "POST",
            f"/api/assistant/relay/answer?world={world or self.world}",
            headers={**headers, "Cookie": f"quiltor_session={session}"},
            body=data,
            pause=0,
        )
        result: dict[str, Any] = answer.json() if answer.body else {}
        return answer.status, result

    def _ticket(self, job: str) -> dict[str, Any]:
        status, body = self._next(job)
        self.assertEqual(status, 200, body)
        return body["request"]

    def _job_state(self, job: str, timeout: float = 5) -> dict[str, Any]:
        return self.runner.wait(job, "alice", self.world, timeout=timeout)


class RelayRouteTests(RelayRouteTestCase):
    def test_the_browser_picks_up_the_call_and_its_answer_finishes_the_job(self):
        job = self._job()
        request = self._ticket(job)
        self.assertEqual(request["seq"], 1)
        self.assertEqual(request["engine"]["kind"], "webllm")
        self.assertEqual(request["payload"], PAYLOAD)
        self.assertEqual(request["limits"]["maxOutputBytes"], LIMIT)
        status, body = self._answer(
            {
                "ticket": request["ticket"],
                "output": {
                    "content": json.dumps({"message": "Ein Kartograph."}),
                    "finishReason": "stop",
                },
            }
        )
        self.assertEqual(status, 200, body)
        done = self._job_state(job)
        self.assertEqual(done["status"], "completed")
        self.assertEqual(done["result"]["message"], "Ein Kartograph.")

    def test_someone_else_and_another_session_get_nothing(self):
        job = self._job()
        bob = self._login("bob", roles=())
        bob_world = self._world(bob)
        status, body = self._next(job, session=bob, world=bob_world)
        self.assertEqual((status, body["error"]["code"]), (404, "assistant.job_not_found"))
        second = self._login("alice", roles=())
        status, body = self._next(job, session=second)
        self.assertEqual((status, body["error"]["code"]), (404, "relay.ticket_not_found"))
        status, _ = self._next(job, session=bob)  # Bob in Alice's world
        self.assertIn(status, {403, 404})

    def test_a_server_job_is_no_relay_job(self):
        paid = self._login("paid")
        world = self._world(paid)
        status, _, raw, _ = self._request(
            "POST",
            "/api/assistant/jobs",
            {"worldId": world, "question": "Wer?"},
            headers={"Idempotency-Key": "server-key"},
            cookies={"quiltor_session": paid},
        )
        self.assertEqual(status, 202, raw)
        job = json.loads(raw)["job"]["id"]
        status, body = self._next(job, session=paid, world=world)
        self.assertEqual((status, body["error"]["code"]), (404, "assistant.job_not_found"))

    def test_a_ticket_answers_once(self):
        job = self._job()
        request = self._ticket(job)
        answer = {"ticket": request["ticket"], "output": {"content": "{}", "finishReason": "stop"}}
        self.assertEqual(self._answer(answer)[0], 200)
        status, body = self._answer(answer)
        self.assertEqual((status, body["error"]["code"]), (410, "relay.ticket_expired"))

    def test_an_answer_above_the_limit_is_refused_unread(self):
        """Refused on the declared length alone. Only the headers are sent: the server must
        answer without waiting for a body, and a body it never reads would make Windows
        reset the connection under the answer (D-38, plan F7)."""
        job = self._job()
        self._ticket(job)
        for length in (str(300 * 1024), str(LIMIT + 1)):
            with self.subTest(length=length):
                answer = late_body.send(
                    self.port,
                    "POST",
                    f"/api/assistant/relay/answer?world={self.world}",
                    headers={
                        "Content-Type": "application/json",
                        "Cookie": f"quiltor_session={self.alice}",
                    },
                    body=b"",
                    length=length,
                )
                self.assertEqual(answer.status, 413, answer.body[:200])
                self.assertEqual(answer.json()["error"]["code"], "relay.answer_too_large")

    def test_an_answer_that_is_no_json_or_has_the_wrong_shape_is_400(self):
        job = self._job()
        request = self._ticket(job)
        ticket = request["ticket"]
        for raw in (
            b"no json",
            b"[" * 100_000,
            json.dumps({"ticket": ticket}).encode(),
            json.dumps({"ticket": ticket, "output": {"content": 7}}).encode(),
            json.dumps({"ticket": ticket, "error": {"code": "nonsense"}}).encode(),
            json.dumps(
                {"ticket": ticket, "output": {"content": "{}"}, "error": {"code": "cancelled"}}
            ).encode(),
        ):
            with self.subTest(raw=raw[:40]):
                status, body = self._answer(None, raw=raw)
                self.assertEqual(status, 400, body)
                self.assertEqual(body["error"]["code"], "relay.answer_invalid")

    def test_five_failures_shut_the_session_out(self):
        job = self._job()
        self._ticket(job)
        for _ in range(4):
            status, _ = self._answer({"ticket": "wrong", "output": {"content": "{}"}})
            self.assertEqual(status, 404)
        status, body = self._answer({"ticket": "wrong", "output": {"content": "{}"}})
        self.assertEqual((status, body["error"]["code"]), (429, "relay.too_many_failures"))

    def test_someone_elses_world_is_refused_before_the_answer_is_read(self):
        """The world is in the query: the dispatch refuses it with the body unread (D-38)."""
        bob = self._login("bob", roles=())
        for attempt in range(30):
            with self.subTest(attempt=attempt):
                answer = late_body.send(
                    self.port,
                    "POST",
                    f"/api/assistant/relay/answer?world={self.world}",
                    headers={
                        "Content-Type": "application/json",
                        "Cookie": f"quiltor_session={bob}",
                    },
                    body=b'{"ticket": "x", "output": {"content": "{}"}}',
                )
                self.assertIn(answer.status, {403, 404}, answer.body[:200])
                self.assertFalse(answer.json()["ok"])

    def test_a_foreign_origin_gets_its_whole_403(self):
        for attempt in range(30):
            with self.subTest(attempt=attempt):
                answer = late_body.send(
                    self.port,
                    "POST",
                    f"/api/assistant/relay/answer?world={self.world}",
                    headers={
                        "Content-Type": "application/json",
                        "Origin": "https://evil.example",
                        "Cookie": f"quiltor_session={self.alice}",
                    },
                    body=b'{"ticket": "x"}',
                )
                self.assertEqual(answer.status, 403, answer.body[:200])
                self.assertEqual(answer.json()["error"]["code"], "request.untrusted_origin")

    def test_unknown_fields_are_dropped_and_never_logged(self):
        job = self._job()
        request = self._ticket(job)
        with self.assertLogs("quiltor", level="DEBUG") as captured:
            logging.getLogger("quiltor").debug("marker")
            status, body = self._answer(
                {
                    "ticket": request["ticket"],
                    "apiKey": "sk-LEAK-relay-route",
                    "output": {
                        "content": "{}",
                        "finishReason": "stop",
                        "apiKey": "sk-LEAK-relay-route",
                    },
                }
            )
        self.assertEqual(status, 200, body)
        self.assertNotIn("sk-LEAK", "\n".join(captured.output))

    def test_only_the_known_fields_of_an_answer_reach_the_waiting_call(self):
        from quiltor.delivery.http.routes.assistant_relay import _answer_from

        ticket, answer = _answer_from(
            {
                "ticket": "t",
                "apiKey": "sk-LEAK",
                "output": {
                    "content": "{}",
                    "finishReason": "stop",
                    "usage": {"promptTokens": 3, "secret": "sk-LEAK"},
                    "apiKey": "sk-LEAK",
                },
            }
        ) or ("", {})
        self.assertEqual(ticket, "t")
        self.assertEqual(
            answer,
            {"output": {"content": "{}", "finishReason": "stop", "usage": {"promptTokens": 3}}},
        )
        _, error = _answer_from(
            {"ticket": "t", "error": {"code": "provider_error", "apiKey": "sk-LEAK"}}
        ) or ("", {})
        self.assertEqual(error, {"error": {"code": "provider_error"}})

    def test_only_a_known_finish_reason_is_taken(self):
        """F-61-18: stop and length pass, a missing one means stop, anything else is no
        answer of ours."""
        from quiltor.delivery.http.routes.assistant_relay import _answer_from

        for reason in ("stop", "length"):
            with self.subTest(reason=reason):
                parsed = _answer_from(
                    {"ticket": "t", "output": {"content": "{}", "finishReason": reason}}
                )
                self.assertEqual(parsed and parsed[1]["output"]["finishReason"], reason)
        parsed = _answer_from({"ticket": "t", "output": {"content": "{}"}})
        self.assertEqual(parsed and parsed[1]["output"]["finishReason"], "stop")
        for reason in ("tool_calls", "content_filter", "", None, 1):
            with self.subTest(reason=reason):
                self.assertIsNone(
                    _answer_from(
                        {"ticket": "t", "output": {"content": "{}", "finishReason": reason}}
                    )
                )

    def test_a_browser_error_detail_is_trimmed_to_200_clean_characters(self):
        job = self._job()
        request = self._ticket(job)
        status, _ = self._answer(
            {
                "ticket": request["ticket"],
                "error": {"code": "provider_error", "status": 401, "detail": "\x07bad key " * 2000},
            }
        )
        self.assertEqual(status, 200)
        done = self._job_state(job)
        self.assertEqual(done["status"], "failed")
        self.assertLessEqual(len(done["error"]), len("provider_error: ") + 200)
        self.assertNotIn("\x07", done["error"])
        self.assertIn("bad key", done["error"])

    def test_cancel_ends_a_waiting_poll_and_the_job(self):
        job = self._job()
        self._ticket(job)  # delivered, the job now waits for the answer
        import threading

        result: list[Any] = []
        poll = threading.Thread(target=lambda: result.append(self._next(job)), daemon=True)
        poll.start()
        time.sleep(0.2)
        status, raw = self._request(
            "POST",
            "/api/assistant/job/cancel",
            {"worldId": self.world, "id": job},
            cookies={"quiltor_session": self.alice},
        )[0::2]
        self.assertEqual(status, 200, raw)
        poll.join(5)
        self.assertFalse(poll.is_alive())
        self.assertEqual(result[0][0], 204)
        self.assertEqual(self._job_state(job)["status"], "cancelled")

    def test_with_the_switch_off_both_routes_are_403(self):
        job = self._job()
        request = self._ticket(job)
        self.application.assistant_client_ai = False
        status, body = self._next(job)
        self.assertEqual((status, body["error"]["code"]), (403, "assistant.client_ai_disabled"))
        status, body = self._answer({"ticket": request["ticket"], "output": {"content": "{}"}})
        self.assertEqual((status, body["error"]["code"]), (403, "assistant.client_ai_disabled"))

    def test_a_poll_without_a_ticket_waits_and_answers_204(self):
        job = self._job()
        self._ticket(job)
        started = time.monotonic()
        # The only ticket is out; the next poll finds nothing until the long poll ends.
        self.tickets_wait_patch = None
        from quiltor.delivery.http.routes import assistant_relay

        original = assistant_relay.LONG_POLL_SECONDS
        assistant_relay.LONG_POLL_SECONDS = 0.3
        try:
            status, body = self._next(job)
        finally:
            assistant_relay.LONG_POLL_SECONDS = original
        self.assertEqual(status, 204)
        self.assertEqual(body, {})
        self.assertLess(time.monotonic() - started, 5)


class RelayFinishedJobTests(RelayRouteTestCase):
    """F-61-16: the own session answering a ticket of a job that ended is no failure."""

    def _cancelled_ticket(self) -> str:
        job = self._job()
        request = self._ticket(job)
        status, _ = self._request(
            "POST",
            "/api/assistant/job/cancel",
            {"worldId": self.world, "id": job},
            cookies={"quiltor_session": self.alice},
        )[0::2]
        self.assertEqual(status, 200)
        self.assertEqual(self._job_state(job)["status"], "cancelled")
        return request["ticket"]

    def test_the_own_session_answering_after_a_cancel_is_410_and_not_counted(self):
        for _ in range(6):
            ticket = self._cancelled_ticket()
            status, body = self._answer({"ticket": ticket, "output": {"content": "{}"}})
            self.assertEqual((status, body["error"]["code"]), (410, "relay.ticket_expired"))
        # Six finished jobs later the session still works.
        job = self._job()
        self.assertEqual(self._next(job)[0], 200)

    def test_another_session_answering_a_cancelled_ticket_still_counts(self):
        ticket = self._cancelled_ticket()
        stranger = self._login("alice", roles=())
        for _ in range(4):
            status, _ = self._answer(
                {"ticket": ticket, "output": {"content": "{}"}}, session=stranger
            )
            self.assertEqual(status, 404)
        status, body = self._answer(
            {"ticket": ticket, "output": {"content": "{}"}}, session=stranger
        )
        self.assertEqual((status, body["error"]["code"]), (429, "relay.too_many_failures"))


if __name__ == "__main__":
    import unittest

    unittest.main()
