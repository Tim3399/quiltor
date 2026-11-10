"""Every finding and every skipped case of the story-world integrity check and knowledge index.

Characterisation before T-19 P5 types `integrity.py` and `knowledge.py` strictly: each
integrity finding is checked with its kind and the IDs it names, each `continue` and early
return with the case it skips, and each knowledge branch with the exact chunk it produces.
`test_story_world_integrity_knowledge_legacy` runs the same inputs against the copies of
both modules from before the rewrite.
"""

from __future__ import annotations

import copy
import unittest
from typing import Any, ClassVar

from quiltor.domain.story_world.integrity import (
    WorldValidation,
    presence_consistency_issues,
    validate_world,
)
from quiltor.domain.story_world.knowledge import (
    KnowledgeChunk,
    KnowledgeContextClass,
    build_knowledge,
    chapter_in_book,
    moment_order,
    retrieve,
    scoped_chapters,
)

TIMELINE = [
    {"id": "m1", "title": "Ankunft", "date": "1200-03-01"},
    {"id": "m2", "title": "Fest", "date": "1200-03-01"},
    {"id": "m3", "title": "Flucht", "date": "1200-02-20"},
    {"id": "m4", "title": "Rückkehr", "date": "1200-04-10"},
    {"id": "m5", "title": "Ohne Datum"},
    {"id": "m6", "title": "Kaputtes Datum", "date": "irgendwann"},
]


def world(**changes: Any) -> dict[str, Any]:
    """A small consistent world; each case changes one part of it."""

    base: dict[str, Any] = {
        "nodes": [
            {"id": "mara", "name": "Mara"},
            {"id": "iven", "name": "Iven"},
            {"id": "hafen", "name": "Hafen", "type": "ort"},
            {"id": "burg", "name": "Burg", "type": "ort"},
        ],
        "edges": [{"id": "e1", "from": "mara", "to": "iven", "versions": []}],
        "timeline": copy.deepcopy(TIMELINE),
        "presence": [],
    }
    base.update(changes)
    return base


def stay(element: str, place: str, moment: str | None) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": f"{element}-{place}-{moment}",
        "elementId": element,
        "placeId": place,
    }
    if moment is not None:
        entry["momentId"] = moment
    return entry


def items(result: WorldValidation) -> list[tuple[str, dict[str, object]]]:
    return [(item["key"], item["params"]) for item in result["issueItems"]]


