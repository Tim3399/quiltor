import unittest

from quiltor.domain.story_world.knowledge import KnowledgeContextClass
from quiltor.modules.assistant.planning_context import (
    MAX_PLANNING_CONTEXT_CHUNKS,
    MAX_PLANNING_CONTEXT_TEXT,
    build_storyboard_knowledge,
)


class AssistantPlanningContextTests(unittest.TestCase):
    def test_storyboard_notes_project_deterministically_as_planning_context(self):
        storyboards = {
            "boards": [
                {"id": "later", "title": "Akt II"},
                {"id": "main", "title": "Auftakt"},
            ],
            "nodes": [
                {
                    "id": "reference-mara",
                    "boardId": "main",
                    "kind": "reference",
                    "text": "  Mara bewacht das Archiv.  ",
                },
                {
                    "id": "empty",
                    "boardId": "main",
                    "kind": "note",
                    "text": "  \n ",
                },
                {
                    "id": "group-finale",
                    "boardId": "later",
                    "kind": "group",
                    "label": "Finale",
                    "text": "Die Krone zerbricht.",
                },
            ],
            "edges": [],
        }

        chunks = build_storyboard_knowledge(storyboards)

        self.assertEqual(
            [chunk.id for chunk in chunks], ["storyboard:group-finale", "storyboard:reference-mara"]
        )
        finale, mara = chunks
        self.assertEqual(finale.title, "Akt II · Finale")
        self.assertEqual(finale.context_class, KnowledgeContextClass.PLANNING)
        self.assertEqual(
            finale.public(),
            {
                "id": "storyboard:group-finale",
                "kind": "storyboard-note",
                "title": "Akt II · Finale",
                "text": "Die Krone zerbricht.",
                "target": {"workspace": "storyboard", "id": "group-finale", "boardId": "later"},
                "contextClass": "planning",
            },
        )
        self.assertEqual(mara.title, "Auftakt · Mara bewacht das Archiv.")
        self.assertEqual(mara.text, "Mara bewacht das Archiv.")

    def test_projection_is_bounded_before_token_packing(self):
        storyboards = {
            "boards": [{"id": "main", "title": "Ideen"}],
            "nodes": [
                {
                    "id": f"note-{index:04d}",
                    "boardId": "main",
                    "kind": "note",
                    "text": "x" * (MAX_PLANNING_CONTEXT_TEXT + 20),
                }
                for index in range(MAX_PLANNING_CONTEXT_CHUNKS + 1)
            ],
            "edges": [],
        }

        chunks = build_storyboard_knowledge(storyboards)

        self.assertEqual(len(chunks), MAX_PLANNING_CONTEXT_CHUNKS)
        self.assertTrue(all(len(chunk.text) == MAX_PLANNING_CONTEXT_TEXT for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
