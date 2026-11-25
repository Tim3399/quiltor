"""Three findings of the v3.26.3 review on world extraction in parts (T-387-B).

F-330-5: a chapter note cut short by the packing was counted as read; the rest never reached
the model. F-330-6: a part whose read step failed returned an ordinary reply and counted as
read. F-344-10: an ambiguous create proposal of one part was folded into the world of the
next one and offered there as a candidate that is never created.
"""

import copy
import json
import unittest

import test_assistant_budget as parts
import test_assistant_runtime as runtime_tests
from test_assistant_budget import EXTRACTION, FIGURES, marked_chapter

from quiltor.modules.assistant.budget import EXTRACTION_PART_PROPOSALS
from quiltor.modules.assistant.jobs import classify_assistant_error
from quiltor.modules.assistant.ports import (
    ExtractionPartFailedError,
    IncompleteInferenceResponse,
    InferenceValidationError,
)


def _helper() -> parts.ExtractionPartsTests:
    # The part tests' runtime and counters; imported by module so their tests do not run here.
    return parts.ExtractionPartsTests()


def _note(words: int) -> tuple[str, list[str]]:
    marks = [f"N{i:05d}" for i in range(0, words, 10)]
    text = " ".join(marks[i // 10] if i % 10 == 0 else "notiz" for i in range(words))
    return text, marks


class NoteCutShortTests(unittest.TestCase):
    def test_every_word_of_a_long_note_reaches_the_model(self):
        helper = _helper()
        for body_words, note_words in ((1000, 400), (2000, 1200), (300, 1200)):
            with self.subTest(body=body_words, note=note_words):
                manuscript, chapter_id, markers = marked_chapter(body_words)
                note, marks = _note(note_words)
                manuscript["chapters"][0]["note"] = note
                runtime, inference = helper.relay(0.9)
                runtime.complete(
                    EXTRACTION,
                    manuscript,
                    FIGURES,
                    chapter_ids=[chapter_id],
                    mode="world_extraction",
                )
                sent = helper.sent_text(inference)
                self.assertEqual([m for m in marks if m not in sent], [])
                self.assertEqual([m for m in markers if m not in sent], [])


class BreaksAfterFirstPart:
    """Read tools whose catalogue fails once the first part was answered: the read step of
    every later part ends in a tool-loop failure (``unsafe_tool_catalog``)."""

    def __init__(self, tools):
        self.tools = tools
        self.broken = False

    def catalog(self):
        if self.broken:
            raise RuntimeError("catalogue unavailable")
        return self.tools.catalog()

    def __getattr__(self, name):
        return getattr(self.tools, name)


class FailedReadStepTests(unittest.TestCase):
    def test_a_part_whose_read_step_fails_fails_the_run(self):
        helper = _helper()
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = helper.relay(0.9)
        tools = BreaksAfterFirstPart(runtime.read_tools)
        runtime.read_tools = tools
        invoke = inference.invoke

        def answer_then_break(payload):
            reply = invoke(payload)
            tools.broken = True
            return reply

        inference.invoke = answer_then_break
        with self.assertRaises(ExtractionPartFailedError) as raised:
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertIn("part 2", str(raised.exception))
        self.assertIn("read step failed", str(raised.exception))
        self.assertEqual(classify_assistant_error(raised.exception), "extraction_part_failed")
        self.assertEqual(len(inference.calls), 1)

    def test_an_extraction_whose_first_read_step_fails_does_not_complete(self):
        # T-369 review (probe2_t369): a catalogue that throws gave "completed", 0 calls, 0
        # proposals; the answer-only part still ends in tool_loop.failure.
        helper = _helper()
        manuscript, chapter_id, _ = marked_chapter(300)
        runtime, inference = helper.relay(0.9)
        tools = BreaksAfterFirstPart(runtime.read_tools)
        tools.broken = True
        runtime.read_tools = tools
        with self.assertRaises(ExtractionPartFailedError) as raised:
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )
        self.assertIn("unsafe_tool_catalog", str(raised.exception))
        self.assertEqual(inference.calls, [])

    def test_a_chat_reply_keeps_its_visible_fallback(self):
        helper = _helper()
        runtime, _ = helper.relay(0.9)
        tools = BreaksAfterFirstPart(runtime.read_tools)
        tools.broken = True
        runtime.read_tools = tools
        result = runtime.complete("Wer ist Mara?", parts.MANUSCRIPT, FIGURES)
        self.assertIn(
            "Der sichere Leseschritt konnte nicht abgeschlossen werden", result["message"]
        )


def _brandt(temp_id: str, name: str) -> dict:
    return {
        "kind": "create_element",
        "tempId": temp_id,
        "element": {"type": "person", "name": name},
    }


class AmbiguousCreateTests(unittest.TestCase):
    def test_an_open_choice_of_one_part_is_no_candidate_in_the_next(self):
        # Probe of F-344-10: a world with Oda Brandt and Karl Brandt.
        figures = copy.deepcopy(FIGURES)
        figures["nodes"].append({"id": "x-karl", "type": "person", "name": "Karl Brandt"})
        first = {"message": "ok", "citations": [], "proposals": [_brandt("new:b", "Herr Brandt")]}
        second = {"message": "ok", "citations": [], "proposals": [_brandt("new:c", "Brandt")]}
        manuscript, chapter_id, _ = marked_chapter(2000)
        runtime, inference = _helper().runtime(
            first, second, *[parts.REPLY] * 20, tokens_per_char=0.9 * 1.1 / 3
        )
        result = runtime.complete(
            EXTRACTION, manuscript, figures, chapter_ids=[chapter_id], mode="world_extraction"
        )
        self.assertGreaterEqual(len(inference.calls), 2)
        choices = {
            envelope["proposal"]["tempId"]: envelope["resolution"]["candidateIds"]
            for envelope in result["proposalEnvelopes"]
            if (envelope.get("resolution") or {}).get("outcome") == "ambiguous"
        }
        self.assertEqual(set(choices), {"new:b", "new:c"})
        self.assertEqual(sorted(choices["new:c"]), ["oda", "x-karl"])

    def test_an_open_choice_of_one_group_is_not_in_the_next_groups_world(self):
        runtime, _ = runtime_tests.AssistantRuntimeCompleteTests()._runtime(
            tokens=2000, heavy=("a", "b")
        )
        open_one = _brandt("new:b", "Herr Brandt")
        worlds = []

        def complete(_question, _manuscript, figures, _history, *, chapter_ids, mode, **_options):
            worlds.append({str(node.get("id")) for node in figures.get("nodes") or []})
            return {
                "message": "ok",
                "citations": [],
                "sources": [],
                "proposals": [open_one],
                "proposalEnvelopes": [
                    {"proposal": open_one, "resolution": {"outcome": "ambiguous"}}
                ],
            }

        runtime.complete = complete
        runtime._run_batches(
            "Update",
            {
                "chapters": [
                    {"id": "c1", "title": "Eins", "body": "a"},
                    {"id": "c2", "title": "Zwei", "body": "b"},
                ]
            },
            FIGURES,
            None,
            None,
            mode="world_extraction",
        )
        self.assertEqual(len(worlds), 2)
        self.assertNotIn("new:b", worlds[1])

    def test_a_resolved_create_is_still_folded(self):
        from quiltor.modules.assistant.batch import foldable_proposals

        open_one = _brandt("new:b", "Herr Brandt")
        plain = _brandt("new:n", "Neue Figur")
        hanging = {
            "kind": "create_relationship",
            "relationship": {"from": "new:b", "to": "oda", "label": "kennt"},
        }
        result = {
            "proposals": [open_one, plain, hanging],
            "proposalEnvelopes": [
                {"proposal": open_one, "resolution": {"outcome": "ambiguous"}},
                {"proposal": plain, "resolution": {"outcome": "create"}},
                {"proposal": hanging},
            ],
        }
        self.assertEqual(foldable_proposals(result), [plain])


NAMES = [f"{first} {last}" for first in ("Alma", "Bruno", "Cilly", "Detlef", "Edda", "Fritjof")
         for last in ("Berg", "Kahl", "Dorn", "Ruh", "Lomb")]  # fmt: skip


def _cut_reply(names: list[str]) -> str:
    """A reply as WebLLM wrote it: proposals first, the list running on until the limit."""
    items = [
        json.dumps(_brandt(f"new:{index}", name), ensure_ascii=False)
        for index, name in enumerate(names)
    ]
    return '{"proposals": [' + ", ".join(items) + ', {"kind": "create_el'


class CutAtLimitTests(unittest.TestCase):
    def cut_runtime(self, content: str):
        runtime, inference = _helper().relay(0.9)

        def cut(payload):
            inference.calls.append(payload)
            raise IncompleteInferenceResponse(content, "length")

        inference.invoke = cut
        return runtime, inference

    def test_parts_cut_at_their_limit_keep_their_whole_proposals(self):
        manuscript, chapter_id, _ = marked_chapter(11000)
        runtime, inference = self.cut_runtime(_cut_reply(NAMES))
        result = runtime.complete(
            EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
        )
        # Every part was cut, one call each, no growth and no repair (seven or more in a row).
        self.assertGreaterEqual(len(inference.calls), 7)
        self.assertEqual(len({call["max_tokens"] for call in inference.calls}), 1)
        names = {p["element"]["name"] for p in result["proposals"]}
        self.assertEqual(names, set(NAMES[:EXTRACTION_PART_PROPOSALS]))

    def test_a_cut_reply_without_a_whole_proposal_still_fails(self):
        manuscript, chapter_id, _ = marked_chapter(300)
        runtime, _ = self.cut_runtime('{"proposals": [{"kind": "create_el')
        with self.assertRaises(InferenceValidationError):
            runtime.complete(
                EXTRACTION, manuscript, FIGURES, chapter_ids=[chapter_id], mode="world_extraction"
            )

    def test_only_an_extraction_answer_is_read_after_a_cut(self):
        from quiltor.modules.assistant.schemas import json_schema_format, reply_schema

        runtime, _ = self.cut_runtime(_cut_reply(NAMES[:3]))
        chat = {
            "messages": [],
            "max_tokens": 900,
            "response_format": json_schema_format(reply_schema()),
        }
        with self.assertRaises(IncompleteInferenceResponse):
            runtime._invoke(chat)
        extraction = json_schema_format(reply_schema(proposals_first=True))
        extraction.trim_proposals = EXTRACTION_PART_PROPOSALS
        kept = runtime._invoke({**chat, "response_format": extraction})
        self.assertEqual([p["element"]["name"] for p in kept["proposals"]], NAMES[:3])

    def test_a_cut_chat_reply_is_not_read(self):
        from quiltor.modules.assistant.schema_check import leading_proposals

        self.assertEqual(leading_proposals('{"message": "a", "proposals": [{"kind": "x"}'), [])
        self.assertEqual(leading_proposals(_cut_reply(NAMES[:2]))[1]["tempId"], "new:1")


if __name__ == "__main__":
    unittest.main()
