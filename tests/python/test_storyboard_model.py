"""valid_storyboard_document accepts the contract fixtures and refuses every rejected shape.

Every `return False` in `quiltor.domain.storyboard.model` is reached by at least one case in
`REJECTIONS`, and so is every alternative of its compound conditions. Each case starts from
the contract's wire fixture and breaks exactly one rule. `ACCEPTANCES` pins the near misses on
the other side of those rules. `test_storyboard_model_legacy` runs both tables against the
pre-T-19 copy of the module as well.
"""

from __future__ import annotations

import copy
import json
import unittest
from collections.abc import Callable
from pathlib import Path
from typing import Any

from quiltor.domain.storyboard.model import (
    MAX_BOARDS,
    MAX_EDGES,
    MAX_ID_LENGTH,
    MAX_NODES,
    MAX_SAFE_INTEGER,
    MAX_TEXT_LENGTH,
    MAX_TITLE_LENGTH,
    default_storyboard_document,
    valid_storyboard_document,
)

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
STORYBOARD_FIXTURES = CONTRACTS / "fixtures" / "application-api" / "storyboards"

# Node positions in the wire fixture.
NOTE, REFERENCE, BOARD_LINK, GROUP = 0, 1, 2, 3

# A case changes the document in place, or returns a value that replaces it.
Mutation = Callable[[dict[str, Any]], Any]


def wire_payload() -> dict[str, Any]:
    fixture = json.loads((STORYBOARD_FIXTURES / "wire.v1.json").read_text(encoding="utf-8"))
    return fixture["payload"]


def build(mutate: Mutation) -> Any:
    """The wire fixture's payload after one case's change."""

    document = copy.deepcopy(wire_payload())
    replaced = mutate(document)
    return document if replaced is None else replaced


def nested_lists(depth: int) -> list[Any]:
    value: list[Any] = []
    for _ in range(depth):
        value = [value]
    return value


def _set(path: tuple[Any, ...], value: Any) -> Mutation:
    def mutate(document: dict[str, Any]) -> None:
        container: Any = document
        for key in path[:-1]:
            container = container[key]
        container[path[-1]] = value

    return mutate


def _remove(*path: Any) -> Mutation:
    def mutate(document: dict[str, Any]) -> None:
        container: Any = document
        for key in path[:-1]:
            container = container[key]
        del container[path[-1]]

    return mutate


def _steps(*mutations: Mutation) -> Mutation:
    def mutate(document: dict[str, Any]) -> None:
        for step in mutations:
            step(document)

    return mutate


def _without_text(index: int) -> Mutation:
    return _steps(
        _remove("nodes", index, "noteReferences"),
        _remove("nodes", index, "noteMarks"),
        _remove("nodes", index, "text"),
    )


def _note_reference(**changes: Any) -> Mutation:
    def mutate(document: dict[str, Any]) -> None:
        document["nodes"][NOTE]["noteReferences"][0].update(changes)

    return mutate


def _second_note_reference(**changes: Any) -> Mutation:
    def mutate(document: dict[str, Any]) -> None:
        node = document["nodes"][NOTE]
        node["text"] = "Mara and Ilan reach the archive."
        node["noteMarks"] = []
        second = {
            "id": "note-ref-ilan",
            "target": {"kind": "entity", "id": "ilan"},
            "from": 9,
            "to": 13,
            "surface": "Ilan",
        }
        second.update(changes)
        node["noteReferences"].append(second)

    return mutate


def _after_emoji(**changes: Any) -> Mutation:
    return _steps(
        _set(("nodes", NOTE, "text"), "\U0001f600 Mara"),
        _set(("nodes", NOTE, "noteMarks"), []),
        _note_reference(**changes),
    )


def _edge(**changes: Any) -> Mutation:
    def mutate(document: dict[str, Any]) -> None:
        document["edges"][0].update(changes)

    return mutate


def _duplicate_edge(document: dict[str, Any]) -> None:
    document["edges"].append(copy.deepcopy(document["edges"][0]))


def _reverse_note_references(document: dict[str, Any]) -> None:
    document["nodes"][NOTE]["noteReferences"].reverse()