class ValidateWorldFindingsTest(unittest.TestCase):
    def test_a_consistent_world_has_no_findings_and_counts_what_it_inspected(self):
        result = validate_world(
            world(
                edges=[
                    {
                        "id": "e1",
                        "from": "mara",
                        "to": "iven",
                        "versions": [{"momentId": "m1"}, {"momentId": "m2"}],
                    }
                ],
                presence=[stay("mara", "hafen", "m1")],
            )
        )
        self.assertEqual(result["issues"], [])
        self.assertEqual(result["issueItems"], [])
        self.assertEqual(
            result["inspected"],
            {
                "elements": 4,
                "relationships": 1,
                "timelineMoments": 6,
                "relationshipStates": 2,
                "presenceEntries": 1,
            },
        )

    def test_an_empty_aggregate_is_inspected_without_findings(self):
        result = validate_world({})
        self.assertEqual(result["issues"], [])
        self.assertEqual(
            result["inspected"],
            {
                "elements": 0,
                "relationships": 0,
                "timelineMoments": 0,
                "relationshipStates": 0,
                "presenceEntries": 0,
            },
        )

    def test_a_missing_source_or_target_is_a_missing_endpoint(self):
        for edge in (
            {"id": "e1", "from": "ghost", "to": "iven"},
            {"id": "e1", "from": "mara", "to": "ghost"},
            {"id": "e1", "to": "iven"},
        ):
            with self.subTest(edge=edge):
                result = validate_world(world(edges=[edge]))
                self.assertEqual(items(result), [("issueMissingEndpoint", {"id": "e1"})])
                self.assertEqual(result["issues"], ["Beziehung e1 hat einen fehlenden Endpunkt"])

    def test_the_same_undirected_pair_in_either_order_is_a_duplicate(self):
        result = validate_world(
            world(
                edges=[
                    {"id": "e1", "from": "mara", "to": "iven"},
                    {"id": "e2", "from": "iven", "to": "mara"},
                ]
            )
        )
        self.assertEqual(items(result), [("issueDuplicateRelationship", {"id": "e2"})])
        self.assertEqual(result["issues"], ["Beziehung e2 ist strukturell doppelt"])

    def test_directed_pairs_are_duplicates_only_in_the_same_direction(self):
        same = validate_world(
            world(
                edges=[
                    {"id": "e1", "from": "mara", "to": "iven", "directed": True},
                    {"id": "e2", "from": "mara", "to": "iven", "directed": True},
                ]
            )
        )
        self.assertEqual(items(same), [("issueDuplicateRelationship", {"id": "e2"})])
        opposite = validate_world(
            world(
                edges=[
                    {"id": "e1", "from": "mara", "to": "iven", "directed": True},
                    {"id": "e2", "from": "iven", "to": "mara", "directed": True},
                ]
            )
        )
        self.assertEqual(items(opposite), [])

    def test_a_directed_and_an_undirected_edge_on_the_same_pair_are_not_duplicates(self):
        result = validate_world(
            world(
                edges=[
                    {"id": "e1", "from": "mara", "to": "iven", "directed": True},
                    {"id": "e2", "from": "mara", "to": "iven"},
                ]
            )
        )
        self.assertEqual(items(result), [])

    def test_a_version_at_an_unknown_moment_is_a_missing_moment(self):
        result = validate_world(
            world(
                edges=[
                    {"id": "e1", "from": "mara", "to": "iven", "versions": [{"momentId": "gone"}]}
                ]
            )
        )
        self.assertEqual(items(result), [("issueMissingMoment", {"id": "e1", "momentId": "gone"})])
        self.assertEqual(
            result["issues"], ["Beziehung e1 verweist auf einen fehlenden Zeitpunkt gone"]
        )

    def test_two_versions_at_the_same_moment_are_a_duplicate_state(self):
        result = validate_world(
            world(
                edges=[
                    {
                        "id": "e1",
                        "from": "mara",
                        "to": "iven",
                        "versions": [{"momentId": "m1"}, {"momentId": "m1"}],
                    }
                ]
            )
        )
        self.assertEqual(
            items(result), [("issueDuplicateMomentState", {"id": "e1", "momentId": "m1"})]
        )
        self.assertEqual(
            result["issues"], ["Beziehung e1 hat mehrere Stände am selben Zeitpunkt m1"]
        )

    def test_a_repeated_unknown_moment_is_reported_as_both(self):
        result = validate_world(
            world(
                edges=[
                    {
                        "id": "e1",
                        "from": "mara",
                        "to": "iven",
                        "versions": [{"momentId": "gone"}, {"momentId": "gone"}],
                    }
                ]
            )
        )
        self.assertEqual(
            items(result),
            [
                ("issueMissingMoment", {"id": "e1", "momentId": "gone"}),
                ("issueMissingMoment", {"id": "e1", "momentId": "gone"}),
                ("issueDuplicateMomentState", {"id": "e1", "momentId": "gone"}),
            ],
        )

    def test_findings_keep_the_order_of_the_edges_then_presence(self):
        result = validate_world(
            world(
                edges=[
                    {"id": "e1", "from": "ghost", "to": "iven", "versions": [{"momentId": "gone"}]},
                    {"id": "e2", "from": "iven", "to": "ghost"},
                ],
                presence=[stay("mara", "hafen", "m1"), stay("mara", "burg", "m3")],
            )
        )
        self.assertEqual(
            [key for key, _params in items(result)],
            [
                "issueMissingEndpoint",
                "issueMissingMoment",
                "issueMissingEndpoint",
                "issueDuplicateRelationship",
                "issuePresenceBackward",
            ],
        )


