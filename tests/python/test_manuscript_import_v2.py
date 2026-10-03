from __future__ import annotations

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from quiltor.application.manuscript_import import (
    ConflictingManuscriptRequest,
    InvalidManuscriptFile,
    InvalidManuscriptSelection,
    ManuscriptLimitExceeded,
    ManuscriptPublicationFailed,
    UnsupportedManuscriptContent,
)
from quiltor.domain.manuscript.tree import breadcrumb_for_chapter, flatten_tree
from quiltor.infrastructure.importing.docx import parse_docx_units
from quiltor.infrastructure.importing.text_formats import parse_markdown_units, parse_text_units
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.manuscript_import import SQLiteManuscriptImportRepository
from quiltor.infrastructure.persistence.project_archive import SQLiteProjectTransferRepository
from quiltor.infrastructure.persistence.sqlite import manuscript
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths
from tests.python.test_manuscript_import import STYLES, document, docx, paragraph


def import_chapters(preview):
    return [
        {
            "sourceIndexes": chapter["sourceIndexes"],
            "title": chapter["title"],
            "folderPath": chapter["folderPath"],
        }
        for chapter in preview["chapters"]
    ]


class TextFormatParserTests(unittest.TestCase):
    def test_txt_accepts_declared_unicode_encodings_and_normalizes_newlines(self):
        utf8 = parse_text_units("Notizen.TXT", b"Erste\r\nZeile\r\n\r\nZweite\r\n\r\n")
        self.assertEqual([unit.text for unit in utf8.units], ["Erste\nZeile", "Zweite", ""])
        utf16 = parse_text_units("Unicode.txt", b"\xff\xfe" + "😀 Text".encode("utf-16-le"))
        self.assertEqual(utf16.units[0].text, "😀 Text")
        whitespace = parse_text_units("Leer.txt", b"A\n \nB")
        self.assertEqual(whitespace.units[0].text, "A\n \nB")

    def test_txt_rejects_invalid_encoding_nul_and_binary_controls(self):
        for payload in (b"\xffbad", b"a\x00b", b"a\x01b"):
            with self.subTest(payload=payload), self.assertRaises(InvalidManuscriptFile):
                parse_text_units("bad.txt", payload)

    def test_markdown_preserves_visible_text_marks_and_frozen_warnings(self):
        source = (
            b"# **Hafen**\n\n"
            b"Text *kursiv* [Link](https://example.test) "
            b"![Bild *alt*](image.png) `code`\n\n"
            b"1. Eins\n\n> Zitat\n\n\\*literal\\*"
        )
        parsed = parse_markdown_units("Roman.Markdown", source)
        self.assertEqual(parsed.format, "markdown")
        self.assertEqual(
            [unit.is_heading for unit in parsed.units], [True, False, False, False, False]
        )
        self.assertEqual(parsed.units[0].text, "Hafen")
        self.assertEqual(parsed.units[0].marks, ({"from": 0, "to": 5, "kind": "bold"},))
        self.assertEqual(parsed.units[1].text, "Text kursiv Link Bild alt code")
        self.assertIn({"from": 5, "to": 11, "kind": "italic"}, parsed.units[1].marks)
        self.assertIn({"from": 22, "to": 25, "kind": "italic"}, parsed.units[1].marks)
        self.assertEqual(parsed.units[-1].text, "*literal*")
        self.assertEqual(
            {warning["code"] for warning in parsed.warnings},
            {"formatting", "hyperlinks", "images", "numbering"},
        )

    def test_markdown_fails_closed_for_html_and_bounds_nesting_and_tokens(self):
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_markdown_units("raw.md", b"<div>visible</div>")
        with self.assertRaises(ManuscriptLimitExceeded):
            parse_markdown_units("deep.md", (("> " * 70) + "Text").encode())
        with self.assertRaises(ManuscriptLimitExceeded):
            parse_markdown_units("tokens.md", ("**a** " * 100_001).encode())

    def test_heading_emphasis_is_reported_as_formatting_loss(self):
        parsed = parse_markdown_units("heading.md", b"# ***Hafen***")
        self.assertEqual(parsed.units[0].text, "Hafen")
        self.assertEqual(
            parsed.units[0].marks,
            (
                {"from": 0, "to": 5, "kind": "bold"},
                {"from": 0, "to": 5, "kind": "italic"},
            ),
        )
        self.assertEqual(parsed.warnings, ({"code": "formatting", "count": 1},))

    def test_nested_image_emphasis_has_canonical_nonoverlapping_marks(self):
        parsed = parse_markdown_units("image.md", b"**![**alt**](image.png)**")
        self.assertEqual(parsed.units[0].text, "alt")
        self.assertEqual(parsed.units[0].marks, ({"from": 0, "to": 3, "kind": "bold"},))


