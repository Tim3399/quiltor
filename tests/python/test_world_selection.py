"""The world state of an extraction in a large world (T-344): chosen, not refused.

The world is the test world (base and check part, with the long chapters x-kettenwache and
x-siegel of T-355), grown to 170 elements with relationships, moments and presence in the
proportion of the example world (D-243, F-344-3). The counters are the four of the budget
tests: llama-like (0.343 per character, measured on Qwen3), the server's chars / 3, and the
relay at calibrations 0.9 and 1.3.
"""

from __future__ import annotations

import copy
import json
import math
import random
import re
import subprocess
import unittest
from functools import cache
from pathlib import Path
from typing import Any

from quiltor.domain.story_world.knowledge import chapter_parts
from quiltor.modules.assistant.world_selection import (
    SELECTED_WORLD_HEADER,
    moment_window,
)
from tests.python.test_assistant_budget import EXTRACTION, CompletionBudgetTests

ROOT = Path(__file__).resolve().parents[2]
COUNTERS = {
    "llama-like": 0.343,
    "server": 1 / 3,
    "relay 0.9": 0.9 * 1.1 / 3,
    "relay 1.3": 1.3 * 1.1 / 3,
}
RELAY = COUNTERS["relay 0.9"]
REPLY = {"message": "ok", "citations": [], "proposals": []}
FIRST_NAMES = [
    "Ansgar",
    "Bente",
    "Cord",
    "Dörte",
    "Eilert",
    "Femke",
    "Gesche",
    "Hauke",
    "Imke",
    "Jasper",
    "Kea",
    "Lüder",
    "Merle",
    "Nantke",
    "Ocke",
    "Petra",
    "Reemt",
    "Silke",
    "Thore",
    "Ulla",
    "Vollrath",
    "Wiebke",
    "Ysker",
    "Zenja",
    "Alke",
    "Broder",
    "Fenna",
    "Gerrit",
    "Hilke",
    "Jelto",
]
LAST_NAMES = [
    "Albers",
    "Bruns",
    "Carstens",
    "Dirks",
    "Eden",
    "Folkerts",
    "Gerdes",
    "Hinrichs",
    "Ihnen",
    "Janssen",
    "Krüger",
    "Lüpkes",
    "Mammen",
    "Nannen",
    "Onken",
    "Poppinga",
    "Rademacher",
    "Siebels",
    "Tammen",
    "Ubben",
    "Voss",
    "Wübbena",
]
PLACES = [
    "Lotsenhaus",
    "Ankerplatz",
    "Tranbrennerei",
    "Seilerbahn",
    "Zollkate",
    "Netzboden",
    "Krabbenkutterhafen",
    "Deichschleuse",
    "Sielhafen",
    "Fischmarkt",
    "Leuchtfeuer",
    "Kornboden",
    "Teerhof",
    "Bootsschuppen",
    "Salzspeicher",
    "Ruderclub",
    "Glockenturm",
    "Kaimauer",
    "Werftgasse",
    "Muschelbank",
]


@cache
def test_world() -> dict[str, Any]:
    """The test world, base and check part, in German, as the JavaScript module builds it."""
    script = (
        "import('./tests/world/index.mjs').then((m) => process.stdout.write(JSON.stringify("
        "m.buildExampleWorld('de', { include: ['base', 'edge'] }))))"
    )
    out = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    return json.loads(out)


