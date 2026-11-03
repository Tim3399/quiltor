"""Characterises the export failures the route tests do not reach (T-19 P9).

Written before `manuscript_export.py` was typed strictly. The book metadata check runs on a
manuscript the wire has already accepted, which pins the language to `de-DE` and the
layout to an object, so its two rejections are reached by calling it directly.
"""

from __future__ import annotations

import copy
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import Mock

from quiltor.application.manuscript_export import (
    EmptyExportBook,
    InvalidExportContent,
    InvalidExportRequest,
    ManuscriptExportUseCases,
    validate_preset,
    word_count,
)
from tests.python.test_manuscript_export_routes import manuscript

DATABASE = Path("owned.sqlite")


def service(state: dict[str, Any], *, epub: bool = True) -> ManuscriptExportUseCases:
    documents = Mock()
    documents.load.side_effect = lambda *_: copy.deepcopy(state)
    documents.revision.return_value = 4
    return ManuscriptExportUseCases(
        documents, Mock(return_value=b"PK-docx"), Mock(return_value=b"PK-epub") if epub else None
    )


class EpubMetadataTests(unittest.TestCase):
    def test_a_layout_that_is_not_an_object_is_invalid_content(self) -> None:
        for layout in ([], "Der Hafen", None):
            with self.subTest(layout=layout), self.assertRaises(InvalidExportContent) as caught:
                ManuscriptExportUseCases._epub_metadata({"bookLayout": layout})
            self.assertEqual(str(caught.exception), "The book metadata is invalid.")

    def test_title_author_and_language_are_bounded(self) -> None:
        for state in (
            {"bookLayout": {"bookTitle": "t" * 1001}},
            {"bookLayout": {"author": 5}},
            {"language": 7},
            {"language": "d"},
            {"language": "deutsch"},
            {"language": "de_DE"},
            {"language": "de-" + "x" * 61},
        ):
            with self.subTest(state=state), self.assertRaises(InvalidExportContent) as caught:
                ManuscriptExportUseCases._epub_metadata(state)
            self.assertEqual(str(caught.exception), "The book metadata is invalid.")

    def test_metadata_is_trimmed_and_defaults_apply(self) -> None:
        self.assertEqual(
            ManuscriptExportUseCases._epub_metadata(
                {"bookLayout": {"bookTitle": "  ", "author": " Ada "}, "language": "en-GB-oxendict"}
            ),
            {"title": "Manuskript", "author": "Ada", "language": "en-GB-oxendict"},
        )
        self.assertEqual(
            ManuscriptExportUseCases._epub_metadata({}),
            {"title": "Manuskript", "author": "", "language": "de"},
        )


class ExportFailureTests(unittest.TestCase):
    def test_epub_without_a_renderer_is_an_invalid_request(self) -> None:
        with self.assertRaises(InvalidExportRequest) as caught:
            service(manuscript(), epub=False).preview(DATABASE, "epub")
        self.assertEqual(str(caught.exception), "EPUB export is unavailable.")

    def test_unknown_presets_are_invalid_requests(self) -> None:
        for preset in ("pdf", None, 1, "EPUB"):
            with self.subTest(preset=preset), self.assertRaises(InvalidExportRequest):
                validate_preset(preset)
        self.assertEqual(validate_preset("normseite"), "normseite")

    def test_a_manuscript_the_wire_refuses_cannot_be_exported(self) -> None:
        state = manuscript()
        state["language"] = "en-US"
        with self.assertRaises(InvalidExportContent) as caught:
            service(state).preview(DATABASE, "editor")
        self.assertEqual(str(caught.exception), "The saved manuscript cannot be exported.")

    def test_a_book_without_chapters_in_it_is_empty(self) -> None:
        state = manuscript()
        for chapter in state["chapters"]:
            chapter["inBook"] = False
        with self.assertRaises(EmptyExportBook):
            service(state).preview(DATABASE, "editor")

    def test_words_follow_ecmascript_whitespace(self) -> None:
        text = "Ada" + chr(0xA0) + "lief" + chr(0x2028) + "zum" + chr(0xFEFF) + "Kai. "
        self.assertEqual(word_count(text), 4)
        self.assertEqual(word_count(""), 0)


if __name__ == "__main__":
    unittest.main()