class PresenceFindingsTest(unittest.TestCase):
    def presence(self, *entries: dict[str, Any], **node: Any) -> WorldValidation:
        nodes = world()["nodes"]
        if node:
            nodes[0] = {**nodes[0], **node}
        return validate_world(world(nodes=nodes, presence=list(entries)))

    def test_moving_back_in_time_is_a_backward_move(self):
        result = self.presence(stay("mara", "hafen", "m1"), stay("mara", "burg", "m3"))
        self.assertEqual(items(result), [("issuePresenceBackward", {"name": "Mara"})])
        self.assertEqual(
            result["issues"],
            [
                "Mara wechselt laut Anwesenheit den Ort, aber das Zieldatum liegt vor dem "
                "Ausgangsdatum"
            ],
        )

    def test_moving_on_the_same_day_is_a_same_day_move(self):
        result = self.presence(stay("mara", "hafen", "m1"), stay("mara", "burg", "m2"))
        self.assertEqual(items(result), [("issuePresenceSameDay", {"name": "Mara"})])
        self.assertEqual(result["issues"], ["Mara wechselt laut Anwesenheit am selben Tag den Ort"])

    def test_moving_forward_in_time_is_fine(self):
        self.assertEqual(
            items(self.presence(stay("mara", "hafen", "m1"), stay("mara", "burg", "m4"))), []
        )

    def test_a_figure_without_a_name_is_named_by_its_id(self):
        result = self.presence(stay("mara", "hafen", "m1"), stay("mara", "burg", "m2"), name="")
        self.assertEqual(items(result), [("issuePresenceSameDay", {"name": "mara"})])

    def test_stops_are_ordered_by_the_timeline_not_by_the_list(self):
        # Listed backwards, but m3 comes after m1 on the timeline, so the move goes back in time.
        result = self.presence(stay("mara", "burg", "m3"), stay("mara", "hafen", "m1"))
        self.assertEqual(items(result), [("issuePresenceBackward", {"name": "Mara"})])

    def test_a_missing_or_unreadable_date_skips_the_comparison(self):
        for moment in ("m5", "m6"):
            with self.subTest(moment=moment):
                result = self.presence(stay("mara", "hafen", "m1"), stay("mara", "burg", moment))
                self.assertEqual(items(result), [])

    def test_staying_at_the_same_place_is_not_a_move(self):
        result = self.presence(
            stay("mara", "hafen", "m1"), stay("mara", "hafen", "m3"), stay("mara", "burg", "m4")
        )
        self.assertEqual(items(result), [])

    def test_stays_after_the_figures_death_are_ignored(self):
        result = self.presence(
            stay("mara", "hafen", "m1"), stay("mara", "burg", "m3"), diedMomentId="m2"
        )
        self.assertEqual(items(result), [])

    def test_a_stay_at_the_moment_of_death_still_counts(self):
        result = self.presence(
            stay("mara", "hafen", "m1"), stay("mara", "burg", "m3"), diedMomentId="m3"
        )
        self.assertEqual(items(result), [("issuePresenceBackward", {"name": "Mara"})])

    def test_a_stay_at_a_dangling_moment_is_ignored(self):
        result = self.presence(stay("mara", "hafen", "m1"), stay("mara", "burg", "gone"))
        self.assertEqual(items(result), [])

    def test_the_base_state_is_a_stop_without_a_date(self):
        # The base stay has no date, so the move from it is not compared; m1 to m3 still is.
        result = self.presence(
            stay("mara", "burg", None), stay("mara", "hafen", "m1"), stay("mara", "burg", "m3")
        )
        self.assertEqual(items(result), [("issuePresenceBackward", {"name": "Mara"})])

    def test_other_figures_stays_belong_to_them(self):
        result = self.presence(stay("mara", "hafen", "m1"), stay("iven", "burg", "m3"))
        self.assertEqual(items(result), [])

    def test_presence_consistency_issues_returns_only_the_presence_texts(self):
        figures = world(
            edges=[{"id": "e1", "from": "ghost", "to": "iven"}],
            presence=[stay("mara", "hafen", "m1"), stay("mara", "burg", "m2")],
        )
        self.assertEqual(
            presence_consistency_issues(figures),
            ["Mara wechselt laut Anwesenheit am selben Tag den Ort"],
        )
        self.assertEqual(presence_consistency_issues({}), [])