def grown_world(size: int) -> dict[str, Any]:
    """The test world's figures grown to ``size`` elements, with 0.9 relationships, 0.5
    moments and 0.5 presence entries per element, deterministically."""
    figures = copy.deepcopy(test_world()["figures"])
    rng = random.Random(344)
    nodes = figures["nodes"]
    # Single names first; double names only once those are used up (pop takes from the end).
    doubled = [f"{one}-{two}" for one in LAST_NAMES for two in LAST_NAMES if one != two]
    single = [f"{first} {last}" for last in LAST_NAMES for first in FIRST_NAMES]
    double = [f"{first} {last}" for last in doubled for first in FIRST_NAMES]
    rng.shuffle(single)
    rng.shuffle(double)
    names = double + single
    places = [f"{place} {last}" for last in LAST_NAMES for place in PLACES]
    more_places = [f"{place} {last}" for last in doubled for place in PLACES]
    rng.shuffle(places)
    rng.shuffle(more_places)
    places = more_places + places
    index = 0
    while len(nodes) < size:
        if index % 4 == 3:
            name, kind = places.pop(), "ort"
        else:
            name, kind = names.pop(), "person"
        nodes.append(
            {
                "id": f"g-{index:04d}",
                "type": kind,
                "name": name,
                "label": "Hafenvolk" if kind == "person" else "Ort am Hafen",
                "profile": {
                    "notes": f"{name} gehört zum Hafen. "
                    + rng.choice(
                        (
                            "Kennt die Gezeiten besser als die Lotsen.",
                            "Schuldet der Gilde noch zwei Fässer Tran.",
                            "Sah die Kette zuletzt bei Nipptide.",
                            "Führt Buch über jedes Schiff, das einläuft.",
                        )
                    )
                },
                "x": 40 + index,
                "y": 40 + index,
            }
        )
        index += 1
    timeline = figures["timeline"]
    position = len(timeline)
    while len(timeline) < math.ceil(0.5 * size):
        timeline.append(
            {
                "id": f"g-t{position:03d}",
                "title": f"Tide {position}",
                "time": 30 + position,
                "position": position,
            }
        )
        position += 1
    people = [node["id"] for node in nodes if node.get("type") in {"person", "tier"}]
    sites = [node["id"] for node in nodes if node.get("type") == "ort"]
    moments = [moment["id"] for moment in timeline]
    edges = figures["edges"]
    number = 0
    while len(edges) < math.ceil(0.9 * size):
        source, goal = rng.sample(people, 2)
        edges.append(
            {
                "id": f"g-e{number:04d}",
                "from": source,
                "to": goal,
                "label": rng.choice(("kennt", "misstraut", "arbeitet mit", "schuldet")),
                "directed": True,
            }
        )
        number += 1
    presence = figures.setdefault("presence", [])
    number = 0
    while len(presence) < math.ceil(0.5 * size):
        presence.append(
            {
                "id": f"g-p{number:04d}",
                "elementId": rng.choice(people),
                "placeId": rng.choice(sites),
                "momentId": rng.choice(moments),
            }
        )
        number += 1
    return figures


def manuscript() -> dict[str, Any]:
    return copy.deepcopy(test_world()["manuscript"])


def world_of(content: str) -> dict[str, Any]:
    """The world state a prompt carried."""
    head, _, rest = content.partition(":\n")
    world, _, _ = rest.partition("\n\nRAG CONTEXT (content excerpts only):\n")
    state = json.loads(world)
    state["_header"] = head
    return state


def carried(content: str) -> str:
    """The manuscript text a prompt carried."""
    _, _, rest = content.partition("\n\nRAG CONTEXT (content excerpts only):\n")
    packed, _, _ = rest.partition("\n\nTASK CONTRACT:\n")
    return "\n".join(str(chunk.get("text") or "") for chunk in json.loads(packed))


def figures_in(text: str, nodes: list[dict[str, Any]]) -> set[str]:
    """An independent probe (after the critic's mention_probe): a figure occurs when its
    name, an alias, or a word of its name of three letters or more appears as a word."""
    found = set()
    # The longest complete name wins (entity_mentions' rule): "Lotsenhaus Bruns" is a place,
    # so the "Bruns" inside it names no figure. Full names of every element are taken out
    # of the text first; figures found by their full name count.
    full_names = sorted(
        {str(node.get("name") or "") for node in nodes if node.get("name")}, key=len, reverse=True
    )
    for name in full_names:
        pattern = rf"(?<!\w){re.escape(name)}(?:s)?(?!\w)"
        if re.search(pattern, text, re.I):
            found.update(
                node["id"]
                for node in nodes
                if node.get("name") == name and node.get("type") in {"person", "tier"}
            )
            text = re.sub(pattern, " ", text, flags=re.I)
    for node in nodes:
        if node.get("type") not in {"person", "tier"}:
            continue
        surfaces = [node.get("name") or ""] + [
            item.get("alias") for item in node.get("aliases") or [] if isinstance(item, dict)
        ]
        words = [
            word
            for surface in surfaces
            # A word as the selection reads it: a hyphenated name ("Ihnen-Nannen") is one word.
            for word in re.findall(r"[^\W\d_][\w'-]*", str(surface))
            if len(word) >= 3 and word.casefold() not in {"der", "die", "das", "von", "und"}
        ]
        for surface in [*surfaces, *words]:
            if surface and re.search(rf"(?<!\w){re.escape(surface)}(?:s)?(?!\w)", text, re.I):
                found.add(node["id"])
                break
    return found


