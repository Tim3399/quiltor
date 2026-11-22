"""Jobs on a client engine next to the server engine (T-61 Teil 1).

The server engine runs one job at a time. A client engine is the user's own browser, so
two accounts run side by side, one account one job at a time, and nothing a client job
does holds up a server job. A client job cannot outlive the process that waited for it.
"""

from __future__ import annotations

import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.modules.assistant.engines import CLOUD, SERVER, WEBLLM, ClientEngineFailure
from quiltor.modules.assistant.jobs import AssistantJobRunner
from quiltor.modules.assistant.ports import (
    ChapterTooLongError,
    ClientJobRunning,
    ExtractionIncompleteError,
    ExtractionPartFailedError,
    InferenceContextTooLargeError,
    WorldTooLargeError,
)
from tests.python.narrowing import present
from tests.python.test_assistant_jobs import (
    WORLD_ID,
    FakeInteractionLogger,
    FakeWorldAccess,
    SilentLogger,
    TestMetrics,
    create_world_file,
    execution,
    intent,
)


def _submit(store_or_runner: Any, owner: str, key: str, engine: str = WEBLLM) -> dict[str, Any]:
    job, _ = store_or_runner.submit(
        owner_sub=owner,
        world_id=WORLD_ID,
        idempotency_key=key,
        intent=intent(key),
        execution=execution(key),
        engine_kind=engine,
    )
    return job


class ClientJobStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "assistant-jobs.sqlite3"
        self.store = AssistantJobStore(self.path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_job_names_its_engine(self):
        self.assertEqual(_submit(self.store, "alice", "a", CLOUD)["engine"], CLOUD)
        self.assertEqual(_submit(self.store, "alice", "b", SERVER)["engine"], SERVER)

    def test_a_second_open_client_job_of_the_same_account_is_refused(self):
        first = _submit(self.store, "alice", "first")
        with self.assertRaises(ClientJobRunning) as refused:
            _submit(self.store, "alice", "second", CLOUD)
        self.assertEqual(refused.exception.job_id, first["id"])
        # Still refused while the first one runs; another account is not affected.
        present(self.store.claim_next_client())
        with self.assertRaises(ClientJobRunning):
            _submit(self.store, "alice", "third")
        _submit(self.store, "bob", "bob-first")

    def test_a_retry_with_the_same_key_is_no_refusal(self):
        first = _submit(self.store, "alice", "same")
        again = _submit(self.store, "alice", "same")
        self.assertEqual(again["id"], first["id"])

    def test_a_server_job_does_not_count_as_a_client_job(self):
        _submit(self.store, "alice", "server", SERVER)
        _submit(self.store, "alice", "client")

    def test_two_accounts_each_claim_a_client_job(self):
        _submit(self.store, "alice", "alice-job")
        _submit(self.store, "bob", "bob-job")
        first = present(self.store.claim_next_client())
        second = present(self.store.claim_next_client())
        self.assertEqual({first["_ownerSub"], second["_ownerSub"]}, {"alice", "bob"})
        self.assertIsNone(self.store.claim_next_client())

    def test_a_running_client_job_does_not_block_a_server_job_and_back(self):
        _submit(self.store, "alice", "client")
        _submit(self.store, "bob", "server", SERVER)
        present(self.store.claim_next_client())
        server = present(self.store.claim_next_server())
        self.assertEqual(server["engine"], SERVER)
        # The server slot is taken, the client side still claims.
        _submit(self.store, "carol", "client-2")
        present(self.store.claim_next_client())

    def test_an_account_never_runs_two_client_jobs_even_if_two_are_queued(self):
        """The second line behind the submit rule: two tabs racing past it (the count
        and the insert run in one transaction today, so this is a guard, not a path)."""
        _submit(self.store, "alice", "first")
        with closing(sqlite3.connect(self.path)) as database, database:
            database.execute(
                "INSERT INTO assistant_jobs(id, owner_sub, world_id, idempotency_key, "
                "request_hash, request_json, status, engine_kind, created_at) "
                "VALUES('second', 'alice', ?, 'second', 'h', '{}', 'queued', 'webllm', "
                "'2999-01-01T00:00:00+00:00')",
                (WORLD_ID,),
            )
        present(self.store.claim_next_client())
        self.assertIsNone(self.store.claim_next_client())

    def test_the_server_claim_never_takes_a_client_job(self):
        _submit(self.store, "alice", "client")
        self.assertIsNone(self.store.claim_next_server())

    def test_a_restart_fails_client_jobs_and_requeues_server_jobs(self):
        queued = _submit(self.store, "alice", "queued-client")
        _submit(self.store, "bob", "running-client")
        server = _submit(self.store, "carol", "server", SERVER)
        running = present(self.store.claim_next_client())
        present(self.store.claim_next_server())

        AssistantJobStore(self.path).recover_interrupted()

        for job_id, owner in ((queued["id"], "alice"), (running["id"], running["_ownerSub"])):
            job = present(self.store.get(job_id, owner, WORLD_ID))
            self.assertEqual(job["status"], "failed")
            self.assertEqual(job["errorType"], "client_unavailable")
        self.assertEqual(
            present(self.store.get(server["id"], "carol", WORLD_ID))["status"], "queued"
        )

    def test_a_queue_from_before_t61_gains_the_engine_column(self):
        old = Path(self.tmp.name) / "old.sqlite3"
        with closing(sqlite3.connect(old)) as database, database:
            database.execute(
                "CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, "
                "world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, "
                "request_json TEXT NOT NULL, progress_id TEXT NOT NULL DEFAULT '', "
                "status TEXT NOT NULL, result_json TEXT, error TEXT NOT NULL DEFAULT '', "
                "error_type TEXT NOT NULL DEFAULT '', http_status INTEGER NOT NULL DEFAULT 0, "
                "interaction_id TEXT NOT NULL DEFAULT '', cancel_requested INTEGER NOT NULL DEFAULT 0, "
                "created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, "
                "UNIQUE(owner_sub, world_id, idempotency_key))"
            )
            database.execute(
                "INSERT INTO assistant_jobs(id, owner_sub, world_id, idempotency_key, request_hash, "
                "request_json, status, created_at) VALUES('old', 'alice', ?, 'k', 'h', '{}', 'queued', "
                "'2026-01-01T00:00:00+00:00')",
                (WORLD_ID,),
            )
        store = AssistantJobStore(old)
        self.assertEqual(present(store.get("old", "alice", WORLD_ID))["engine"], SERVER)
        self.assertEqual(present(store.claim_next_server())["id"], "old")


class _BlockingRuntime:
    """A runtime that holds its job until released, and records that it started."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def reload(self) -> None:
        pass

    def complete(self, question, *args, **kwargs):
        self.started.set()
        self.release.wait(timeout=5)
        return {"message": question, "proposals": [], "sources": []}


class ClientJobRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        create_world_file(self.data)
        self.server = _BlockingRuntime()
        self.clients: dict[str, _BlockingRuntime] = {}

    def tearDown(self) -> None:
        self.server.release.set()
        for runtime in self.clients.values():
            runtime.release.set()
        # Let the released jobs finish before the queue file goes (Windows locks it).
        time.sleep(0.5)
        self.tmp.cleanup()

    def _runner(self, *, factory: bool = True) -> AssistantJobRunner:
        def client_runtime(job: dict[str, Any], request: dict[str, Any]) -> _BlockingRuntime:
            return self.clients.setdefault(job["_ownerSub"], _BlockingRuntime())

        return AssistantJobRunner(
            self.server,
            store_factory=lambda: AssistantJobStore(self.data / "assistant-jobs.sqlite3"),
            interaction_logger=FakeInteractionLogger(),
            world_access=FakeWorldAccess(self.data),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
            client_runtime_factory=client_runtime if factory else None,
        )

    def _wait_started(self, owner: str) -> None:
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            runtime = self.clients.get(owner)
            if runtime is not None and runtime.started.wait(timeout=0.02):
                return
            time.sleep(0.02)
        self.fail(f"the client job of {owner} never started")

    def test_two_accounts_compute_at_the_same_time(self):
        runner = self._runner()
        try:
            _submit(runner, "alice", "alice-job")
            _submit(runner, "bob", "bob-job")
            self._wait_started("alice")
            self._wait_started("bob")
        finally:
            runner.close()

    def test_a_client_job_does_not_hold_up_a_server_job(self):
        runner = self._runner()
        try:
            _submit(runner, "alice", "client")
            self._wait_started("alice")
            server_job = _submit(runner, "bob", "server", SERVER)
            self.assertTrue(self.server.started.wait(timeout=2))
            self.server.release.set()
            done = runner.wait(server_job["id"], "bob", WORLD_ID, timeout=3)
            self.assertEqual(done["status"], "completed")
        finally:
            runner.close()

    def test_without_a_client_engine_the_job_fails_as_unavailable(self):
        runner = self._runner(factory=False)
        try:
            job = _submit(runner, "alice", "client")
            done = runner.wait(job["id"], "alice", WORLD_ID, timeout=3)
            self.assertEqual(done["status"], "failed")
            # No browser engine took it: a code the client words, not an English sentence.
            self.assertEqual(done["errorType"], "client_unavailable")
            self.assertEqual(done["engineError"], {"code": "client_unavailable"})
        finally:
            runner.close()

    def test_an_engine_failure_reaches_the_job_as_code_and_detail(self):
        class _Unloaded(_BlockingRuntime):
            def complete(self, question, *args, **kwargs):
                raise ClientEngineFailure("engine_unavailable", "model not loaded")

        runner = self._runner()
        self.clients["alice"] = _Unloaded()
        try:
            job = _submit(runner, "alice", "client")
            done = runner.wait(job["id"], "alice", WORLD_ID, timeout=3)
            self.assertEqual(done["status"], "failed", done)
            self.assertEqual(
                done.get("engineError"),
                {"code": "engine_unavailable", "detail": "model not loaded"},
            )
            self.assertEqual(done["errorType"], "engine_unavailable")
            self.assertNotIn("engine_unavailable", done["error"])
        finally:
            runner.close()

    def test_a_server_job_carries_no_engine_error(self):
        class _Failing(_BlockingRuntime):
            def complete(self, question, *args, **kwargs):
                raise RuntimeError("boom")

        self.server = _Failing()
        runner = self._runner()
        try:
            job = _submit(runner, "bob", "server", SERVER)
            done = runner.wait(job["id"], "bob", WORLD_ID, timeout=3)
            self.assertEqual(done["status"], "failed")
            self.assertNotIn("engineError", done)
        finally:
            runner.close()

    def test_a_server_context_overflow_carries_no_engine_error(self):
        class _TooLarge(_BlockingRuntime):
            def complete(self, question, *args, **kwargs):
                raise InferenceContextTooLargeError("exceeds the local model's context window")

        self.server = _TooLarge()
        runner = self._runner()
        try:
            job = _submit(runner, "bob", "server-large", SERVER)
            done = runner.wait(job["id"], "bob", WORLD_ID, timeout=3)
            self.assertEqual(done["status"], "failed")
            self.assertEqual(done["errorType"], "context_too_large")
            self.assertNotIn("engineError", done)
        finally:
            runner.close()

    def test_a_client_context_overflow_carries_an_engine_error(self):
        class _TooLarge(_BlockingRuntime):
            def complete(self, question, *args, **kwargs):
                raise ClientEngineFailure("context_too_large", "prompt too long")

        runner = self._runner()
        self.clients["alice"] = _TooLarge()
        try:
            job = _submit(runner, "alice", "client-large")
            done = runner.wait(job["id"], "alice", WORLD_ID, timeout=3)
            self.assertEqual(done["status"], "failed", done)
            self.assertEqual(done["errorType"], "context_too_large")
            self.assertEqual(
                done.get("engineError"), {"code": "context_too_large", "detail": "prompt too long"}
            )
        finally:
            runner.close()

    def test_an_extraction_failure_carries_its_own_code_on_every_engine(self):
        # T-330: each has its own words in the client, whatever engine ran the job; none of
        # them is "fewer chapters".
        failures = {
            "world_too_large": WorldTooLargeError("The world state alone leaves no room."),
            "chapter_too_long": ChapterTooLongError("about 30 parts"),
            "extraction_incomplete": ExtractionIncompleteError("part 3: nothing reached"),
            "extraction_part_failed": ExtractionPartFailedError("part 2: timeout"),
        }
        for code, error in failures.items():
            for engine in (SERVER, WEBLLM):
                with self.subTest(code=code, engine=engine):

                    class _Failing(_BlockingRuntime):
                        def complete(self, question, *args, error=error, **kwargs):
                            raise error

                    owner = "bob" if engine == SERVER else "alice"
                    if engine == SERVER:
                        self.server = _Failing()
                    else:
                        self.clients["alice"] = _Failing()
                    runner = self._runner()
                    try:
                        job = _submit(runner, owner, f"{code}-{engine}", engine)
                        done = runner.wait(job["id"], owner, WORLD_ID, timeout=3)
                        self.assertEqual(done["status"], "failed", done)
                        self.assertEqual(done["errorType"], code)
                        self.assertEqual(done.get("engineError", {}).get("code"), code)
                    finally:
                        runner.close()


if __name__ == "__main__":
    unittest.main()