class DocxUnitParserTests(unittest.TestCase):
    def test_docx_units_are_actual_paragraphs_with_utf16_marks(self):
        payload = docx(
            document(
                paragraph("Kapitel", style="Heading1")
                + "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>😀 Text</w:t></w:r></w:p>"
            ),
            styles=STYLES,
        )
        parsed = parse_docx_units("Roman.docx", payload)
        self.assertEqual(
            [(unit.index, unit.text) for unit in parsed.units], [(0, "Kapitel"), (1, "😀 Text")]
        )
        self.assertTrue(parsed.units[0].is_heading)
        self.assertEqual(parsed.units[1].marks, ({"from": 0, "to": 7, "kind": "bold"},))

    def test_docx_v2_rejects_a_document_without_paragraph_units(self):
        with self.assertRaises(InvalidManuscriptFile):
            parse_docx_units("Leer.docx", docx(document("")))


class ManuscriptImportV2RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.paths = SQLitePaths.from_data_directory(Path(self.temporary.name))
        self.repository = SQLiteManuscriptImportRepository(self.paths)

    def tearDown(self):
        self.temporary.cleanup()

    def test_preview_supports_arbitrary_splits_merges_counts_and_blank_heading(self):
        payload = b"#\n\nErster Absatz\n\n## Innen\n\nLetzter Absatz"
        initial = self.repository.preview_v2("Roman.md", payload)
        self.assertEqual([unit["index"] for unit in initial["units"]], [0, 1, 2, 3])
        self.assertEqual(initial["counts"]["sourceParagraphs"], 4)
        self.assertEqual(initial["counts"]["importedParagraphs"], 4)
        self.assertEqual(initial["counts"]["importedWords"], initial["counts"]["sourceWords"])
        selected = self.repository.preview_v2(
            "Roman.md",
            payload,
            {
                "title": "Neu",
                "chapters": [
                    {"sourceIndexes": [0, 1], "title": "Anfang", "folderPath": ["Teil"]},
                    {"sourceIndexes": [2, 3], "title": "Innen neu", "folderPath": ["Teil"]},
                ],
            },
        )
        self.assertEqual(selected["chapters"][0]["body"], "\n\nErster Absatz")
        self.assertEqual(selected["chapters"][1]["body"], "Letzter Absatz")
        self.assertEqual(selected["counts"]["importedParagraphs"], 4)

    def test_folder_paths_persist_in_order_and_reentry_is_rejected(self):
        payload = b"eins\n\nzwei\n\ndrei"
        preview = self.repository.preview_v2("Roman.txt", payload)
        chapters = [
            {"sourceIndexes": [0], "title": "Eins", "folderPath": ["Teil"]},
            {"sourceIndexes": [1], "title": "Zwei", "folderPath": ["Teil", "Innen"]},
            {"sourceIndexes": [2], "title": "Drei", "folderPath": ["Teil"]},
        ]
        world = self.repository.publish_v2(
            "Roman.txt",
            payload,
            preview["sourceSha256"],
            "Roman",
            chapters,
            [],
            str(uuid.uuid4()),
            "alice",
        )
        saved = manuscript.load(self.paths.worlds / f"{world['id']}.sqlite3")
        chapter_ids = [chapter["id"] for chapter in saved["chapters"]]
        self.assertEqual(flatten_tree(chapter_ids, saved["structure"]), chapter_ids)
        self.assertEqual(
            breadcrumb_for_chapter(chapter_ids[1], chapter_ids, saved["structure"]),
            ["Teil", "Innen"],
        )
        self.assertEqual(saved["importSource"]["version"], 2)
        self.assertEqual(saved["importSource"]["format"], "txt")
        invalid = [
            {"sourceIndexes": [0], "title": "Eins", "folderPath": ["A"]},
            {"sourceIndexes": [1], "title": "Zwei", "folderPath": []},
            {"sourceIndexes": [2], "title": "Drei", "folderPath": ["A"]},
        ]
        with self.assertRaises(InvalidManuscriptSelection):
            self.repository.preview_v2(
                "Roman.txt", payload, {"title": "Roman", "chapters": invalid}
            )

    def test_selection_rejects_invalid_unit_partitions_and_folder_limits(self):
        payload = b"eins\n\nzwei\n\ndrei"
        invalid_chapters = (
            [{"sourceIndexes": [1, 2], "title": "X", "folderPath": []}],
            [{"sourceIndexes": [True, 1, 2], "title": "X", "folderPath": []}],
            [{"sourceIndexes": [0, 0, 2], "title": "X", "folderPath": []}],
            [{"sourceIndexes": [0, 2], "title": "X", "folderPath": []}],
            [{"sourceIndexes": [0, 1], "title": "X", "folderPath": []}],
            [{"sourceIndexes": [0, 1, 2], "title": "X", "folderPath": "A"}],
            [{"sourceIndexes": [0, 1, 2], "title": "X", "folderPath": [""]}],
            [{"sourceIndexes": [0, 1, 2], "title": "X", "folderPath": ["A"] * 9}],
            [{"sourceIndexes": [0, 1, 2], "title": "X", "folderPath": ["A" * 1001]}],
        )
        for chapters in invalid_chapters:
            with self.subTest(chapters=chapters), self.assertRaises(InvalidManuscriptSelection):
                self.repository.preview_v2(
                    "Roman.txt", payload, {"title": "Roman", "chapters": chapters}
                )

    def test_same_folder_title_under_different_parents_has_distinct_folders(self):
        payload = b"links\n\nrechts"
        preview = self.repository.preview_v2(
            "Roman.txt",
            payload,
            {
                "title": "Roman",
                "chapters": [
                    {"sourceIndexes": [0], "title": "Links", "folderPath": ["L", "Teil"]},
                    {
                        "sourceIndexes": [1],
                        "title": "Rechts",
                        "folderPath": ["R", "Teil"],
                    },
                ],
            },
        )
        world = self.repository.publish_v2(
            "Roman.txt",
            payload,
            preview["sourceSha256"],
            preview["title"],
            import_chapters(preview),
            [],
            str(uuid.uuid4()),
            "alice",
        )
        saved = manuscript.load(self.paths.worlds / f"{world['id']}.sqlite3")
        same_named = [
            folder for folder in saved["structure"]["folders"] if folder["title"] == "Teil"
        ]
        self.assertEqual(len(same_named), 2)
        self.assertNotEqual(same_named[0]["id"], same_named[1]["id"])

    def test_staged_structure_round_trip_failure_leaves_catalogue_unchanged(self):
        payload = b"eins\n\nzwei"
        preview = self.repository.preview_v2(
            "Roman.txt",
            payload,
            {
                "title": "Roman",
                "chapters": [
                    {
                        "sourceIndexes": [0, 1],
                        "title": "Roman",
                        "folderPath": ["Teil"],
                    }
                ],
            },
        )
        original_load = manuscript.load

        def mutate_structure(path=None):
            loaded = original_load(path)
            if loaded.get("structure", {}).get("folders"):
                loaded["structure"]["folders"][0]["title"] = "Anderer Teil"
            return loaded

        with (
            patch(
                "quiltor.infrastructure.persistence.manuscript_import.manuscript.load",
                side_effect=mutate_structure,
            ),
            self.assertRaises(ManuscriptPublicationFailed),
        ):
            self.repository.publish_v2(
                "Roman.txt",
                payload,
                preview["sourceSha256"],
                preview["title"],
                import_chapters(preview),
                [],
                str(uuid.uuid4()),
                "alice",
            )
        worlds = SQLiteWorldRepository(self.paths)
        worlds.prepare()
        self.assertEqual(worlds.list("alice"), [])
        self.assertEqual(list(self.paths.worlds.glob("*.sqlite3")), [])

    def test_v2_provenance_survives_save_and_portable_transfer(self):
        payload = b"eins\n\nzwei"
        preview = self.repository.preview_v2("Roman.txt", payload)
        world = self.repository.publish_v2(
            "Roman.txt",
            payload,
            preview["sourceSha256"],
            preview["title"],
            import_chapters(preview),
            [],
            str(uuid.uuid4()),
            "alice",
        )
        database = self.paths.worlds / f"{world['id']}.sqlite3"
        saved = manuscript.load(database)
        provenance = saved["importSource"]
        manuscript.save(saved, db_path=database)
        self.assertEqual(manuscript.load(database)["importSource"], provenance)

        transfer = SQLiteProjectTransferRepository(self.paths)
        _title, archive = transfer.export(world["id"], "alice")
        with tempfile.TemporaryDirectory() as destination:
            destination_paths = SQLitePaths.from_data_directory(Path(destination))
            imported = SQLiteProjectTransferRepository(destination_paths).import_archive(
                archive, "bob"
            )
            imported_database = destination_paths.worlds / f"{imported.id}.sqlite3"
            self.assertEqual(manuscript.load(imported_database)["importSource"], provenance)

    def test_direct_boundary_limit_and_cross_version_request_conflict(self):
        with self.assertRaises(ManuscriptLimitExceeded):
            self.repository.preview_v2("large.txt", b"x" * (8 * 1024 * 1024 + 1))
        payload = docx(document(paragraph("Text")))
        v1 = self.repository.preview("Roman.docx", payload)
        request_id = str(uuid.uuid4())
        self.repository.publish(
            "Roman.docx",
            payload,
            v1["sourceSha256"],
            v1["title"],
            [{"sourceIndexes": [0], "title": v1["chapters"][0]["title"]}],
            [],
            request_id,
            "alice",
        )
        v2 = self.repository.preview_v2("Roman.docx", payload)
        with self.assertRaises(ConflictingManuscriptRequest):
            self.repository.publish_v2(
                "Roman.docx",
                payload,
                v2["sourceSha256"],
                v2["title"],
                [{"sourceIndexes": [0], "title": "Text", "folderPath": []}],
                [],
                request_id,
                "alice",
            )


if __name__ == "__main__":
    unittest.main()
