"""The context budget per prompt part (T-307): the rule, the cuts and their markers.

Every check runs with two counters: words (`len(text.split())`) and the relay's worst case,
chars / 3 * 1.1 with calibration 1.0 -- a long word without spaces is one token for the first and
many for the second, and the cases that matter show in the second.
"""

from __future__ import annotations

import itertools
import json
import math
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from quiltor.domain.story_world.knowledge import build_knowledge, chapter_parts, retrieve
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
from quiltor.modules.assistant.jobs import classify_assistant_error
from quiltor.modules.assistant.ports import (
    ChapterTooLongError,
    ExtractionIncompleteError,
    ExtractionPartFailedError,
    InferenceDeadlineError,
    InferenceTimeoutError,
    InferenceUnavailableError,
    InferenceValidationError,
    WorldTooLargeError,
)

# Invocations one extraction call makes before it gives up on an invalid reply: the answer
# and its in-call repairs.
PART_CALLS = 3

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


REPLY = {"message": "ok", "citations": [], "proposals": []}
EXTRACTION = "Weltmodell aus Manuskript aktualisieren"


class CompletionWiringTests(CompletionBudgetTests):
    """The lines in complete_request that apply the budget rules (F-307-10, F-307-11)."""

    def capture_budget(self) -> tuple[Any, list[dict[str, Any]]]:
        from quiltor.modules.assistant import completion

        calls: list[dict[str, Any]] = []

        def recording(**kwargs: Any) -> Any:
            calls.append(kwargs)
            return prompt_budget(**kwargs)

        return mock.patch.object(completion, "prompt_budget", side_effect=recording), calls

    def test_the_tool_instructions_and_the_task_requirements_are_measured_first(self):
        # Swap world state and excerpts in the prompt that was sent for empty ones: what remains
        # is what the budget measured as fixed -- base prompt (with the requirements) and tools.
        from quiltor.modules.assistant.contract import COMPLETE_WORLD_HEADER
        from quiltor.modules.assistant.tool_loop import tool_instructions

        runtime, inference = self.runtime(*[REPLY] * 4)
        patch, budgets = self.capture_budget()
        question = "Ergänze in Ivens Steckbrief, dass er Salzspuren an den Stiefeln trägt."
        with patch, self.assertRaises(InferenceValidationError):
            runtime.complete(question, MANUSCRIPT, FIGURES)
        measured = budgets[0]
        tools = inference.count_tokens(tool_instructions(runtime.read_tools))
        self.assertGreater(tools, 0)
        self.assertEqual(measured["tools"], tools)
        messages = inference.calls[0]["messages"]
        self.assertIn("TASK REQUIREMENTS", messages[1]["content"])
        user = messages[-1]["content"]
        rag_at = user.index("\n\nRAG CONTEXT (content excerpts only):\n")
        contract_at = user.index("\n\nTASK CONTRACT:\n")
        emptied = (
            f"{COMPLETE_WORLD_HEADER}:\n{{}}"
            + "\n\nRAG CONTEXT (content excerpts only):\n[]"
            + user[contract_at:]
        )
        self.assertLess(rag_at, contract_at)
        sent = [message["content"] for message in messages[:-1]] + [emptied]
        fixed = inference.count_tokens("".join(sent))
        self.assertLessEqual(abs(measured["base_prompt"] + tools - fixed), 3)

    def test_the_world_state_of_a_question_stays_under_the_cap(self):
        runtime, _ = self.runtime(REPLY)
        result = runtime.complete(Q1, MANUSCRIPT, generated_world(400))
        step = self.budget_step(result)
        self.assertLess(step["cap"], step["free"] - RAG_FLOOR)
        # The world is cut to the cap before RAG is packed, so RAG gets far more than its floor;
        # without the cap the world would take all but the floor.
        self.assertGreater(step["ragTokens"], 2 * RAG_FLOOR)

    def test_rag_keeps_its_floor_when_the_cap_would_leave_less(self):
        # A small window: 65 % of what is free leaves RAG less than its floor.
        from quiltor.modules.assistant import completion

        def tight(**kwargs: Any) -> Any:
            budget = prompt_budget(**kwargs)
            return type(budget)(
                **{**budget.__dict__, "round_reserve": budget.round_reserve + budget.free - 600}
            )

        runtime, _ = self.runtime(REPLY)
        with (
            mock.patch.object(completion, "prompt_budget", side_effect=tight),
            mock.patch.object(completion, "fit_world_state", wraps=fit_world_state) as fitted,
        ):
            result = runtime.complete(Q1, MANUSCRIPT, generated_world(200))
        step = self.budget_step(result)
        self.assertEqual(step["free"], 600)
        self.assertGreater(step["cap"], step["free"] - RAG_FLOOR)
        # The first cut leaves RAG its floor; only what RAG then leaves may flow back.
        self.assertEqual(fitted.call_args_list[0].kwargs["target"], step["free"] - RAG_FLOOR)

    def test_extraction_on_the_example_world_reaches_the_model(self):
        # F-307-10: presence has only "always" fields and cannot shrink; every scope gets its
        cases: list[tuple[float, list[str] | None]] = [
            (per_char, ["c-arrival"]) for per_char in (0.25, 0.33, 0.37)
        ]
        cases = [(per_char, ["c-arrival"]) for per_char in (0.25, 0.33, 0.37)]
        # Every chapter: more excerpts than the cap, so RAG is cut to the cap before the world.
        cases.append((0.37, None))
        for per_char, chapters in cases:
            with self.subTest(per_char=per_char, chapters=chapters):
                from quiltor.modules.assistant import completion

                runtime, inference = self.runtime(REPLY, tokens_per_char=per_char)
                with mock.patch.object(completion, "pack_chunks", wraps=pack_chunks) as packed:
                    result = runtime.complete(
                        EXTRACTION,
                        MANUSCRIPT,
                        FIGURES,
                        chapter_ids=chapters,
                        mode="world_extraction",
                    )
                self.assertEqual(len(inference.calls), 1)
                step = self.budget_step(result)
                # The manuscript is packed first, up to the cap, not up to everything free.
                self.assertEqual(packed.call_args_list[0].args[2], step["cap"])
                self.assertEqual(step["truncated"], {})
                self.assertLessEqual(step["ragTokens"], step["cap"])
                content = inference.calls[0]["messages"][-1]["content"]
                for node in FIGURES["nodes"]:
                    self.assertIn(node["name"], content)

    def test_extraction_keeps_every_entry_of_a_large_world(self):
        world = generated_world(120)
        runtime, inference = self.runtime(REPLY, tokens_per_char=0.37)
        result = runtime.complete(
            EXTRACTION, MANUSCRIPT, world, chapter_ids=["c-arrival"], mode="world_extraction"
        )
        step = self.budget_step(result)
        self.assertTrue(step["shortened"])
        self.assertEqual(step["truncated"], {})
        content = inference.calls[0]["messages"][-1]["content"]
        for node in world["nodes"]:
            self.assertIn(node["name"], content)


