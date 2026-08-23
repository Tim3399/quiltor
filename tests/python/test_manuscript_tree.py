from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quiltor.domain.manuscript.tree import (
    ManuscriptTreeError,
    breadcrumb_for_chapter,
    delete_folder,
    flat_structure,
    flatten_tree,
    move_item,
    structure_or_flat,
    validate_tree,
)
from quiltor.infrastructure.persistence.sqlite import manuscript, migrations, schema
from quiltor.infrastructure.persistence.sqlite.connection import connection


def nested_structure() -> dict:
    return {
        "folders": [
            {"id": "part", "title": "Teil I"},
            {"id": "arc", "title": "Ankunft"},
        ],
        "items": [
            {"id": "i-part", "kind": "folder", "folderId": "part", "position": 0},
            {"id": "i-c3", "kind": "chapter", "chapterId": "c3", "position": 1},
            {
                "id": "i-arc",
                "kind": "folder",
                "folderId": "arc",
                "parentFolderId": "part",
                "position": 0,
            },
            {
                "id": "i-c2",
                "kind": "chapter",
                "chapterId": "c2",
                "parentFolderId": "part",
                "position": 1,
            },
            {
                "id": "i-c1",
                "kind": "chapter",
                "chapterId": "c1",
                "parentFolderId": "arc",
                "position": 0,
            },
        ],
    }


class ManuscriptTreeDomainTests(unittest.TestCase):
    def test_nested_tree_has_one_deterministic_flattened_order_and_breadcrumb(self) -> None:
        structure = nested_structure()

        validate_tree(["c1", "c2", "c3"], structure)

        self.assertEqual(flatten_tree(["c1", "c2", "c3"], structure), ["c1", "c2", "c3"])
        self.assertEqual(
            breadcrumb_for_chapter("c1", ["c1", "c2", "c3"], structure),
            ["Teil I", "Ankunft"],
        )

    def test_arbitrary_depth_is_not_capped(self) -> None:
        folders = [{"id": f"f{index}", "title": str(index)} for index in range(12)]
        items = [
            {
                "id": f"i{index}",
                "kind": "folder",
                "folderId": f"f{index}",
                **({"parentFolderId": f"f{index - 1}"} if index else {}),
                "position": 0,
            }
            for index in range(12)
        ]
        items.append(
            {
                "id": "chapter",
                "kind": "chapter",
                "chapterId": "c1",
                "parentFolderId": "f11",
                "position": 0,
            }
        )
        structure = {"folders": folders, "items": items}

        validate_tree(["c1"], structure)
        self.assertEqual(flatten_tree(["c1"], structure), ["c1"])

    def test_cycle_duplicate_ownership_and_non_contiguous_order_are_rejected(self) -> None:
        cycle = nested_structure()
        cycle["items"][0]["parentFolderId"] = "arc"
        with self.assertRaises(ManuscriptTreeError):
            validate_tree(["c1", "c2", "c3"], cycle)

        duplicate = nested_structure()
        duplicate["items"].append(
            {"id": "duplicate", "kind": "chapter", "chapterId": "c1", "position": 2}
        )
        with self.assertRaises(ManuscriptTreeError):
            validate_tree(["c1", "c2", "c3"], duplicate)

        gap = flat_structure(["c1", "c2"])
        gap["items"][1]["position"] = 3
        with self.assertRaises(ManuscriptTreeError):
            validate_tree(["c1", "c2"], gap)

    def test_move_rejects_descendant_and_folder_delete_keeps_all_content(self) -> None:
        structure = nested_structure()
        with self.assertRaises(ManuscriptTreeError):
            move_item(["c1", "c2", "c3"], structure, "i-part", "arc")

        moved = move_item(["c1", "c2", "c3"], structure, "i-c3", "arc")
        self.assertEqual(flatten_tree(["c1", "c2", "c3"], moved), ["c1", "c3", "c2"])

        without_part = delete_folder(["c1", "c2", "c3"], structure, "part")
        self.assertEqual(flatten_tree(["c1", "c2", "c3"], without_part), ["c1", "c2", "c3"])
        self.assertEqual({folder["id"] for folder in without_part["folders"]}, {"arc"})
        arc_item = next(item for item in without_part["items"] if item.get("folderId") == "arc")
        self.assertNotIn("parentFolderId", arc_item)


class ManuscriptTreePersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "world.sqlite3"
        schema.initialize(self.database)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_round_trip_projects_chapters_in_tree_order_without_changing_ids(self) -> None:
        state = {
            "chapters": [
                {"id": "c3", "title": "Drei", "body": "", "note": ""},
                {"id": "c1", "title": "Eins", "body": "", "note": ""},
                {"id": "c2", "title": "Zwei", "body": "", "note": ""},
            ],
            "structure": nested_structure(),
        }

        manuscript.save(state, db_path=self.database)
        loaded = manuscript.load(self.database)

        self.assertEqual([chapter["id"] for chapter in loaded["chapters"]], ["c1", "c2", "c3"])
        self.assertEqual(
            loaded["structure"],
            structure_or_flat(["c1", "c2", "c3"], nested_structure()),
        )

    def test_v8_flat_manuscript_migrates_at_root_with_exact_order(self) -> None:
        with connection(self.database) as database:
            database.execute("DELETE FROM manuscript_tree_items")
            database.execute("DELETE FROM chapters")
            for position, chapter_id in enumerate(("c2", "c1", "c3")):
                database.execute(
                    "INSERT INTO chapters(id,position,title,body,note) VALUES(?,?,?,'','')",
                    (chapter_id, position, chapter_id),
                )
            database.execute("UPDATE meta SET value='8' WHERE key='schema_version'")
            migrations.migrate(database, 8)

        loaded = manuscript.load(self.database)
        self.assertEqual([chapter["id"] for chapter in loaded["chapters"]], ["c2", "c1", "c3"])
        self.assertEqual(loaded["structure"], flat_structure(["c2", "c1", "c3"]))


if __name__ == "__main__":
    unittest.main()
