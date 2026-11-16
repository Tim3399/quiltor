"""Assistant jobs are bound to the account and the world that created them.

Two OIDC users, A and B, against a real server.Server. The job store is the real
SQLite store without a worker, so every job stays ``queued`` and nothing races
the assertions. Three things are pinned:

- B cannot read, cancel or follow the progress of a job of A -- neither by
  naming A's world (the world gate answers 403) nor by naming the job id in B's
  own world (the job query answers 404 ``assistant.job_not_found``).
- A cannot reach B's world either.
- A signing in again -- a new session, the same ``sub`` -- still sees the job.
"""

import json
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock

from quiltor.bootstrap.application import AssistantServices
from quiltor.infrastructure.persistence.assistant_jobs import AssistantJobStore
from quiltor.infrastructure.persistence.assistant_progress import SQLiteAssistantProgressStore
from quiltor.modules.assistant.jobs import AssistantJobRunner
from tests.python.test_server_auth import _LiveAuthServerTestCase


class _QueuedJobStore(AssistantJobStore):
    """The real store under the runner's interface, minus the worker."""

    def close(self) -> None:
        pass


class AssistantJobIsolationTests(_LiveAuthServerTestCase):
    def setUp(self):
        super().setUp()
        root = Path(self.temp.name)
        self.jobs = _QueuedJobStore(root / "assistant-jobs.sqlite3")
        runtime = MagicMock()
        runtime.progress = SQLiteAssistantProgressStore(root / "assistant-progress.sqlite3")
        self.progress = runtime.progress
        self.application.assistant_services = AssistantServices(
            runtime, cast(AssistantJobRunner, self.jobs)
        )

        self.alice = self._login("user-alice")
        self.bob = self._login("user-bob")
        self.alice_world = self._create_world(self.alice, "Alices Welt")
        self.bob_world = self._create_world(self.bob, "Bobs Welt")

        job, created = self.jobs.submit(
            owner_sub="user-alice",
            world_id=self.alice_world,
            idempotency_key="alice-job",
            intent={"question": "Wer ist Tarek?"},
            execution={"question": "Wer ist Tarek?"},
            progress_id="alice-progress",
        )
        self.assertTrue(created)
        self.job_id = job["id"]
        self.progress.start("user-alice", self.alice_world, "alice-progress", 2)

    # ---------- helpers ----------

    def _create_world(self, session: str, title: str) -> str:
        status, _, body, _ = self._request(
            "POST",
            "/api/worlds/create",
            body={"title": title, "backupUrl": ""},
            cookies={"quiltor_session": session},
        )
        self.assertEqual(status, 200, body)
        return json.loads(body)["world"]["id"]

    def _json(self, method: str, path: str, session: str, body=None):
        status, _, raw, _ = self._request(
            method, path, body=body, cookies={"quiltor_session": session}
        )
        return status, json.loads(raw)

    def _read_job(self, session: str, world_id: str):
        return self._json("GET", f"/api/assistant/job?id={self.job_id}&world={world_id}", session)

    def _cancel_job(self, session: str, world_id: str):
        return self._json(
            "POST",
            "/api/assistant/job/cancel",
            session,
            body={"id": self.job_id, "worldId": world_id},
        )

    def _read_progress(self, session: str, world_id: str):
        return self._json(
            "GET", f"/api/assistant/progress?id=alice-progress&world={world_id}", session
        )

    def _assert_job_untouched(self):
        job = self.jobs.get(self.job_id, "user-alice", self.alice_world)
        self.assertIsNotNone(job)
        self.assertEqual(cast(dict, job)["status"], "queued")

    # ---------- B against A's world ----------

    def test_b_cannot_read_a_job_through_as_world(self):
        status, body = self._read_job(self.bob, self.alice_world)
        self.assertEqual(status, 403, body)
        self.assertFalse(body["ok"])

    def test_b_cannot_cancel_a_job_through_as_world(self):
        status, body = self._cancel_job(self.bob, self.alice_world)
        self.assertEqual(status, 403, body)
        self.assertFalse(body["ok"])
        self._assert_job_untouched()

    def test_b_cannot_read_progress_through_as_world(self):
        status, body = self._read_progress(self.bob, self.alice_world)
        self.assertEqual(status, 403, body)
        self.assertFalse(body["ok"])
        self.assertNotIn("progress", body)

    # ---------- B with A's job id in B's own world ----------

    def test_b_reading_as_job_id_in_own_world_is_not_found(self):
        status, body = self._read_job(self.bob, self.bob_world)
        self.assertEqual(status, 404, body)
        self.assertEqual(body["error"]["code"], "assistant.job_not_found")

    def test_b_cancelling_as_job_id_in_own_world_is_not_found(self):
        status, body = self._cancel_job(self.bob, self.bob_world)
        self.assertEqual(status, 404, body)
        self.assertEqual(body["error"]["code"], "assistant.job_not_found")
        self._assert_job_untouched()

    def test_b_reading_as_progress_id_in_own_world_sees_nothing(self):
        # Progress is keyed by owner and world; an unknown record is a valid
        # polling state (200, null), not an error -- current behaviour.
        status, body = self._read_progress(self.bob, self.bob_world)
        self.assertEqual(status, 200, body)
        self.assertIsNone(body["progress"])

    # ---------- the store's own owner binding ----------
    #
    # Over HTTP the world gate answers first: world ids are unique, so B never
    # reaches the job query with A's world. The owner clause in the query is a
    # second line of its own and is pinned here directly, with the right world
    # and the wrong account.

    def test_store_does_not_hand_as_job_to_b_even_with_as_world(self):
        self.assertIsNone(self.jobs.get(self.job_id, "user-bob", self.alice_world))

    def test_store_does_not_let_b_cancel_as_job_even_with_as_world(self):
        self.assertIsNone(self.jobs.cancel(self.job_id, "user-bob", self.alice_world))
        self._assert_job_untouched()

    # ---------- A against B's world ----------

    def test_a_cannot_read_own_job_through_bs_world(self):
        status, body = self._read_job(self.alice, self.bob_world)
        self.assertEqual(status, 403, body)
        self.assertFalse(body["ok"])

    def test_a_cannot_cancel_own_job_through_bs_world(self):
        status, body = self._cancel_job(self.alice, self.bob_world)
        self.assertEqual(status, 403, body)
        self._assert_job_untouched()

    def test_a_with_an_unknown_world_id_is_not_found(self):
        status, body = self._read_job(self.alice, "0" * 32)
        self.assertEqual(status, 404, body)
        self.assertFalse(body["ok"])

    # ---------- A after signing in again ----------

    def test_a_still_sees_the_job_after_a_new_login(self):
        second = self._login("user-alice")
        self.assertNotEqual(second, self.alice)

        status, body = self._read_job(second, self.alice_world)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["job"]["id"], self.job_id)

        status, body = self._read_progress(second, self.alice_world)
        self.assertEqual(status, 200, body)
        self.assertIsNotNone(body["progress"])

        status, body = self._cancel_job(second, self.alice_world)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["job"]["id"], self.job_id)
