"""The evaluation override: sampling and a seed per job, only behind QUILTOR_EVAL (T-289).

The product must never feel it: without the switch the payloads keep 0.2 and no seed, and a
job that names `evalSeed` is refused before it exists. With it, the values reach every model
call of a job -- the answer, the planner and a client engine's relay ticket alike.
"""

from __future__ import annotations

import contextlib
import os
import threading
import unittest
from pathlib import Path
from typing import Any, ClassVar, cast
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.web import HOSTED, LOCAL, AssistantRouteServices, eval_sampling
from quiltor.infrastructure.identity.runtime import StdlibIdentityGateway
from quiltor.infrastructure.inference.relay import RelayInferenceEngine, RelayTicketStore
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.modules.assistant.prompts import MODEL_CONTEXT_TOKENS
from quiltor.modules.assistant.runtime import AssistantRuntime
from quiltor.modules.assistant.sampling import EvalSampling
from quiltor.modules.identity.auth import IdentityConfiguration
from quiltor.modules.identity.service import LocalIdentity
from tests.python.test_assistant_runtime import FIGURES, FakeInference, _Progress, _ReadTools
from tests.python.test_audit268_identity_support import (
    CLIENT_ID,
    ISSUER,
    PUBLIC_URL,
    FakeClock,
    FakeProvider,
    assistant_fakes,
    make_directories,
)
from tests.python.test_server_assistant import _LiveServerTestCase

# "Warum" sends the question through the model planner and then to the answer call.
PLANNED_QUESTION = "Warum ist Tarek wütend?"
PLANNER_REPLY = {"goal": "why", "steps": [], "searchQueries": ["Tarek"], "requiredKinds": []}
ANSWER = {"message": "Weil.", "citations": [], "proposals": []}
EVAL_ENV = ("QUILTOR_EVAL", "QUILTOR_EVAL_SAMPLING")


def _without_eval_env() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key not in EVAL_ENV}


def _runtime(*replies: dict[str, Any]) -> tuple[AssistantRuntime, FakeInference]:
    inference = FakeInference(replies)
    runtime = AssistantRuntime(
        Path("."),
        Path("."),
        inference,
        progress=_Progress(),
        read_tools=_ReadTools(),
        token_cache=BoundedTokenCountCache(),
    )
    return runtime, inference


class EvalSamplingStartupTests(unittest.TestCase):
    def test_without_the_switch_the_sampling_variable_is_ignored(self):
        for flag in ("", "0"):
            with self.subTest(flag=flag):
                self.assertIsNone(eval_sampling(flag, '{"temperature": 0.9}', LOCAL))

    def test_with_the_switch_the_values_are_taken(self):
        self.assertEqual(
            eval_sampling("1", '{"temperature": 0, "seed": 7, "max_tokens": 64}', LOCAL),
            EvalSampling(temperature=0.0, seed=7, max_tokens=64),
        )

    def test_the_switch_without_values_keeps_the_product_values_but_allows_a_job_seed(self):
        self.assertEqual(eval_sampling("1", "", LOCAL), EvalSampling())

    def test_a_hosted_server_with_the_switch_does_not_start(self):
        with self.assertRaisesRegex(RuntimeError, "hosted"):
            eval_sampling("1", "", HOSTED)
        self.assertIsNone(eval_sampling("0", "", HOSTED))

    def test_anything_malformed_is_a_startup_error(self):
        for flag, raw in (
            ("yes", ""),
            ("1", "not json"),
            ("1", "[]"),
            ("1", '{"top_p": 1}'),
            ("1", '{"temperature": 3}'),
            ("1", '{"temperature": true}'),
            ("1", '{"seed": -1}'),
            ("1", '{"seed": 1.5}'),
            ("1", '{"max_tokens": 0}'),
        ):
            with self.subTest(flag=flag, raw=raw), self.assertRaises(RuntimeError):
                eval_sampling(flag, raw, LOCAL)


