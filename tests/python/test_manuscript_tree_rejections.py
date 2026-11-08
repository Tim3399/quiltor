"""Characterises every rejection branch of the binder rules, written before they were typed (T-19 P1)."""

from __future__ import annotations

import copy
import unittest
from typing import Any

from quiltor.domain.manuscript.tree import (
    ManuscriptTreeError,
    breadcrumb_for_chapter,
    delete_folder,
    descendants,
    flatten_tree,
    move_item,
    normalize_positions,
    structure_or_flat,
    validate_tree,
)
from tests.python.test_manuscript_tree import nested_structure

CHAPTERS = ["c1", "c2", "c3"]


def _item(structure: dict[str, Any], item_id: str) -> dict[str, Any]:
    return next(entry for entry in structure["items"] if entry["id"] == item_id)


class ValidateTreeRejectionTests(unittest.TestCase):
    def assertRejected(self, chapters: Any, structure: Any, message: str) -> None:
        with self.assertRaises(ManuscriptTreeError) as caught:
            validate_tree(chapters, structure)
        self.assertEqual(str(caught.exception), message)

    def test_chapter_ids_must_be_unique_non_empty_strings(self) -> None:
        message = "chapter IDs must be unique non-empty strings"
        for chapters in (["c1", "c1"], ["c1", ""], ["c1", 5]):
            with self.subTest(chapters=chapters):
                self.assertRejected(chapters, nested_structure(), message)

    def test_structure_must_be_an_object_with_folder_and_item_lists(self) -> None:
        self.assertRejected(CHAPTERS, [], "manuscript structure must be an object")
        message = "manuscript structure needs folder and item lists"
        for structure in (
            {"folders": {}, "items": []},
            {"folders": [], "items": None},
            {"items": []},
        ):
            with self.subTest(structure=structure):
                self.assertRejected(CHAPTERS, structure, message)

    def test_a_folder_must_be_an_object(self) -> None:
        structure = nested_structure()
        structure["folders"].append(5)
        self.assertRejected(CHAPTERS, structure, "folder must be an object")

    def test_folder_identity_and_title_are_bounded(self) -> None:
        message = "folder identity or title is invalid"
        cases = {
            "empty id": {"id": "", "title": "x"},
            "id too long": {"id": "x" * 201, "title": "x"},
            "id not a string": {"id": 5, "title": "x"},
            "duplicate id": {"id": "part", "title": "x"},
            "title not a string": {"id": "new", "title": 5},
            "title too long": {"id": "new", "title": "x" * 1001},
            "title missing": {"id": "new"},
        }
        for name, folder in cases.items():
            with self.subTest(name):
                structure = nested_structure()
                structure["folders"].append(folder)
                self.assertRejected(CHAPTERS, structure, message)

    def test_folder_id_at_the_length_limit_is_accepted(self) -> None:
        structure = nested_structure()
        structure["folders"].append({"id": "x" * 200, "title": "y" * 1000})
        structure["items"].append(
            {"id": "i-long", "kind": "folder", "folderId": "x" * 200, "position": 2}
        )
        validate_tree(CHAPTERS, structure)

    def test_a_tree_item_must_be_an_object(self) -> None:
        structure = nested_structure()
        structure["items"].append("c4")
        self.assertRejected(CHAPTERS, structure, "tree item must be an object")

    def test_tree_item_identity_and_position_are_checked(self) -> None:
        message = "tree item identity or position is invalid"
        cases = {
            "empty id": {"id": ""},
            "id too long": {"id": "x" * 501},
            "id not a string": {"id": 5},
            "duplicate id": {"id": "i-part"},
            "bool position": {"position": True},
            "string position": {"position": "1"},
            "negative position": {"position": -1},
        }
        for name, change in cases.items():
            with self.subTest(name):
                structure = nested_structure()
                _item(structure, "i-c3").update(change)
                self.assertRejected(CHAPTERS, structure, message)

    def test_parent_folder_must_be_a_non_empty_string_or_null(self) -> None:
        message = "parent folder must be a non-empty string or null"
        for value in ("", 5):
            with self.subTest(value=value):
                structure = nested_structure()
                _item(structure, "i-c3")["parentFolderId"] = value
                self.assertRejected(CHAPTERS, structure, message)
        structure = nested_structure()
        _item(structure, "i-c3")["parentFolderId"] = None
        validate_tree(CHAPTERS, structure)

    def test_parent_folder_must_exist(self) -> None:
        structure = nested_structure()
        _item(structure, "i-c3")["parentFolderId"] = "ghost"
        self.assertRejected(CHAPTERS, structure, "tree item references an unknown parent folder")

    def test_sibling_positions_must_be_unique_and_contiguous(self) -> None:
        structure = nested_structure()
        _item(structure, "i-c3")["position"] = 0
        self.assertRejected(CHAPTERS, structure, "sibling positions must be unique")
        structure = nested_structure()
        _item(structure, "i-c3")["position"] = 5
        self.assertRejected(CHAPTERS, structure, "sibling positions must be contiguous")

    def test_chapter_ownership_is_checked(self) -> None:
        message = "chapter ownership is invalid"
        cases = {
            "not a string": {"chapterId": 5},
            "unknown chapter": {"chapterId": "c9"},
            "owned twice": {"chapterId": "c1"},
            "carries a folder id": {"folderId": "part"},
        }
        for name, change in cases.items():
            with self.subTest(name):
                structure = nested_structure()
                _item(structure, "i-c3").update(change)
                self.assertRejected(CHAPTERS, structure, message)

    def test_folder_ownership_is_checked(self) -> None:
        message = "folder ownership is invalid"
        cases = {
            "not a string": {"folderId": 5},
            "unknown folder": {"folderId": "ghost"},
            "owned twice": {"folderId": "part"},
            "carries a chapter id": {"chapterId": "c1"},
        }
        for name, change in cases.items():
            with self.subTest(name):
                structure = nested_structure()
                _item(structure, "i-arc").update(change)
                self.assertRejected(CHAPTERS, structure, message)

    def test_a_folder_cannot_contain_itself(self) -> None:
        structure = nested_structure()
        _item(structure, "i-arc")["parentFolderId"] = "arc"
        self.assertRejected(CHAPTERS, structure, "folder cannot contain itself")

    def test_item_kind_must_be_chapter_or_folder(self) -> None:
        for kind in ("page", None, 5):
            with self.subTest(kind=kind):
                structure = nested_structure()
                _item(structure, "i-c3")["kind"] = kind
                self.assertRejected(CHAPTERS, structure, "tree item kind is invalid")

    def test_every_chapter_and_every_folder_must_appear_once(self) -> None:
        structure = nested_structure()
        structure["items"] = [i for i in structure["items"] if i["id"] != "i-c3"]
        self.assertRejected(CHAPTERS, structure, "every chapter must appear exactly once")
        structure = nested_structure()
        structure["folders"].append({"id": "orphan", "title": "Lose"})
        self.assertRejected(CHAPTERS, structure, "every folder must appear exactly once")

    def test_a_two_folder_cycle_is_rejected(self) -> None:
        structure = {
            "folders": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}],
            "items": [
                {
                    "id": "i-a",
                    "kind": "folder",
                    "folderId": "a",
                    "parentFolderId": "b",
                    "position": 0,
                },
                {
                    "id": "i-b",
                    "kind": "folder",
                    "folderId": "b",
                    "parentFolderId": "a",
                    "position": 0,
                },
            ],
        }
        self.assertRejected([], structure, "folder hierarchy contains a cycle")


