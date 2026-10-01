from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quiltor.application.document_wire_v1 import (
    InvalidDocumentWireV1,
    decode_document_v1,
    encode_document_v1,
)
from quiltor.infrastructure.persistence.sqlite import manuscript, schema


def document() -> dict:
    return {
        "chapters": [{"id": "active", "title": "Aktiv", "body": "Text", "note": ""}],
        "trash": [
            {
                "chapter": {
                    "id": "deleted",
                    "inBook": False,
                    "title": "Gelöscht",
                    "body": "Mara im Archiv",
                    "note": "Mara",
                    "noteReferences": [
                        {
                            "id": "ref-1",
                            "target": {"kind": "entity", "id": "mara"},
                            "from": 0,
                            "to": 4,
                            "surface": "Mara",
                        }
                    ],
                    "storyTime": {"startMomentId": "arrival", "futureAnchor": True},
                    "futureChapter": {"kept": True},
                },
                "deletedAt": "2026-09-19T10:00:00.000Z",
                "originalFolderPath": [
                    {"id": "part-1", "title": "Teil Eins", "futureFolder": True}
                ],
                "treeItem": {
                    "id": "chapter:deleted",
                    "kind": "chapter",
                    "chapterId": "deleted",
                    "parentFolderId": "part-1",
                    "position": 2,
                    "futurePlacement": "kept",
                },
            }
        ],
    }


class ManuscriptTrashTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "world.sqlite3"
        schema.initialize(self.database)

    def tearDown(self):
        self.temporary.cleanup()

    def test_trash_round_trips_through_wire_and_sqlite_with_extensions(self):
        encoded = encode_document_v1("manuscript", document(), revision=4)
        decoded = decode_document_v1("manuscript", encoded)
        manuscript.save(decoded.payload, db_path=self.database)

        loaded = manuscript.load(self.database)
        self.assertEqual(loaded["trash"], document()["trash"])
        self.assertEqual(
            loaded["trash"][0]["chapter"]["noteReferences"][0]["target"],
            {"kind": "entity", "id": "mara"},
        )
        self.assertTrue(loaded["trash"][0]["chapter"]["futureChapter"]["kept"])
        self.assertIs(loaded["trash"][0]["chapter"]["inBook"], False)

    def test_malformed_duplicate_and_oversized_trash_are_rejected(self):
        cases = []
        duplicate_active = document()
        duplicate_active["trash"][0]["chapter"]["id"] = "active"
        duplicate_active["trash"][0]["treeItem"]["chapterId"] = "active"
        cases.append(duplicate_active)
        bad_timestamp = document()
        bad_timestamp["trash"][0]["deletedAt"] = "yesterday"
        cases.append(bad_timestamp)
        bad_tree = document()
        bad_tree["trash"][0]["treeItem"]["chapterId"] = "other"
        cases.append(bad_tree)
        oversized = document()
        oversized["trash"] = oversized["trash"] * 1001
        cases.append(oversized)
        invalid_in_book = document()
        invalid_in_book["trash"][0]["chapter"]["inBook"] = "false"
        cases.append(invalid_in_book)

        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(InvalidDocumentWireV1):
                encode_document_v1("manuscript", payload)


if __name__ == "__main__":
    unittest.main()