class MomentOrderTest(unittest.TestCase):
    def test_no_moment_is_the_base_state(self):
        self.assertEqual(moment_order(TIMELINE, None), -1)
        self.assertEqual(moment_order(TIMELINE, ""), -1)

    def test_a_known_moment_is_its_timeline_position(self):
        self.assertEqual(moment_order(TIMELINE, "m1"), 0)
        self.assertEqual(moment_order(TIMELINE, "m4"), 3)

    def test_a_dangling_moment_sorts_before_everything(self):
        self.assertEqual(moment_order(TIMELINE, "gone"), -2)


MANUSCRIPT = {
    "chapters": [
        {
            "id": "c1",
            "title": "  Die   Krönung ",
            "body": "Erster Absatz.\n\nZweiter Absatz.",
            "note": " Ring  ",
        },
        {"id": "c2", "title": "", "body": "", "note": ""},
        {"id": "c3", "title": "Beiseite", "body": "Verworfen.", "inBook": False},
    ]
}


def chunk_map(chunks: list[KnowledgeChunk]) -> dict[str, KnowledgeChunk]:
    return {chunk.id: chunk for chunk in chunks}


class ScopedChaptersTest(unittest.TestCase):
    def test_without_ids_only_chapters_in_the_book(self):
        self.assertEqual([chapter["id"] for chapter in scoped_chapters(MANUSCRIPT)], ["c1", "c2"])
        self.assertTrue(chapter_in_book({}))
        self.assertTrue(chapter_in_book({"inBook": None}))
        self.assertFalse(chapter_in_book({"inBook": False}))

    def test_named_ids_select_those_chapters_including_set_aside_ones(self):
        self.assertEqual(
            [chapter["id"] for chapter in scoped_chapters(MANUSCRIPT, ["c3", "missing"])], ["c3"]
        )

    def test_an_empty_id_list_means_the_whole_book(self):
        self.assertEqual(
            [chapter["id"] for chapter in scoped_chapters(MANUSCRIPT, [])], ["c1", "c2"]
        )
        self.assertEqual(scoped_chapters({}), [])


class BuildKnowledgeChaptersTest(unittest.TestCase):
    def test_chapter_body_paragraphs_and_note_become_manuscript_chunks(self):
        chunks = chunk_map(build_knowledge(MANUSCRIPT, {}))
        body = chunks["chapter:c1:0"]
        self.assertEqual(
            (
                body.kind,
                body.title,
                body.text,
                body.target,
                body.context_class,
                body.document_status,
            ),
            (
                "chapter",
                "Die Krönung",
                "Erster Absatz.\n\nZweiter Absatz.",
                {"workspace": "text", "id": "c1"},
                KnowledgeContextClass.MANUSCRIPT,
                None,
            ),
        )
        note = chunks["chapter-note:c1"]
        self.assertEqual(
            (note.kind, note.title, note.text), ("chapter-note", "Notiz · Die Krönung", "Ring")
        )

    def test_an_untitled_chapter_is_named_by_its_position_and_an_empty_one_yields_nothing(self):
        chunks = build_knowledge(MANUSCRIPT, {})
        self.assertEqual([chunk.id for chunk in chunks], ["chapter:c1:0", "chapter-note:c1"])
        titled = build_knowledge({"chapters": [{"id": "c2", "body": "Text."}]}, {})
        self.assertEqual(titled[0].title, "Kapitel 1")

    def test_a_set_aside_chapter_is_marked_when_it_is_selected(self):
        chunks = chunk_map(build_knowledge(MANUSCRIPT, {}, ["c3"]))
        self.assertEqual(chunks["chapter:c3:0"].document_status, "set_aside")
        self.assertEqual(chunks["chapter:c3:0"].public().get("documentStatus"), "set_aside")

    def test_paragraphs_are_packed_up_to_the_limit_and_long_ones_are_cut(self):
        long = "a" * 1500
        body = f"{'b' * 900}\n\n{'c' * 600}\n\n{long}"
        chunks = build_knowledge({"chapters": [{"id": "c1", "title": "T", "body": body}]}, {})
        self.assertEqual(
            [len(chunk.text) for chunk in chunks],
            [900, 600, 1400, 100],
        )
        self.assertEqual(
            [chunk.id for chunk in chunks], [f"chapter:c1:{index}" for index in range(4)]
        )

    def test_small_paragraphs_share_one_chunk(self):
        chunks = build_knowledge(
            {"chapters": [{"id": "c1", "title": "T", "body": "x\n\n\n  y  \n\nz"}]}, {}
        )
        self.assertEqual([chunk.text for chunk in chunks], ["x\n\ny\n\nz"])


