"""World extraction answers from its part, without read tools (T-369).

On llama.cpp and WebLLM a small model offered read tools always read first, got nothing useful
back and answered with no proposals (T-368: 0 proposals in every real run, also for a world
without the chapter's figures). These tests pin the four parts of the fix: no read tools in an
extraction part, an extraction instruction with typed elements, section ids mapped in
search_manuscript, and a part budget that fits its proposal limit.
"""

import copy
import unittest
from pathlib import Path
from typing import Any

from test_assistant_budget import EXTRACTION
from test_assistant_runtime import _Progress
from test_world_selection import manuscript, test_world

from quiltor.application.story_world.read_tools import StoryWorldReadTools, execute_read_tool
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.modules.assistant import AssistantRuntime
from quiltor.modules.assistant.budget import (
    EXTRACTION_ANSWER_TOKENS,
    EXTRACTION_PART_PROPOSALS,
    prompt_budget,
)
from quiltor.modules.assistant.prompts import EXTRACTION_INSTRUCTION
from quiltor.modules.assistant.schema_check import check
from quiltor.modules.assistant.schemas import reply_schema

STEP = "quiltor_read_tool_step"
NEW_PERSON = {
    "kind": "create_element",
    "tempId": "new:probe",
    "element": {"type": "person", "name": "Probe Neumann"},
}


class ReadsFirstModel:
    """Behaves like Qwen3-4B in T-368: reads whenever it may, then proposes nothing.

    Only a step schema without the tool branch gets the proposal it would have made.
    """

    identity = "http://fake"

    def __init__(self):
        self.calls = []

    def reload(self):
        pass

    def status(self):
        return {"available": True, "mode": "local", "reason": ""}

    def invoke(self, payload):
        self.calls.append(copy.deepcopy(dict(payload)))
        schema = payload["response_format"]["json_schema"]
        branches = schema["schema"]["properties"]["step"]["anyOf"] if schema["name"] == STEP else []
        if any("toolCalls" in branch["properties"] for branch in branches):
            if not any(m["content"].startswith("READ TOOL RESULTS") for m in payload["messages"]):
                call = {"name": "search_manuscript", "arguments": {"query": "Person"}}
                return {"step": {"action": "tool_calls", "toolCalls": [call]}}
            final = {"message": "Nichts gefunden.", "citations": [], "proposals": []}
        else:
            final = {"message": "Eine neue Figur.", "citations": [], "proposals": [NEW_PERSON]}
        return {"step": {"action": "final", "final": final}} if schema["name"] == STEP else final

    def count_tokens(self, text):
        return max(1, round(len(text) * 0.343))

    def close(self):
        pass


def extract(chapter="c-arrival"):
    engine = ReadsFirstModel()
    runtime = AssistantRuntime(
        Path("."),
        Path("."),
        engine,
        progress=_Progress(),
        read_tools=StoryWorldReadTools(),
        token_cache=BoundedTokenCountCache(),
    )
    result = runtime.complete(
        EXTRACTION,
        manuscript(),
        copy.deepcopy(test_world()["figures"]),
        chapter_ids=[chapter],
        mode="world_extraction",
    )
    return result, engine.calls


def final_branch(payload):
    branches = payload["response_format"]["json_schema"]["schema"]["properties"]["step"]["anyOf"]
    return next(b["properties"]["final"] for b in branches if "final" in b["properties"]), branches


class ExtractionAnswersWithoutReadToolsTests(unittest.TestCase):
    def test_a_model_that_reads_whenever_it_may_still_proposes(self):
        result, calls = extract()
        self.assertEqual([p["element"]["name"] for p in result["proposals"]], ["Probe Neumann"])
        self.assertEqual(len(calls), 1)

    def test_an_extraction_part_offers_no_read_tool(self):
        _, calls = extract()
        _, branches = final_branch(calls[0])
        self.assertEqual([sorted(b["properties"]) for b in branches], [["action", "final"]])
        self.assertNotIn("READ-ONLY TOOL STEP CONTRACT", calls[0]["messages"][0]["content"])


class ExtractionInstructionTests(unittest.TestCase):
    def test_the_extraction_prompt_carries_the_instruction(self):
        _, calls = extract()
        self.assertIn(EXTRACTION_INSTRUCTION, calls[0]["messages"][0]["content"])

    def test_an_extracted_element_needs_a_type(self):
        _, calls = extract()
        final, _ = final_branch(calls[0])
        untyped = {"message": "m", "citations": [], "proposals": [
            {"kind": "create_element", "tempId": "new:a", "element": {"name": "A"}}
        ]}  # fmt: skip
        typed = {**untyped, "proposals": [NEW_PERSON]}
        self.assertNotEqual(check(untyped, final), [])
        self.assertEqual(check(typed, final), [])

    def test_a_chat_request_keeps_the_open_element(self):
        untyped = {"message": "m", "citations": [], "proposals": [
            {"kind": "create_element", "tempId": "new:a", "element": {"name": "A"}}
        ]}  # fmt: skip
        self.assertEqual(check(untyped, reply_schema()), [])


class SectionIdsInSearchManuscriptTests(unittest.TestCase):
    def search(self, chapter_ids) -> Any:
        return execute_read_tool(
            "search_manuscript",
            {"query": "Kette", "chapterIds": chapter_ids},
            manuscript=manuscript(),
            figures=test_world()["figures"],
            world_revision=0,
        )

    def test_a_section_id_finds_its_chapter(self):
        plain = self.search(["x-kettenwache"])
        self.assertTrue(plain["ok"])
        self.assertGreater(plain["result"]["count"], 0)
        for section in ("x-kettenwache:0", "chapter:x-kettenwache:3", "chapter-note:x-kettenwache"):
            with self.subTest(section=section):
                found = self.search([section])
                self.assertTrue(found["ok"], found)
                self.assertEqual(found["result"], plain["result"])

    def test_an_id_that_names_no_chapter_is_refused(self):
        for unknown in ("x-nirgends", "x-nirgends:0", "x-kettenwache:eins"):
            with self.subTest(unknown=unknown):
                self.assertFalse(self.search([unknown])["ok"])


class ExtractionPartBudgetTests(unittest.TestCase):
    def test_the_part_lists_at_most_its_proposal_limit(self):
        _, calls = extract()
        final, _ = final_branch(calls[0])
        self.assertEqual(final["properties"]["proposals"]["maxItems"], EXTRACTION_PART_PROPOSALS)

    def test_the_answer_reserve_takes_what_tools_and_the_read_round_left(self):
        chat = prompt_budget(base_prompt=2000, tools=900, required_kinds=0)
        part = prompt_budget(base_prompt=2000, tools=900, required_kinds=0, answer_only=True)
        self.assertEqual((part.tools, part.round_reserve), (0, 0))
        self.assertEqual(part.answer, EXTRACTION_ANSWER_TOKENS)
        self.assertGreater(part.free, chat.free)

    def test_the_part_asks_for_the_extraction_answer_reserve(self):
        _, calls = extract()
        self.assertEqual(calls[0]["max_tokens"], EXTRACTION_ANSWER_TOKENS)

    def test_the_answer_reserve_fits_the_proposal_limit(self):
        # About 80 tokens per proposal plus message and citations (T-368 one-shot replies).
        self.assertGreaterEqual(EXTRACTION_ANSWER_TOKENS, 80 * EXTRACTION_PART_PROPOSALS + 300)


if __name__ == "__main__":
    unittest.main()