# Each case breaks one rule; the comment names the `return False` it reaches on 2894c0f.
REJECTIONS: dict[str, Mutation] = {
    # valid_storyboard_document :99 (and _valid_json_value :308, :312, :317, :320)
    "document-not-an-object": lambda document: [document],
    "document-not-json-nan": _set(("nodes", NOTE, "x"), float("nan")),
    "document-not-json-infinity": _set(("extension",), float("inf")),
    "document-not-json-non-string-key": _set(("extension",), {1: "one"}),
    "document-not-json-tuple": _set(("extension",), ("a", "b")),
    "document-not-json-too-deep": _set(("extension",), nested_lists(101)),
    # :104
    "boards-not-a-list": _set(("boards",), {"main-storyboard": {}}),
    "boards-missing": _remove("boards"),
    "nodes-not-a-list": _set(("nodes",), None),
    "edges-not-a-list": _set(("edges",), "edge"),
    # :106
    "boards-empty": _set(("boards",), []),
    "boards-too-many": _set(("boards",), [{}] * (MAX_BOARDS + 1)),
    "nodes-too-many": _set(("nodes",), [{}] * (MAX_NODES + 1)),
    "edges-too-many": _set(("edges",), [{}] * (MAX_EDGES + 1)),
    # :117
    "board-not-an-object": _set(("boards", 1), "plot-board"),
    "board-id-missing": _remove("boards", 1, "id"),
    "board-id-empty": _set(("boards", 1, "id"), ""),
    "board-id-padded": _set(("boards", 1, "id"), " plot-board"),
    "board-id-too-long": _set(("boards", 1, "id"), "b" * (MAX_ID_LENGTH + 1)),
    "board-id-not-a-string": _set(("boards", 1, "id"), 7),
    "board-title-missing": _remove("boards", 1, "title"),
    "board-title-too-long": _set(("boards", 1, "title"), "t" * (MAX_TITLE_LENGTH + 1)),
    "board-id-duplicate": _set(("boards", 1, "id"), "main-storyboard"),
    # :124
    "node-id-duplicate": _set(("nodes", REFERENCE, "id"), "note-opening"),
    # :131
    "edge-id-duplicate": _duplicate_edge,
    # _valid_node :138
    "node-not-an-object": _set(("nodes", NOTE), ["note-opening"]),
    # :151
    "node-id-missing": _remove("nodes", NOTE, "id"),
    "node-id-padded": _set(("nodes", NOTE, "id"), "note-opening "),
    "node-board-id-missing": _remove("nodes", NOTE, "boardId"),
    "node-board-unknown": _set(("nodes", NOTE, "boardId"), "missing-board"),
    "node-kind-not-a-string": _set(("nodes", NOTE, "kind"), 1),
    "node-kind-unknown": _set(("nodes", NOTE, "kind"), "sticker"),
    "node-x-missing": _remove("nodes", NOTE, "x"),
    "node-x-string": _set(("nodes", NOTE, "x"), "120"),
    "node-x-bool": _set(("nodes", NOTE, "x"), True),
    "node-x-unsafe": _set(("nodes", NOTE, "x"), MAX_SAFE_INTEGER + 1),
    "node-y-missing": _remove("nodes", NOTE, "y"),
    "node-y-unsafe": _set(("nodes", NOTE, "y"), -float(MAX_SAFE_INTEGER) * 2),
    # :156
    "node-width-not-a-number": _set(("nodes", NOTE, "width"), None),
    "node-width-zero": _set(("nodes", NOTE, "width"), 0),
    "node-height-negative": _set(("nodes", NOTE, "height"), -1),
    "node-height-unsafe": _set(("nodes", NOTE, "height"), MAX_SAFE_INTEGER + 1),
    # :158
    "group-without-width": _remove("nodes", GROUP, "width"),
    "group-without-height": _remove("nodes", GROUP, "height"),
    # :161
    "node-z-index-float": _set(("nodes", NOTE, "zIndex"), 2.0),
    "node-z-index-bool": _set(("nodes", NOTE, "zIndex"), True),
    "node-z-index-null": _set(("nodes", NOTE, "zIndex"), None),
    "node-z-index-unsafe": _set(("nodes", NOTE, "zIndex"), -(MAX_SAFE_INTEGER + 1)),
    # :166
    "node-text-not-a-string": _set(("nodes", GROUP, "text"), ["Opening"]),
    "node-text-too-long": _set(("nodes", GROUP, "text"), "t" * (MAX_TEXT_LENGTH + 1)),
    # :170
    "node-label-not-a-string": _set(("nodes", GROUP, "label"), None),
    "node-label-too-long": _set(("nodes", GROUP, "label"), "l" * (MAX_TITLE_LENGTH + 1)),
    # :172
    "note-without-text": _without_text(NOTE),
    # :178, through _valid_target :192, :195, :201
    "reference-without-target": _remove("nodes", REFERENCE, "target"),
    "reference-target-not-an-object": _set(("nodes", REFERENCE, "target"), "mara"),
    "reference-target-kind-not-a-string": _set(("nodes", REFERENCE, "target", "kind"), None),
    "reference-target-kind-storyboard": _set(
        ("nodes", REFERENCE, "target"), {"kind": "storyboard", "id": "plot-board"}
    ),
    "reference-target-kind-unknown": _set(("nodes", REFERENCE, "target", "kind"), "weapon"),
    "reference-target-id-empty": _set(("nodes", REFERENCE, "target", "id"), ""),
    "reference-target-id-not-a-string": _set(("nodes", REFERENCE, "target", "id"), 4),
    # :181, through _valid_target :198
    "board-link-without-target": _remove("nodes", BOARD_LINK, "target"),
    "board-link-target-entity": _set(
        ("nodes", BOARD_LINK, "target"), {"kind": "entity", "id": "mara"}
    ),
    "board-link-target-id-padded": _set(("nodes", BOARD_LINK, "target", "id"), "plot-board "),
    "board-link-target-board-unknown": _set(("nodes", BOARD_LINK, "target", "id"), "lost-board"),
    # :183
    "note-with-target": _set(("nodes", NOTE, "target"), {"kind": "entity", "id": "mara"}),
    "group-with-target": _set(("nodes", GROUP, "target"), None),
    # :185, the note-marks half (the note-references half is :239 and below)
    "note-marks-invalid": _set(("nodes", NOTE, "noteMarks"), [{"kind": "bold", "from": 3}]),
    # _valid_edge :210
    "edge-not-an-object": _set(("edges", 0), "edge-note-to-mara"),
    # :215
    "edge-board-id-missing": _edge(boardId=None),
    "edge-source-id-empty": _edge(sourceNodeId=""),
    "edge-target-id-not-a-string": _edge(targetNodeId=1),
    # :218, the edge's final conjunction
    "edge-id-missing": _remove("edges", 0, "id"),
    "edge-board-unknown": _edge(boardId="lost-board"),
    "edge-source-unknown": _edge(sourceNodeId="lost-node"),
    "edge-target-unknown": _edge(targetNodeId="lost-node"),
    "edge-source-on-another-board": _set(("nodes", NOTE, "boardId"), "plot-board"),
    "edge-target-on-another-board": _set(("nodes", REFERENCE, "boardId"), "plot-board"),
    "edge-label-not-a-string": _edge(label=3),
    "edge-label-too-long": _edge(label="l" * (MAX_TITLE_LENGTH + 1)),
    "edge-directed-not-a-bool": _edge(directed=1),
    "edge-color-not-a-string": _edge(color=["gold"]),
    "edge-color-unknown": _edge(color="neon"),
    "edge-line-style-not-a-string": _edge(lineStyle=None),
    "edge-line-style-unknown": _edge(lineStyle="wavy"),
    # _valid_note_references :239
    "note-references-not-a-list": _set(("nodes", NOTE, "noteReferences"), None),
    "note-references-too-many": _set(("nodes", NOTE, "noteReferences"), [{}] * 10_001),
    # :249
    "note-reference-not-an-object": _set(("nodes", NOTE, "noteReferences", 0), "note-ref-mara"),
    # :268
    "note-reference-id-missing": _note_reference(id=None),
    "note-reference-id-duplicate": _second_note_reference(id="note-ref-mara"),
    "note-reference-target-invalid": _note_reference(target={"kind": "entity", "id": ""}),
    "note-reference-target-kind-unknown": _note_reference(target={"kind": "weapon", "id": "x"}),
    "note-reference-from-float": _note_reference(**{"from": 0.0}),
    "note-reference-to-bool": _note_reference(to=True),
    "note-reference-from-unsafe": _note_reference(**{"from": MAX_SAFE_INTEGER + 1}),
    "note-reference-to-unsafe": _note_reference(to=MAX_SAFE_INTEGER + 1),
    "note-reference-overlap": _second_note_reference(
        **{"from": 3, "to": 13, "surface": "a and Ilan"}
    ),
    "note-reference-empty-span": _note_reference(to=0),
    "note-reference-reversed-span": _note_reference(**{"from": 4, "to": 0}),
    "note-reference-surface-not-a-string": _note_reference(surface=None),
    "note-reference-surface-empty": _note_reference(surface=""),
    "note-reference-surface-too-long": _note_reference(surface="s" * (MAX_TITLE_LENGTH + 1)),
    # :270
    "note-reference-board-unknown": _set(
        ("nodes", BOARD_LINK, "noteReferences", 0, "target", "id"), "lost-board"
    ),
    # :273, through _utf16_offsets_to_indices
    "note-reference-surface-mismatch": _note_reference(surface="Mira"),
    "note-reference-beyond-text": _note_reference(**{"from": 30, "to": 34}),
    "note-reference-inside-surrogate-pair": _after_emoji(**{"from": 1, "to": 3}, surface=" "),
}