class BuildKnowledgeWorldTest(unittest.TestCase):
    def figures(self) -> dict[str, Any]:
        return {
            "nodes": [
                {
                    "id": "mara",
                    "name": "Mara",
                    "type": "person",
                    "label": "Archivarin",
                    "sub": "",
                    "profile": {
                        "notes": "Misstrauisch",
                        "fields": [{"key": "Alter", "value": "31"}, {"key": "", "value": ""}],
                    },
                },
                {"id": "hafen", "name": "", "type": "ort"},
                {"id": "iven"},
            ],
            "timeline": [
                {"id": "m1", "title": "Ankunft", "date": "1200-03-01", "note": "Regen"},
                {"id": "m2"},
            ],
            "edges": [
                {
                    "id": "e1",
                    "from": "mara",
                    "to": "iven",
                    "label": "Bruder",
                    "directed": True,
                    "versions": [
                        {"momentId": "m1", "label": "Freund", "active": True},
                        {"momentId": "gone"},
                    ],
                },
                {"id": "e2", "from": "iven", "to": "ghost"},
            ],
            "presence": [
                {"elementId": "mara", "placeId": "hafen", "momentId": "m1"},
                {"elementId": "mara", "placeId": "ghost-place"},
                {"elementId": "ghost", "placeId": "hafen", "momentId": "m2"},
            ],
        }

    def test_elements_list_only_their_filled_profile_lines(self):
        chunks = chunk_map(build_knowledge({}, self.figures()))
        mara = chunks["element:mara"]
        self.assertEqual(mara.title, "Mara")
        self.assertEqual(
            mara.text, "Art: person\nRolle/Kategorie: Archivarin\nNotizen: Misstrauisch\nAlter: 31"
        )
        self.assertEqual(mara.target, {"workspace": "figures", "id": "mara"})
        self.assertEqual(mara.context_class, KnowledgeContextClass.CANON)
        self.assertEqual(chunks["element:hafen"].title, "Ohne Namen")
        self.assertEqual(chunks["element:hafen"].text, "Art: ort")
        self.assertEqual(chunks["element:iven"].text, "Art: person")

    def test_timeline_moments_carry_date_and_note(self):
        chunks = chunk_map(build_knowledge({}, self.figures()))
        self.assertEqual(
            (chunks["timeline:m1"].title, chunks["timeline:m1"].text),
            ("Ankunft", "Datum: 1200-03-01\nRegen"),
        )
        self.assertEqual(
            (chunks["timeline:m2"].title, chunks["timeline:m2"].text), ("Zeitpunkt", "")
        )

    def test_relationships_name_both_ends_their_kind_and_every_version(self):
        chunks = chunk_map(build_knowledge({}, self.figures()))
        first = chunks["relationship:e1"]
        self.assertEqual(first.title, "Mara · Unbekannt")
        self.assertEqual(
            first.text,
            "Mara → Unbekannt\nBeziehung: Bruder\nArt: gerichtet\n"
            "Ab Ankunft: Freund (aktiv)\nAb gone: ohne Bezeichnung (beendet)",
        )
        self.assertEqual(
            first.target, {"workspace": "figures", "id": "mara", "from": "mara", "to": "iven"}
        )
        second = chunks["relationship:e2"]
        self.assertEqual(second.title, "Unbekannt · None")
        self.assertEqual(second.text, "Unbekannt → None\nBeziehung: \nArt: ungerichtet")

    def test_presence_is_one_chunk_per_element_in_timeline_order(self):
        chunks = chunk_map(build_knowledge({}, self.figures()))
        self.assertEqual(chunks["presence:mara"].title, "Aufenthalte · Mara")
        # The base stay sorts first; the harbour's empty name is kept as it is.
        self.assertEqual(
            chunks["presence:mara"].text, "Ausgangslage: Unbekannter Ort\nAnkunft (1200-03-01): "
        )
        self.assertEqual(chunks["presence:ghost"].title, "Aufenthalte · Unbekannt")
        # A moment without a title gives an empty "when" rather than a fallback.
        self.assertEqual(chunks["presence:ghost"].text, ": ")
        self.assertEqual(chunks["presence:ghost"].target, {"workspace": "figures", "id": "ghost"})

    def test_chunks_come_in_a_fixed_order(self):
        kinds = [chunk.kind for chunk in build_knowledge(MANUSCRIPT, self.figures())]
        self.assertEqual(
            kinds,
            ["chapter", "chapter-note"]
            + ["element"] * 3
            + ["timeline"] * 2
            + ["relationship"] * 2
            + ["presence"] * 2,
        )

    def test_public_names_its_fields_for_the_wire(self):
        chunk = build_knowledge({}, self.figures())[0]
        self.assertEqual(
            chunk.public(),
            {
                "id": "element:mara",
                "kind": "element",
                "title": "Mara",
                "text": chunk.text,
                "target": {"workspace": "figures", "id": "mara"},
                "contextClass": "canon",
            },
        )


