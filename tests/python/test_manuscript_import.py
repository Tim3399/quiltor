from __future__ import annotations

import io
import os
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from quiltor.application.document_wire_v1 import InvalidDocumentWireV1, encode_document_v1
from quiltor.application.manuscript_import import (
    ConflictingManuscriptRequest,
    InvalidManuscriptFile,
    InvalidManuscriptSelection,
    ManuscriptPublicationFailed,
    ManuscriptWarningsUnacknowledged,
    UnsupportedManuscriptContent,
)
from quiltor.infrastructure.importing.docx import parse_docx
from quiltor.infrastructure.persistence.manuscript_import import SQLiteManuscriptImportRepository
from quiltor.infrastructure.persistence.sqlite import manuscript
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def docx(document: str, *, styles: str = "", extras: dict[str, bytes] | None = None) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document)
        if styles:
            archive.writestr("word/styles.xml", styles)
        for name, payload in (extras or {}).items():
            archive.writestr(name, payload)
    return target.getvalue()


def document(body: str) -> str:
    return f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr/></w:body></w:document>'


def paragraph(text: str, *, style: str = "", run_properties: str = "") -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}<w:r>{run_properties}<w:t>{text}</w:t></w:r></w:p>"


STYLES = f"""<w:styles xmlns:w="{W}">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="StrongBody"><w:name w:val="Strong Body"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>"""


class DocxParserTests(unittest.TestCase):
    def test_parses_headings_as_chapters_with_utf16_marks_and_style_overrides(self):
        first_body = (
            '<w:p><w:pPr><w:pStyle w:val="StrongBody"/></w:pPr>'
            '<w:r><w:t>😀 Der</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Emphasis"/>'
            '<w:b w:val="false"/></w:rPr><w:t> Morgen</w:t></w:r></w:p>'
        )
        payload = docx(
            document(
                paragraph("Der Hafen", style="Heading1")
                + first_body
                + paragraph("Die Reise", style="Heading1")
                + paragraph("Anna brach auf.")
            ),
            styles=STYLES,
        )

        parsed = parse_docx("Roman.docx", payload)

        self.assertEqual([chapter.title for chapter in parsed.chapters], ["Der Hafen", "Die Reise"])
        self.assertEqual(parsed.chapters[0].body, "😀 Der Morgen")
        self.assertEqual(
            parsed.chapters[0].marks,
            (
                {"from": 0, "to": 6, "kind": "bold"},
                {"from": 6, "to": 13, "kind": "italic"},
            ),
        )
        self.assertEqual((parsed.source_words, parsed.source_paragraphs), (9, 4))

    def test_reports_frozen_loss_warnings_and_fails_closed_on_tables(self):
        warning_body = (
            paragraph("Kapitel", style="Heading1")
            + "<w:p><w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink>"
            + "<w:r><w:drawing/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>"
        )
        parsed = parse_docx(
            "Warnung.docx",
            docx(
                document(warning_body),
                styles=STYLES,
                extras={"word/header1.xml": b"<header/>", "word/footnotes.xml": b"<notes/>"},
            ),
        )
        self.assertEqual(
            {warning["code"] for warning in parsed.warnings},
            {"fields", "footnotes_endnotes", "headers_footers", "hyperlinks", "images"},
        )
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_docx("Tabelle.docx", docx(document("<w:tbl/>")))
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_docx(
                "Content-Control.docx",
                docx(
                    document(f"<w:sdt><w:sdtContent>{paragraph('Hidden')}</w:sdtContent></w:sdt>")
                ),
            )

    def test_character_style_adds_to_inherited_paragraph_formatting(self):
        body = (
            '<w:p><w:pPr><w:pStyle w:val="StrongBody"/></w:pPr><w:r>'
            '<w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>Text</w:t></w:r></w:p>'
        )
        parsed = parse_docx("Stile.docx", docx(document(body), styles=STYLES))
        self.assertEqual(
            parsed.chapters[0].marks,
            (
                {"from": 0, "to": 4, "kind": "bold"},
                {"from": 0, "to": 4, "kind": "italic"},
            ),
        )

    def test_warns_for_unsupported_default_formatting_and_preserves_known_hyphens(self):
        styles = f"""<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault>
          <w:rPr><w:u w:val="single"/></w:rPr>
        </w:rPrDefault></w:docDefaults></w:styles>"""
        body = (
            "<w:p><w:r><w:t>A</w:t><w:noBreakHyphen/><w:t>B</w:t>"
            "<w:softHyphen/><w:t>C</w:t></w:r></w:p>"
        )
        parsed = parse_docx("Defaults.docx", docx(document(body), styles=styles))
        self.assertEqual(parsed.chapters[0].body, "A‑B\u00adC")
        self.assertEqual(parsed.warnings, ({"code": "formatting", "count": 1},))

    def test_fails_closed_on_unsupported_visible_run_content(self):
        body = '<w:p><w:r><w:t>A</w:t><w:sym w:char="F041"/></w:r></w:p>'
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_docx("Symbol.docx", docx(document(body)))

    def test_rejects_utf16_dtd_and_excessive_xml_depth(self):
        unsafe = (
            f'<?xml version="1.0" encoding="utf-16"?><!DOCTYPE w:document '
            f'[<!ENTITY x "lost">]><w:document xmlns:w="{W}"><w:body>'
            f"<w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>"
        ).encode("utf-16")
        with self.assertRaises(InvalidManuscriptFile):
            parse_docx("unsafe.docx", docx("", extras={"unused": b"x"})[:-1])
        with self.assertRaises(InvalidManuscriptFile):
            parse_docx("unsafe.docx", _archive_with_document(unsafe))
        nested = "<w:sdt>" * 130 + paragraph("text") + "</w:sdt>" * 130
        from quiltor.application.manuscript_import import ManuscriptLimitExceeded

        with self.assertRaises(ManuscriptLimitExceeded):
            parse_docx("deep.docx", docx(document(nested)))


