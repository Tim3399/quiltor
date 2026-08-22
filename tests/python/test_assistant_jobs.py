from __future__ import annotations

import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path

from quiltor.modules.assistant.jobs import (
    AssistantJobRunner,
    IdempotencyConflict,
)
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore

WORLD_ID = "a" * 32


def intent(question: str) -> dict:
    return {
        "question": question,
        "history": [],
        "chapterIds": [],
        "runBatches": False,
        "language": "de",
    }


def execution(question: str) -> dict:
    return {
        **intent(question),
        "worldId": WORLD_ID,
        "progressId": None,
        "manuscript": {"chapters": []},
        "figures": {"nodes": [], "edges": []},
    }


class FakeAssistant:
    def __init__(self) -> None:
        self.started_first = threading.Event()
        self.release_first = threading.Event()
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.calls: list[str] = []

    def reload(self) -> None:
        pass

    def complete(
        self,
        question,
        manuscript,
        figures,
        history,
        chapter_ids,
        run_batches,
        progress_id,
        language,
        **scope,
    ):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            self.calls.append(question)
        try:
            if question == "first":
                self.started_first.set()
                self.release_first.wait(timeout=5)
            return {"message": question, "proposals": [], "sources": []}
        finally:
            with self.lock:
                self.active -= 1


class FakeInteractionLogger:
    def record(self, question, response=None, *, error="", owner_sub="", world_id=""):
        return f"interaction-{question}"


class FakeWorldAccess:
    def __init__(self, data: Path) -> None:
        self.data = data

    def exists(self, owner_sub: str, world_id: str) -> bool:
        return (self.data / "worlds" / f"{world_id}.sqlite3").exists()


class SilentLogger:
    def event(self, level, name, **fields):
        pass


class TestMetrics:
    def increment(self, name, value=1, **labels):
        pass

    def observe(self, name, value, **labels):
        pass


def create_runner(assistant, data: Path) -> AssistantJobRunner:
    return AssistantJobRunner(
        assistant,
        store_factory=lambda: AssistantJobStore(data / "assistant-jobs.sqlite3"),
        interaction_logger=FakeInteractionLogger(),
        world_access=FakeWorldAccess(data),
        structured_logger=SilentLogger(),
        metrics=TestMetrics(),
    )


def create_world_file(data: Path) -> None:
    worlds = data / "worlds"
    worlds.mkdir(parents=True, exist_ok=True)
    (worlds / f"{WORLD_ID}.sqlite3").touch()


class AssistantJobStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "assistant-jobs.sqlite3"
        self.store = AssistantJobStore(self.path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_same_idempotency_key_returns_the_same_job(self):
        first, created = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-1",
            intent=intent("hello"),
            execution=execution("hello"),
        )
        second, created_again = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-1",
            intent=intent("hello"),
            execution=execution("hello"),
        )

        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["id"], second["id"])

        with closing(sqlite3.connect(self.path)) as conn:
            count = conn.execute("SELECT COUNT(*) FROM assistant_jobs").fetchone()[0]
        self.assertEqual(count, 1)

    def test_same_key_with_different_intent_is_rejected(self):
        self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-1",
            intent=intent("hello"),
            execution=execution("hello"),
        )
        with self.assertRaises(IdempotencyConflict):
            self.store.submit(
                owner_sub="user",
                world_id=WORLD_ID,
                idempotency_key="request-1",
                intent=intent("different"),
                execution=execution("different"),
            )

    def test_fresh_keys_are_distinct_user_actions_even_for_identical_prompts(self):
        first, created_first = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-a",
            intent=intent("same prompt"),
            execution=execution("same prompt"),
        )
        second, created_second = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-b",
            intent=intent("same prompt"),
            execution=execution("same prompt"),
        )

        self.assertTrue(created_first)
        self.assertTrue(created_second)
        self.assertNotEqual(first["id"], second["id"])

    def test_interrupted_running_job_is_requeued(self):
        job, _ = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-1",
            intent=intent("hello"),
            execution=execution("hello"),
        )
        claimed = self.store.claim_next()
        self.assertEqual(claimed["id"], job["id"])
        self.assertEqual(claimed["status"], "running")

        self.store.recover_interrupted()
        recovered = self.store.get(job["id"], "user", WORLD_ID)
        self.assertEqual(recovered["status"], "queued")
        self.assertIsNone(recovered["startedAt"])

    def test_queued_job_can_be_cancelled_without_running(self):
        job, _ = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-1",
            intent=intent("hello"),
            execution=execution("hello"),
        )
        cancelled = self.store.cancel(job["id"], "user", WORLD_ID)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertTrue(cancelled["cancelRequested"])

    def test_terminal_job_discards_the_world_snapshot_but_keeps_the_result(self):
        job, _ = self.store.submit(
            owner_sub="user",
            world_id=WORLD_ID,
            idempotency_key="request-1",
            intent=intent("hello"),
            execution=execution("hello"),
        )
        self.store.claim_next()
        result = {"ok": True, "message": "done", "proposals": [], "sources": []}
        terminal = self.store.finish_success(job["id"], result, "interaction-1")

        self.assertEqual(terminal["status"], "completed")
        self.assertEqual(terminal["result"], result)
        with closing(sqlite3.connect(self.path)) as conn:
            request_json = conn.execute(
                "SELECT request_json FROM assistant_jobs WHERE id=?", (job["id"],)
            ).fetchone()[0]
        self.assertEqual(request_json, "{}")


