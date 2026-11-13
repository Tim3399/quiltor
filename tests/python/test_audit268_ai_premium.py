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
        )
        self.addCleanup(self.runner.close)

    # S268-100: the role is only checked when the job is submitted
    # (routes/assistant.py:136-139). AssistantJobRunner._execute
    # (modules/assistant/jobs.py:395-420) checks only that the world exists. A job
    # queued while the account was premium is computed on the server after the role
    # was withdrawn. The fix decides how the worker learns about the role; this test
    # withdraws it through the identity and only asks that nothing is computed.
    @unittest.expectedFailure
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
        with patch.object(type(identity), "is_premium", return_value=False):
            self.runner.start()
            finished = self.runner.wait(
                job["id"], "user-premium", "a" * 32, timeout=JOB_WAIT_SECONDS
            )
        self.assertIsNotNone(finished)
        self.assertEqual(self.assistant.calls, [])


class _EveryWorldExists:
    def exists(self, owner_sub: str, world_id: str) -> bool:
        return True

    def revision(self, owner_sub: str, world_id: str) -> int:
        return 0

    def revisions(self, owner_sub: str, world_id: str) -> dict[str, int]:
        return {"manuscript": 0, "figures": 0, "storyboards": 0}


if __name__ == "__main__":
    unittest.main()
