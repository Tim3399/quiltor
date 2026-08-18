import unittest

from backend.core.knowledge import build_knowledge, moment_order, retrieve, _parts


class KnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.manuscript = {
            "chapters": [
                {
                    "id": "c1",
                    "title": "Die Krönung",
                    "body": "Mara entdeckt im Archiv den gefälschten Siegelring. Sie misstraut danach Iven.",
                    "note": "Der Ring stammt aus Asterheim.",
                },
                {
                    "id": "c2",
                    "title": "Am Fluss",
                    "body": "Bela wartet am stillen Wasser.",
                    "note": "",
                },
            ]
        }
        self.figures = {
            "nodes": [
                {
                    "id": "mara",
                    "x": 0,
                    "y": 0,
                    "type": "person",
                    "name": "Mara",
                    "profile": {"rolle": "Archivarin"},
                },
                {
                    "id": "iven",
                    "x": 1,
                    "y": 1,
                    "type": "person",
                    "name": "Iven",
                    "profile": {"rolle": "Regent"},
                },
            ],
            "timeline": [{"id": "crown", "title": "Krönung", "date": "1421-03-14"}],
            "edges": [
                {
                    "id": "trust",
                    "from": "mara",
                    "to": "iven",
                    "label": "Verbündete",
                    "versions": [{"momentId": "crown", "label": "Misstrauen", "active": True}],
                }
            ],
        }

    def test_indexes_every_knowledge_kind(self):
        kinds = {chunk.kind for chunk in build_knowledge(self.manuscript, self.figures)}
        self.assertEqual(kinds, {"chapter", "chapter-note", "element", "relationship", "timeline"})

    def test_retrieves_chapter_evidence_and_graph_context(self):
        results = retrieve(
            build_knowledge(self.manuscript, self.figures),
            "Warum misstraut Mara Iven nach der Krönung?",
        )
        identifiers = {chunk.id for chunk in results}
        self.assertIn("chapter:c1:0", identifiers)
        self.assertIn("relationship:trust", identifiers)
        self.assertNotIn("chapter:c2:0", identifiers)

    def test_build_knowledge_on_an_empty_world_does_not_crash(self):
        self.assertEqual(build_knowledge({}, {}), [])

    def test_relationship_chunk_lists_every_moment_version_line(self):
        edges = {
            **self.figures,
            "edges": [
                {
                    "id": "trust",
                    "from": "mara",
                    "to": "iven",
                    "label": "Verbündete",
                    "versions": [
                        {"momentId": "crown", "label": "Misstrauen", "active": True},
                        {"momentId": "crown", "label": "Bruch", "active": False},
                    ],
                }
            ],
        }
        chunk = next(
            chunk
            for chunk in build_knowledge(self.manuscript, edges)
            if chunk.id == "relationship:trust"
        )
        self.assertIn("Ab Krönung: Misstrauen (aktiv)", chunk.text)
        self.assertIn("Ab Krönung: Bruch (beendet)", chunk.text)

    def test_retrieve_graph_expansion_pulls_in_a_relationship_the_query_never_mentions(self):
        # The relationship chunk's own text never contains "Archivarin" or "Mara" as a query
        # token match target for this query -- it should only surface via related_ids expansion
        # from the matched element chunk, not lexical scoring of its own text.
        chunks = build_knowledge(self.manuscript, self.figures)
        results = retrieve(chunks, "Archivarin")
        identifiers = {chunk.id for chunk in results}
        self.assertIn("element:mara", identifiers)
        self.assertIn("relationship:trust", identifiers)

    def test_retrieve_with_no_query_tokens_returns_the_first_chunks_unscored(self):
        chunks = build_knowledge(self.manuscript, self.figures)
        self.assertEqual(retrieve(chunks, "   ", limit=3), chunks[:3])

    def test_retrieve_falls_back_to_the_first_chunks_when_nothing_scores(self):
        chunks = build_knowledge(self.manuscript, self.figures)
        results = retrieve(chunks, "xyzxyz keinemitteilung", limit=3)
        self.assertEqual(results, chunks[:3])

    def test_presence_chunk_lists_stops_in_timeline_order_with_place_names(self):
        figures = {
            **self.figures,
            "presence": [
                {"id": "p1", "elementId": "mara", "placeId": "iven", "momentId": "crown"},
                {"id": "p0", "elementId": "mara", "placeId": "iven"},
            ],
        }
        chunk = next(
            chunk
            for chunk in build_knowledge(self.manuscript, figures)
            if chunk.id == "presence:mara"
        )
        self.assertEqual(chunk.kind, "presence")
        lines = chunk.text.splitlines()
        self.assertEqual(lines, ["Ausgangslage: Iven", "Krönung (1421-03-14): Iven"])

    def test_no_presence_chunk_is_built_when_a_world_has_no_presence_data(self):
        chunks = build_knowledge(self.manuscript, self.figures)
        self.assertFalse(any(chunk.kind == "presence" for chunk in chunks))


class MomentOrderTest(unittest.TestCase):
    timeline = [{"id": "a"}, {"id": "b"}]

    def test_no_moment_id_is_the_base_state_and_sorts_first(self):
        self.assertEqual(moment_order(self.timeline, None), -1)
        self.assertEqual(moment_order(self.timeline, ""), -1)

    def test_a_real_moment_returns_its_timeline_position(self):
        self.assertEqual(moment_order(self.timeline, "b"), 1)

    def test_a_dangling_reference_sorts_before_the_base_state(self):
        self.assertEqual(moment_order(self.timeline, "missing"), -2)


class PartsChunkingTest(unittest.TestCase):
    def test_a_paragraph_longer_than_the_limit_is_split_into_multiple_parts(self):
        paragraph = "a" * 3000
        parts = _parts(paragraph, limit=1400)
        self.assertEqual(len(parts), 3)
        self.assertTrue(all(len(part) <= 1400 for part in parts))
        self.assertEqual("".join(parts), paragraph)

    def test_short_paragraphs_are_merged_up_to_the_limit(self):
        text = "\n\n".join(["kurz eins", "kurz zwei", "kurz drei"])
        parts = _parts(text, limit=1400)
        self.assertEqual(parts, ["kurz eins\n\nkurz zwei\n\nkurz drei"])

    def test_empty_or_whitespace_only_text_produces_no_parts(self):
        self.assertEqual(_parts(""), [])
        self.assertEqual(_parts("   \n\n   "), [])
        self.assertEqual(_parts(None), [])


if __name__ == "__main__":
    unittest.main()