def marked_chapter(words: int) -> tuple[dict[str, Any], str, list[str]]:
    """The example manuscript with its first chapter replaced by ``words`` words of its own prose,
    a unique marker every 25 words and a paragraph break every 100: the markers prove which part
    of the chapter reached the model."""
    prose = " ".join(str(chapter.get("body") or "") for chapter in MANUSCRIPT["chapters"]).split()
    markers: list[str] = []
    paragraphs: list[str] = []
    current: list[str] = []
    for index in range(words):
        if index % 25 == 0:
            markers.append(f"M{index:05d}")
            current.append(markers[-1])
        else:
            current.append(prose[index % len(prose)])
        if len(current) == 100:
            paragraphs.append(" ".join(current))
            current = []
    if current:
        paragraphs.append(" ".join(current))
    manuscript = json.loads(json.dumps(MANUSCRIPT))
    manuscript["chapters"][0]["body"] = "\n\n".join(paragraphs)
    # Mentions point into the old text by offset; the new text has none of them.
    manuscript["chapters"][0]["mentions"] = []
    return manuscript, str(manuscript["chapters"][0]["id"]), markers


class ExtractionPartsTests(CompletionBudgetTests):
    """T-330: world extraction covers a whole chapter in parts, each fitting the browser's window,
    and refuses only a world that cannot fit on its own. Counted with the relay's counter."""

    def relay(self, calibration: float, replies: int = 60):
        return self.runtime(*([REPLY] * replies), tokens_per_char=calibration * 1.1 / 3)

    def prompt_tokens(self, inference: Any, call: dict[str, Any]) -> int:
        return inference.count_tokens("".join(m["content"] for m in call["messages"]))

    def assert_calls_fit(self, inference: Any) -> None:
        for call in inference.calls:
            self.assertLessEqual(
                self.prompt_tokens(inference, call) + call["max_tokens"],
                RUNTIME_CONFIG.context_tokens - RUNTIME_CONFIG.template_reserve,
            )

    def test_a_long_chapter_reaches_the_model_in_full(self):
        for words in (2000, 9000):
            with self.subTest(words=words):
                manuscript, chapter_id, markers = marked_chapter(words)
                runtime, inference = self.relay(0.9)
                result = runtime.complete(
                    EXTRACTION,
                    manuscript,
                    FIGURES,
                    chapter_ids=[chapter_id],
                    mode="world_extraction",
                )
                sent = "\n".join(m["content"] for call in inference.calls for m in call["messages"])
                missing = [marker for marker in markers if marker not in sent]
                self.assertEqual(missing, [])
                # The trace names every paragraph of the original chapter as carried.
                carried = {
                    paragraph
                    for step in result["agentTrace"]
                    if step.get("step") == "extraction_sent"
                    for chunk in step["chunks"]
                    for paragraph in chunk["paragraphs"]
                }
                paragraphs = chapter_parts(manuscript["chapters"][0]["body"])
                self.assertEqual(
                    carried, {f"chapter:{chapter_id}:{i}" for i in range(len(paragraphs))}
                )
                self.assertGreater(len(inference.calls), 1)
                self.assert_calls_fit(inference)
                self.assertEqual(result["mode"], "world_extraction")

    def test_a_chapter_that_fits_stays_one_call(self):
        runtime, inference = self.relay(0.9)
        runtime.complete(
            EXTRACTION, MANUSCRIPT, FIGURES, chapter_ids=["c-arrival"], mode="world_extraction"
        )
        self.assertEqual(len(inference.calls), 1)

    def test_a_large_world_gets_a_smaller_share_of_the_chapter_instead_of_a_refusal(self):
        cases = [
            ("150 elements, cal 0.9", generated_world(150), 0.9),
            ("example world, cal 1.3", FIGURES, 1.3),
        ]
        for label, world, calibration in cases:
            with self.subTest(label):
                # A 2,000-word chapter: with it the example world was refused at 1.3.
                manuscript, chapter_id, markers = marked_chapter(2000)
                runtime, inference = self.relay(calibration)
                runtime.complete(
                    EXTRACTION,
                    manuscript,
                    world,
                    chapter_ids=[chapter_id],
                    mode="world_extraction",
                )
                self.assertGreaterEqual(len(inference.calls), 1)
                self.assert_calls_fit(inference)
                sent = "\n".join(m["content"] for call in inference.calls for m in call["messages"])
                for node in world["nodes"]:
                    self.assertIn(node["name"], sent)
                # The chapter is covered here too (review r1, note on section 5).
                self.assertEqual([m for m in markers if m not in sent], [])

    def test_a_world_too_large_for_the_window_is_chosen_from_not_refused(self):
        # T-344: what T-330 refused as world_too_large now reaches the model with a selection.
        runtime, inference = self.relay(0.9)
        runtime.complete(
            EXTRACTION,
            MANUSCRIPT,
            generated_world(1500),
            chapter_ids=["c-arrival"],
            mode="world_extraction",
        )
        self.assertGreater(len(inference.calls), 0)
        self.assert_calls_fit(inference)
        self.assertIn('"selected": true', self.sent_text(inference))

    # -- Round 2 of the plan (F-330-1, F-330-3, F-330-4) ------------------------------------

    def sent_text(self, inference: Any) -> str:
        return "\n".join(m["content"] for call in inference.calls for m in call["messages"])

    def test_a_world_near_the_limit_gets_every_marker_or_no_call(self):
        # F-330-1: never a part of the chapter. Three counters, worlds up to past their limit.
        manuscript, chapter_id, markers = marked_chapter(9000)
        counters = {"llama-like": 0.25, "server": 1 / 3, "relay 0.9": 0.9 * 1.1 / 3}
        for label, per_char in counters.items():
            for size in range(100, 361, 20):
                with self.subTest(counter=label, elements=size):
                    runtime, inference = self.runtime(*[REPLY] * 30, tokens_per_char=per_char)
                    try:
                        runtime.complete(
                            EXTRACTION,
                            manuscript,
                            generated_world(size),
                            chapter_ids=[chapter_id],
                            mode="world_extraction",
                        )
                    except (WorldTooLargeError, ChapterTooLongError):
                        self.assertEqual(inference.calls, [])
                        continue
                    sent = self.sent_text(inference)
                    self.assertEqual([m for m in markers if m not in sent], [])
                    self.assert_calls_fit(inference)

    def test_a_chapter_beyond_the_part_limit_is_refused_before_any_call(self):
        from quiltor.modules.assistant import completion

        manuscript, chapter_id, _ = marked_chapter(9000)
        runtime, inference = self.relay(0.9)
        with (
            mock.patch.object(completion, "MAX_EXTRACTION_PARTS", 2),
            self.assertRaises(ChapterTooLongError),
        ):
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertEqual(inference.calls, [])

    def test_a_call_that_carries_nothing_of_the_chapter_is_incomplete(self):
        from quiltor.modules.assistant import completion

        runtime, inference = self.relay(0.9)
        with (
            mock.patch.object(completion, "pack_chunks", return_value=[]),
            self.assertRaises(ExtractionIncompleteError),
        ):
            runtime.complete(
                EXTRACTION, MANUSCRIPT, FIGURES, chapter_ids=["c-arrival"], mode="world_extraction"
            )
        self.assertEqual(inference.calls, [])

    def test_the_parts_follow_the_text(self):
        manuscript, chapter_id, markers = marked_chapter(9000)
        runtime, inference = self.relay(0.9)
        runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        firsts = []
        for call in inference.calls:
            content = call["messages"][-1]["content"]
            found = [index for index, marker in enumerate(markers) if marker in content]
            firsts.append((min(found), max(found)))
        for (_, last), (first, _) in itertools.pairwise(firsts):
            self.assertLessEqual(first, last + 1)
        self.assertEqual(firsts, sorted(firsts))

    def test_a_timeout_in_a_later_part_is_tried_once_more(self):
        manuscript, chapter_id, markers = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        invoke = inference.invoke
        failures = {"left": 1}

        def flaky(payload):
            if len(inference.calls) == 1 and failures["left"]:
                failures["left"] -= 1
                raise InferenceTimeoutError(30)
            return invoke(payload)

        inference.invoke = flaky
        runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        self.assertEqual([m for m in markers if m not in self.sent_text(inference)], [])

    def test_a_schema_error_in_a_later_part_is_tried_once_more_with_the_same_input(self):
        # D-248: llama.cpp broke "$.step anyOf" in part 2 of a long chapter. The call already
        # repairs inside itself; the part as a whole gets one more try with the same input.
        manuscript, chapter_id, markers = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        invoke = inference.invoke
        part_two: list[str] = []

        def flaky(payload):
            if len(inference.calls) >= 1 and len(part_two) < PART_CALLS:
                part_two.append(json.dumps(payload["messages"][:2]))
                raise InferenceValidationError("schema: $.step anyOf")
            if len(part_two) == PART_CALLS:
                part_two.append(json.dumps(payload["messages"][:2]))
            return invoke(payload)

        inference.invoke = flaky
        runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        self.assertEqual(part_two[0], part_two[PART_CALLS])
        self.assertEqual([m for m in markers if m not in self.sent_text(inference)], [])

    def test_a_second_schema_error_in_a_later_part_fails_the_run(self):
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        invoke = inference.invoke
        attempts = {"part 2": 0}

        def broken(payload):
            if len(inference.calls) >= 1:
                attempts["part 2"] += 1
                raise InferenceValidationError("schema: $.step anyOf")
            return invoke(payload)

        inference.invoke = broken
        with self.assertRaises(ExtractionPartFailedError) as raised:
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertIn("part 2", str(raised.exception))
        self.assertEqual(attempts["part 2"], 2 * PART_CALLS)
        self.assertEqual(classify_assistant_error(raised.exception), "extraction_part_failed")

    def test_a_later_part_that_fails_fails_the_run_and_names_the_part(self):
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        invoke = inference.invoke

        def broken(payload):
            if len(inference.calls) >= 1:
                raise InferenceTimeoutError(30)
            return invoke(payload)

        inference.invoke = broken
        with self.assertRaises(ExtractionPartFailedError) as raised:
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertIn("part 2", str(raised.exception))
        self.assertEqual(classify_assistant_error(raised.exception), "extraction_part_failed")

    def test_a_part_out_of_time_ends_the_run_as_incomplete_without_a_retry(self):
        # D-238: past the time of a part or of the job the chapter is not finished; that is
        # extraction_incomplete, and a retry would only take the same time again.
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        invoke = inference.invoke
        attempts = {"part 2": 0}

        def late(payload):
            if len(inference.calls) >= 1:
                attempts["part 2"] += 1
                raise InferenceDeadlineError(20 * 60.0)
            return invoke(payload)

        inference.invoke = late
        with self.assertRaises(ExtractionIncompleteError) as raised:
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertIn("part 2", str(raised.exception))
        self.assertEqual(attempts["part 2"], 1)
        self.assertEqual(classify_assistant_error(raised.exception), "extraction_incomplete")

    def test_every_part_opens_its_own_time(self):
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        opened: list[int] = []
        with mock.patch.object(
            inference,
            "start_part",
            create=True,
            side_effect=lambda: opened.append(len(inference.calls)),
        ):
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertEqual(opened, list(range(len(inference.calls))))

    def test_a_cancelled_job_starts_no_further_part(self):
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        with self.assertRaises(InferenceUnavailableError) as raised:
            runtime.complete(
                EXTRACTION,
                manuscript,
                FIGURES,
                chapter_ids=[chapter_id],
                mode="world_extraction",
                should_stop=lambda: len(inference.calls) >= 1,
            )
        self.assertEqual(str(raised.exception), "cancelled")
        self.assertEqual(len(inference.calls), 1)

    def test_the_product_route_with_batches_covers_the_chapter_and_reports_parts(self):
        # routes/assistant.py sets run_batches for every extraction.
        manuscript, chapter_id, markers = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        updates: list[tuple[str, dict[str, Any]]] = []
        with mock.patch.object(
            runtime.progress, "update", side_effect=lambda *args: updates.append((args[4], args[5]))
        ):
            result = runtime.complete(
                EXTRACTION,
                manuscript,
                FIGURES,
                chapter_ids=[chapter_id],
                mode="world_extraction",
                run_batches=True,
                progress_id="p-1",
            )
        self.assertEqual([m for m in markers if m not in self.sent_text(inference)], [])
        # The product route keeps the coverage in the trace too.
        sent = [step for step in result["agentTrace"] if step.get("step") == "extraction_sent"]
        self.assertEqual(len(sent), len(inference.calls))
        parts = [params for key, params in updates if key == "chapterGroupPartLabel"]
        self.assertEqual(
            [params["part"] for params in parts], list(range(2, len(inference.calls) + 1))
        )

    def test_the_metrics_sum_the_parts(self):
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        result = runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        metrics = [step for step in result["agentTrace"] if step.get("step") == "metrics"]
        total = metrics[-1]
        self.assertEqual(total["parts"], len(inference.calls))
        self.assertEqual(total["promptTokens"], sum(step["promptTokens"] for step in metrics[:-1]))
        self.assertEqual(
            len(total["runtimeCalls"]), sum(len(s["runtimeCalls"]) for s in metrics[:-1])
        )

    def test_evidence_of_a_later_part_points_at_the_original_paragraph(self):
        manuscript, chapter_id, _ = marked_chapter(2000)
        cited = {**REPLY, "citations": [f"chapter:{chapter_id}:0"]}
        runtime, inference = self.runtime(*[cited] * 30, tokens_per_char=0.9 * 1.1 / 3)
        result = runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        self.assertGreater(len(inference.calls), 1)
        # Every part cites its own first paragraph; each must point somewhere else in the chapter.
        self.assertEqual(len(result["citations"]), len(inference.calls))
        self.assertEqual(len({item["id"] for item in result["sources"]}), len(inference.calls))

    def test_the_same_element_relationship_and_moment_from_two_parts_are_proposed_once(self):
        # Stage 2 runs through the resolver: a later part sees the earlier proposals folded into
        # the world, so what exists already resolves to it. Real, clearly different names.
        manuscript, chapter_id, _ = marked_chapter(2000)
        cite = [f"chapter:{chapter_id}:0"]
        reply = {
            "message": "ok",
            "citations": cite,
            "proposals": [
                {
                    "kind": "create_element",
                    "tempId": "new:ilka",
                    "element": {"type": "person", "name": "Ilka Brandt"},
                },
                {
                    "kind": "create_element",
                    "tempId": "new:speicher",
                    "element": {"type": "ort", "name": "Kornspeicher am Nordkai"},
                },
                {
                    "kind": "create_relationship",
                    "relationship": {
                        "from": "new:ilka",
                        "to": "new:speicher",
                        "label": "verwaltet",
                        "directed": True,
                        "lineStyle": "solid",
                        "relationshipKind": "general",
                        "color": "auto",
                    },
                },
                {
                    "kind": "create_timeline_moment",
                    "tempId": "new:sturmnacht",
                    "moment": {"title": "Die Sturmnacht am Nordkai"},
                },
            ],
        }
        runtime, inference = self.runtime(*[reply] * 30, tokens_per_char=0.9 * 1.1 / 3)
        result = runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        self.assertGreater(len(inference.calls), 1)
        kinds = [proposal["kind"] for proposal in result["proposals"]]
        names = [
            str((proposal.get("element") or {}).get("name"))
            for proposal in result["proposals"]
            if proposal["kind"] == "create_element"
        ]
        self.assertEqual(sorted(names), ["Ilka Brandt", "Kornspeicher am Nordkai"])
        self.assertEqual(kinds.count("create_relationship"), 1)
        self.assertEqual(kinds.count("create_timeline_moment"), 1)

    def test_a_world_that_leaves_less_than_the_minimum_share_is_chosen_from(self):
        # T-330 refused this world (F-330-1); since T-344 the part gets a selection of it and
        # the chapter still reaches the model in full (D-243: never refuse).
        manuscript, chapter_id, markers = marked_chapter(2000)
        runtime, inference = self.relay(0.9)
        runtime.complete(
            EXTRACTION,
            manuscript,
            generated_world(190),
            chapter_ids=[chapter_id],
            mode="world_extraction",
        )
        self.assertGreater(len(inference.calls), 0)
        self.assertEqual([m for m in markers if m not in self.sent_text(inference)], [])
        self.assert_calls_fit(inference)

    def test_the_part_limit_in_the_loop_is_an_error_when_the_estimate_falls_short(self):
        # The estimate guards the limit before each call; should it ever fall short, the loop
        # still stops with an error and never returns a part of the chapter as a result.
        from quiltor.modules.assistant import completion

        manuscript, chapter_id, _ = marked_chapter(9000)
        runtime, inference = self.relay(0.9)
        with (
            mock.patch.object(completion, "MAX_EXTRACTION_PARTS", 2),
            mock.patch.object(completion, "_parts_needed", return_value=1),
            self.assertRaises(ExtractionIncompleteError),
        ):
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertEqual(len(inference.calls), 2)

    def test_a_cancelled_job_starts_no_further_batch_group(self):
        # Two long chapters, one group each; the job is cancelled when the first group is done,
        # so the check between groups is the one that stops it (not the one between parts).
        manuscript, first, _ = marked_chapter(2000)
        second = str(manuscript["chapters"][1]["id"])
        manuscript["chapters"][1]["body"] = manuscript["chapters"][0]["body"]
        runtime, inference = self.relay(0.9)
        stopped = {"now": False}
        done_calls: list[int] = []

        def update(*args: Any) -> None:
            if args[4] == "chapterGroupLabel":
                stopped["now"] = True
                done_calls.append(len(inference.calls))

        with (
            mock.patch.object(runtime.progress, "update", side_effect=update),
            self.assertRaises(InferenceUnavailableError) as raised,
        ):
            runtime.complete(
                EXTRACTION,
                manuscript,
                FIGURES,
                chapter_ids=[first, second],
                mode="world_extraction",
                run_batches=True,
                progress_id="p-1",
                should_stop=lambda: stopped["now"],
            )
        self.assertEqual(str(raised.exception), "cancelled")
        self.assertEqual(len(inference.calls), done_calls[0])


class ScopeFloorTests(unittest.TestCase):
    def test_a_scope_of_always_fields_only_gets_its_full_size(self):
        # Presence cannot lose a field; the shares must not cut it below its size.
        everything = {"readScopes": ["elements", "relationships", "timeline", "presence"]}
        full = structured_world_state(FIGURES, everything)
        presence = relay_worst(dump(full["presence"]))
        floor_world = fit_world_state(
            FIGURES, everything, target=10**6, count=relay_worst, keep_all_entries=True
        )
        assert floor_world is not None
        whole = floor_world.tokens
        fitted = fit_world_state(
            FIGURES, everything, target=whole * 2 // 3, count=relay_worst, keep_all_entries=True
        )
        self.assertIsNotNone(fitted)
        assert fitted is not None
        self.assertEqual(fitted.state["presence"], full["presence"])
        self.assertNotIn("presence", fitted.state.get("shortened", {}))
        self.assertGreater(presence, 0)


if __name__ == "__main__":
    unittest.main()
