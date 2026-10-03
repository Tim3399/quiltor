from __future__ import annotations

import unittest
import zipfile
from io import BytesIO
from unittest.mock import patch
from xml.etree import ElementTree as ET

from quiltor.infrastructure.exporting import docx as docx_export
from quiltor.infrastructure.exporting.docx import (
    DocxExportOptions,
    ExportChapter,
    ExportLimitExceeded,
    InvalidExportContent,
    serialize_docx,
)
from quiltor.infrastructure.importing.docx import parse_docx

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def document_xml(payload: bytes) -> ET.Element:
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        return ET.fromstring(archive.read("word/document.xml"))


class ManuscriptDocxExportTests(unittest.TestCase):
    def test_editor_round_trip_preserves_text_order_whitespace_and_utf16_marks(self):
        chapters = (
            ExportChapter(
                "Der Hafen & <Meer>",
                " 😀 Anfang\nZeile\tEnde \n\n\n\nLetzter Absatz ",
                (
                    {"from": 1, "to": 10, "kind": "bold"},
                    {"from": 4, "to": 18, "kind": "italic"},
                    {"from": 8, "to": 20, "kind": "bold"},
                ),
            ),
            ExportChapter("Die Reise", "Kurz", ()),
        )
        exported = serialize_docx(chapters)
        parsed = parse_docx("Roman.docx", exported.content)

        self.assertEqual(
            [chapter.title for chapter in parsed.chapters], [c.title for c in chapters]
        )
        self.assertEqual([chapter.body for chapter in parsed.chapters], [c.body for c in chapters])
        self.assertEqual(
            parsed.chapters[0].marks,
            (
                {"from": 1, "to": 20, "kind": "bold"},
                {"from": 4, "to": 18, "kind": "italic"},
            ),
        )
        self.assertEqual(exported.counts, {"chapters": 2, "paragraphs": 6, "words": 13})
        self.assertEqual(exported.warnings, ())

    def test_cross_paragraph_marks_preserve_formatting_on_visible_text(self):
        body = "😀A\n\nB\nC"
        exported = serialize_docx(
            [
                ExportChapter(
                    "Kapitel",
                    body,
                    (
                        {"from": 0, "to": 8, "kind": "bold"},
                        {"from": 2, "to": 7, "kind": "italic"},
                    ),
                )
            ],
            DocxExportOptions(page_numbers=False),
        )
        parsed = parse_docx("Roman.docx", exported.content).chapters[0]
        self.assertEqual(parsed.body, body)
        for offset, character in enumerate(body):
            if (
                body[offset : offset + 2] == "\n\n"
                or body[max(0, offset - 1) : offset + 1] == "\n\n"
            ):
                continue
            utf16_offset = len(body[:offset].encode("utf-16-le")) // 2
            expected_bold = utf16_offset < 8
            expected_italic = 2 <= utf16_offset < 7
            actual = {
                mark["kind"] for mark in parsed.marks if mark["from"] <= utf16_offset < mark["to"]
            }
            self.assertEqual("bold" in actual, expected_bold, character)
            self.assertEqual("italic" in actual, expected_italic, character)

    def test_presets_emit_exact_page_line_font_and_paragraph_properties(self):
        editor = serialize_docx([ExportChapter("Titel", "Text")]).content
        normseite = serialize_docx(
            [ExportChapter("Titel", "Text")], DocxExportOptions("normseite", False)
        ).content
        editor_root = document_xml(editor)
        norm_root = document_xml(normseite)

        editor_margin = editor_root.find(f".//{W}pgMar")
        self.assertEqual(
            {name: editor_margin.get(f"{W}{name}") for name in ("left", "right", "top", "bottom")},
            {"left": "1440", "right": "1440", "top": "1440", "bottom": "1440"},
        )
        norm_margin = norm_root.find(f".//{W}pgMar")
        self.assertEqual(
            {name: norm_margin.get(f"{W}{name}") for name in ("left", "right", "top", "bottom")},
            {"left": "1701", "right": "1563", "top": "1417", "bottom": "1021"},
        )
        self.assertEqual(11906 - 1701 - 1563, 8642)
        self.assertEqual((11906 - 1701 - 1563) - 60 * 144, 2)
        self.assertEqual(16838 - 1417 - 1021, 14400)
        self.assertEqual(norm_margin.get(f"{W}footer"), "598")
        self.assertEqual(editor_margin.get(f"{W}footer"), "720")
        norm_spacing = norm_root.findall(f".//{W}body/{W}p/{W}pPr/{W}spacing")
        self.assertTrue(norm_spacing)
        self.assertTrue(
            all(
                spacing.get(f"{W}line") == "480"
                and spacing.get(f"{W}lineRule") == "exact"
                and spacing.get(f"{W}before") == spacing.get(f"{W}after") == "0"
                for spacing in norm_spacing
            )
        )
        self.assertTrue(norm_root.findall(f".//{W}pageBreakBefore"))
        with zipfile.ZipFile(BytesIO(normseite)) as archive:
            styles = archive.read("word/styles.xml").decode()
            settings = archive.read("word/settings.xml").decode()
            self.assertIn("Courier New", styles)
            self.assertIn('w:autoHyphenation w:val="false"', settings)
            self.assertNotIn("footer1.xml", archive.namelist())
        with zipfile.ZipFile(BytesIO(editor)) as archive:
            self.assertIn("Times New Roman", archive.read("word/styles.xml").decode())
            self.assertIn("word/footer1.xml", archive.namelist())
            self.assertIn(" PAGE ", archive.read("word/footer1.xml").decode())

    def test_empty_titles_and_bodies_are_serialized_as_exact_heading_and_body_paragraphs(self):
        exported = serialize_docx(
            [ExportChapter("", ""), ExportChapter("", " \n\t ")],
            DocxExportOptions(page_numbers=False),
        )
        root = document_xml(exported.content)
        paragraphs = root.findall(f".//{W}body/{W}p")
        self.assertEqual(len(paragraphs), 4)
        heading_values = []
        for paragraph in paragraphs[::2]:
            self.assertIsNotNone(paragraph.find(f"{W}pPr/{W}pStyle"))
            heading_values.append(
                "".join(node.text or "" for node in paragraph.findall(f".//{W}t"))
            )
        self.assertEqual(heading_values, ["", ""])
        parsed = parse_docx("Empty.docx", exported.content)
        self.assertEqual([chapter.body for chapter in parsed.chapters], ["", " \n\t "])
        self.assertEqual([chapter.title for chapter in parsed.chapters], ["Kapitel 1", "Kapitel 2"])

    def test_archive_is_deterministic_and_contains_no_active_or_external_parts(self):
        chapters = [ExportChapter("Kapitel", "Text")]
        first = serialize_docx(chapters).content
        second = serialize_docx(
            [{"id": "chapter-1", "title": "Kapitel", "body": "Text", "marks": []}]
        ).content
        self.assertEqual(first, second)
        with zipfile.ZipFile(BytesIO(first)) as archive:
            names = set(archive.namelist())
            self.assertFalse(any(name.endswith((".bin", "vbaProject.bin")) for name in names))
            for name in names:
                self.assertFalse(name.startswith(("/", "../")))
            relationships = b"".join(archive.read(name) for name in names if name.endswith(".rels"))
            self.assertNotIn(b'TargetMode="External"', relationships)

    def test_missing_marks_and_large_alternating_formatting_are_bounded_and_linear(self):
        plain = serialize_docx([{"id": "one", "title": "Title", "body": "Body"}])
        self.assertEqual(parse_docx("plain.docx", plain.content).chapters[0].body, "Body")

        body = "a" * 2_000
        marks = [
            {"from": index, "to": index + 1, "kind": "bold" if index % 2 == 0 else "italic"}
            for index in range(len(body))
        ]
        formatted = serialize_docx([ExportChapter("Title", body, tuple(marks))])
        parsed = parse_docx("formatted.docx", formatted.content).chapters[0]
        self.assertEqual(parsed.body, body)
        self.assertEqual(len(parsed.marks), len(marks))

    def test_document_xml_budget_aborts_before_rendering_every_formatted_run(self):
        body = "a" * 200
        marks = tuple(
            {
                "from": index,
                "to": index + 1,
                "kind": "bold" if index % 2 == 0 else "italic",
            }
            for index in range(len(body))
        )
        with (
            patch("quiltor.infrastructure.exporting.docx.MAX_DOCUMENT_XML_BYTES", 3_000),
            patch.object(docx_export, "_run_xml", wraps=docx_export._run_xml) as render_run,
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_docx([ExportChapter("Title", body, marks)])
        self.assertLess(render_run.call_count, len(body))

    def test_text_and_paragraph_limits_are_checked_before_mark_normalization(self):
        chapter = ExportChapter("Title", "a\n\nb", ({"from": 0, "to": 1, "kind": "bold"},))
        for limit in ("MAX_TEXT_CHARS", "MAX_PARAGRAPHS"):
            with (
                self.subTest(limit=limit),
                patch(f"quiltor.infrastructure.exporting.docx.{limit}", 1),
                patch.object(docx_export, "_marks") as normalize_marks,
                self.assertRaises(ExportLimitExceeded),
            ):
                serialize_docx([chapter])
            normalize_marks.assert_not_called()

    def test_rejects_invalid_text_marks_options_and_resource_limits(self):
        invalid_chapters = (
            [ExportChapter("Bad\rtitle", "")],
            [ExportChapter("Bad\x00title", "")],
            [ExportChapter("Title", "😀", ({"from": 1, "to": 2, "kind": "bold"},))],
            [ExportChapter("Title", "text", ({"from": 0, "to": 5, "kind": "bold"},))],
            [ExportChapter("Title", "text", ({"from": 0, "to": 1, "kind": "underline"},))],
            [ExportChapter("Title", "text", ({"from": 0, "to": 1, "kind": []},))],
        )
        for chapters in invalid_chapters:
            with self.subTest(chapters=chapters), self.assertRaises(InvalidExportContent):
                serialize_docx(chapters)
        with self.assertRaises(InvalidExportContent):
            serialize_docx([])
        with self.assertRaises(InvalidExportContent):
            serialize_docx([ExportChapter("Title", "")], DocxExportOptions("unknown"))
        with self.assertRaises(InvalidExportContent):
            serialize_docx(
                [ExportChapter("Title", "")],
                DocxExportOptions([]),  # type: ignore[arg-type]
            )
        with (
            patch("quiltor.infrastructure.exporting.docx.MAX_PARAGRAPHS", 1),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_docx([ExportChapter("Title", "")])
        with (
            patch("quiltor.infrastructure.exporting.docx.MAX_DOCX_BYTES", 1),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_docx([ExportChapter("Title", "text")])
        with (
            patch("quiltor.infrastructure.exporting.docx.MAX_DOCUMENT_XML_BYTES", 1),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_docx([ExportChapter("Title", "text")])
        with (
            patch("quiltor.infrastructure.exporting.docx.MAX_XML_NODES", 1),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_docx([ExportChapter("Title", "text")])


if __name__ == "__main__":
    unittest.main()
