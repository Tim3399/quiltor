"""The strictly typed world validators decide exactly as the ones before T-19 did.

Both versions see every figure state and every manuscript in `contracts/fixtures` and every
case of `test_story_world_validation_branches`. Their answers must agree, and an exception
counts as an answer. T-19 P12 deletes this test together with `tests/python/legacy`.
"""

from __future__ import annotations

import copy
import json
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from quiltor.domain.story_world.validation import valid_figures, valid_manuscript
from tests.python.legacy.story_world_validation_2894c0f import (
    valid_figures as legacy_valid_figures,
)
from tests.python.legacy.story_world_validation_2894c0f import (
    valid_manuscript as legacy_valid_manuscript,
)
from tests.python.test_story_world_validation_branches import (
    FIGURE_ACCEPTANCES,
    FIGURE_REJECTIONS,
    MANUSCRIPT_ACCEPTANCES,
    MANUSCRIPT_REJECTIONS,
    figures,
    manuscript,
)

CONTRACTS = Path(__file__).parents[2] / "contracts"

type Validator = Callable[[Any], bool]


def documents(value: Any, keys: tuple[str, ...], path: str = "") -> Iterator[tuple[str, Any]]:
    """Every object in a fixture that carries all of `keys`, with its JSON pointer."""

    if isinstance(value, dict):
        if all(key in value for key in keys):
            yield path, value
        for key, item in value.items():
            yield from documents(item, keys, f"{path}/{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from documents(item, keys, f"{path}/{index}")


def fixture_documents(keys: tuple[str, ...]) -> list[tuple[str, Any]]:
    return [
        (f"{path.relative_to(CONTRACTS).as_posix()}#{pointer}", document)
        for path in sorted((CONTRACTS / "fixtures").rglob("*.json"))
        for pointer, document in documents(json.loads(path.read_text(encoding="utf-8")), keys)
    ]


def answer(validator: Validator, document: Any) -> tuple[str, object]:
    try:
        return "returned", validator(copy.deepcopy(document))
    except Exception as error:  # an exception is part of the answer
        return "raised", type(error).__name__


def built(build: Callable[[], dict[str, Any]], case: Callable[[dict[str, Any]], object]) -> Any:
    payload = build()
    case(payload)
    return payload


class LegacyWorldValidatorTests(unittest.TestCase):
    def assert_same_answer(
        self, name: str, current: Validator, legacy: Validator, document: Any
    ) -> None:
        with self.subTest(case=name):
            self.assertEqual(answer(current, document), answer(legacy, document))

    def test_every_figure_state_in_the_contract_fixtures(self) -> None:
        found = fixture_documents(("nodes", "edges"))
        self.assertGreaterEqual(len(found), 5)
        for name, document in found:
            self.assert_same_answer(name, valid_figures, legacy_valid_figures, document)

    def test_every_manuscript_in_the_contract_fixtures(self) -> None:
        found = fixture_documents(("chapters",))
        self.assertGreaterEqual(len(found), 5)
        for name, document in found:
            self.assert_same_answer(name, valid_manuscript, legacy_valid_manuscript, document)

    def test_every_figure_rejection_and_acceptance(self) -> None:
        for name, case in {**FIGURE_REJECTIONS, **FIGURE_ACCEPTANCES}.items():
            self.assert_same_answer(name, valid_figures, legacy_valid_figures, built(figures, case))

    def test_every_manuscript_rejection_and_acceptance(self) -> None:
        for name, case in {**MANUSCRIPT_REJECTIONS, **MANUSCRIPT_ACCEPTANCES}.items():
            self.assert_same_answer(
                name, valid_manuscript, legacy_valid_manuscript, built(manuscript, case)
            )

    def test_a_node_that_is_not_an_object_is_now_rejected_instead_of_raising(self) -> None:
        # The one deliberate difference: the old place-level check called `.get` on every
        # node before any node was validated.
        for node in ("ada", 5, None, ["ada"]):
            with self.subTest(node=node):
                document = figures()
                document["nodes"].append(node)
                self.assertEqual(
                    answer(legacy_valid_figures, document), ("raised", "AttributeError")
                )
                self.assertEqual(answer(valid_figures, document), ("returned", False))

    def test_the_legacy_copy_still_refuses_every_rejection(self) -> None:
        # Guards the comparison itself: a copy that accepted everything would agree with a
        # rewrite that accepted everything.
        for name, case in FIGURE_REJECTIONS.items():
            with self.subTest(case=name):
                self.assertFalse(legacy_valid_figures(built(figures, case)))
        for name, case in MANUSCRIPT_REJECTIONS.items():
            with self.subTest(case=name):
                self.assertFalse(legacy_valid_manuscript(built(manuscript, case)))


if __name__ == "__main__":
    unittest.main()
