"""Reaches every decision of resolve-before-create, before the module was typed (T-19 P6).

Each case asks one `ensure_*` function about one candidate against the same small world
and names the outcome and proof status the assistant receives. The table is shared with
the differential test, which asks the frozen old module the same questions.

Three guards (`_node` finding nothing for an id the resolver just returned, and a
resolved result without an id) cannot be reached through the real resolver; they are
pinned with a patched resolver in `UnreachableGuardTests`.
"""

from __future__ import annotations

import unittest
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from quiltor.domain.story_world import resolve_before_create as module
from quiltor.domain.story_world.resolve_before_create import (
    EnsureDecision,
    ResolutionProof,
    StaleResolutionProof,
    WorldResolutionContext,
    build_resolution_context,
    ensure_alias,
    require_current_world_revision,
)

REVISION = 3


def world() -> dict[str, Any]:
    return {
        "nodes": [
            {"id": "ada", "name": "Ada Lovelace", "type": "person", "aliases": [{"alias": "Ada"}]},
            {"id": "ben", "name": "Benedikt", "type": "person", "label": "Ben"},
            {"id": "hafen", "name": "Hafen", "type": "ort"},
            {"id": "turm", "name": "Leuchtturm", "type": "ort"},
            {"id": "z1", "name": "Zwilling", "type": "person"},
            {"id": "z2", "name": "Zwilling", "type": "person"},
            "kein Knoten",
        ],
        "edges": [
            {"id": "e1", "from": "ada", "to": "ben", "directed": False, "label": "kennt"},
            {"id": "e2", "from": "ben", "to": "hafen"},
            {"id": "e3", "from": "hafen", "to": "ben"},
            {"from": "ada", "to": "turm"},
            {"id": "e4", "from": "ben", "to": "turm", "directed": True},
            "keine Kante",
        ],
        "timeline": [
            {"id": "m1", "title": "Sturm", "time": 5, "date": "Herbst"},
            {"id": "m2", "title": "Fest"},
            {"id": "m3", "title": "Fest"},
            {"title": "Ohne Kennung"},
            {"id": "m4", "title": "Ernte", "date": "Spätsommer"},
            "kein Moment",
        ],
        "presence": [
            {"id": "p1", "elementId": "ada", "placeId": "hafen", "momentId": "m1"},
            {"id": "p2", "elementId": "ben", "placeId": "hafen"},
            {"id": "p3", "elementId": "ben", "placeId": "turm"},
            {"elementId": "hafen", "placeId": "turm"},
            "keine Anwesenheit",
        ],
    }


