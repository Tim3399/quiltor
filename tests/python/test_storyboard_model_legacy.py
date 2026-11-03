"""The strictly typed Storyboard validator decides exactly as the one before T-19 did.

Both versions see every Storyboard document in `contracts/fixtures`, every variant the
contract's differential fixture describes, and every case of `test_storyboard_model`. Their
answers must agree. T-19 P12 deletes this test together with `tests/python/legacy`.
"""

from __future__ import annotations

import copy
import json
import unittest
from collections.abc import Iterator
from typing import Any

from quiltor.domain.storyboard.model import valid_storyboard_document
from tests.python.legacy.storyboard_model_2894c0f import (
    valid_storyboard_document as legacy_valid_storyboard_document,
)
from tests.python.test_storyboard_model import (
    ACCEPTANCES,
    CONTRACTS,
    REJECTIONS,
    STORYBOARD_FIXTURES,
    build,
)


def storyboard_documents(value: Any, path: str = "") -> Iterator[tuple[str, Any]]:
    """Every object in a fixture that carries `boards`, with its JSON pointer."""

    if isinstance(value, dict):
        if "boards" in value:
            yield path, value
        for key, item in value.items():
            yield from storyboard_documents(item, f"{path}/{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from storyboard_documents(item, f"{path}/{index}")


def apply_pointer(document: Any, pointer: str, operation: str, value: Any = None) -> Any:
    keys = [key.replace("~1", "/").replace("~0", "~") for key in pointer.split("/")[1:]]
    if not keys:
        return value
    container = document
    for key in keys[:-1]:
        container = container[int(key) if isinstance(container, list) else key]
    last: Any = int(keys[-1]) if isinstance(container, list) else keys[-1]
    if operation == "remove":
        del container[last]
    else:
        container[last] = value
    return document


def differential_payloads() -> Iterator[tuple[str, Any]]:
    """The payload of every variant in the contract's differential fixture."""

    spec = json.loads((STORYBOARD_FIXTURES / "differential.v1.json").read_text(encoding="utf-8"))
    base = json.loads((CONTRACTS / spec["baseFixture"]).read_text(encoding="utf-8"))
    for presence in spec["optionalPresence"]:
        for mode in ("absent", "null"):
            wire = copy.deepcopy(base)
            for extra in presence.get("alsoRemove", []) if mode == "absent" else []:
                apply_pointer(wire, extra, "remove")
            wire = apply_pointer(wire, presence["path"], "remove" if mode == "absent" else "set")
            yield (
                f"{presence['id']}-{mode}",
                wire.get("payload") if isinstance(wire, dict) else wire,
            )
    for case in spec["cases"]:
        wire = apply_pointer(
            copy.deepcopy(base), case["path"], case["operation"], case.get("value")
        )
        yield case["id"], wire.get("payload") if isinstance(wire, dict) else wire


class LegacyStoryboardValidatorTests(unittest.TestCase):
    def assert_same_answer(self, name: str, document: Any) -> None:
        with self.subTest(case=name):
            expected = legacy_valid_storyboard_document(copy.deepcopy(document))
            self.assertEqual(valid_storyboard_document(copy.deepcopy(document)), expected)

    def test_every_storyboard_document_in_the_contract_fixtures(self):
        documents = [
            (f"{path.relative_to(CONTRACTS).as_posix()}#{pointer}", document)
            for path in sorted((CONTRACTS / "fixtures").rglob("*.json"))
            for pointer, document in storyboard_documents(
                json.loads(path.read_text(encoding="utf-8"))
            )
        ]
        self.assertGreaterEqual(len(documents), 3)
        for name, document in documents:
            self.assert_same_answer(name, document)

    def test_every_variant_of_the_differential_fixture(self):
        variants = list(differential_payloads())
        self.assertGreater(len(variants), 40)
        for name, document in variants:
            self.assert_same_answer(name, document)

    def test_every_rejection_and_near_miss(self):
        for name, mutate in {**REJECTIONS, **ACCEPTANCES}.items():
            self.assert_same_answer(name, build(mutate))

    def test_the_legacy_copy_still_refuses_every_rejection(self):
        # Guards the comparison itself: a copy that accepted everything would agree with a
        # rewrite that accepted everything.
        for name, mutate in REJECTIONS.items():
            with self.subTest(case=name):
                self.assertFalse(legacy_valid_storyboard_document(build(mutate)))


if __name__ == "__main__":
    unittest.main()