class WorldSelectionTests(CompletionBudgetTests):
    def extract(self, figures: dict[str, Any], chapter_id: str, per_char: float = RELAY):
        runtime, inference = self.runtime(*[REPLY] * 60, tokens_per_char=per_char)
        result = runtime.complete(
            EXTRACTION, manuscript(), figures, chapter_ids=[chapter_id], mode="world_extraction"
        )
        return result, inference

    def prompts(self, inference: Any) -> list[str]:
        return [call["messages"][-1]["content"] for call in inference.calls]

    def test_the_grown_world_reaches_the_model_on_every_counter(self):
        figures = grown_world(170)
        for label, per_char in COUNTERS.items():
            for chapter_id in ("x-siegel", "x-kettenwache"):
                with self.subTest(counter=label, chapter=chapter_id):
                    result, inference = self.extract(figures, chapter_id, per_char)
                    self.assertGreater(len(inference.calls), 0)
                    body = next(
                        c["body"] for c in manuscript()["chapters"] if c["id"] == chapter_id
                    )
                    expected = {
                        f"chapter:{chapter_id}:{i}" for i in range(len(chapter_parts(body)))
                    }
                    sent = {
                        paragraph
                        for step in result["agentTrace"]
                        if step.get("step") == "extraction_sent"
                        for chunk in step["chunks"]
                        for paragraph in chunk["paragraphs"]
                    }
                    self.assertEqual(expected - sent, set())
                    for content in self.prompts(inference):
                        self.assertTrue(
                            world_of(content)["_header"].startswith(SELECTED_WORLD_HEADER)
                        )

    def test_every_figure_a_part_names_is_written_out_in_that_part(self):
        figures = grown_world(170)
        for label, per_char in COUNTERS.items():
            for chapter_id in ("x-siegel", "x-kettenwache"):
                with self.subTest(counter=label, chapter=chapter_id):
                    _, inference = self.extract(figures, chapter_id, per_char)
                    for content in self.prompts(inference):
                        named = figures_in(carried(content), figures["nodes"])
                        shown = {item["id"] for item in world_of(content).get("elements") or []}
                        self.assertEqual(named - shown, set())

    def test_every_element_of_the_grown_world_is_in_the_register(self):
        # On the counters a real run has (llama, server, relay at its measured 0.9). At the
        # worst relay calibration 1.3 the register is cut by relevance instead; see the next
        # test. A whole register there would leave x-kettenwache more parts than allowed.
        figures = grown_world(170)
        for label, per_char in COUNTERS.items():
            if label == "relay 1.3":
                continue
            with self.subTest(counter=label):
                _, inference = self.extract(figures, "x-siegel", per_char)
                for content in self.prompts(inference):
                    state = world_of(content)
                    listed = {
                        entry.split(" (")[0]
                        for names in state["register"].values()
                        for entry in names.split("; ")
                    }
                    self.assertEqual({node["name"] for node in figures["nodes"]} - listed, set())
                    self.assertNotIn("register", state.get("omitted") or {})

    def test_at_the_worst_calibration_the_register_is_cut_by_relevance(self):
        figures = grown_world(170)
        _, inference = self.extract(figures, "x-kettenwache", COUNTERS["relay 1.3"])
        names = {node["id"]: node["name"] for node in figures["nodes"]}
        for content in self.prompts(inference):
            state = world_of(content)
            listed = {
                entry.split(" (")[0]
                for names_ in state["register"].values()
                for entry in names_.split("; ")
            }
            written = {item["name"] for item in state.get("elements") or []}
            named = figures_in(carried(content), figures["nodes"])
            self.assertEqual({names[ident] for ident in named} - listed - written, set())
            if (state.get("omitted") or {}).get("register"):
                # Entries, not names: the test world has two places called "Nordhafen".
                entries = sum(len(names_.split("; ")) for names_ in state["register"].values())
                self.assertEqual(entries + state["omitted"]["register"], len(figures["nodes"]))

    def test_the_number_of_calls_stays_within_half_again_of_a_small_world(self):
        figures = grown_world(170)
        for chapter_id, limit in (("x-siegel", 8), ("x-kettenwache", 11)):
            with self.subTest(chapter=chapter_id):
                _, inference = self.extract(figures, chapter_id)
                self.assertLessEqual(len(inference.calls), limit)

    def test_a_relationship_between_two_named_figures_is_in_the_prompt(self):
        figures = grown_world(170)
        _, inference = self.extract(figures, "x-kettenwache")
        for content in self.prompts(inference):
            state = world_of(content)
            shown = {item["id"] for item in state.get("elements") or []}
            relationships = {item["id"] for item in state.get("relationships") or []}
            between = {
                edge["id"]
                for edge in figures["edges"]
                if edge["from"] in shown and edge["to"] in shown
            }
            self.assertEqual(between - relationships, set())
        self.assertTrue(any(world_of(c).get("relationships") for c in self.prompts(inference)))

    def test_the_time_window_holds_the_span_of_the_chapter(self):
        figures = grown_world(170)
        _, inference = self.extract(figures, "x-kettenwache")
        for content in self.prompts(inference):
            moments = {item["id"] for item in world_of(content).get("timeline") or []}
            # The span is t5 .. x-t4; ordered by day, x-t4 is its end.
            self.assertTrue({"t5", "x-t1", "x-t2", "x-t3", "x-t4"} <= moments, moments)

    def test_a_chapter_without_story_time_takes_the_anchor_before_it(self):
        figures = grown_world(170)
        chapters = manuscript()
        # c-crossing has no storyTime; c-break before it starts at t6.
        self.assertEqual(
            moment_window(figures, chapters, ["c-crossing"]),
            moment_window(figures, chapters, ["c-break"]),
        )
        stripped = copy.deepcopy(chapters)
        for chapter in stripped["chapters"]:
            chapter.pop("storyTime", None)
        self.assertEqual(moment_window(figures, stripped, ["c-crossing"]), [])

    def test_the_window_is_ordered_by_day_not_by_position(self):
        figures = test_world()["figures"]
        window = moment_window(figures, manuscript(), ["x-kettenwache"])
        # By position x-t1 .. x-t4 come after t8; by day they lie between t5 and t6.
        self.assertLess(window.index("x-t4"), window.index("t7"))

    def test_presence_of_a_named_figure_in_the_window_is_in_the_prompt(self):
        figures = grown_world(170)
        _, inference = self.extract(figures, "x-kettenwache")
        for content in self.prompts(inference):
            state = world_of(content)
            shown = {item["id"] for item in state.get("elements") or []}
            window = {item["id"] for item in state.get("timeline") or []}
            expected = {
                entry["id"]
                for entry in figures["presence"]
                if entry["elementId"] in shown and entry.get("momentId") in window
            }
            listed = {item["id"] for item in state.get("presence") or []}
            self.assertEqual(expected - listed, set())

    def test_omitted_counts_what_is_not_shown(self):
        figures = grown_world(170)
        _, inference = self.extract(figures, "x-siegel")
        for content in self.prompts(inference):
            state = world_of(content)
            omitted = state.get("omitted") or {}
            self.assertEqual(
                omitted.get("relationships", 0),
                len(figures["edges"]) - len(state.get("relationships") or []),
            )
            self.assertEqual(
                omitted.get("timeline", 0),
                len(figures["timeline"]) - len(state.get("timeline") or []),
            )
            self.assertEqual(
                omitted.get("presence", 0),
                len(figures["presence"]) - len(state.get("presence") or []),
            )

    def test_a_thousand_elements_still_reach_the_model_with_the_register_cut_by_relevance(self):
        figures = grown_world(1000)
        _, inference = self.extract(figures, "x-siegel")
        self.assertGreater(len(inference.calls), 0)
        for content in self.prompts(inference):
            state = world_of(content)
            self.assertGreater((state.get("omitted") or {}).get("register", 0), 0)
            listed = {
                entry.split(" (")[0]
                for names in state["register"].values()
                for entry in names.split("; ")
            }
            named = figures_in(carried(content), figures["nodes"])
            names = {node["id"]: node["name"] for node in figures["nodes"]}
            written = {item["name"] for item in state.get("elements") or []}
            # Every figure the part names is visible: listed, or written out.
            self.assertEqual({names[ident] for ident in named} - listed - written, set())

    def test_names_are_parts_only_for_figures(self):
        from quiltor.modules.assistant.world_selection import mentioned_elements

        nodes = test_world()["figures"]["nodes"]
        found = mentioned_elements("Die Gilde tagte am Kai, und Oda schwieg.", nodes)
        self.assertIn("oda", found)
        self.assertNotIn("x-long-org", found)
        self.assertNotIn("x-long-place", found)


if __name__ == "__main__":
    unittest.main()
