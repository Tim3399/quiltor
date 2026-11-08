"""The shipped example world passes the server's own document boundary (T-214-4).

`src/quiltor/resources/example_world/{de,en}.json` are generated in Node from tests/world/
and read by the server. Nothing in Node knows the server's wire decoders, its validators or
its database schema, so a change on either side would only show once a user opened the
example world. Here each document goes through the same path an autosave takes: the v1 wire
decoder, then the document use case into a freshly initialised world database.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from typing import Any, cast

from quiltor.application import decode_document_v1
from quiltor.application.backups import BackupRepository
from quiltor.application.documents import DocumentKind, DocumentLocation, DocumentUseCases
from quiltor.application.telemetry import UseCaseObserver
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.adapters.place_maps import SQLitePlaceMapRepository
from quiltor.infrastructure.persistence.sqlite import schema

SHIP = Path(__file__).resolve().parents[2] / "src/quiltor/resources/example_world"
LANGUAGES = ("de", "en")
# Ship field -> (document kind, wire contract). Figures go first: the manuscript's story-time
# anchors are checked against the moments already saved.
DOCUMENTS: tuple[tuple[str, DocumentKind, str], ...] = (
    ("storyWorld", "figures", "quiltor.story-world"),
    ("manuscript", "manuscript", "quiltor.manuscript"),
    ("storyboards", "storyboards", "quiltor.storyboards"),
)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class _Observer:
    def observe(self, *_args, **_kwargs):
        return nullcontext()


class _Backups:
    def backup_if_due(self, *_args, **_kwargs):
        return False

    def mirror_manuscript(self, *_args, **_kwargs):
        return None

    def mirror_story_world(self, *_args, **_kwargs):
        return None


def _ship(lang: str) -> dict[str, Any]:
    return json.loads((SHIP / f"{lang}.json").read_text(encoding="utf-8"))


class ShippedExampleWorldTests(unittest.TestCase):
    def test_both_languages_carry_the_format_their_title_and_the_map(self):
        for lang in LANGUAGES:
            with self.subTest(lang=lang):
                document = _ship(lang)
                self.assertEqual(document["format"], "quiltor.example-world.v1")
                self.assertEqual(document["lang"], lang)
                self.assertTrue(document["title"].strip())
                image = SHIP / document["mapImage"]["file"]
                self.assertTrue(image.is_file(), image)
                self.assertEqual(image.read_bytes()[:8], PNG_SIGNATURE)
                self.assertTrue(document["mapImage"]["id"])

    def test_every_document_passes_the_wire_decoder(self):
        for lang in LANGUAGES:
            document = _ship(lang)
            for field, kind, contract in DOCUMENTS:
                with self.subTest(lang=lang, document=kind):
                    wire = decode_document_v1(
                        kind, {"contract": contract, "version": 1, "payload": document[field]}
                    )
                    self.assertEqual(wire.payload, document[field])

    def test_every_document_saves_into_a_fresh_world_and_reads_back(self):
        for lang in LANGUAGES:
            document = _ship(lang)
            with self.subTest(lang=lang), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                location = DocumentLocation(
                    database=root / "world.sqlite3",
                    backups=root / "backups",
                    manuscript_mirrors=root / "manuscript",
                    story_world_mirrors=root / "story-world",
                )
                schema.initialize(location.database)
                documents = DocumentUseCases(
                    SQLiteDocumentRepository(),
                    cast(BackupRepository, _Backups()),
                    cast(UseCaseObserver, _Observer()),
                    SQLitePlaceMapRepository(),
                )
                for field, kind, _ in DOCUMENTS:
                    current = documents.load(kind, location.database).revision
                    saved = documents.save_with_status(kind, document[field], current, location)
                    self.assertEqual(saved.revision, current + 1, kind)
                figures = documents.load("figures", location.database).state
                self.assertEqual(
                    {node["id"] for node in figures["nodes"]},
                    {node["id"] for node in document["storyWorld"]["nodes"]},
                )
                chapters = documents.load("manuscript", location.database).state["chapters"]
                self.assertEqual(
                    [chapter["id"] for chapter in chapters],
                    [chapter["id"] for chapter in document["manuscript"]["chapters"]],
                )
                boards = documents.load("storyboards", location.database).state["boards"]
                self.assertEqual(len(boards), len(document["storyboards"]["boards"]))


if __name__ == "__main__":
    unittest.main()
