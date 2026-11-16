"""The context budget per prompt part (T-307): the rule, the cuts and their markers.

Every check runs with two counters: words (`len(text.split())`) and the relay's worst case,
chars / 3 * 1.1 with calibration 1.0 -- a long word without spaces is one token for the first and
many for the second, and the cases that matter show in the second.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.infrastructure.inference.relay.engine import RelayInferenceEngine
from quiltor.infrastructure.inference.relay.tickets import RelayTicketStore
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.modules.assistant.budget import (
    RAG_FLOOR,
    ROUND_RESERVE,
    WORLD_CAP_MAX,
    prompt_budget,
)
from quiltor.modules.assistant.completion import relevant_ids
from quiltor.modules.assistant.config import RUNTIME_CONFIG
from quiltor.modules.assistant.context import pack_chunks
from quiltor.modules.assistant.contract import (
    fit_world_state,
    structured_world_state,
    task_contract,
)

EXAMPLE = json.loads(
    (Path(__file__).resolve().parents[2] / "src/quiltor/resources/example_world/de.json").read_text(
        encoding="utf-8"
    )
)
FIGURES: dict[str, Any] = EXAMPLE["storyWorld"]
MANUSCRIPT: dict[str, Any] = EXAMPLE["manuscript"]
Q1 = "Wer kommt in dieser Welt vor?"


def words(text: str) -> int:
    return len(text.split())


def relay_worst(text: str) -> int:
    return math.ceil(math.ceil(len(text) / 3) * 1.1)


def dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def llama_like() -> Any:
    # The ratio the T-307 confirmation measured for this world state: 2236 tokens.
    full = len(dump(structured_world_state(FIGURES, task_contract(Q1, FIGURES))))
    return lambda text: math.ceil(len(text) * 2236 / full)


def candidates(question: str) -> list[Any]:
    chunks = build_knowledge(
        MANUSCRIPT, FIGURES, [str(chapter.get("id")) for chapter in MANUSCRIPT["chapters"]]
    )
    return retrieve(chunks, question)


def generated_world(count: int, relevant: int = 0) -> dict[str, Any]:
    nodes = [
        {
            "id": f"g{index:03d}",
            "type": "person" if index % 2 else "ort",
            "name": f"Gestalt {index:03d}",
            "label": "Rolle " * 4,
            "sub": "Untertitel " * 4,
            "profile": {"notes": "Steckbriefzeile " * (60 if index < relevant else 20)},
        }
        for index in range(count)
    ]
    return {"nodes": nodes, "edges": [], "timeline": [], "presence": []}


ELEMENTS = {"readScopes": ["elements"]}


class BudgetRuleTests(unittest.TestCase):
    def test_the_parts_add_up_to_the_window_with_one_round_reserved(self):
        for kinds in (0, 3):
            budget = prompt_budget(base_prompt=2836, tools=906, required_kinds=kinds)
            self.assertEqual(budget.fixed + budget.free, RUNTIME_CONFIG.context_tokens)
            self.assertEqual(
                budget.fixed,
                RUNTIME_CONFIG.template_reserve
                + RUNTIME_CONFIG.base_output_tokens
                + RUNTIME_CONFIG.output_tokens_per_kind * kinds
                + 2836
                + 906
                + 1024,  # one read round, reserved before the first call
            )
            self.assertEqual(ROUND_RESERVE, 1024)
            self.assertLessEqual(budget.cap, min(budget.free, WORLD_CAP_MAX))

    def test_the_example_world_stays_byte_identical_on_llama_without_history(self):
        count = llama_like()
        budget = prompt_budget(base_prompt=763 + 73, tools=906, required_kinds=0)
        contract = task_contract(Q1, FIGURES)
        fitted = fit_world_state(FIGURES, contract, target=budget.cap, count=count)
        assert fitted is not None
        self.assertFalse(fitted.shortened)
        self.assertEqual(fitted.state, structured_world_state(FIGURES, contract))

    def test_the_example_world_keeps_every_element_with_the_worst_counter_and_full_history(self):
        budget = prompt_budget(base_prompt=1276 + 90 + 2000, tools=1326, required_kinds=0)
        target = min(budget.cap, budget.free - RAG_FLOOR)
        contract = task_contract(Q1, FIGURES)
        relevant = relevant_ids(Q1, FIGURES, {}, candidates(Q1))
        fitted = fit_world_state(
            FIGURES, contract, target=target, count=relay_worst, relevant=relevant
        )
        assert fitted is not None
        elements = fitted.state["elements"]
        self.assertEqual(len(elements), len(FIGURES["nodes"]))
        for element in elements:
            self.assertTrue({"id", "type", "name"} <= set(element))
        died = {node["id"] for node in FIGURES["nodes"] if node.get("diedMomentId")}
        self.assertTrue(died)
        for element in elements:
            if element["id"] in died:
                self.assertIn("diedMomentId", element)
        self.assertNotIn("truncated", fitted.state)
        self.assertGreater(fitted.state["shortened"]["elements"]["profile"], 0)
        self.assertLessEqual(fitted.tokens, target + 40)  # the markers themselves


class CuttingTests(unittest.TestCase):
    def test_stages_go_in_order_and_relevant_entries_stay_whole(self):
        world = generated_world(200)
        relevant = {"elements": ["g000", "g001"]}
        for count in (words, relay_worst):
            full = sum(
                count(dump(item)) for item in structured_world_state(world, ELEMENTS)["elements"]
            )
            without_profile = sum(
                count(dump({k: v for k, v in item.items() if k != "profile"}))
                for item in structured_world_state(world, ELEMENTS)["elements"]
            )
            target = without_profile + 2 * count(dump(world["nodes"][0]["profile"])) + 50
            self.assertLess(target, full)
            fitted = fit_world_state(world, ELEMENTS, target=target, count=count, relevant=relevant)
            assert fitted is not None
            self.assertEqual(set(fitted.state["shortened"]["elements"]), {"profile"})
            kept = {item["id"]: item for item in fitted.state["elements"]}
            self.assertIn("profile", kept["g000"])
            self.assertIn("profile", kept["g001"])
            self.assertNotIn("profile", kept["g002"])

            tiny = fit_world_state(world, ELEMENTS, target=600, count=count, relevant=relevant)
            assert tiny is not None
            self.assertEqual(tiny.state["truncated"]["elements"], 200 - len(tiny.state["elements"]))
            self.assertIn("g000", {item["id"] for item in tiny.state["elements"]})
            self.assertEqual(tiny.state["shortened"]["elements"]["label"], 198)

    def test_relevant_entries_lose_their_fields_before_the_floor(self):
        world = generated_world(20, relevant=20)
        world["nodes"][3]["diedMomentId"] = "t-end"
        relevant = {"elements": [node["id"] for node in world["nodes"]]}
        always = ("id", "type", "name", "diedMomentId")
        for count in (words, relay_worst):
            floor = sum(
                count(dump({k: node[k] for k in always if k in node})) for node in world["nodes"]
            )
            fitted = fit_world_state(
                world, ELEMENTS, target=floor + 5, count=count, relevant=relevant
            )
            assert fitted is not None
            self.assertEqual(len(fitted.state["elements"]), 20)
            self.assertNotIn("truncated", fitted.state)
            self.assertEqual(fitted.state["shortened"]["elements"]["profile"], 20)
            self.assertEqual(fitted.state["elements"][3]["diedMomentId"], "t-end")
            self.assertIsNone(
                fit_world_state(world, ELEMENTS, target=floor - 5, count=count, relevant=relevant)
            )

    def test_relevance_holds_within_its_own_scope(self):
        contract = {"readScopes": ["relationships", "elements"]}
        mara_edges = [
            edge["id"] for edge in FIGURES["edges"] if "mara" in (edge.get("from"), edge.get("to"))
        ]
        self.assertTrue(mara_edges)
        full = structured_world_state(FIGURES, contract)
        target = words(dump(full)) // 2
        fitted = fit_world_state(
            FIGURES, contract, target=target, count=words, relevant={"elements": ["mara"]}
        )
        assert fitted is not None
        mara = next(item for item in fitted.state["elements"] if item["id"] == "mara")
        self.assertEqual(mara, next(item for item in full["elements"] if item["id"] == "mara"))
        kept = {item["id"]: item for item in fitted.state["relationships"]}
        original = {item["id"]: item for item in full["relationships"]}
        self.assertTrue(
            any(kept.get(ident) != original[ident] for ident in mara_edges),
            "Mara's relationships were kept whole although only her element is relevant",
        )

    def test_the_selection_does_not_depend_on_the_order_of_the_nodes(self):
        world = generated_world(60)
        backwards = {**world, "nodes": list(reversed(world["nodes"]))}
        target = 900
        first = fit_world_state(world, ELEMENTS, target=target, count=words)
        second = fit_world_state(backwards, ELEMENTS, target=target, count=words)
        assert first is not None and second is not None
        self.assertEqual(
            {item["id"]: set(item) for item in first.state["elements"]},
            {item["id"]: set(item) for item in second.state["elements"]},
        )
        self.assertEqual(
            [item["id"] for item in second.state["elements"]],
            [
                node["id"]
                for node in backwards["nodes"]
                if node["id"] in {i["id"] for i in second.state["elements"]}
            ],
        )

    def test_extraction_keeps_every_name(self):
        world = generated_world(120)
        floor = sum(
            words(dump({k: node[k] for k in ("id", "type", "name")})) for node in world["nodes"]
        )
        fitted = fit_world_state(
            world, ELEMENTS, target=floor + 10, count=words, keep_all_entries=True
        )
        assert fitted is not None
        self.assertEqual(len(fitted.state["elements"]), 120)
        self.assertNotIn("truncated", fitted.state)
        self.assertIsNone(
            fit_world_state(world, ELEMENTS, target=floor - 10, count=words, keep_all_entries=True)
        )

    def test_the_header_says_whether_the_state_was_shortened(self):
        contract = task_contract(Q1, FIGURES)
        whole = fit_world_state(FIGURES, contract, target=10**6, count=words)
        cut = fit_world_state(FIGURES, contract, target=200, count=words)
        assert whole is not None and cut is not None
        self.assertEqual(whole.header, "STRUCTURED WORLD STATE (complete for the requested scopes)")
        self.assertTrue(cut.header.startswith("STRUCTURED WORLD STATE (shortened to fit;"))


class RagBudgetTests(unittest.TestCase):
    def test_the_serialized_block_stays_within_the_budget(self):
        found = candidates(Q1)
        for count in (words, relay_worst):
            for budget in (300, 800, 1500):
                packed = pack_chunks(
                    found,
                    "tokenizer",
                    budget,
                    lambda _url, text, count=count: count(text),
                    BoundedTokenCountCache(),
                )
                block = json.dumps([chunk.public() for chunk in packed], ensure_ascii=False)
                if count is relay_worst:
                    self.assertLessEqual(len(block), math.ceil(budget / 1.1 * 3) + 3)
                self.assertTrue(packed)


class RelayCalibrationTests(unittest.TestCase):
    def test_webllm_starts_at_point_nine_and_other_client_engines_at_one(self):
        tickets = RelayTicketStore()
        try:
            webllm = RelayInferenceEngine(tickets, "job-a", {"kind": "webllm"})
            cloud = RelayInferenceEngine(tickets, "job-b", {"kind": "cloud"})
            self.assertEqual(webllm.calibration, 0.9)
            self.assertEqual(cloud.calibration, 1.0)
        finally:
            tickets.close()


class CompletionBudgetTests(unittest.TestCase):
    """The budget inside complete_request, with the runtime fakes of the runtime tests."""

    def runtime(self, *replies: dict[str, Any], tokens_per_char: float = 0.25):
        from quiltor.modules.assistant import AssistantRuntime
        from tests.python.test_assistant_runtime import FakeInference, _Progress, _ReadTools

        inference = FakeInference(replies, 0, heavy=())
        inference.count_tokens = lambda text: max(1, math.ceil(len(text) * tokens_per_char))
        runtime = AssistantRuntime(
            Path("."),
            Path("."),
            inference,
            progress=_Progress(),
            read_tools=_ReadTools(),
            token_cache=BoundedTokenCountCache(),
        )
        return runtime, inference

    def budget_step(self, result: dict[str, Any]) -> dict[str, Any]:
        return next(step for step in result["agentTrace"] if step.get("step") == "budget")

    def test_what_rag_leaves_goes_back_to_the_world_state(self):
        # No RAG candidates, a world larger than the cap but smaller than the free tokens: the
        # world is cut to the cap first and then grows back into what RAG did not take.
        world = generated_world(30)
        runtime, inference = self.runtime({"message": "ok", "citations": [], "proposals": []})
        with mock.patch("quiltor.modules.assistant.completion.retrieve", return_value=[]):
            result = runtime.complete(Q1, {"chapters": []}, world)
        step = self.budget_step(result)
        full = math.ceil(len(dump(structured_world_state(world, ELEMENTS))) * 0.25)
        self.assertGreater(full, step["cap"])
        self.assertLess(full, step["free"])
        self.assertEqual(step["shortened"], {})
        content = inference.calls[0]["messages"][-1]["content"]
        self.assertTrue(
            content.startswith("STRUCTURED WORLD STATE (complete for the requested scopes)")
        )

    def test_a_shortened_state_is_announced_in_the_prompt(self):
        world = generated_world(200)
        runtime, inference = self.runtime({"message": "ok", "citations": [], "proposals": []})
        result = runtime.complete(Q1, MANUSCRIPT, world)
        step = self.budget_step(result)
        self.assertTrue(step["shortened"] or step["truncated"])
        content = inference.calls[0]["messages"][-1]["content"]
        self.assertTrue(content.startswith("STRUCTURED WORLD STATE (shortened to fit;"))

    def test_below_the_floor_the_model_is_never_called(self):
        from quiltor.modules.assistant.ports import InferenceContextTooLargeError

        world = generated_world(20, relevant=20)
        question = "Was wissen wir über " + ", ".join(node["name"] for node in world["nodes"]) + "?"
        runtime, inference = self.runtime(tokens_per_char=4.0)
        with self.assertRaises(InferenceContextTooLargeError):
            runtime.complete(question, {"chapters": []}, world)
        self.assertEqual(inference.calls, [])


if __name__ == "__main__":
    unittest.main()
