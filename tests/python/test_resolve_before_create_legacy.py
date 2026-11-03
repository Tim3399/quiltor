"""The strictly typed resolve-before-create decides exactly as the one before T-19 did.

Both versions answer every case of `test_resolve_before_create_branches`, with and without
staged proposals folded into the view, and build the same resolver view from the same
staged input. An answer is every field of the decision, or the exception with its message.
T-19 P12 deletes this test together with `tests/python/legacy`.
"""

from __future__ import annotations

import copy
import unittest
from typing import Any

from quiltor.domain.story_world import resolve_before_create as current
from tests.python.legacy import resolve_before_create_2894c0f as legacy
from tests.python.test_resolve_before_create_branches import CASES, REVISION, summary, world

STAGED: dict[str, Any] = {
    "staged_elements": [
        {"tempId": "t-clara", "element": {"name": "Clara", "aliases": ["Cl"]}},
        {"element": {"id": "ben", "name": "Benno", "type": "person"}},
    ],
    "staged_relationships": [
        {"relationship": {"from": "ada", "to": "hafen"}},
        {"from": "turm", "to": "ada", "directed": True},
    ],
    "staged_moments": [{"moment": {"id": "m5", "title": "Abreise", "time": 9}}],
    "staged_presence": [{"elementId": "ben", "placeId": "turm", "momentId": "m1"}],
}

BAD_CONTEXTS: list[tuple[object, object, dict[str, Any]]] = [
    ([], REVISION, {}),
    ({}, -1, {}),
    ({}, True, {}),
    ({"nodes": {}}, REVISION, {}),
    ({}, REVISION, {"staged_elements": ["Ada"]}),
    ({}, REVISION, {"staged_elements": [{"name": "Clara"}]}),
    ({}, REVISION, {"staged_relationships": [{"from": "ada", "to": 5}]}),
    ({}, REVISION, {"staged_presence": [{"elementId": "ada", "momentId": 5}]}),
]


def answer(
    target: Any, function: str, candidate: object, options: dict[str, Any], staged: dict[str, Any]
) -> tuple[object, ...]:
    try:
        context = target.build_resolution_context(world(), REVISION, **copy.deepcopy(staged))
        decision = getattr(target, function)(context, copy.deepcopy(candidate), **options)
    except Exception as error:  # an exception is part of the answer
        return "raised", type(error).__name__, str(error)
    return "returned", summary(decision)


def view(
    target: Any, story_world: object, revision: object, staged: dict[str, Any]
) -> tuple[object, ...]:
    try:
        context = target.build_resolution_context(
            copy.deepcopy(story_world), revision, **copy.deepcopy(staged)
        )
    except Exception as error:  # an exception is part of the answer
        return "raised", type(error).__name__, str(error)
    return "returned", context.story_world, context.world_revision


class LegacyResolveBeforeCreateTests(unittest.TestCase):
    def test_every_case_with_and_without_staged_proposals(self) -> None:
        for staged_name, staged in (("plain", {}), ("staged", STAGED)):
            for name, (function, candidate, options, *_rest) in CASES.items():
                with self.subTest(case=name, view=staged_name):
                    self.assertEqual(
                        answer(current, function, candidate, options, staged),
                        answer(legacy, function, candidate, options, staged),
                    )

    def test_the_resolver_view_and_its_refusals(self) -> None:
        cases: list[tuple[object, object, dict[str, Any]]] = [
            (world(), REVISION, STAGED),
            *BAD_CONTEXTS,
        ]
        for story_world, revision, staged in cases:
            with self.subTest(
                world=type(story_world).__name__, revision=revision, staged=sorted(staged)
            ):
                self.assertEqual(
                    view(current, story_world, revision, staged),
                    view(legacy, story_world, revision, staged),
                )

    def test_proofs_are_checked_alike(self) -> None:
        for target in (current, legacy):
            with self.subTest(module=target.__name__):
                context = target.build_resolution_context(world(), REVISION)
                proof = target.ensure_element(context, {"name": "Ada Lovelace"}).proof
                target.require_current_world_revision(proof, REVISION)
                with self.assertRaises(target.StaleResolutionProof):
                    target.require_current_world_revision(proof, REVISION + 1)
                with self.assertRaises(TypeError):
                    target.require_current_world_revision(object(), REVISION)

    def test_the_legacy_copy_still_answers_the_characterised_outcomes(self) -> None:
        # Guards the comparison itself: a copy that answered everything alike would agree
        # with a rewrite that did too.
        for name, (function, candidate, options, outcome, status, resolved) in CASES.items():
            with self.subTest(case=name):
                result = answer(legacy, function, candidate, options, {})
                decision = result[1]
                assert isinstance(decision, tuple)
                self.assertEqual(
                    (decision[1], decision[6], decision[3]), (outcome, status, resolved)
                )


if __name__ == "__main__":
    unittest.main()
