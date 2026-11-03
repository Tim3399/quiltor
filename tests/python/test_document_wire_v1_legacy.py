"""The strictly typed v1 document wire answers exactly as the one before T-19 did.

Both versions decode every envelope in `contracts/fixtures`, every variant of the three
differential fixtures, every case of `test_document_wire_v1_branches`, and every world,
manuscript and Storyboard case of the validator tests wrapped in an envelope. An answer is
the decoded envelope, or the exception with its message, `reason` and `field`.

The frozen copy imports the current domain validators, so this test guards
`document_wire_v1.py` alone; P2 and P4 guard the validators themselves. T-19 P12 deletes
this test together with `tests/python/legacy`.
"""

from __future__ import annotations

import copy
import json
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, get_args

from quiltor.application import document_wire_v1 as current
from quiltor.application.document_wire_v1 import DocumentKind
from tests.python.legacy import document_wire_v1_2894c0f as legacy
from tests.python.test_document_wire_v1_branches import ACCEPTANCES, CONTRACTS, REJECTIONS
from tests.python.test_story_world_validation_branches import (
    FIGURE_ACCEPTANCES,
    FIGURE_REJECTIONS,
    MANUSCRIPT_ACCEPTANCES,
    MANUSCRIPT_REJECTIONS,
    figures,
    manuscript,
)
from tests.python.test_storyboard_model import ACCEPTANCES as STORYBOARD_ACCEPTANCES
from tests.python.test_storyboard_model import REJECTIONS as STORYBOARD_REJECTIONS
from tests.python.test_storyboard_model import build as storyboard_build
from tests.python.test_storyboard_model_legacy import apply_pointer

FIXTURES = Path(__file__).parents[2] / "contracts" / "fixtures"
KINDS: tuple[DocumentKind, ...] = get_args(DocumentKind)
DIFFERENTIAL = {
    "manuscript": "application-api/manuscript/differential.v1.json",
    "figures": "application-api/story-world/differential.v1.json",
    "storyboards": "application-api/storyboards/differential.v1.json",
}


def answer(module: Any, kind: DocumentKind, value: object) -> tuple[object, ...]:
    try:
        decoded = module.decode_document_v1(kind, copy.deepcopy(value))
    except Exception as error:  # an exception is part of the answer
        return (
            "raised",
            type(error).__name__,
            str(error),
            getattr(error, "reason", None),
            getattr(error, "field", None),
        )
    return "returned", decoded.kind, decoded.revision, decoded.to_mapping()


def envelopes(value: Any, path: str = "") -> Iterator[tuple[str, Any]]:
    """Every object in a fixture that carries a `contract` and a `payload`."""

    if isinstance(value, dict):
        if "contract" in value and "payload" in value:
            yield path, value
        for key, item in value.items():
            yield from envelopes(item, f"{path}/{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from envelopes(item, f"{path}/{index}")


def differential_envelopes(kind: DocumentKind) -> Iterator[tuple[str, Any]]:
    spec = json.loads((FIXTURES / DIFFERENTIAL[kind]).read_text(encoding="utf-8"))
    base = json.loads((FIXTURES.parent / spec["baseFixture"]).read_text(encoding="utf-8"))
    for presence in spec["optionalPresence"]:
        for mode in ("absent", "null"):
            wire = copy.deepcopy(base)
            for extra in presence.get("alsoRemove", []) if mode == "absent" else []:
                apply_pointer(wire, extra, "remove")
            yield (
                f"{presence['id']}-{mode}",
                apply_pointer(wire, presence["path"], "remove" if mode == "absent" else "set"),
            )
    for case in spec["cases"]:
        yield (
            case["id"],
            apply_pointer(copy.deepcopy(base), case["path"], case["operation"], case.get("value")),
        )


def wrapped(kind: DocumentKind, payload: object) -> dict[str, object]:
    return {"contract": CONTRACTS[kind], "version": 1, "payload": payload}


def built(build: Callable[[], dict[str, Any]], case: Callable[[dict[str, Any]], object]) -> Any:
    payload = build()
    case(payload)
    return payload


class LegacyDocumentWireTests(unittest.TestCase):
    def assert_same_answer(self, name: str, kind: DocumentKind, value: object) -> None:
        with self.subTest(case=name, kind=kind):
            self.assertEqual(answer(current, kind, value), answer(legacy, kind, value))

    def test_every_envelope_in_the_contract_fixtures_as_every_kind(self) -> None:
        found = [
            (f"{path.relative_to(FIXTURES).as_posix()}#{pointer}", envelope)
            for path in sorted(FIXTURES.rglob("*.json"))
            for pointer, envelope in envelopes(json.loads(path.read_text(encoding="utf-8")))
        ]
        self.assertGreaterEqual(len(found), 5)
        for name, envelope in found:
            for kind in KINDS:
                self.assert_same_answer(name, kind, envelope)

    def test_every_variant_of_the_differential_fixtures(self) -> None:
        for kind in KINDS:
            variants = list(differential_envelopes(kind))
            self.assertGreater(len(variants), 40)
            for name, envelope in variants:
                self.assert_same_answer(name, kind, envelope)

    def test_every_wire_rejection_and_acceptance(self) -> None:
        for name, (kind, build, _reason, _field) in REJECTIONS.items():
            self.assert_same_answer(name, kind, build())
        for name, (kind, build) in ACCEPTANCES.items():
            self.assert_same_answer(name, kind, build())

    def test_every_validator_case_inside_an_envelope(self) -> None:
        for name, case in {**FIGURE_REJECTIONS, **FIGURE_ACCEPTANCES}.items():
            self.assert_same_answer(name, "figures", wrapped("figures", built(figures, case)))
        for name, case in {**MANUSCRIPT_REJECTIONS, **MANUSCRIPT_ACCEPTANCES}.items():
            self.assert_same_answer(
                name, "manuscript", wrapped("manuscript", built(manuscript, case))
            )
        for name, mutate in {**STORYBOARD_REJECTIONS, **STORYBOARD_ACCEPTANCES}.items():
            self.assert_same_answer(
                name, "storyboards", wrapped("storyboards", storyboard_build(mutate))
            )

    def test_encode_agrees_too(self) -> None:
        for name, (kind, build) in ACCEPTANCES.items():
            envelope = build()
            assert isinstance(envelope, dict)
            payload, revision = envelope["payload"], envelope.get("revision")
            with self.subTest(case=name):
                self.assertEqual(
                    current.encode_document_v1(kind, copy.deepcopy(payload), revision),
                    legacy.encode_document_v1(kind, copy.deepcopy(payload), revision),
                )

    def test_the_legacy_copy_still_refuses_every_rejection(self) -> None:
        # Guards the comparison itself: a copy that accepted everything would agree with a
        # rewrite that accepted everything.
        for name, (kind, build, reason, field) in REJECTIONS.items():
            with self.subTest(case=name):
                self.assertEqual(answer(legacy, kind, build())[3:], (reason, field))


if __name__ == "__main__":
    unittest.main()