class AssistantJobRunnerTests(unittest.TestCase):
    def test_runner_is_lazy_until_started_or_used(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            data = Path(tmp_name)
            runner = create_runner(FakeAssistant(), data)
            try:
                self.assertFalse((data / "assistant-jobs.sqlite3").exists())
            finally:
                runner.close()

    def test_missing_world_fails_without_recreating_the_world_database(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            data = Path(tmp_name)
            runner = create_runner(FakeAssistant(), data)
            try:
                job, _ = runner.submit(
                    owner_sub="user",
                    world_id=WORLD_ID,
                    idempotency_key="missing-world",
                    intent=intent("hello"),
                    execution=execution("hello"),
                )
                terminal = runner.wait(job["id"], "user", WORLD_ID, timeout=3)
                self.assertEqual(terminal["status"], "failed")
                self.assertFalse((data / "worlds" / f"{WORLD_ID}.sqlite3").exists())
            finally:
                runner.close()

    def test_runner_never_executes_two_inferences_at_once(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            data = Path(tmp_name)
            create_world_file(data)
            assistant = FakeAssistant()
            runner = create_runner(assistant, data)
            try:
                first, _ = runner.submit(
                    owner_sub="user",
                    world_id=WORLD_ID,
                    idempotency_key="first-key",
                    intent=intent("first"),
                    execution=execution("first"),
                )
                self.assertTrue(assistant.started_first.wait(timeout=2))

                second, _ = runner.submit(
                    owner_sub="user",
                    world_id=WORLD_ID,
                    idempotency_key="second-key",
                    intent=intent("second"),
                    execution=execution("second"),
                )
                time.sleep(0.15)
                queued = runner.get(second["id"], "user", WORLD_ID)
                self.assertEqual(queued["status"], "queued")
                self.assertEqual(assistant.max_active, 1)

                assistant.release_first.set()
                first_done = runner.wait(first["id"], "user", WORLD_ID, timeout=3)
                second_done = runner.wait(second["id"], "user", WORLD_ID, timeout=3)
                self.assertEqual(first_done["status"], "completed")
                self.assertEqual(second_done["status"], "completed")
                self.assertEqual(assistant.calls, ["first", "second"])
                self.assertEqual(assistant.max_active, 1)
            finally:
                assistant.release_first.set()
                runner.close()

    def test_cancelling_running_job_does_not_start_next_inference_early(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            data = Path(tmp_name)
            create_world_file(data)
            assistant = FakeAssistant()
            runner = create_runner(assistant, data)
            try:
                first, _ = runner.submit(
                    owner_sub="user",
                    world_id=WORLD_ID,
                    idempotency_key="first-key",
                    intent=intent("first"),
                    execution=execution("first"),
                )
                self.assertTrue(assistant.started_first.wait(timeout=2))
                runner.cancel(first["id"], "user", WORLD_ID)

                second, _ = runner.submit(
                    owner_sub="user",
                    world_id=WORLD_ID,
                    idempotency_key="second-key",
                    intent=intent("second"),
                    execution=execution("second"),
                )
                time.sleep(0.15)
                self.assertEqual(runner.get(first["id"], "user", WORLD_ID)["status"], "running")
                self.assertEqual(runner.get(second["id"], "user", WORLD_ID)["status"], "queued")
                self.assertEqual(assistant.max_active, 1)

                assistant.release_first.set()
                first_done = runner.wait(first["id"], "user", WORLD_ID, timeout=3)
                second_done = runner.wait(second["id"], "user", WORLD_ID, timeout=3)
                self.assertEqual(first_done["status"], "cancelled")
                self.assertEqual(second_done["status"], "completed")
                self.assertEqual(assistant.max_active, 1)
            finally:
                assistant.release_first.set()
                runner.close()


if __name__ == "__main__":
    unittest.main()
