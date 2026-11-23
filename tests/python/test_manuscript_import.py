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
from quiltor.infrastructure.importing.docx import parse_docx, parse_docx_units
from quiltor.infrastructure.importing.text_formats import parse_markdown_units
from quiltor.infrastructure.persistence.manuscript_import import SQLiteManuscriptImportRepository
from quiltor.infrastructure.persistence.sqlite import manuscript
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WORD_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "manuscript-import"


def notes(tag: str, *, separators_only: bool) -> bytes:
    """A notes part as Word writes it: two separator entries, then the author's notes."""

    entries = (
        f'<w:{tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:{tag}>'
        f'<w:{tag} w:type="continuationSeparator" w:id="0">'
        f"<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:{tag}>"
    )
    if not separators_only:
        entries += f'<w:{tag} w:id="1"><w:p><w:r><w:t>Anmerkung</w:t></w:r></w:p></w:{tag}>'
    return f'<w:{tag}s xmlns:w="{W}">{entries}</w:{tag}s>'.encode()


NOTES_WITH_ONE = notes("footnote", separators_only=False)


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
                extras={"word/header1.xml": b"<header/>", "word/footnotes.xml": NOTES_WITH_ONE},
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

    def test_a_notes_part_holding_only_words_separators_warns_of_nothing(self):
        for part in ("word/footnotes.xml", "word/endnotes.xml"):
            with self.subTest(part=part):
                tag = "footnote" if part == "word/footnotes.xml" else "endnote"
                parsed = parse_docx(
                    "Trenner.docx",
                    docx(
                        document(paragraph("Kapitel", style="Heading1") + paragraph("Text")),
                        styles=STYLES,
                        extras={part: notes(tag, separators_only=True)},
                    ),
                )
                self.assertEqual(parsed.warnings, ())

    def test_a_real_endnote_in_its_part_still_warns(self):
        parsed = parse_docx(
            "Endnote.docx",
            docx(
                document(paragraph("Kapitel", style="Heading1") + paragraph("Text")),
                styles=STYLES,
                extras={"word/endnotes.xml": notes("endnote", separators_only=False)},
            ),
        )
        self.assertEqual(parsed.warnings, ({"code": "footnotes_endnotes", "count": 1},))

    def test_symbols_become_characters_and_an_unknown_one_becomes_a_replacement(self):
        cases = {
            '<w:sym w:font="Symbol" w:char="F061"/>': "\u03b1",  # alpha
            '<w:sym w:font="Symbol" w:char="F0AE"/>': "→",
            '<w:sym w:font="Symbol" w:char="0057"/>': "Ω",
            '<w:sym w:font="Arial" w:char="2192"/>': "→",
            # A picture font has no Unicode meaning: U+FFFD, counted as lost formatting.
            '<w:sym w:font="Wingdings" w:char="F0AB"/>': "\ufffd",
            '<w:sym w:font="Symbol" w:char="F0FF"/>': "\ufffd",
            '<w:sym w:font="Arial" w:char="E001"/>': "\ufffd",
            '<w:sym w:font="Arial" w:char="zz"/>': "\ufffd",
        }
        for sym, expected in cases.items():
            with self.subTest(sym=sym):
                body = paragraph("Kapitel", style="Heading1") + f"<w:p><w:r>{sym}</w:r></w:p>"
                parsed = parse_docx("Symbol.docx", docx(document(body), styles=STYLES))
                self.assertEqual(parsed.chapters[0].body, expected)
                lost = [w["count"] for w in parsed.warnings if w["code"] == "formatting"]
                self.assertEqual(lost, [1] if expected == "\ufffd" else [])

    def test_a_multi_page_file_saved_by_word_imports(self):
        """F0: Word writes `w:lastRenderedPageBreak` into every run that began a page."""

        payload = (WORD_FIXTURES / "word-multipage.docx").read_bytes()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            self.assertIn(b"lastRenderedPageBreak", archive.read("word/document.xml"))
        parsed = parse_docx("word-multipage.docx", payload)
        self.assertEqual(
            [chapter.title for chapter in parsed.chapters],
            [
                "Die Ankunft",
                "Das Archiv",
                "Das letzte Blatt",
                "Gerüchte am Salzmarkt",
                "Vor dem Sturm",
                "Bruch mit der Gilde",
                "Die Überfahrt",
                "Die offene Küste",
            ],
        )
        self.assertTrue(parsed.chapters[0].body.startswith("Der Morgen lag still über dem Hafen."))
        self.assertNotIn("footnotes_endnotes", {w["code"] for w in parsed.warnings})

    def test_a_plain_word_file_brings_no_formatting_warning(self):
        """F0 has no formatting of its own; Word's default styles alone are no loss (T-337)."""

        parsed = parse_docx(
            "word-multipage.docx", (WORD_FIXTURES / "word-multipage.docx").read_bytes()
        )
        self.assertEqual(parsed.warnings, ())

    def test_only_a_used_style_that_cannot_be_mapped_warns_and_once_per_code(self):
        # Word's look in docDefaults, Normal and Heading 1 is replaced by Quiltor's own.
        # "Einzug" indents its paragraphs, which Quiltor cannot keep; "Ungenutzt" would too,
        # but no paragraph uses it.
        styles = f"""<w:styles xmlns:w="{W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
          <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/>
            <w:kern w:val="2"/><w:sz w:val="22"/><w:lang w:val="de-DE"/>
            <w14:ligatures w14:val="standardContextual"/></w:rPr></w:rPrDefault>
            <w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>
          <w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/>
            <w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
          <w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/>
            <w:basedOn w:val="Standard"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
            <w:rPr><w:color w:val="0F4761"/><w:sz w:val="40"/></w:rPr></w:style>
          <w:style w:type="paragraph" w:styleId="Einzug"><w:name w:val="Einzug"/>
            <w:basedOn w:val="Standard"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
          <w:style w:type="paragraph" w:styleId="Ungenutzt"><w:name w:val="Ungenutzt"/>
            <w:pPr><w:jc w:val="center"/></w:pPr></w:style>
        </w:styles>"""
        indented = '<w:p><w:pPr><w:pStyle w:val="Einzug"/></w:pPr><w:r><w:t>Zitat</w:t></w:r></w:p>'
        body = (
            paragraph("Kapitel", style="berschrift1")
            + "<w:p><w:r><w:t>Der Morgen lag still.</w:t></w:r></w:p>"
            + indented * 3
        )
        parsed = parse_docx("Einzug.docx", docx(document(body), styles=styles))
        self.assertEqual(parsed.chapters[0].title, "Kapitel")
        self.assertEqual(parsed.warnings, ({"code": "formatting", "count": 3},))
        without_loss = parse_docx(
            "Einzug.docx",
            docx(document(body.replace("Einzug", "Standard")), styles=styles),
        )
        self.assertEqual(without_loss.warnings, ())

    def test_a_word_file_with_inserted_symbols_imports_them(self):
        """F1: one Wingdings and one Symbol character inserted through Word's symbol dialog."""

        parsed = parse_docx("word-symbol.docx", (WORD_FIXTURES / "word-symbol.docx").read_bytes())
        self.assertIn("Kompassrose \ufffd und Windrichtung ⊥", parsed.chapters[0].body)

    def test_a_word_file_with_a_bookmark_and_a_language_mark_imports_without_warning(self):
        """F2: Word ends a bookmark over whole paragraphs in w:body, and marks a paragraph in
        another proofing language and a name excluded from proofing on the runs. Nothing of
        that is lost, so the file imports with no warning (F-334-1, F-337-1)."""

        payload = (WORD_FIXTURES / "word-markers.docx").read_bytes()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            xml = archive.read("word/document.xml")
        self.assertIn(b"</w:p><w:bookmarkEnd", xml)
        self.assertIn(b'<w:lang w:val="en-US"', xml)
        self.assertIn(b"<w:noProof/>", xml)
        parsed = parse_docx("word-markers.docx", payload)
        self.assertEqual([chapter.title for chapter in parsed.chapters], ["Die Ankunft"])
        self.assertTrue(parsed.chapters[0].body.startswith("Der Morgen lag still über dem Hafen."))
        self.assertIn("»Du bist spät«, sagte Iven Rook.", parsed.chapters[0].body)
        self.assertEqual(parsed.warnings, ())
        self.assertEqual(parse_docx_units("word-markers.docx", payload).warnings, ())

    def test_invisible_markers_between_paragraphs_are_skipped(self):
        for marker in (
            '<w:bookmarkStart w:id="1" w:name="Szene"/>',
            '<w:bookmarkEnd w:id="1"/>',
            '<w:permStart w:id="2" w:edGrp="everyone"/>',
            '<w:permEnd w:id="2"/>',
            '<w:proofErr w:type="spellStart"/>',
            '<w:commentRangeEnd w:id="3"/>',
            '<w:moveFromRangeStart w:id="4" w:name="m"/>',
            '<w:moveFromRangeEnd w:id="4"/>',
            '<w:moveToRangeStart w:id="5" w:name="m"/>',
            '<w:moveToRangeEnd w:id="5"/>',
        ):
            with self.subTest(marker=marker):
                body = (
                    paragraph("Kapitel", style="Heading1")
                    + paragraph("Der Morgen lag still.")
                    + marker
                    + paragraph("Mara blieb stehen.")
                )
                parsed = parse_docx("Marker.docx", docx(document(body), styles=STYLES))
                self.assertEqual(
                    parsed.chapters[0].body, "Der Morgen lag still.\n\nMara blieb stehen."
                )
                self.assertEqual(parsed.warnings, ())

    def test_a_comment_range_between_paragraphs_still_counts_as_a_comment(self):
        body = (
            paragraph("Kapitel", style="Heading1")
            + '<w:commentRangeStart w:id="3"/>'
            + paragraph("Der Morgen lag still.")
        )
        parsed = parse_docx("Kommentar.docx", docx(document(body), styles=STYLES))
        self.assertEqual(parsed.warnings, ({"code": "comments", "count": 1},))

    def test_moved_text_between_paragraphs_is_still_refused(self):
        body = paragraph("Der Morgen lag still.") + '<w:moveFrom w:id="6"><w:p/></w:moveFrom>'
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_docx("Verschoben.docx", docx(document(body), styles=STYLES))

    def test_tracked_moves_inside_a_paragraph_are_refused(self):
        # Word writes a tracked move in the paragraph: the old place in w:moveFrom, the new one
        # in w:moveTo. Both hold runs, so reading them would bring the text in twice (F-334-2).
        for tag in ("moveFrom", "moveTo"):
            with self.subTest(tag=tag):
                body = paragraph("Kapitel", style="Heading1") + (
                    f'<w:p><w:{tag} w:id="6" w:author="A"><w:r><w:t>Der Morgen lag still.</w:t>'
                    f"</w:r></w:{tag}></w:p>"
                )
                with self.assertRaises(UnsupportedManuscriptContent):
                    parse_docx("Verschoben.docx", docx(document(body), styles=STYLES))
        both = (
            '<w:p><w:moveFromRangeStart w:id="4" w:name="m"/><w:moveFrom w:id="5">'
            "<w:r><w:t>Der Morgen lag still.</w:t></w:r></w:moveFrom>"
            '<w:moveFromRangeEnd w:id="4"/><w:moveTo w:id="7"><w:r><w:t>Der Morgen lag still.'
            "</w:t></w:r></w:moveTo></w:p>"
        )
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_docx(
                "Verschoben.docx",
                docx(document(paragraph("K", style="Heading1") + both), styles=STYLES),
            )

    def test_complex_script_weight_in_heading_one_is_no_loss_but_in_body_text_it_is(self):
        # Word 2007/2010 and LibreOffice write w:bCs and w:iCs next to w:b and w:i into
        # Heading 1 (T-350). The title is set in Quiltor's own type, so nothing is lost there.
        styles = f"""<w:styles xmlns:w="{W}">
          <w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>
          <w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/>
            <w:basedOn w:val="Standard"/><w:pPr><w:keepNext/></w:pPr>
            <w:rPr><w:rFonts w:ascii="Cambria"/><w:b/><w:bCs/><w:i/><w:iCs/><w:color w:val="365F91"/>
              <w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
          <w:style w:type="paragraph" w:styleId="Fett"><w:name w:val="Fett"/>
            <w:basedOn w:val="Standard"/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
        </w:styles>"""
        title = paragraph("Kapitel", style="berschrift1")
        text = paragraph("Der Morgen lag still.", style="Standard")
        clean = parse_docx("Titel.docx", docx(document(title + text * 3), styles=styles))
        self.assertEqual(clean.warnings, ())
        bold_body = parse_docx(
            "Fett.docx", docx(document(title + paragraph("Text", style="Fett")), styles=styles)
        )
        self.assertEqual(bold_body.warnings, ({"code": "formatting", "count": 1},))
        bold_normal = styles.replace(
            '<w:name w:val="Normal"/>', '<w:name w:val="Normal"/><w:rPr><w:bCs/></w:rPr>'
        )
        normal = parse_docx("Standard.docx", docx(document(title + text), styles=bold_normal))
        # Two paragraphs warn: the text, and the title, which is based on Normal.
        self.assertEqual(normal.warnings, ({"code": "formatting", "count": 2},))
        on_run = parse_docx(
            "Lauf.docx",
            docx(
                document(title + paragraph("Text", run_properties="<w:rPr><w:bCs/></w:rPr>")),
                styles=styles,
            ),
        )
        self.assertEqual(on_run.warnings, ({"code": "formatting", "count": 1},))

    def test_proofing_marks_on_a_run_are_no_loss_but_its_typeface_is(self):
        for run_properties, lost in (
            ('<w:rPr><w:lang w:val="en-US"/></w:rPr>', []),
            ("<w:rPr><w:noProof/></w:rPr>", []),
            ('<w:rPr><w:lang w:val="en-US"/><w:noProof/><w:i/></w:rPr>', []),
            ('<w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr>', [1]),
            ('<w:rPr><w:lang w:val="en-US"/><w:sz w:val="40"/></w:rPr>', [1]),
        ):
            with self.subTest(run_properties=run_properties):
                body = paragraph("Kapitel", style="Heading1") + paragraph(
                    "She said nothing.", run_properties=run_properties
                )
                parsed = parse_docx("Sprache.docx", docx(document(body), styles=STYLES))
                self.assertEqual(
                    [w["count"] for w in parsed.warnings if w["code"] == "formatting"], lost
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
        self.assertEqual(parsed.chapters[0].body, "A\u2011B\u00adC")
        self.assertEqual(parsed.warnings, ({"code": "formatting", "count": 1},))

    def test_fails_closed_on_unsupported_visible_run_content(self):
        # An embedded OLE object is visible and has no text form. (`w:sym` was the example
        # here until T-334 turned symbols into characters.)
        body = "<w:p><w:r><w:t>A</w:t><w:object/></w:r></w:p>"
        with self.assertRaises(UnsupportedManuscriptContent):
            parse_docx("Objekt.docx", docx(document(body)))

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


class MarkdownSceneBreakTests(unittest.TestCase):
    def test_every_markdown_rule_form_imports_as_the_scene_break_the_book_layout_knows(self):
        before = "Sie las die Küstenlinie wie einen Brief."
        after = "Spät am Abend zählte Iven die Lampen im Lesesaal."
        for form in ("* * *", "***", "---", "___", "- - -", "_ _ _", "*****", "- - - - -"):
            with self.subTest(form=form):
                source = f"{before}\n\n{form}\n\n{after}\n".encode()
                parsed = parse_markdown_units("kapitel.md", source)
                self.assertEqual([unit.text for unit in parsed.units], [before, "* * *", after])
                self.assertEqual(parsed.warnings, ())


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