# Shapes that are valid although they sit close to a rejection, so a rewrite cannot tighten a
# rule unnoticed either.
ACCEPTANCES: dict[str, Mutation] = {
    "wire-fixture": lambda document: None,
    "empty-board": _steps(_set(("nodes",), []), _set(("edges",), [])),
    "unknown-fields-are-kept": _set(("nodes", NOTE, "futureField"), {"nested": [1, None]}),
    "json-depth-at-the-limit": _set(("extension",), nested_lists(99)),
    "node-without-optional-dimensions": _remove("nodes", NOTE, "width"),
    "node-z-index-at-the-limit": _set(("nodes", NOTE, "zIndex"), MAX_SAFE_INTEGER),
    "node-x-at-the-limit": _set(("nodes", NOTE, "x"), -MAX_SAFE_INTEGER),
    "board-title-empty": _set(("boards", 1, "title"), ""),
    "board-id-at-the-limit": _steps(
        _set(("boards", 1, "id"), "b" * MAX_ID_LENGTH),
        _set(("nodes", BOARD_LINK, "target", "id"), "b" * MAX_ID_LENGTH),
        _set(("nodes", BOARD_LINK, "noteReferences", 0, "target", "id"), "b" * MAX_ID_LENGTH),
    ),
    "reference-target-id-padded": _set(("nodes", REFERENCE, "target", "id"), " mara "),
    "reference-target-id-long": _set(
        ("nodes", REFERENCE, "target", "id"), "m" * (MAX_ID_LENGTH + 1)
    ),
    "group-without-text": _without_text(GROUP),
    "edge-defaults": _steps(
        *(_remove("edges", 0, key) for key in ("label", "directed", "color", "lineStyle"))
    ),
    "edge-directed-false": _edge(directed=False),
    "note-references-adjacent": _second_note_reference(**{"from": 4, "to": 8, "surface": " and"}),
    "note-references-unsorted": _steps(_second_note_reference(), _reverse_note_references),
    "note-reference-after-surrogate-pair": _after_emoji(**{"from": 3, "to": 7}),
}


class ValidStoryboardDocumentTests(unittest.TestCase):
    def test_the_default_document_is_valid(self):
        self.assertTrue(valid_storyboard_document(default_storyboard_document()))

    def test_every_storyboard_contract_fixture_is_valid(self):
        for path in ("default.v1.json", "wire.v1.json"):
            fixture = json.loads((STORYBOARD_FIXTURES / path).read_text(encoding="utf-8"))
            with self.subTest(path=path):
                self.assertTrue(valid_storyboard_document(fixture["payload"]))

    def test_every_near_miss_is_accepted(self):
        for name, mutate in ACCEPTANCES.items():
            with self.subTest(case=name):
                self.assertTrue(valid_storyboard_document(build(mutate)))

    def test_every_rejection_is_refused(self):
        for name, mutate in REJECTIONS.items():
            with self.subTest(case=name):
                self.assertFalse(valid_storyboard_document(build(mutate)))


if __name__ == "__main__":
    unittest.main()
