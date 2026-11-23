"""A figure named by one part of its name is that figure, or a choice (T-344, D-243, D-244).

"Oda", "Frau Brandt", "Kapitänin Estrand" and "Wenke" name figures of the test world that
the extraction must not create again. A part shared by two figures is kept as a proposal of
its own with both as candidates, for the author to choose; nothing is created until then,
and the other proposals of the reply stay. Other types are found by their full name only.
"""

from __future__ import annotations

import copy
import unittest
from typing import Any

from quiltor.domain.story_world.name_parts import name_part_owners, without_address
from quiltor.modules.assistant.proposal_resolution import resolve_proposals
from tests.python.test_assistant_budget import EXTRACTION, CompletionBudgetTests
from tests.python.test_world_selection import manuscript, test_world


def figures() -> dict[str, Any]:
    return copy.deepcopy(test_world()["figures"])


def with_karl(world: dict[str, Any]) -> dict[str, Any]:
    world["nodes"].append({"id": "x-karl", "type": "person", "name": "Karl Brandt"})
    return world


def create(temp: str, name: str, kind: str = "person") -> dict[str, Any]:
    return {"kind": "create_element", "tempId": temp, "element": {"type": kind, "name": name}}


def relationship(source: str, target: str) -> dict[str, Any]:
    return {
        "kind": "create_relationship",
        "relationship": {
            "from": source,
            "to": target,
            "label": "verwaltet",
            "directed": True,
            "lineStyle": "solid",
            "relationshipKind": "general",
            "color": "auto",
        },
    }


class NamePartTests(unittest.TestCase):
    def test_a_form_of_address_is_not_a_name(self):
        self.assertEqual(without_address("Frau Brandt"), "Brandt")
        self.assertEqual(without_address("Kapitänin Estrand"), "Estrand")
        self.assertEqual(without_address("Frau"), "Frau")

    def test_a_part_names_the_figure_it_belongs_to(self):
        nodes = figures()["nodes"]
        for mention, owner in (
            ("Oda", "oda"),
            ("Frau Brandt", "oda"),
            ("Kapitänin Estrand", "x-jorun"),
            ("Wenke", "x-wenke"),
        ):
            with self.subTest(mention=mention):
                self.assertEqual(name_part_owners(nodes, mention, "person"), [owner])

    def test_only_figures_have_name_parts(self):
        nodes = figures()["nodes"]
        self.assertEqual(name_part_owners(nodes, "Gilde", "organisation"), [])
        self.assertEqual(name_part_owners(nodes, "Kai", "ort"), [])
        # A figure's part never names a place either.
        self.assertNotIn("x-long-place", name_part_owners(nodes, "Kai", "person"))


class NamePartResolutionTests(unittest.TestCase):
    def test_a_name_part_of_one_figure_creates_nothing(self):
        for mention in ("Oda", "Frau Brandt", "Kapitänin Estrand", "Wenke"):
            with self.subTest(mention=mention):
                result = resolve_proposals(
                    [create("new:a", mention)], figures(), keep_ambiguous=True
                )
                self.assertEqual(
                    [item for item in result.proposals if item["kind"] == "create_element"], []
                )
                self.assertIn(result.decisions[0].outcome, {"existing", "unchanged", "update"})

    def test_a_place_or_organisation_never_takes_a_figure_by_its_name_part(self):
        # "Brandt" as an organisation (a trading house, say) is not Oda Brandt.
        result = resolve_proposals(
            [create("new:h", "Brandt", "organisation")], figures(), keep_ambiguous=True
        )
        self.assertEqual([item["kind"] for item in result.proposals], ["create_element"])

    def test_a_new_full_name_is_a_new_element(self):
        result = resolve_proposals([create("new:a", "Oda Lind")], figures(), keep_ambiguous=True)
        self.assertEqual([item["kind"] for item in result.proposals], ["create_element"])

    def test_a_part_of_another_type_is_a_new_element(self):
        result = resolve_proposals(
            [create("new:g", "Gilde", "organisation"), create("new:k", "Kai", "ort")],
            figures(),
            keep_ambiguous=True,
        )
        self.assertEqual([item["kind"] for item in result.proposals], ["create_element"] * 2)

    def test_a_shared_part_is_kept_with_its_candidates_and_creates_nothing_yet(self):
        world = with_karl(figures())
        result = resolve_proposals(
            [create("new:b", "Herr Brandt"), relationship("new:b", "x-wenke")],
            world,
            keep_ambiguous=True,
        )
        self.assertIsNone(result.clarification)
        kinds = [item["kind"] for item in result.proposals]
        self.assertEqual(kinds, ["create_element", "create_relationship"])
        self.assertEqual(
            sorted(item["id"] for item in result.ambiguous["new:b"]), ["oda", "x-karl"]
        )
        # What hangs on the ambiguous element keeps pointing at it until the author chooses.
        self.assertEqual(result.proposals[1]["relationship"]["from"], "new:b")

    def test_an_ambiguous_proposal_leaves_the_others_standing(self):
        # Probe C2 of the critic: two places called "Nordhafen" in the test world.
        proposals = [
            create("new:ilka", "Ilka Kornatz"),
            create("new:hafen", "Nordhafen", "ort"),
            create("new:speicher", "Kornspeicher am Nordkai", "ort"),
        ]
        result = resolve_proposals(proposals, figures(), keep_ambiguous=True)
        self.assertEqual(
            [item["tempId"] for item in result.proposals],
            ["new:ilka", "new:hafen", "new:speicher"],
        )
        self.assertEqual(len(result.ambiguous["new:hafen"]), 2)

    def test_a_chat_question_still_asks_back(self):
        world = with_karl(figures())
        result = resolve_proposals([create("new:b", "Herr Brandt")], world)
        self.assertIsNotNone(result.clarification)
        self.assertEqual(result.proposals, [])


class AmbiguousEnvelopeTests(CompletionBudgetTests):
    def test_the_extraction_reply_offers_the_candidates(self):
        world = with_karl(figures())
        reply = {
            "message": "ok",
            "citations": [],
            "proposals": [create("new:ilka", "Ilka Kornatz"), create("new:b", "Herr Brandt")],
        }
        runtime, _ = self.runtime(*[reply] * 10, tokens_per_char=0.25)
        result = runtime.complete(
            EXTRACTION, manuscript(), world, chapter_ids=["c-arrival"], mode="world_extraction"
        )
        envelopes = {item["proposal"].get("tempId"): item for item in result["proposalEnvelopes"]}
        self.assertIn("new:ilka", envelopes)
        resolution = envelopes["new:b"]["resolution"]
        self.assertEqual(resolution["outcome"], "ambiguous")
        self.assertEqual(sorted(item["id"] for item in resolution["candidates"]), ["oda", "x-karl"])
        self.assertNotIn("clarification", result)


if __name__ == "__main__":
    unittest.main()