class EvalSamplingBuildTests(unittest.TestCase):
    """The real builder reads the environment once and hands the value to the app."""

    def _build(self, env: dict[str, str], identity=None):
        root = Path(self.enterContext(_TempDir()))
        with patch.dict(os.environ, {**_without_eval_env(), **env}, clear=True):
            with patch(
                "quiltor.bootstrap.web.build_assistant_services", return_value=assistant_fakes()
            ):
                app = build_web_application(
                    identity=identity or build_identity(False),
                    ensure_assistant_installed=False,
                    app_directories=make_directories(root),
                )
        self.addCleanup(app.close)
        return app

    def test_a_local_server_carries_the_values_from_the_environment(self):
        app = self._build({"QUILTOR_EVAL": "1", "QUILTOR_EVAL_SAMPLING": '{"seed": 3}'})
        self.assertEqual(app.eval_sampling, EvalSampling(seed=3))
        self.assertEqual(
            cast(AssistantRouteServices, app.route_services("/api/assistant/jobs")).eval_sampling,
            EvalSampling(seed=3),
        )

    def test_a_local_server_without_the_switch_has_no_override(self):
        app = self._build({"QUILTOR_EVAL_SAMPLING": '{"seed": 3}'})
        self.assertIsNone(app.eval_sampling)

    def test_a_multi_user_server_with_the_switch_stops_at_startup(self):
        gateway = StdlibIdentityGateway(
            IdentityConfiguration(issuer=ISSUER, client_id=CLIENT_ID, client_secret="audit-secret"),
            transport=FakeProvider(),
            clock=FakeClock(),
            sleep=lambda _seconds: None,
        )
        env = {"QUILTOR_HOST": "0.0.0.0", "QUILTOR_PUBLIC_URL": PUBLIC_URL, "QUILTOR_EVAL": "1"}
        with patch.dict(os.environ, env):
            identity = build_identity(True, gateway=gateway)
        with self.assertRaisesRegex(RuntimeError, "QUILTOR_EVAL"):
            self._build(env, identity=identity)


class _TempDir:
    def __enter__(self) -> str:
        import tempfile

        self._temp = tempfile.TemporaryDirectory()
        return self._temp.name

    def __exit__(self, *exc: object) -> None:
        self._temp.cleanup()


class EvalSamplingPayloadTests(unittest.TestCase):
    def test_without_sampling_the_payloads_keep_the_product_values(self):
        runtime, inference = _runtime(PLANNER_REPLY, ANSWER)
        runtime.complete(PLANNED_QUESTION, {}, FIGURES)
        planner, answer = inference.calls
        self.assertEqual((planner["temperature"], planner["max_tokens"]), (0.1, 500))
        self.assertEqual(answer["temperature"], 0.2)
        # Absent, not None: MLX and WebLLM ask whether the key is there.
        self.assertNotIn("seed", planner)
        self.assertNotIn("seed", answer)

    def test_sampling_reaches_the_planner_and_the_answer(self):
        runtime, inference = _runtime(PLANNER_REPLY, ANSWER)
        sampling = EvalSampling(temperature=0.7, seed=1000, max_tokens=64)
        runtime.complete(PLANNED_QUESTION, {}, FIGURES, sampling=sampling)
        planner, answer = inference.calls
        for payload in (planner, answer):
            self.assertEqual(
                (payload["temperature"], payload["seed"], payload["max_tokens"]), (0.7, 1000, 64)
            )

    def test_max_tokens_never_exceeds_the_headroom_or_the_planner_limit(self):
        runtime, inference = _runtime(PLANNER_REPLY, ANSWER)
        runtime.complete(
            PLANNED_QUESTION,
            {},
            FIGURES,
            sampling=EvalSampling(max_tokens=10 * MODEL_CONTEXT_TOKENS),
        )
        planner, answer = inference.calls
        self.assertEqual(planner["max_tokens"], 500)
        self.assertLess(answer["max_tokens"], MODEL_CONTEXT_TOKENS)
        # An override without a seed leaves the key out, as the product does.
        self.assertNotIn("seed", planner)
        self.assertNotIn("seed", answer)

    def test_a_batched_request_hands_the_sampling_to_every_group(self):
        runtime, _ = _runtime()
        calls = []
        runtime.complete = lambda *args, **kwargs: calls.append(kwargs) or dict(ANSWER)
        manuscript = {
            "chapters": [
                {"id": "c1", "title": "Eins", "content": "Der Morgen lag still."},
                {"id": "c2", "title": "Zwei", "content": "Der Abend kam."},
            ]
        }
        sampling = EvalSampling(seed=1000)
        runtime._run_batches(
            "Aktualisiere", manuscript, FIGURES, None, None, chapter_ids=None, sampling=sampling
        )
        self.assertTrue(calls)
        self.assertEqual({call["sampling"] for call in calls}, {sampling})

    def test_two_seeds_give_two_seeds_at_the_engine(self):
        seen = []
        for seed in (1000, 1001):
            runtime, inference = _runtime(PLANNER_REPLY, ANSWER)
            runtime.complete(PLANNED_QUESTION, {}, FIGURES, sampling=EvalSampling(seed=seed))
            seen.append([payload["seed"] for payload in inference.calls])
        self.assertEqual(seen, [[1000, 1000], [1001, 1001]])