def plain(
    identifier: str, title: str, text: str, kind: str = "element", **target: str
) -> KnowledgeChunk:
    return KnowledgeChunk(
        identifier, kind, title, text, {"workspace": "figures", "id": identifier, **target}
    )


class RetrieveTest(unittest.TestCase):
    chunks: ClassVar[list[KnowledgeChunk]] = [
        plain("mara", "Mara", "Archivarin im Hafen"),
        plain("iven", "Iven", "Bruder"),
        plain(
            "rel", "Mara · Iven", "Geschwister", "relationship", **{"from": "mara", "to": "iven"}
        ),
        plain("hafen", "Hafen", "Ein Ort am Meer"),
    ]

    def test_a_query_without_words_returns_the_first_chunks(self):
        self.assertEqual(
            [chunk.id for chunk in retrieve(self.chunks, "  ?! ", 2)], ["mara", "iven"]
        )

    def test_title_phrase_and_word_matches_rank_the_results(self):
        self.assertEqual(
            [chunk.id for chunk in retrieve(self.chunks, "hafen", 3)], ["hafen", "mara", "rel"]
        )

    def test_relationships_of_found_elements_are_added_up_to_the_limit(self):
        self.assertEqual(
            [chunk.id for chunk in retrieve(self.chunks, "Archivarin", 5)], ["mara", "rel"]
        )
        self.assertEqual([chunk.id for chunk in retrieve(self.chunks, "Archivarin", 1)], ["mara"])

    def test_without_a_match_the_fallback_decides(self):
        self.assertEqual(
            [chunk.id for chunk in retrieve(self.chunks, "Drache", 2)], ["mara", "iven"]
        )
        self.assertEqual(retrieve(self.chunks, "Drache", 2, fallback=False), [])


if __name__ == "__main__":
    unittest.main()