class StructureHelpersTests(unittest.TestCase):
    def test_incomplete_structures_project_to_the_flat_default(self) -> None:
        flat = structure_or_flat(["c1"], None)
        self.assertEqual([item["chapterId"] for item in flat["items"]], ["c1"])
        for structure in ("x", {"folders": {}, "items": []}, {"folders": [], "items": "x"}):
            with self.subTest(structure=structure):
                self.assertEqual(structure_or_flat(["c1"], structure), flat)

    def test_structure_or_flat_orders_depth_first_and_does_not_mutate_its_input(self) -> None:
        source = nested_structure()
        before = copy.deepcopy(source)
        result = structure_or_flat(CHAPTERS, source)
        self.assertEqual(source, before)
        self.assertEqual(
            [item["id"] for item in result["items"]], ["i-part", "i-arc", "i-c1", "i-c2", "i-c3"]
        )
        self.assertEqual([folder["id"] for folder in result["folders"]], ["part", "arc"])

    def test_normalize_positions_rejects_malformed_structures(self) -> None:
        with self.assertRaises(ManuscriptTreeError) as caught:
            normalize_positions([])
        self.assertEqual(str(caught.exception), "manuscript structure must be an object")
        for structure in ({"folders": [], "items": None}, {"items": []}):
            with self.subTest(structure=structure):
                with self.assertRaises(ManuscriptTreeError) as caught:
                    normalize_positions(structure)
                self.assertEqual(
                    str(caught.exception), "manuscript structure needs folder and item lists"
                )

    def test_normalize_positions_rejects_an_unvalidated_structure_instead_of_repairing_it(
        self,
    ) -> None:
        # Both callers hand over a validated structure; the function itself does not repair
        # what validate_tree would have refused (T-19, Critic F-19-5).
        bad_position = nested_structure()
        _item(bad_position, "i-c3")["position"] = False
        with self.assertRaises(ManuscriptTreeError) as caught:
            normalize_positions(bad_position)
        self.assertEqual(str(caught.exception), "tree item identity or position is invalid")
        bad_folder = nested_structure()
        bad_folder["folders"].append(True)
        with self.assertRaises(ManuscriptTreeError) as caught:
            normalize_positions(bad_folder)
        self.assertEqual(str(caught.exception), "folder must be an object")
        missing_id = nested_structure()
        del _item(missing_id, "i-c3")["id"]
        normalized = normalize_positions(missing_id)
        nameless = [item for item in normalized["items"] if "id" not in item]
        self.assertEqual(len(nameless), 1)
        self.assertEqual(nameless[0]["position"], 1)

    def test_normalize_positions_closes_gaps_per_parent(self) -> None:
        structure = nested_structure()
        _item(structure, "i-c3")["position"] = 7
        normalized = normalize_positions(structure)
        self.assertEqual(_item(normalized, "i-c3")["position"], 1)
        self.assertEqual(_item(structure, "i-c3")["position"], 7)

    def test_descendants_collects_nested_folders_and_rejects_bad_input(self) -> None:
        self.assertEqual(descendants("part", nested_structure()), {"arc"})
        self.assertEqual(descendants("arc", nested_structure()), set())
        for structure in ([], {"items": "x"}, {}):
            with self.subTest(structure=structure):
                with self.assertRaises(ManuscriptTreeError) as caught:
                    descendants("part", structure)
                self.assertEqual(str(caught.exception), "manuscript structure needs an item list")


