import copy
import unittest

from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.modules.assistant.batch import run_batches


class _Progress:
    def start(self, *_args):
        pass

    def update(self, *_args):
        pass

    def finish(self, *_args):
        pass


class AnalysisScopeTest(unittest.TestCase):
    def setUp(self):
        self.manuscript = {
            "chapters": [
                {
                    "id": "book",
                    "title": "Im Buch",
                    "body": "Die Glocke klingt im Hafen.",
                    "note": "",
                },
                {
                    "id": "aside",
                    "title": "Beiseitegelegt",
                    "body": "Ein Zinnoberdrache wartet im verlassenen Turm.",
                    "note": "Nur ein Entwurf.",
                    "inBook": False,
                },
            ],
            "trash": [
                {
                    "chapter": {
                        "id": "deleted",
                        "title": "Gelöscht",
                        "body": "Der Saphirwal verschwindet im Nebel.",
                        "note": "",
                    },
                    "deletedAt": "2026-09-19T10:00:00Z",
                    "originalFolderPath": [],
                    "treeItem": {
                        "id": "chapter:deleted",
                        "kind": "chapter",
                        "chapterId": "deleted",
                        "position": 0,
                    },
                }
            ],
        }
        self.figures = {
            "nodes": [{"id": "mara", "name": "Mara", "x": 0, "y": 0}],
            "edges": [],
        }

    def test_default_retrieval_excludes_set_aside_and_trash_but_keeps_world_context(self):
        before_manuscript = copy.deepcopy(self.manuscript)
        before_figures = copy.deepcopy(self.figures)

        chunks = build_knowledge(self.manuscript, self.figures)
        dragon = retrieve(chunks, "Zinnoberdrache", fallback=False)
        whale = retrieve(chunks, "Saphirwal", fallback=False)

        self.assertEqual(dragon, [])
        self.assertEqual(whale, [])
        self.assertIn("chapter:book:0", {chunk.id for chunk in chunks})
        self.assertIn("element:mara", {chunk.id for chunk in chunks})
        self.assertEqual(self.manuscript, before_manuscript)
        self.assertEqual(self.figures, before_figures)

    def test_explicit_set_aside_scope_is_exact_and_retains_source_provenance(self):
        chunks = build_knowledge(self.manuscript, self.figures, ["aside"])
        identifiers = {chunk.id for chunk in chunks}

        self.assertIn("chapter:aside:0", identifiers)
        self.assertNotIn("chapter:book:0", identifiers)
        self.assertNotIn("chapter:deleted:0", identifiers)
        self.assertIn("element:mara", identifiers)
        source = next(chunk.public() for chunk in chunks if chunk.id == "chapter:aside:0")
        self.assertEqual(source["target"]["id"], "aside")
        self.assertEqual(source["documentStatus"], "set_aside")

    def test_batch_default_excludes_distinctive_set_aside_text_and_explicit_scope_includes_it(self):
        calls = []

        def complete(_question, manuscript, _figures, _history, *, chapter_ids, **_options):
            scoped_text = " ".join(
                chapter["body"]
                for chapter in manuscript["chapters"]
                if chapter["id"] in chapter_ids
            )
            calls.append((list(chapter_ids), scoped_text))
            return {"message": "ok", "proposals": [], "sources": []}

        options = {
            "mode": "world_extraction",
            "question": "Prüfe den Text",
            "manuscript": self.manuscript,
            "figures": self.figures,
            "history": None,
            "progress_id": None,
            "complete": complete,
            "progress": _Progress(),
            "identity": "test",
            "count_tokens": lambda _text: 1,
        }
        default = run_batches(**options)
        self.assertEqual(default["extraction"]["chapterIds"], ["book"])
        self.assertNotIn("Zinnoberdrache", " ".join(text for _, text in calls))

        calls.clear()
        explicit = run_batches(**options, chapter_ids=["aside"])
        self.assertEqual(explicit["extraction"]["chapterIds"], ["aside"])
        self.assertIn("Zinnoberdrache", " ".join(text for _, text in calls))


if __name__ == "__main__":
    unittest.main()
