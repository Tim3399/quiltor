from __future__ import annotations

import unittest
import zipfile
from io import BytesIO
from unittest.mock import patch
from xml.etree import ElementTree as ET

from quiltor.application.manuscript_export import ExportLimitExceeded, InvalidExportContent
from quiltor.infrastructure.exporting import epub as epub_export
from quiltor.infrastructure.exporting.docx import ExportChapter
from quiltor.infrastructure.exporting.epub import EpubExportOptions, serialize_epub

XHTML = "{http://www.w3.org/1999/xhtml}"
OPF = "{http://www.idpf.org/2007/opf}"
DC = "{http://purl.org/dc/elements/1.1/}"


def archive_files(payload: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def visible_text(element: ET.Element) -> str:
    result = [element.text or ""]
    for child in element:
        result.append("\n" if child.tag == f"{XHTML}br" else visible_text(child))
        result.append(child.tail or "")
    return "".join(result)


class ManuscriptEpubExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.options = EpubExportOptions(
            title="Mein & Manuskript",
            author="Ada <Autorin>",
            language="de",
            identifier="urn:isbn:9780000000000",
            modified="2026-10-03T12:34:56Z",
        )

    def test_package_has_epub_structure_metadata_and_ordered_spine(self):
        exported = serialize_epub(
            [ExportChapter("Erstes", "Text"), ExportChapter("Zweites", "Mehr")],
            self.options,
        )
        with zipfile.ZipFile(BytesIO(exported.content)) as archive:
            infos = archive.infolist()
            self.assertEqual(infos[0].filename, "mimetype")
            self.assertEqual(infos[0].compress_type, zipfile.ZIP_STORED)
            self.assertEqual(archive.read("mimetype"), b"application/epub+zip")
            self.assertEqual(
                set(archive.namelist()),
                {
                    "mimetype",
                    "META-INF/container.xml",
                    "EPUB/package.opf",
                    "EPUB/nav.xhtml",
                    "EPUB/styles.css",
                    "EPUB/chapter-00001.xhtml",
                    "EPUB/chapter-00002.xhtml",
                },
            )

            package = ET.fromstring(archive.read("EPUB/package.opf"))
            self.assertEqual(package.findtext(f".//{DC}title"), "Mein & Manuskript")
            self.assertEqual(package.findtext(f".//{DC}creator"), "Ada <Autorin>")
            self.assertEqual(package.findtext(f".//{DC}language"), "de")
            self.assertEqual(package.findtext(f".//{DC}identifier"), "urn:isbn:9780000000000")
            self.assertEqual(
                package.findtext(f'.//{OPF}meta[@property="dcterms:modified"]'),
                "2026-10-03T12:34:56Z",
            )
            self.assertEqual(
                [item.get("idref") for item in package.findall(f".//{OPF}spine/{OPF}itemref")],
                ["chapter-00001", "chapter-00002"],
            )
            nav = ET.fromstring(archive.read("EPUB/nav.xhtml"))
            self.assertEqual(
                [(link.text, link.get("href")) for link in nav.findall(f".//{XHTML}a")],
                [
                    ("Erstes", "chapter-00001.xhtml"),
                    ("Zweites", "chapter-00002.xhtml"),
                ],
            )
        self.assertEqual(exported.counts, {"chapters": 2, "paragraphs": 4, "words": 4})

    def test_chapter_preserves_text_paragraphs_soft_breaks_tabs_and_utf16_formatting(self):
        body = " 😀A & <B>\nZeile\tEnde \n\n\n\nLetzter Absatz "
        exported = serialize_epub(
            [
                ExportChapter(
                    "Titel & <Kapitel>",
                    body,
                    (
                        {"from": 1, "to": 9, "kind": "bold"},
                        {"from": 3, "to": 18, "kind": "italic"},
                        {"from": 7, "to": 20, "kind": "bold"},
                    ),
                )
            ],
            self.options,
        )
        chapter_bytes = archive_files(exported.content)["EPUB/chapter-00001.xhtml"]
        self.assertIn(b"&amp;", chapter_bytes)
        self.assertIn(b"&lt;Kapitel&gt;", chapter_bytes)
        root = ET.fromstring(chapter_bytes)
        self.assertEqual(root.findtext(f".//{XHTML}h1"), "Titel & <Kapitel>")
        paragraphs = root.findall(f".//{XHTML}p")
        self.assertEqual([visible_text(item) for item in paragraphs], body.split("\n\n"))
        self.assertTrue(root.findall(f".//{XHTML}strong/{XHTML}em"))
        self.assertTrue(root.findall(f".//{XHTML}em"))
        self.assertNotIn(b"<script", chapter_bytes)

    def test_blank_titles_preserve_headings_with_german_technical_fallbacks(self):
        exported = serialize_epub(
            [ExportChapter("", ""), ExportChapter(" \t", "Text")], self.options
        )
        files = archive_files(exported.content)
        chapter = ET.fromstring(files["EPUB/chapter-00001.xhtml"])
        heading = chapter.find(f".//{XHTML}h1")
        self.assertIsNotNone(heading)
        self.assertEqual(heading.text, None)
        self.assertEqual(chapter.findtext(f".//{XHTML}head/{XHTML}title"), "Kapitel 1")
        whitespace_chapter = ET.fromstring(files["EPUB/chapter-00002.xhtml"])
        self.assertEqual(whitespace_chapter.findtext(f".//{XHTML}h1"), " \t")
        self.assertEqual(whitespace_chapter.findtext(f".//{XHTML}head/{XHTML}title"), "Kapitel 2")
        nav = ET.fromstring(files["EPUB/nav.xhtml"])
        self.assertEqual(
            [link.text for link in nav.findall(f".//{XHTML}a")], ["Kapitel 1", "Kapitel 2"]
        )

    def test_archive_and_derived_identifier_are_deterministic_with_explicit_timestamp(self):
        options = EpubExportOptions(modified="2026-01-02T03:04:05Z")
        first = serialize_epub([ExportChapter("Kapitel", "Text")], options).content
        second = serialize_epub(
            [{"id": "ignored", "title": "Kapitel", "body": "Text", "marks": []}],
            options,
        ).content
        self.assertEqual(first, second)
        package = ET.fromstring(archive_files(first)["EPUB/package.opf"])
        identifier = package.findtext(f".//{DC}identifier")
        self.assertRegex(identifier or "", r"^urn:sha256:[0-9a-f]{64}$")

    def test_large_alternating_formatting_is_rendered_without_losing_text(self):
        body = "a" * 2_000
        marks = tuple(
            {
                "from": index,
                "to": index + 1,
                "kind": "bold" if index % 2 == 0 else "italic",
            }
            for index in range(len(body))
        )
        exported = serialize_epub([ExportChapter("Title", body, marks)], self.options)
        chapter = ET.fromstring(archive_files(exported.content)["EPUB/chapter-00001.xhtml"])
        paragraph = chapter.find(f".//{XHTML}p")
        self.assertIsNotNone(paragraph)
        self.assertEqual(visible_text(paragraph), body)
        self.assertEqual(len(chapter.findall(f".//{XHTML}strong")), 1_000)
        self.assertEqual(len(chapter.findall(f".//{XHTML}em")), 1_000)

    def test_rejects_invalid_xml_text_marks_options_and_timestamp(self):
        invalid_chapters = (
            [ExportChapter("Bad\rtitle", "")],
            [ExportChapter("Bad\x00title", "")],
            [ExportChapter("Title", "😀", ({"from": 1, "to": 2, "kind": "bold"},))],
            [ExportChapter("Title", "text", ({"from": 0, "to": 5, "kind": "bold"},))],
            [ExportChapter("Title", "text", ({"from": 0, "to": 1, "kind": "link"},))],
        )
        for chapters in invalid_chapters:
            with self.subTest(chapters=chapters), self.assertRaises(InvalidExportContent):
                serialize_epub(chapters, self.options)
        invalid_options = (
            EpubExportOptions(title="", modified="2026-01-02T03:04:05Z"),
            EpubExportOptions(title=" \t", modified="2026-01-02T03:04:05Z"),
            EpubExportOptions(language="not a tag", modified="2026-01-02T03:04:05Z"),
            EpubExportOptions(identifier="", modified="2026-01-02T03:04:05Z"),
            EpubExportOptions(identifier=" \t", modified="2026-01-02T03:04:05Z"),
            EpubExportOptions(modified="2026-02-30T03:04:05Z"),
            EpubExportOptions(modified="2026-01-02T03:04:05+00:00"),
        )
        for options in invalid_options:
            with self.subTest(options=options), self.assertRaises(InvalidExportContent):
                serialize_epub([ExportChapter("Title", "")], options)
        with self.assertRaises(InvalidExportContent):
            serialize_epub([], self.options)

    def test_metadata_limits_fail_before_package_document_generation(self):
        invalid_options = (
            EpubExportOptions(title="t" * 1_001),
            EpubExportOptions(author="a" * 1_001),
            EpubExportOptions(language="de-" + "x" * 62),
            EpubExportOptions(identifier="urn:" + "i" * 253),
        )
        for options in invalid_options:
            with (
                self.subTest(options=options),
                patch.object(epub_export, "_package_document") as package_document,
                self.assertRaises(InvalidExportContent),
            ):
                serialize_epub([ExportChapter("Title", "Body")], options)
            package_document.assert_not_called()

    def test_stylesheet_inherits_reader_colors(self):
        exported = serialize_epub([ExportChapter("Title", "Body")], self.options)
        stylesheet = archive_files(exported.content)["EPUB/styles.css"]
        self.assertNotIn(b"color:", stylesheet)
        self.assertNotIn(b"background:", stylesheet)
        self.assertIn(b"font-family: serif", stylesheet)

    def test_input_and_generated_output_limits_fail_early(self):
        chapter = ExportChapter("Title", "a\n\nb", ({"from": 0, "to": 1, "kind": "bold"},))
        for limit in ("MAX_TEXT_CHARS", "MAX_PARAGRAPHS"):
            with (
                self.subTest(limit=limit),
                patch(f"quiltor.infrastructure.exporting.epub.{limit}", 1),
                patch.object(epub_export, "_marks") as normalize_marks,
                self.assertRaises(ExportLimitExceeded),
            ):
                serialize_epub([chapter], self.options)
            normalize_marks.assert_not_called()
        with (
            patch("quiltor.infrastructure.exporting.epub.MAX_EXPANDED_BYTES", 400),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_epub([ExportChapter("Title", "a" * 1_000)], self.options)
        with (
            patch("quiltor.infrastructure.exporting.epub.MAX_CONTENT_DOCUMENT_BYTES", 400),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_epub([ExportChapter("Title", "a" * 1_000)], self.options)
        with (
            patch("quiltor.infrastructure.exporting.epub.MAX_XML_NODES", 7),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_epub([ExportChapter("Title", "Body")], self.options)
        with (
            patch("quiltor.infrastructure.exporting.epub.MAX_EPUB_BYTES", 1),
            self.assertRaises(ExportLimitExceeded),
        ):
            serialize_epub([ExportChapter("Title", "Body")], self.options)


if __name__ == "__main__":
    unittest.main()
