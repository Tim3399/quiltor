"""The relay: model calls of a client-engine job travel to the browser as tickets (T-61 Teil 2).

The clock is fake where deadlines matter; waits poll it, so moving it is enough to make a
deadline pass. Threads stand in for the job worker that waits and the browser that answers.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

from quiltor.bootstrap.application import build_assistant_services
from quiltor.infrastructure.inference.relay import RelayInferenceEngine, RelayTicketStore
from quiltor.infrastructure.inference.relay.tickets import (
    RelayTicketExpired,
    RelayTicketNotFound,
    RelayTooManyFailures,
)
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.modules.assistant.jobs import AssistantJobRunner
from quiltor.modules.assistant.ports import (
    ClientJobRunning,
    IncompleteInferenceResponse,
    InferenceTimeoutError,
    InferenceUnavailableError,
    InferenceValidationError,
)
from quiltor.modules.assistant.runtime import AssistantRuntime
from tests.python.narrowing import present
from tests.python.test_assistant_jobs import (
    WORLD_ID,
    FakeAssistant,
    FakeInteractionLogger,
    FakeWorldAccess,
    SilentLogger,
    TestMetrics,
    create_world_file,
    execution,
    intent,
)

JOB = "job-1"
ALICE = {"sub": "alice", "session_id": "session-a", "world_id": WORLD_ID}
PAYLOAD = {
    "messages": [{"role": "system", "content": "x" * 300}, {"role": "user", "content": "Wer?"}],
    "max_tokens": 100,
    "response_format": {
        "type": "json_schema",
        "json_schema": {"name": "quiltor_reply", "schema": {"type": "object"}},
    },
}


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class Call:
    """`invoke` in a thread of its own, as the job worker runs it."""

    def __init__(self, engine: RelayInferenceEngine, payload: dict[str, Any] = PAYLOAD) -> None:
        self.result: Any = None
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, args=(engine, payload), daemon=True)
        self.thread.start()

    def _run(self, engine: RelayInferenceEngine, payload: dict[str, Any]) -> None:
        try:
            self.result = engine.invoke(payload)
        except BaseException as exc:
            self.error = exc

    def join(self, timeout: float = 3.0) -> None:
        self.thread.join(timeout)
        if self.thread.is_alive():
            raise AssertionError("invoke did not return")


def _output(content: Any, finish: str = "stop", usage: dict[str, Any] | None = None):
    return {
        "output": {
            "content": content,
            "finishReason": finish,
            **({"usage": usage} if usage else {}),
        }
    }


class RelayTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.tickets = RelayTicketStore(clock=self.clock)
        self.tickets.bind_job(JOB, **ALICE)
        self.engine = RelayInferenceEngine(
            self.tickets, JOB, {"kind": "webllm", "grammar": True}, clock=self.clock
        )

    def tearDown(self) -> None:
        self.tickets.close()

    def pick_up(self, **binding: str):
        return self.tickets.next_for(**{**ALICE, **binding}, job_id=JOB, wait=2)

    def answer(self, token: str, answer: dict[str, Any], **binding: str):
        return self.tickets.answer(token, **{**ALICE, **binding}, answer=answer)


class RelayDeliveryTests(RelayTestCase):
    def test_an_answer_in_time_comes_back_parsed(self):
        call = Call(self.engine)
        ticket = present(self.pick_up())
        self.assertEqual(ticket.seq, 1)
        self.assertEqual(ticket.payload, PAYLOAD)
        self.answer(ticket.token, _output(json.dumps({"message": "Tarek."})))
        call.join()
        self.assertIsNone(call.error)
        self.assertEqual(call.result["message"], "Tarek.")
        self.assertEqual(call.result["_runtime"]["engine"], "webllm")
        self.assertEqual(call.result["_runtime"]["seq"], 1)

    def test_a_ticket_nobody_picks_up_ends_the_call_as_unavailable(self):
        call = Call(self.engine)
        time.sleep(0.1)
        self.clock.advance(21)
        call.join()
        self.assertIsInstance(call.error, InferenceUnavailableError)
        self.assertEqual(str(call.error), "client_unavailable")

    def test_a_picked_up_ticket_without_an_answer_times_out(self):
        call = Call(self.engine)
        present(self.pick_up())
        self.clock.advance(301)
        call.join()
        self.assertIsInstance(call.error, InferenceTimeoutError)

    def test_a_ticket_answers_once(self):
        call = Call(self.engine)
        ticket = present(self.pick_up())
        self.answer(ticket.token, _output("{}"))
        call.join()
        with self.assertRaises(RelayTicketExpired):
            self.answer(ticket.token, _output("{}"))

    def test_a_ticket_is_refused_to_anyone_but_its_session(self):
        call = Call(self.engine)
        ticket = present(self.pick_up())
        for binding in ({"session_id": "session-b"}, {"world_id": "b" * 32}, {"sub": "bob"}):
            with self.subTest(binding=binding), self.assertRaises(RelayTicketNotFound):
                self.answer(ticket.token, _output("{}"), **binding)
        with self.assertRaises(RelayTicketNotFound):
            self.answer("no-such-ticket", _output("{}"))
        # The job itself is not this session's either.
        with self.assertRaises(RelayTicketNotFound):
            self.tickets.next_for(**{**ALICE, "session_id": "session-b"}, job_id=JOB, wait=0)
        self.answer(ticket.token, _output("{}"))
        call.join()

    def test_an_earlier_ticket_of_the_job_is_no_longer_valid(self):
        first_call = Call(self.engine)
        first = present(self.pick_up())
        self.answer(first.token, _output("{}"))
        first_call.join()
        second_call = Call(self.engine)
        second = present(self.pick_up())
        self.assertEqual(second.seq, 2)
        with self.assertRaises(RelayTicketNotFound):
            self.answer(first.token, _output("{}"))
        self.answer(second.token, _output("{}"))
        second_call.join()

    def test_five_failures_shut_the_session_out(self):
        call = Call(self.engine)
        ticket = present(self.pick_up())
        for _ in range(4):
            with self.assertRaises(RelayTicketNotFound):
                self.answer("wrong", _output("{}"))
        with self.assertRaises(RelayTooManyFailures):
            self.answer("wrong", _output("{}"))
        with self.assertRaises(RelayTooManyFailures):
            self.answer(ticket.token, _output("{}"))
        # Ten minutes later the session may try again.
        self.clock.advance(601)
        call.join()  # the waiting call has long timed out by then

    def test_a_cancel_wakes_the_waiting_call_at_once(self):
        call = Call(self.engine)
        present(self.pick_up())
        started = time.monotonic()
        self.tickets.cancel(JOB)
        call.join(timeout=1)
        self.assertLess(time.monotonic() - started, 1)
        self.assertIsInstance(call.error, InferenceUnavailableError)
        self.assertEqual(str(call.error), "cancelled")


class RelayOutputTests(RelayTestCase):
    def _answered(self, answer: dict[str, Any], payload: dict[str, Any] = PAYLOAD) -> Call:
        call = Call(self.engine, payload)
        ticket = present(self.pick_up())
        self.answer(ticket.token, answer)
        call.join()
        return call

    def test_nesting_too_deep_to_read_is_a_validation_error(self):
        call = self._answered(_output("[" * 100_000))
        self.assertIsInstance(call.error, InferenceValidationError)

    def test_text_that_is_no_json_is_a_validation_error(self):
        call = self._answered(_output("Gern geschehen!"))
        self.assertIsInstance(call.error, InferenceValidationError)

    def test_a_cut_off_answer_is_incomplete_and_the_retry_takes_a_new_ticket(self):
        runtime = AssistantRuntime(
            Path("."),
            Path("."),
            self.engine,
            progress=MagicMock(),
            read_tools=MagicMock(),
            token_cache=BoundedTokenCountCache(),
        )
        result: dict[str, Any] = {}
        worker = threading.Thread(
            target=lambda: result.update(runtime._invoke_with_growth(PAYLOAD, prompt_tokens=10)),
            daemon=True,
        )
        worker.start()
        first = present(self.pick_up())
        self.answer(first.token, _output('{"message": "Tar', finish="length"))
        second = present(self.pick_up())
        self.assertEqual(second.seq, 2)
        self.assertEqual(second.payload["max_tokens"], 200)
        self.answer(second.token, _output('{"message": "Tarek."}'))
        worker.join(3)
        self.assertEqual(result["message"], "Tarek.")

    def test_a_cut_off_answer_alone_raises_incomplete(self):
        call = self._answered(_output('{"message": "Tar', finish="length"))
        self.assertIsInstance(call.error, IncompleteInferenceResponse)

    def test_the_browser_errors_map_onto_the_inference_errors(self):
        call = self._answered({"error": {"code": "provider_error", "status": 401}})
        self.assertIsInstance(call.error, InferenceUnavailableError)

    def test_without_grammar_the_request_carries_the_schema_in_the_prompt(self):
        engine = RelayInferenceEngine(
            self.tickets,
            JOB,
            {"kind": "cloud", "provider": "openai", "grammar": False},
            clock=self.clock,
        )
        call = Call(engine)
        ticket = present(self.pick_up())
        self.assertEqual(ticket.payload["response_format"], {"type": "json_object"})
        self.assertIn("JSON schema", ticket.payload["messages"][0]["content"])
        self.answer(ticket.token, _output("{}"))
        call.join()

    def test_the_calibration_follows_the_browser_but_only_so_far(self):
        estimate = self.engine.count_tokens("y" * 300)
        self._answered(_output("{}", usage={"promptTokens": 1_000_000}))
        self._answered(_output("{}", usage={"promptTokens": 1_000_000}))
        self.assertEqual(self.engine.calibration, 2.0)
        self.assertLessEqual(self.engine.count_tokens("y" * 300), estimate * 2 + 1)
        for _ in range(6):
            self._answered(_output("{}", usage={"promptTokens": 1}))
        self.assertEqual(self.engine.calibration, 0.5)

    def test_the_engine_reports_the_client_window(self):
        self.assertEqual(self.engine.identity, f"relay:{JOB}")
        self.assertEqual(self.engine.status()["contextTokens"], 8192)


class _RelayRuntime:
    """A job runtime whose one model call goes through the relay engine."""

    def __init__(self, engine: RelayInferenceEngine) -> None:
        self.engine = engine
        self.closed = threading.Event()

    def reload(self) -> None:
        pass

    def complete(self, question, *args, **kwargs):
        try:
            return self.engine.invoke(PAYLOAD)
        except InferenceUnavailableError:
            # Some clean-up after the release, so a close() that does not join would
            # return while this thread still runs.
            time.sleep(0.3)
            raise

    def close(self) -> None:
        self.closed.set()
        self.engine.close()


class RelayRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        create_world_file(self.data)
        self.tickets = RelayTicketStore()
        self.runtimes: dict[str, _RelayRuntime] = {}

    def tearDown(self) -> None:
        self.tickets.close()
        time.sleep(0.3)
        self.tmp.cleanup()

    def _runner(self, store_factory=None, assistant=None) -> AssistantJobRunner:
        def factory(job: dict[str, Any], request: dict[str, Any]) -> _RelayRuntime:
            runtime = _RelayRuntime(
                RelayInferenceEngine(self.tickets, job["id"], {"kind": "webllm", "grammar": True})
            )
            self.runtimes[job["id"]] = runtime
            return runtime

        return AssistantJobRunner(
            assistant or FakeAssistant(),
            store_factory=store_factory
            or (lambda: AssistantJobStore(self.data / "assistant-jobs.sqlite3")),
            interaction_logger=FakeInteractionLogger(),
            world_access=FakeWorldAccess(self.data),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
            client_runtime_factory=factory,
        )

    def _submit(self, runner: AssistantJobRunner, key: str, engine: str = "webllm"):
        job, _ = runner.submit(
            owner_sub="alice",
            world_id=WORLD_ID,
            idempotency_key=key,
            intent=intent(key),
            execution=execution(key),
            engine_kind=engine,
        )
        # As the job route does once submit returns (Teil 3).
        self.tickets.bind_job(job["id"], sub="alice", session_id="s", world_id=WORLD_ID)
        return job

    def _wait_delivered(self, job_id: str):
        ticket = self.tickets.next_for(
            sub="alice", session_id="s", world_id=WORLD_ID, job_id=job_id, wait=3
        )
        return present(ticket)

    def test_a_cancel_frees_the_account_for_its_next_client_job_at_once(self):
        runner = self._runner()
        try:
            job = self._submit(runner, "first")
            self._wait_delivered(job["id"])
            with self.assertRaises(ClientJobRunning):
                self._submit(runner, "blocked")
            started = time.monotonic()
            runner.cancel(job["id"], "alice", WORLD_ID)
            done = runner.wait(job["id"], "alice", WORLD_ID, timeout=2)
            self.assertLess(time.monotonic() - started, 2)
            self.assertEqual(done["status"], "cancelled")
            self._submit(runner, "second")
        finally:
            runner.close()

    def test_close_releases_a_waiting_client_job_and_joins_its_thread(self):
        runner = self._runner()
        job = self._submit(runner, "waiting")
        self._wait_delivered(job["id"])
        with runner._active_lock:
            threads = list(runner._active_threads.values())
        self.assertEqual(len(threads), 1)
        started = time.monotonic()
        runner.close(timeout=2)
        self.assertLess(time.monotonic() - started, 2)
        self.assertFalse(threads[0].is_alive())
        self.assertTrue(self.runtimes[job["id"]].closed.is_set())

    def test_a_failing_claim_does_not_end_the_client_worker(self):
        class FlakyStore(AssistantJobStore):
            failed = False

            def claim_next_client(self):
                if not FlakyStore.failed:
                    FlakyStore.failed = True
                    raise sqlite3.OperationalError("database is locked")
                return super().claim_next_client()

        runner = self._runner(
            store_factory=lambda: FlakyStore(self.data / "assistant-jobs.sqlite3")
        )
        try:
            job = self._submit(runner, "after-the-failure")
            ticket = self._wait_delivered(job["id"])
            self.assertTrue(FlakyStore.failed)
            self.tickets.answer(
                ticket.token,
                sub="alice",
                session_id="s",
                world_id=WORLD_ID,
                answer=_output(json.dumps({"message": "ok", "proposals": [], "sources": []})),
            )
            done = runner.wait(job["id"], "alice", WORLD_ID, timeout=5)
            self.assertEqual(done["status"], "completed")
        finally:
            runner.close()

    def test_a_failing_claim_does_not_end_the_server_worker(self):
        class FlakyStore(AssistantJobStore):
            failed = False

            def claim_next_server(self):
                if not FlakyStore.failed:
                    FlakyStore.failed = True
                    raise sqlite3.OperationalError("database is locked")
                return super().claim_next_server()

        assistant = FakeAssistant()
        runner = self._runner(
            store_factory=lambda: FlakyStore(self.data / "assistant-jobs.sqlite3"),
            assistant=assistant,
        )
        try:
            job = self._submit(runner, "server-job", engine="server")
            done = runner.wait(job["id"], "alice", WORLD_ID, timeout=5)
            self.assertTrue(FlakyStore.failed)
            self.assertEqual(done["status"], "completed")
        finally:
            runner.close()


class ClientCacheTests(unittest.TestCase):
    def test_a_client_job_leaves_the_server_cache_alone(self):
        """F-61-1: one cache per client runtime; the server's keeps its counts."""
        with tempfile.TemporaryDirectory() as directory:
            server_engine = MagicMock()
            server_engine.identity = "server:model"
            services = build_assistant_services(
                base=Path("."),
                data=Path(directory),
                assistant=cast(Any, MagicMock()),
                lock=threading.Lock(),
                observability=cast(
                    Any, SimpleNamespace(logger=SilentLogger(), metrics=TestMetrics())
                ),
                capabilities=cast(Any, MagicMock()),
                inference=server_engine,
            )
            factory = present(services.jobs.client_runtime_factory)
            client = factory({"id": "job-c", "engine": "webllm"}, {"engine": {"kind": "webllm"}})
            server_cache = services.runtime.token_cache
            self.assertIsNot(client.token_cache, server_cache)

            server_counts: list[str] = []

            def server_counter(text: str) -> int:
                server_counts.append(text)
                return 1000

            server_cache.count("server:model", "same text", server_counter)
            client.token_cache.count(client.url, "same text", lambda text: 7)
            server_cache.count("server:model", "same text", server_counter)
            self.assertEqual(len(server_counts), 1)
            client.close()


if __name__ == "__main__":
    unittest.main()