def _archive_with_document(payload: bytes) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", payload)
    return target.getvalue()


class ManuscriptImportRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.paths = SQLitePaths.from_data_directory(Path(self.temporary.name))
        self.repository = SQLiteManuscriptImportRepository(self.paths)
        self.payload = docx(
            document(
                paragraph("Der Hafen", style="Heading1")
                + paragraph("Morgen am Meer.")
                + paragraph("Die Reise", style="Heading1")
                + paragraph("Anna fährt.")
            ),
            styles=STYLES,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_preview_merge_retains_heading_and_validates_exact_partition(self):
        preview = self.repository.preview(
            "Roman.docx",
            self.payload,
            {
                "title": "Neuer Roman",
                "chapters": [{"sourceIndexes": [0, 1], "title": "Gemeinsam"}],
            },
        )
        self.assertEqual(
            preview["chapters"][0]["body"], "Morgen am Meer.\n\nDie Reise\n\nAnna fährt."
        )
        self.assertEqual(preview["counts"]["sourceParagraphs"], 4)
        self.assertEqual(preview["counts"]["importedParagraphs"], 4)
        with self.assertRaises(InvalidManuscriptSelection):
            self.repository.preview(
                "Roman.docx",
                self.payload,
                {"title": "Roman", "chapters": [{"sourceIndexes": [1], "title": "Lost"}]},
            )

    def test_publish_is_atomic_idempotent_owner_scoped_and_persists_provenance(self):
        preview = self.repository.preview("Roman.docx", self.payload)
        chapters = [
            {"sourceIndexes": chapter["sourceIndexes"], "title": chapter["title"]}
            for chapter in preview["chapters"]
        ]
        request_id = str(uuid.uuid4())
        first = self.repository.publish(
            "Roman.docx",
            self.payload,
            preview["sourceSha256"],
            preview["title"],
            chapters,
            [],
            request_id,
            "alice",
        )
        retry = self.repository.publish(
            "Roman.docx",
            self.payload,
            preview["sourceSha256"],
            preview["title"],
            chapters,
            [],
            request_id,
            "alice",
        )
        bob = self.repository.publish(
            "Roman.docx",
            self.payload,
            preview["sourceSha256"],
            preview["title"],
            chapters,
            [],
            request_id,
            "bob",
        )
        self.assertEqual(first, retry)
        self.assertNotEqual(first["id"], bob["id"])
        persisted = manuscript.load(self.paths.worlds / f"{first['id']}.sqlite3")
        self.assertEqual(persisted["importSource"]["fileName"], "Roman.docx")
        self.assertEqual(persisted["importSource"]["sourceSha256"], preview["sourceSha256"])
        self.assertNotIn("dataBase64", persisted["importSource"])
        with self.assertRaises(ConflictingManuscriptRequest):
            self.repository.publish(
                "Roman.docx",
                self.payload,
                preview["sourceSha256"],
                "Andere Fassung",
                chapters,
                [],
                request_id,
                "alice",
            )

    def test_warnings_require_acknowledgment_and_publication_failure_leaves_no_world(self):
        warning_payload = docx(
            document(
                paragraph("Kapitel", style="Heading1")
                + "<w:p><w:hyperlink><w:r><w:t>Text</w:t></w:r></w:hyperlink></w:p>"
            ),
            styles=STYLES,
        )
        preview = self.repository.preview("Warnung.docx", warning_payload)
        chapters = [
            {"sourceIndexes": chapter["sourceIndexes"], "title": chapter["title"]}
            for chapter in preview["chapters"]
        ]
        with self.assertRaises(ManuscriptWarningsUnacknowledged):
            self.repository.publish(
                "Warnung.docx",
                warning_payload,
                preview["sourceSha256"],
                preview["title"],
                chapters,
                [],
                str(uuid.uuid4()),
                "alice",
            )
        with (
            patch.object(os, "link", side_effect=OSError("disk failure")),
            self.assertRaises(ManuscriptPublicationFailed),
        ):
            self.repository.publish(
                "Warnung.docx",
                warning_payload,
                preview["sourceSha256"],
                preview["title"],
                chapters,
                ["hyperlinks"],
                str(uuid.uuid4()),
                "alice",
            )
        self.assertEqual(list(self.paths.worlds.glob("*.sqlite3")), [])

    def test_import_provenance_is_validated_at_the_document_wire_boundary(self):
        source = {
            "version": 1,
            "fileName": "Roman.docx",
            "format": "docx",
            "sourceSha256": "a" * 64,
            "importedAt": "2026-10-02T12:34:56.123456Z",
            "counts": {
                "sourceWords": 1,
                "sourceParagraphs": 1,
                "importedWords": 1,
                "importedParagraphs": 1,
            },
            "warnings": [{"code": "formatting", "count": 1}],
            "futureField": {"preserved": True},
        }
        envelope = encode_document_v1("manuscript", {"chapters": [], "importSource": source})
        self.assertEqual(envelope["payload"]["importSource"]["futureField"], {"preserved": True})
        for field, invalid in (
            ("sourceSha256", "A" * 64),
            ("importedAt", "2026-10-02T12:34:56+00:00"),
            ("fileName", " "),
        ):
            with self.subTest(field=field):
                changed = dict(source)
                changed[field] = invalid
                with self.assertRaises(InvalidDocumentWireV1):
                    encode_document_v1("manuscript", {"chapters": [], "importSource": changed})
        duplicated = dict(source)
        duplicated["warnings"] = [
            {"code": "formatting", "count": 1},
            {"code": "formatting", "count": 2},
        ]
        with self.assertRaises(InvalidDocumentWireV1):
            encode_document_v1("manuscript", {"chapters": [], "importSource": duplicated})
        malformed_code = dict(source)
        malformed_code["warnings"] = [{"code": [], "count": 1}]
        with self.assertRaises(InvalidDocumentWireV1):
            encode_document_v1("manuscript", {"chapters": [], "importSource": malformed_code})
        version_two = dict(source, version=2, format="markdown")
        encoded_v2 = encode_document_v1("manuscript", {"chapters": [], "importSource": version_two})
        self.assertEqual(encoded_v2["payload"]["importSource"]["format"], "markdown")
        invalid_v1_format = dict(source, format="txt")
        with self.assertRaises(InvalidDocumentWireV1):
            encode_document_v1("manuscript", {"chapters": [], "importSource": invalid_v1_format})
        invalid_v2_format = dict(source, version=2, format=[])
        with self.assertRaises(InvalidDocumentWireV1):
            encode_document_v1("manuscript", {"chapters": [], "importSource": invalid_v2_format})


if __name__ == "__main__":
    unittest.main()