# name -> (function, candidate, keyword arguments, outcome, proof status, resolved id)
CASES: dict[str, tuple[str, object, dict[str, Any], str, str, str | None]] = {
    # elements
    "element not a mapping": ("ensure_element", "Ada", {}, "invalid", "invalid", None),
    "element without name": ("ensure_element", {"type": "person"}, {}, "invalid", "invalid", None),
    "element with a blank name": ("ensure_element", {"name": "  "}, {}, "invalid", "invalid", None),
    "element aliases not a list": (
        "ensure_element",
        {"name": "Clara", "aliases": "Cl"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element alias a number": (
        "ensure_element",
        {"name": "Clara", "aliases": [5]},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element alias blank": (
        "ensure_element",
        {"name": "Clara", "aliases": [" "]},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element alias source unknown": (
        "ensure_element",
        {"name": "Clara", "aliases": [{"alias": "Cl", "source": "rumour"}]},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element alias source not a string": (
        "ensure_element",
        {"name": "Clara", "aliases": [{"alias": "Cl", "source": 1}]},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element type unknown": (
        "ensure_element",
        {"name": "Clara", "type": "drache"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element type not a string": (
        "ensure_element",
        {"name": "Clara", "type": 1},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "element name shared by two": (
        "ensure_element",
        {"name": "Zwilling"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "element name and alias name two others": (
        "ensure_element",
        {"name": "Ada Lovelace", "aliases": ["Benedikt"]},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "new element": (
        "ensure_element",
        {"name": " Clara ", "aliases": ["Cl", {"alias": "Clärchen", "source": "manuscript"}]},
        {},
        "create",
        "not_found",
        None,
    ),
    "new place": (
        "ensure_element",
        {"name": "Mole", "type": "ort"},
        {},
        "create",
        "not_found",
        None,
    ),
    "known element by name": (
        "ensure_element",
        {"name": "Ada Lovelace"},
        {},
        "existing",
        "resolved",
        "ada",
    ),
    "known element by alias": (
        "ensure_element",
        {"name": "Ada"},
        {},
        "existing",
        "resolved",
        "ada",
    ),
    "known element with the same label": (
        "ensure_element",
        {"name": "Benedikt", "label": "Ben"},
        {},
        "existing",
        "resolved",
        "ben",
    ),
    "known element with a new label": (
        "ensure_element",
        {"name": "Benedikt", "label": "Benni", "pinned": True},
        {},
        "update",
        "resolved",
        "ben",
    ),
    "type filter excludes the person": (
        "ensure_element",
        {"name": "Ada Lovelace", "type": "ort"},
        {},
        "create",
        "not_found",
        None,
    ),
    # relationships
    "relationship not a mapping": (
        "ensure_relationship",
        ["ada", "ben"],
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship from blank": (
        "ensure_relationship",
        {"from": " ", "to": "ben"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship to missing": (
        "ensure_relationship",
        {"from": "ada"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship from a number": (
        "ensure_relationship",
        {"from": 5, "to": "ben"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship directed a string": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "directed": "yes"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship label a number": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "label": 1},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship style unknown": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "style": "wavy"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship style not a string": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "style": 1},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship endpoint ambiguous": (
        "ensure_relationship",
        {"from": "Zwilling", "to": "ben"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "relationship endpoint unknown": (
        "ensure_relationship",
        {"from": "ada", "to": "Niemand"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "relationship to itself": (
        "ensure_relationship",
        {"from": "Ada Lovelace", "to": "Ada"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "new relationship": (
        "ensure_relationship",
        {"from": "ada", "to": "hafen", "label": "lebt am"},
        {},
        "create",
        "not_found",
        None,
    ),
    "new directed relationship beside an undirected one": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "directed": True},
        {},
        "create",
        "not_found",
        None,
    ),
    "relationship matching two edges": (
        "ensure_relationship",
        {"from": "hafen", "to": "ben"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "relationship matching an edge without id": (
        "ensure_relationship",
        {"from": "turm", "to": "ada"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "known directed relationship": (
        "ensure_relationship",
        {"from": "ben", "to": "turm", "directed": True},
        {},
        "unchanged",
        "resolved",
        "e4",
    ),
    "directed relationship the other way round": (
        "ensure_relationship",
        {"from": "turm", "to": "ben", "directed": True},
        {},
        "create",
        "not_found",
        None,
    ),
    "known relationship either way round": (
        "ensure_relationship",
        {"from": "ben", "to": "ada", "label": "kennt"},
        {},
        "unchanged",
        "resolved",
        "e1",
    ),
    "known relationship without details": (
        "ensure_relationship",
        {"from": "ada", "to": "ben"},
        {},
        "unchanged",
        "resolved",
        "e1",
    ),
    "known relationship with a new label": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "label": "liebt"},
        {},
        "update",
        "resolved",
        "e1",
    ),
    "known relationship with a new style": (
        "ensure_relationship",
        {"from": "ada", "to": "ben", "style": "gold"},
        {},
        "update",
        "resolved",
        "e1",
    ),
    # timeline moments
    "moment not a mapping": ("ensure_timeline_moment", "Sturm", {}, "invalid", "invalid", None),
    "moment date a number": (
        "ensure_timeline_moment",
        {"title": "Sturm", "date": 1},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment note a number": (
        "ensure_timeline_moment",
        {"title": "Sturm", "note": 1},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment time a string": (
        "ensure_timeline_moment",
        {"title": "Sturm", "time": "5"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment time unsafe": (
        "ensure_timeline_moment",
        {"title": "Sturm", "time": 2**53},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment end time a bool": (
        "ensure_timeline_moment",
        {"title": "Sturm", "endTime": True},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment ends before it starts": (
        "ensure_timeline_moment",
        {"title": "Sturm", "time": 5, "endTime": 4},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment precision unknown": (
        "ensure_timeline_moment",
        {"title": "Sturm", "precision": "week"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment precision not a string": (
        "ensure_timeline_moment",
        {"title": "Sturm", "precision": 1},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment end precision unknown": (
        "ensure_timeline_moment",
        {"title": "Sturm", "endPrecision": "hour"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment end precision not a string": (
        "ensure_timeline_moment",
        {"title": "Sturm", "endPrecision": []},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment by id unchanged": (
        "ensure_timeline_moment",
        {"id": "m1", "title": "Sturm"},
        {},
        "unchanged",
        "resolved",
        "m1",
    ),
    "moment by temp id updated": (
        "ensure_timeline_moment",
        {"tempId": " m1 ", "note": "Regen"},
        {},
        "update",
        "resolved",
        "m1",
    ),
    "moment unknown id without title": (
        "ensure_timeline_moment",
        {"id": "m9"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment without id and title": (
        "ensure_timeline_moment",
        {"note": "x"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "moment unknown id with a known title": (
        "ensure_timeline_moment",
        {"id": "m9", "title": "Sturm"},
        {},
        "unchanged",
        "resolved",
        "m1",
    ),
    "moment by title and time": (
        "ensure_timeline_moment",
        {"title": "sturm", "time": 5},
        {},
        "unchanged",
        "resolved",
        "m1",
    ),
    "moment by title with another time": (
        "ensure_timeline_moment",
        {"title": "Sturm", "time": 6},
        {},
        "create",
        "not_found",
        None,
    ),
    "moment by title and date": (
        "ensure_timeline_moment",
        {"title": "Ernte", "date": " Spätsommer "},
        {},
        "unchanged",
        "resolved",
        "m4",
    ),
    "moment by title with another date": (
        "ensure_timeline_moment",
        {"title": "Ernte", "date": "Winter"},
        {},
        "create",
        "not_found",
        None,
    ),
    "moment by title with a blank date": (
        "ensure_timeline_moment",
        {"title": "Ernte", "date": " "},
        {},
        "unchanged",
        "resolved",
        "m4",
    ),
    "moment by title with a new note": (
        "ensure_timeline_moment",
        {"title": "Ernte", "note": "Äpfel", "precision": "month", "endPrecision": "year"},
        {},
        "update",
        "resolved",
        "m4",
    ),
    "moment title shared by two": (
        "ensure_timeline_moment",
        {"title": "Fest"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "moment matching one without id": (
        "ensure_timeline_moment",
        {"title": "Ohne Kennung"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "new moment": (
        "ensure_timeline_moment",
        {"title": "Abreise", "time": 9, "endTime": 9},
        {},
        "create",
        "not_found",
        None,
    ),
    # presence
    "presence not a mapping": ("ensure_presence", None, {}, "invalid", "invalid", None),
    "presence element blank": (
        "ensure_presence",
        {"elementId": "", "placeId": "hafen"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "presence place missing": (
        "ensure_presence",
        {"elementId": "ada"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "presence element a number": (
        "ensure_presence",
        {"elementId": 1, "placeId": "hafen"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "presence moment blank": (
        "ensure_presence",
        {"elementId": "ada", "placeId": "hafen", "momentId": " "},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "presence element ambiguous": (
        "ensure_presence",
        {"elementId": "Zwilling", "placeId": "hafen"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "presence place is no place": (
        "ensure_presence",
        {"elementId": "ada", "placeId": "Benedikt"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "presence moment unknown": (
        "ensure_presence",
        {"elementId": "ada", "placeId": "hafen", "momentId": "m9"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "new presence": (
        "ensure_presence",
        {"elementId": "ben", "placeId": "turm", "momentId": "m1"},
        {},
        "create",
        "not_found",
        None,
    ),
    "presence matching two rows": (
        "ensure_presence",
        {"elementId": "ben", "placeId": "hafen"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "presence matching a row without id": (
        "ensure_presence",
        {"elementId": "hafen", "placeId": "turm"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "known presence": (
        "ensure_presence",
        {"elementId": "Ada", "placeId": "Hafen", "momentId": "m1"},
        {},
        "unchanged",
        "resolved",
        "p1",
    ),
    "known presence moved": (
        "ensure_presence",
        {"elementId": "ada", "placeId": "turm", "momentId": "m1"},
        {},
        "update",
        "resolved",
        "p1",
    ),
    # aliases
    "alias not a mapping": ("ensure_alias", "Ada", {}, "invalid", "invalid", None),
    "alias owner blank": (
        "ensure_alias",
        {"elementId": " ", "alias": "Adi"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "alias blank": (
        "ensure_alias",
        {"elementId": "ada", "alias": ""},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "alias source unknown": (
        "ensure_alias",
        {"elementId": "ada", "alias": "Adi", "source": "rumour"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "alias source not a string": (
        "ensure_alias",
        {"elementId": "ada", "alias": "Adi", "source": None},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "alias owner ambiguous": (
        "ensure_alias",
        {"elementId": "Zwilling", "alias": "Zwei"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "alias owner unknown": (
        "ensure_alias",
        {"elementId": "Niemand", "alias": "Keiner"},
        {},
        "invalid",
        "invalid",
        None,
    ),
    "new alias": (
        "ensure_alias",
        {"elementId": "ada", "alias": "Gräfin", "source": "assistant"},
        {},
        "create",
        "not_found",
        None,
    ),
    "alias already shared by two": (
        "ensure_alias",
        {"elementId": "ada", "alias": "Zwilling"},
        {},
        "ambiguous",
        "ambiguous",
        None,
    ),
    "alias the owner already has": (
        "ensure_alias",
        {"elementId": "ada", "alias": "Ada"},
        {},
        "unchanged",
        "resolved",
        "ada",
    ),
    "alias naming another entity": (
        "ensure_alias",
        {"elementId": "ada", "alias": "Benedikt"},
        {},
        "existing",
        "resolved",
        "ben",
    ),
    "alias for a place is checked among places": (
        "ensure_alias",
        {"elementId": "hafen", "alias": "Benedikt"},
        {},
        "create",
        "not_found",
        None,
    ),
}


def decide(target: Any, name: str) -> Any:
    function, candidate, options, *_ = CASES[name]
    context = target.build_resolution_context(world(), REVISION)
    return getattr(target, function)(context, candidate, **options)


def summary(decision: Any) -> tuple[object, ...]:
    """Every observable field of a decision, so two modules' classes compare."""

    proof = decision.proof
    return (
        decision.operation,
        decision.outcome,
        decision.operation_satisfied,
        decision.resolved_id,
        decision.canonical,
        proof.checked,
        proof.status,
        proof.mention,
        proof.candidate_ids,
        proof.world_revision,
    )


class DecisionTests(unittest.TestCase):
    def test_every_case_reaches_its_outcome(self) -> None:
        for name, (_function, _candidate, _options, outcome, status, resolved) in CASES.items():
            with self.subTest(name):
                decision = decide(module, name)
                self.assertEqual(
                    (decision.outcome, decision.proof.status, decision.resolved_id),
                    (outcome, status, resolved),
                )
                self.assertEqual(decision.proof.world_revision, REVISION)
                self.assertEqual(
                    decision.operation_satisfied,
                    outcome in {"existing", "unchanged"} and name != "alias naming another entity",
                )

    def test_canonical_payloads(self) -> None:
        self.assertEqual(
            decide(module, "new element").canonical,
            {
                "name": "Clara",
                "aliases": [
                    {"alias": "Cl", "source": "manual"},
                    {"alias": "Clärchen", "source": "manuscript"},
                ],
                "type": "person",
            },
        )
        self.assertEqual(
            decide(module, "known element with a new label").canonical,
            {"id": "ben", "name": "Benedikt", "type": "person", "label": "Benni", "pinned": True},
        )
        self.assertEqual(
            decide(module, "new relationship").canonical,
            {"from": "ada", "to": "hafen", "directed": False, "label": "lebt am", "style": "solid"},
        )
        self.assertEqual(
            decide(module, "known relationship with a new label").canonical,
            {"id": "e1", "from": "ada", "to": "ben", "label": "liebt"},
        )
        self.assertEqual(
            decide(module, "known presence moved").canonical,
            {"id": "p1", "elementId": "ada", "placeId": "turm", "momentId": "m1"},
        )
        self.assertEqual(
            decide(module, "alias already shared by two").canonical,
            {"elementId": "ada", "alias": "Zwilling", "source": "manual"},
        )

    def test_mentions_and_candidates(self) -> None:
        self.assertEqual(
            decide(module, "relationship endpoint ambiguous").proof.candidate_ids,
            ("ben", "z1", "z2"),
        )
        self.assertEqual(decide(module, "relationship from a number").proof.mention, "")
        self.assertEqual(decide(module, "new relationship").proof.mention, "ada -> hafen")
        self.assertEqual(decide(module, "new presence").proof.mention, "ben @ turm [m1]")
        self.assertEqual(decide(module, "presence matching two rows").proof.mention, "ben @ hafen")
        self.assertEqual(
            decide(module, "presence matching two rows").proof.candidate_ids, ("p2", "p3")
        )
        self.assertEqual(decide(module, "presence element a number").proof.mention, "")
        self.assertEqual(decide(module, "moment unknown id without title").proof.mention, "m9")
        self.assertEqual(
            decide(module, "relationship matching two edges").proof.candidate_ids, ("e2", "e3")
        )


class ContextTests(unittest.TestCase):
    def test_revisions_must_be_safe_non_negative_integers(self) -> None:
        for revision in (-1, True, 2**53, "3", 3.0):
            with self.subTest(revision=revision):
                with self.assertRaises(ValueError) as caught:
                    build_resolution_context(world(), revision)  # pyright: ignore[reportArgumentType]
                self.assertEqual(
                    str(caught.exception), "world_revision must be a non-negative safe integer"
                )
                with self.assertRaises(ValueError):
                    WorldResolutionContext({}, revision)  # pyright: ignore[reportArgumentType]

    def test_the_world_must_be_a_mapping(self) -> None:
        with self.assertRaises(TypeError) as caught:
            build_resolution_context([], REVISION)  # pyright: ignore[reportArgumentType]
        self.assertEqual(str(caught.exception), "story_world must be a mapping")
        with self.assertRaises(TypeError) as caught:
            WorldResolutionContext([], REVISION)  # pyright: ignore[reportArgumentType]
        self.assertEqual(str(caught.exception), "story_world must be a mapping snapshot")

    def test_collections_must_be_lists(self) -> None:
        for key, collection in (
            ("nodes", "elements"),
            ("edges", "relationships"),
            ("timeline", "moments"),
            ("presence", "presence"),
        ):
            with self.subTest(key=key), self.assertRaises(TypeError) as caught:
                build_resolution_context({key: {}}, REVISION)
            self.assertEqual(str(caught.exception), f"story_world {collection} must be a list")
        self.assertEqual(
            build_resolution_context({}, REVISION).story_world,
            {"nodes": [], "edges": [], "timeline": [], "presence": []},
        )

    def test_staged_entries_must_be_mappings_with_an_identity(self) -> None:
        with self.assertRaises(TypeError) as caught:
            build_resolution_context({}, REVISION, staged_elements=["Ada"])  # pyright: ignore[reportArgumentType]
        self.assertEqual(str(caught.exception), "staged elements entries must be mappings")
        for options, collection in (
            ({"staged_elements": [{"name": "Clara"}]}, "elements"),
            ({"staged_moments": [{"title": "Fest", "tempId": " "}]}, "moments"),
            ({"staged_relationships": [{"from": "ada", "to": 5}]}, "relationships"),
            (
                {"staged_relationships": [{"from": "ada", "to": "ben", "directed": "ja"}]},
                "relationships",
            ),
            ({"staged_presence": [{"elementId": "ada", "momentId": 5}]}, "presence"),
            ({"staged_presence": [{"elementId": None}]}, "presence"),
        ):
            with self.subTest(options=options), self.assertRaises(ValueError) as caught:
                build_resolution_context({}, REVISION, **options)
            self.assertEqual(
                str(caught.exception), f"staged {collection} entries need a stable id or tempId"
            )

    def test_staged_proposals_are_folded_into_the_view(self) -> None:
        context = build_resolution_context(
            world(),
            REVISION,
            staged_elements=[
                {
                    "tempId": "t-clara",
                    "element": {"name": "Clara", "aliases": ["Cl", {"alias": "C"}]},
                },
                {"element": {"id": "ben", "name": "Benno"}},
            ],
            staged_relationships=[
                {"relationship": {"from": "ada", "to": "hafen"}},
                {"from": "turm", "to": "ada", "directed": True},
            ],
            staged_moments=[{"moment": {"id": "m5", "title": "Abreise"}}],
            staged_presence=[{"elementId": "ben", "placeId": "turm", "momentId": None}],
        )
        nodes = context.story_world["nodes"]
        self.assertEqual(nodes[1], {"id": "ben", "name": "Benno"})
        self.assertEqual(
            nodes[-1],
            {
                "name": "Clara",
                "aliases": [{"alias": "Cl", "source": "assistant"}, {"alias": "C"}],
                "tempId": "t-clara",
                "id": "t-clara",
            },
        )
        edges = context.story_world["edges"]
        undirected, directed = edges[-2], edges[-1]
        self.assertEqual(undirected["directed"], False)
        self.assertTrue(undirected["id"].startswith("staged:relationships:"))
        self.assertNotEqual(undirected["id"], directed["id"])
        self.assertEqual(
            build_resolution_context(
                {}, REVISION, staged_relationships=[{"from": "hafen", "to": "ada"}]
            ).story_world["edges"][0]["id"],
            undirected["id"],
        )
        self.assertEqual(context.story_world["timeline"][-1], {"id": "m5", "title": "Abreise"})
        self.assertTrue(context.story_world["presence"][-1]["id"].startswith("staged:presence:"))
        self.assertEqual(
            world()["nodes"][1], {"id": "ben", "name": "Benedikt", "type": "person", "label": "Ben"}
        )
        self.assertEqual(
            ensure_alias(context, {"elementId": "Clara", "alias": "Cl"}).outcome,
            "unchanged",
        )


class ProofTests(unittest.TestCase):
    def test_proofs_cannot_be_forged(self) -> None:
        with self.assertRaises(TypeError) as caught:
            ResolutionProof(True, "resolved", "Ada", ("ada",), REVISION, object())
        self.assertEqual(
            str(caught.exception), "resolution proofs can only be created by the domain resolver"
        )
        decision = decide(module, "known element by name")
        for forged in (
            {"checked": True, "status": "resolved", "world_revision": REVISION},
            SimpleNamespace(**{**decision.proof.__dict__})
            if hasattr(decision.proof, "__dict__")
            else object(),
            None,
        ):
            with self.subTest(forged=type(forged).__name__), self.assertRaises(TypeError) as caught:
                require_current_world_revision(forged, REVISION)  # pyright: ignore[reportArgumentType]
            self.assertEqual(
                str(caught.exception), "an authoritative in-process resolution proof is required"
            )

    def test_a_proof_must_match_the_current_revision(self) -> None:
        proof = decide(module, "known element by name").proof
        require_current_world_revision(proof, REVISION)
        with self.assertRaises(StaleResolutionProof) as caught:
            require_current_world_revision(proof, REVISION + 1)
        self.assertEqual(
            (caught.exception.checked_revision, caught.exception.current_revision), (3, 4)
        )
        self.assertEqual(
            str(caught.exception), "resolution checked world revision 3, current revision is 4"
        )
        with self.assertRaises(ValueError):
            require_current_world_revision(proof, -1)


class UnreachableGuardTests(unittest.TestCase):
    """Guards the real resolver never triggers, pinned with a patched resolver."""

    def patched(self, result: Callable[..., Any]) -> Any:
        return patch.object(module, "resolve_entity", side_effect=result)

    @staticmethod
    def resolved(identifier: str | None) -> Any:
        return SimpleNamespace(status="resolved", resolved_id=identifier, candidates=[])

    def test_an_element_resolved_to_an_unknown_node_is_invalid(self) -> None:
        context = build_resolution_context(world(), REVISION)
        with self.patched(lambda *_args, **_kwargs: self.resolved("ghost")):
            decision: EnsureDecision = module.ensure_element(context, {"name": "Ada Lovelace"})
        self.assertEqual((decision.outcome, decision.proof.status), ("invalid", "invalid"))

    def test_endpoints_resolved_without_an_id_are_invalid(self) -> None:
        context = build_resolution_context(world(), REVISION)
        with self.patched(lambda *_args, **_kwargs: self.resolved(None)):
            relationship = module.ensure_relationship(context, {"from": "ada", "to": "ben"})
            presence = module.ensure_presence(context, {"elementId": "ada", "placeId": "hafen"})
            alias = module.ensure_alias(context, {"elementId": "ada", "alias": "Adi"})
        for decision in (relationship, presence, alias):
            self.assertEqual((decision.outcome, decision.proof.status), ("invalid", "invalid"))

    def test_an_alias_owner_missing_from_the_nodes_is_invalid(self) -> None:
        context = build_resolution_context(world(), REVISION)
        with self.patched(lambda *_args, **_kwargs: self.resolved("ghost")):
            decision = module.ensure_alias(context, {"elementId": "ada", "alias": "Adi"})
        self.assertEqual((decision.outcome, decision.proof.status), ("invalid", "invalid"))


if __name__ == "__main__":
    unittest.main()