class EvalSeedRelayTests(unittest.TestCase):
    """A client engine computes in the browser; the seed travels in its relay ticket."""

    def test_two_jobs_with_two_seeds_put_two_seeds_into_the_tickets(self):
        tickets = RelayTicketStore()
        self.addCleanup(tickets.close)
        binding = {"sub": "alice", "session_id": "session-a", "world_id": "world-a"}
        seen = []
        for job_id, seed in (("job-1", 1000), ("job-2", 1001)):
            tickets.bind_job(job_id, **binding)
            engine = RelayInferenceEngine(tickets, job_id, {"kind": "webllm"})
            runtime = AssistantRuntime(
                Path("."),
                Path("."),
                engine,
                progress=_Progress(),
                read_tools=_ReadTools(),
                token_cache=BoundedTokenCountCache(),
            )
            worker = threading.Thread(
                target=_swallow,
                args=(runtime.complete, "Wie geht es Tarek?", {}, FIGURES),
                kwargs={"sampling": EvalSampling(seed=seed)},
                daemon=True,
            )
            worker.start()
            ticket = tickets.next_for(**binding, job_id=job_id, wait=5)
            self.assertIsNotNone(ticket)
            seen.append(cast(Any, ticket).payload.get("seed"))
            tickets.cancel(job_id)
            worker.join(5)
        self.assertEqual(seen, [1000, 1001])


def _swallow(call, *args, **kwargs) -> None:
    # The job is cancelled once its ticket was read; how it ends does not matter here.
    with contextlib.suppress(Exception):
        call(*args, **kwargs)


class EvalSeedRouteTests(_LiveServerTestCase):
    """POST /api/assistant/jobs over real HTTP, built by the real builder."""

    eval_env: ClassVar[dict[str, str]] = {}

    def setUp(self):
        patcher = patch.dict(os.environ, {**_without_eval_env(), **self.eval_env}, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()
        status, body = self._request(
            "POST", "/api/worlds/create", {"title": "Testwelt", "backupUrl": ""}
        )
        self.assertEqual(status, 200, body)
        self.world_id = body["world"]["id"]
        self.assistant = MagicMock(complete=MagicMock(return_value={**ANSWER, "sources": []}))
        assistant_patch = patch.object(self.app.assistant_jobs, "assistant", self.assistant)
        assistant_patch.start()
        self.addCleanup(assistant_patch.stop)

    def _submit(self, body: dict, key: str):
        return self._request(
            "POST",
            "/api/assistant/jobs",
            {"question": "Wie geht es Tarek?", **body, "worldId": self.world_id},
            headers={"Idempotency-Key": key},
        )

    def _wait(self, body: dict) -> dict:
        return self.app.assistant_jobs.wait(
            body["job"]["id"],
            cast(LocalIdentity, self.app.identity).master_sub,
            self.world_id,
            timeout=15,
        )


class EvalSeedRefusedRouteTests(EvalSeedRouteTests):
    def test_an_eval_seed_without_the_switch_is_refused_before_any_job(self):
        for seed in (0, 1000, "x", None):
            with self.subTest(seed=seed):
                status, body = self._submit({"evalSeed": seed}, key=f"k-{seed}")
                self.assertEqual((status, body["error"]["code"]), (400, "assistant.eval_disabled"))
        self.assistant.complete.assert_not_called()

    def test_a_job_without_an_eval_seed_carries_no_sampling(self):
        status, body = self._submit({}, key="plain")
        self.assertEqual(status, 202, body)
        self._wait(body)
        self.assertIsNone(self.assistant.complete.call_args.kwargs["sampling"])


class EvalSeedAcceptedRouteTests(EvalSeedRouteTests):
    eval_env: ClassVar[dict[str, str]] = {
        "QUILTOR_EVAL": "1",
        "QUILTOR_EVAL_SAMPLING": '{"temperature": 0, "seed": 5}',
    }

    def test_two_jobs_with_two_seeds_reach_the_assistant_with_two_seeds(self):
        seeds = []
        for seed in (1000, 1001):
            status, body = self._submit({"evalSeed": seed}, key=f"seed-{seed}")
            self.assertEqual(status, 202, body)
            self._wait(body)
            seeds.append(self.assistant.complete.call_args.kwargs["sampling"])
        self.assertEqual(
            seeds,
            [EvalSampling(temperature=0.0, seed=1000), EvalSampling(temperature=0.0, seed=1001)],
        )

    def test_without_an_eval_seed_the_start_seed_applies(self):
        status, body = self._submit({}, key="start-seed")
        self.assertEqual(status, 202, body)
        self._wait(body)
        self.assertEqual(
            self.assistant.complete.call_args.kwargs["sampling"],
            EvalSampling(temperature=0.0, seed=5),
        )

    def test_a_seed_that_is_no_whole_number_is_refused(self):
        for seed in ("1000", 1.5, -1, True, 2**31):
            with self.subTest(seed=seed):
                status, _body = self._submit({"evalSeed": seed}, key=f"bad-{seed}")
                self.assertEqual(status, 400)
        self.assistant.complete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