class MoveAndDeleteTests(unittest.TestCase):
    def assertRejected(self, message: str, call: Any, *args: Any) -> None:
        with self.assertRaises(ManuscriptTreeError) as caught:
            call(*args)
        self.assertEqual(str(caught.exception), message)

    def test_move_rejects_unknown_target_item_and_anchor(self) -> None:
        self.assertRejected(
            "target folder does not exist", move_item, CHAPTERS, nested_structure(), "i-c3", "ghost"
        )
        self.assertRejected(
            "tree item does not exist", move_item, CHAPTERS, nested_structure(), "ghost", None
        )
        self.assertRejected(
            "drop anchor is not a target sibling",
            move_item,
            CHAPTERS,
            nested_structure(),
            "i-c3",
            "part",
            "i-c1",
        )

    def test_move_rejects_a_folder_into_itself(self) -> None:
        self.assertRejected(
            "folder cannot move below itself",
            move_item,
            CHAPTERS,
            nested_structure(),
            "i-part",
            "part",
        )

    def test_dropping_an_item_before_itself_changes_nothing(self) -> None:
        source = nested_structure()
        expected = structure_or_flat(CHAPTERS, source)
        self.assertEqual(move_item(CHAPTERS, source, "i-c3", None, "i-c3"), expected)

    def test_moving_to_the_root_drops_the_parent_and_honours_the_anchor(self) -> None:
        moved = move_item(CHAPTERS, nested_structure(), "i-c2", None, "i-part")
        self.assertNotIn("parentFolderId", _item(moved, "i-c2"))
        self.assertEqual(flatten_tree(CHAPTERS, moved), ["c2", "c1", "c3"])

    def test_moving_into_a_folder_appends_after_its_children(self) -> None:
        moved = move_item(CHAPTERS, nested_structure(), "i-c3", "arc")
        self.assertEqual(_item(moved, "i-c3")["parentFolderId"], "arc")
        self.assertEqual(_item(moved, "i-c3")["position"], 1)

    def test_delete_rejects_an_unknown_folder(self) -> None:
        self.assertRejected(
            "folder does not exist", delete_folder, CHAPTERS, nested_structure(), "ghost"
        )

    def test_deleting_a_nested_folder_hands_its_children_to_the_parent(self) -> None:
        result = delete_folder(CHAPTERS, nested_structure(), "arc")
        self.assertEqual(_item(result, "i-c1")["parentFolderId"], "part")
        self.assertEqual([folder["id"] for folder in result["folders"]], ["part"])
        self.assertEqual(flatten_tree(CHAPTERS, result), ["c1", "c2", "c3"])

    def test_deleting_a_root_folder_hands_its_children_to_the_root(self) -> None:
        result = delete_folder(CHAPTERS, nested_structure(), "part")
        self.assertNotIn("parentFolderId", _item(result, "i-c2"))
        self.assertNotIn("parentFolderId", _item(result, "i-arc"))

    def test_breadcrumb_rejects_a_chapter_missing_from_the_binder(self) -> None:
        self.assertRejected(
            "chapter is absent from the binder",
            breadcrumb_for_chapter,
            "c9",
            CHAPTERS,
            nested_structure(),
        )


if __name__ == "__main__":
    unittest.main()
