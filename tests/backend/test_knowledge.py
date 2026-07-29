import unittest

from backend.knowledge import build_knowledge, retrieve


class KnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.manuscript = {"chapters": [
            {"id": "c1", "title": "Die Krönung", "body": "Mara entdeckt im Archiv den gefälschten Siegelring. Sie misstraut danach Iven.", "note": "Der Ring stammt aus Asterheim."},
            {"id": "c2", "title": "Am Fluss", "body": "Bela wartet am stillen Wasser.", "note": ""},
        ]}
        self.figures = {
            "nodes": [
                {"id": "mara", "x": 0, "y": 0, "type": "person", "name": "Mara", "profile": {"rolle": "Archivarin"}},
                {"id": "iven", "x": 1, "y": 1, "type": "person", "name": "Iven", "profile": {"rolle": "Regent"}},
            ],
            "timeline": [{"id": "crown", "title": "Krönung", "date": "1421-03-14"}],
            "edges": [{"id": "trust", "from": "mara", "to": "iven", "label": "Verbündete", "versions": [{"momentId": "crown", "label": "Misstrauen", "active": True}]}],
        }

    def test_indexes_every_knowledge_kind(self):
        kinds = {chunk.kind for chunk in build_knowledge(self.manuscript, self.figures)}
        self.assertEqual(kinds, {"chapter", "chapter-note", "element", "relationship", "timeline"})

    def test_retrieves_chapter_evidence_and_graph_context(self):
        results = retrieve(build_knowledge(self.manuscript, self.figures), "Warum misstraut Mara Iven nach der Krönung?")
        identifiers = {chunk.id for chunk in results}
        self.assertIn("chapter:c1:0", identifiers)
        self.assertIn("relationship:trust", identifiers)
        self.assertNotIn("chapter:c2:0", identifiers)


if __name__ == "__main__":
    unittest.main()
