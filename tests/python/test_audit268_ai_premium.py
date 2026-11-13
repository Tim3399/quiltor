"""T-268 audit, package D2: the premium gate of the server assistant (2.4a, 2.4b).

Phase 2 only reads, so a gap is pinned by an ``expectedFailure`` test that the
fix in phase 4 turns green. Findings are numbered S268-1xx in
implementer/T-268-audit-input-ai.md.
"""

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock, patch

from quiltor.bootstrap.application import AssistantServices
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.infrastructure.persistence.assistant_progress import SQLiteAssistantProgressStore
from quiltor.modules.assistant.jobs import AssistantJobRunner
from tests.python.test_assistant_jobs import (
    JOB_WAIT_SECONDS,
    FakeAssistant,
    FakeInteractionLogger,
    SilentLogger,
    TestMetrics,
    execution,
    intent,
)
from tests.python.test_server_auth import _LiveAuthServerTestCase


class _QueuedJobStore(AssistantJobStore):
    def close(self) -> None:
        pass


class PremiumGateAtSubmitTests(_LiveAuthServerTestCase):
    """2.4a: the job route itself. Checked, no finding; kept as a regression pin."""

    def setUp(self):
        super().setUp()
        root = Path(self.temp.name)
        self.jobs_path = root / "assistant-jobs.sqlite3"
        self.jobs = _QueuedJobStore(self.jobs_path)
        runtime = MagicMock()
        runtime.progress = SQLiteAssistantProgressStore(root / "assistant-progress.sqlite3")
        self.application.assistant_services = AssistantServices(
            runtime, cast(AssistantJobRunner, self.jobs)
        )

    def _world(self, session: str) -> str:
        status, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": "Welt", "backupUrl": ""},
            cookies={"quiltor_session": session},
        )
        self.assertEqual(status, 200, body)
        return json.loads(body)["world"]["id"]

    def _submit(self, session: str, world: str, engine=None):
        body = {"worldId": world, "question": "Wer ist Tarek?", "mode": "chat"}
        if engine is not None:
            body["engine"] = engine
        status, _, raw, _ = self._request(
            "POST",
            "/api/assistant/jobs",
            body=body,
            headers={"Idempotency-Key": "audit-268"},
            cookies={"quiltor_session": session},
        )
        return status, json.loads(raw)

    def test_account_without_role_gets_403_and_nothing_is_stored(self):
        session = self._login("user-free", roles=())
        world = self._world(session)
        for engine in (None, {"kind": "server"}):
            status, body = self._submit(session, world, engine)
            self.assertEqual(status, 403, body)
            self.assertEqual(body["error"]["code"], "assistant.premium_required")
        with closing(sqlite3.connect(self.jobs_path)) as db:
            (count,) = db.execute("SELECT COUNT(*) FROM assistant_jobs").fetchone()
        self.assertEqual(count, 0)

    def test_spellings_of_the_engine_never_fall_back_to_the_server(self):
        session = self._login("user-free", roles=())
        world = self._world(session)
        for engine in ("server", "Server", {"kind": "Server"}, {"kind": "server", "x": 1}, []):
            status, body = self._submit(session, world, engine)
            self.assertIn(status, {400, 403}, (engine, body))
            self.assertNotEqual(status, 200, engine)


class QueuedJobAfterPremiumWithdrawnTests(_LiveAuthServerTestCase):
    """2.4b: the worker computes a queued server job without asking about the role again."""

    def setUp(self):
        super().setUp()
        self.data = Path(tempfile.mkdtemp(dir=self.temp.name))
        self.assistant = FakeAssistant()
        self.runner = AssistantJobRunner(
            self.assistant,
            store_factory=lambda: AssistantJobStore(self.data / "assistant-jobs.sqlite3"),
            interaction_logger=FakeInteractionLogger(),
            world_access=_EveryWorldExists(),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
            server_job_gate=lambda sub: self.application.identity.auth.premium_confirmed(sub),
        )
        self.addCleanup(self.runner.close)

    # S268-100: the role used to be checked only when the job was submitted. The worker
    # now asks the identity port (premium_confirmed) before it computes a server job.
    def test_queued_server_job_is_not_computed_after_the_role_is_withdrawn(self):
        job, created = self.runner.submit(
            owner_sub="user-premium",
            world_id="a" * 32,
            idempotency_key="audit-268-queued",
            intent=intent("queued"),
            execution=execution("queued"),
        )
        self.assertTrue(created)
        identity = self.application.identity
        with patch.object(type(identity.auth), "premium_confirmed", return_value=False):
            self.runner.start()
            finished = self.runner.wait(
                job["id"], "user-premium", "a" * 32, timeout=JOB_WAIT_SECONDS
            )
        self.assertIsNotNone(finished)
        self.assertEqual(self.assistant.calls, [])
        self.assertEqual(finished["status"], "failed")
        self.assertEqual(finished["errorType"], "premium_required")

    def test_queued_server_job_is_computed_while_premium_is_confirmed(self):
        job, _ = self.runner.submit(
            owner_sub="user-premium",
            world_id="a" * 32,
            idempotency_key="audit-268-confirmed",
            intent=intent("queued"),
            execution=execution("queued"),
        )
        with patch.object(
            type(self.application.identity.auth), "premium_confirmed", return_value=True
        ):
            self.runner.start()
            finished = self.runner.wait(
                job["id"], "user-premium", "a" * 32, timeout=JOB_WAIT_SECONDS
            )
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(len(self.assistant.calls), 1)

    def test_runner_without_a_gate_computes_as_before(self):
        runner = AssistantJobRunner(
            self.assistant,
            store_factory=lambda: AssistantJobStore(self.data / "local.sqlite3"),
            interaction_logger=FakeInteractionLogger(),
            world_access=_EveryWorldExists(),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
        )
        self.addCleanup(runner.close)
        job, _ = runner.submit(
            owner_sub="local",
            world_id="a" * 32,
            idempotency_key="audit-268-local",
            intent=intent("local"),
            execution=execution("local"),
        )
        finished = runner.wait(job["id"], "local", "a" * 32, timeout=JOB_WAIT_SECONDS)
        self.assertEqual(finished["status"], "completed")

    def test_client_job_is_not_gated(self):
        gate_calls = []
        runner = AssistantJobRunner(
            self.assistant,
            store_factory=lambda: AssistantJobStore(self.data / "client.sqlite3"),
            interaction_logger=FakeInteractionLogger(),
            world_access=_EveryWorldExists(),
            structured_logger=SilentLogger(),
            metrics=TestMetrics(),
            client_runtime_factory=lambda job, request: self.assistant,
            server_job_gate=lambda sub: gate_calls.append(sub) or False,
        )
        self.addCleanup(runner.close)
        job, _ = runner.submit(
            owner_sub="user-premium",
            world_id="a" * 32,
            idempotency_key="audit-268-client",
            intent=intent("client"),
            execution=execution("client"),
            engine_kind="webllm",
        )
        finished = runner.wait(job["id"], "user-premium", "a" * 32, timeout=JOB_WAIT_SECONDS)
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(gate_calls, [])


class _EveryWorldExists:
    def exists(self, owner_sub: str, world_id: str) -> bool:
        return True

    def revision(self, owner_sub: str, world_id: str) -> int:
        return 0

    def revisions(self, owner_sub: str, world_id: str) -> dict[str, int]:
        return {"manuscript": 0, "figures": 0, "storyboards": 0}


if __name__ == "__main__":
    unittest.main()
