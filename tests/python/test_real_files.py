"""Every file of `tests/fixtures/real-files/` goes once through the route a user's file takes (T-364).

The folder holds what a hand-built fixture cannot: files written by Word, by an image writer
with EXIF, and by older versions of the product. A file there with no route in this test, or
without an entry in the folder's README, fails here -- and so does a route whose file is gone.
"""

from __future__ import annotations

import re
import shutil
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from contextlib import closing
from pathlib import Path

from quiltor.application.place_maps import PlaceMapUseCases
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.adapters.place_maps import SQLitePlaceMapRepository
from quiltor.infrastructure.persistence.manuscript_import import SQLiteManuscriptImportRepository
from quiltor.infrastructure.persistence.sqlite import schema
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
FOLDER = FIXTURES / "real-files"
README = FOLDER / "README.md"
DOCUMENTS = SQLiteDocumentRepository()

CHAPTER_TITLES = [
    "Die Ankunft",
    "Das Archiv",
    "Das letzte Blatt",
    "Gerüchte am Salzmarkt",
    "Vor dem Sturm",
    "Bruch mit der Gilde",
    "Die Überfahrt",
    "Die offene Küste",
]


def _preview(file_name: str, payload: bytes) -> dict:
    with tempfile.TemporaryDirectory() as folder:
        repository = SQLiteManuscriptImportRepository(SQLitePaths.from_data_directory(Path(folder)))
        return repository.preview_v2(file_name, payload)


def _stored_map(payload: bytes):
    with tempfile.TemporaryDirectory() as folder:
        database = Path(folder) / "world.sqlite3"
        schema.initialize(database)
        use_cases = PlaceMapUseCases(SQLitePlaceMapRepository())
        stored = use_cases.store(payload, database)
        assert use_cases.content(stored.id, database).data == payload
        return stored


def _opened(path: Path, folder: Path) -> Path:
    """What opening an old world does: work on a copy and let `initialize` migrate it."""
    copy = folder / "world.sqlite3"
    shutil.copyfile(path, copy)
    schema.initialize(copy)
    return copy


def _schema_version(database: Path) -> str:
    with closing(sqlite3.connect(database)) as connection:
        return connection.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]


class RealFileRoutes(unittest.TestCase):
    """One method per file; `ROUTES` binds each name in the folder to its method."""

    def check_word(self, path: Path, titles: list[str], paragraphs: int) -> None:
        preview = _preview(path.name, path.read_bytes())
        self.assertEqual([chapter["title"] for chapter in preview["chapters"]], titles)
        self.assertEqual(preview["counts"]["sourceParagraphs"], paragraphs)
        self.assertEqual(preview["counts"]["importedWords"], preview["counts"]["sourceWords"])
        self.assertNotIn("footnotes_endnotes", {w["code"] for w in preview["warnings"]})

    def word_multipage(self, path: Path) -> None:
        self.check_word(path, CHAPTER_TITLES, 43)

    def word_symbol(self, path: Path) -> None:
        self.check_word(path, CHAPTER_TITLES, 44)

    def word_markers(self, path: Path) -> None:
        self.check_word(path, ["Die Ankunft"], 8)

    def markdown_scene_separators(self, path: Path) -> None:
        preview = _preview(path.name, path.read_bytes())
        texts = [unit["text"] for unit in preview["units"]]
        # `* * *`, `***`, `---`, `___` and `- - -` all arrive as the one spelling the book knows.
        self.assertEqual(texts.count("* * *"), 5)
        self.assertEqual([chapter["title"] for chapter in preview["chapters"]], ["Die Ankunft"])
        self.assertEqual(preview["counts"]["importedWords"], preview["counts"]["sourceWords"])

    def image_quarter_turn(self, path: Path, mime: str) -> None:
        stored = _stored_map(path.read_bytes())
        self.assertEqual(stored.mime, mime)
        # Drawn 400 by 300 and saved with orientation 6 or 8: a browser shows it 300 by 400.
        self.assertEqual((stored.width, stored.height), (300, 400))

    def jpeg(self, path: Path) -> None:
        self.image_quarter_turn(path, "image/jpeg")

    def png(self, path: Path) -> None:
        self.image_quarter_turn(path, "image/png")

    def webp(self, path: Path) -> None:
        self.image_quarter_turn(path, "image/webp")

    def world_v3(self, path: Path) -> None:
        with tempfile.TemporaryDirectory() as folder:
            database = _opened(path, Path(folder))
            self.assertEqual(_schema_version(database), str(schema.SCHEMA_VERSION))
            state = DOCUMENTS.load("figures", database)
            names = {node["name"] for node in state["nodes"]}
            self.assertEqual(names, {"Mara Venn", "Iven Rook", "Nordhafen"})
            DOCUMENTS.save("figures", state, None, database)
            again = DOCUMENTS.load("figures", database)
            self.assertEqual({node["name"] for node in again["nodes"]}, names)

    def world_v14(self, path: Path) -> None:
        with tempfile.TemporaryDirectory() as folder:
            database = _opened(path, Path(folder))
            self.assertEqual(_schema_version(database), str(schema.SCHEMA_VERSION))
            figures = DOCUMENTS.load("figures", database)
            chapters = DOCUMENTS.load("manuscript", database)["chapters"]
            boards = DOCUMENTS.load("storyboards", database)
            self.assertIn("Mara Venn", {node["name"] for node in figures["nodes"]})
            self.assertEqual(len(chapters), 8)
            DOCUMENTS.save("figures", figures, None, database)
            DOCUMENTS.save("manuscript", DOCUMENTS.load("manuscript", database), None, database)
            DOCUMENTS.save("storyboards", boards, None, database)
            reloaded = DOCUMENTS.load("storyboards", database)
            self.assertEqual(len(reloaded["boards"]), len(boards["boards"]))

    def routes(self) -> dict[str, Callable[[Path], None]]:
        return {
            "../manuscript-import/word-multipage.docx": self.word_multipage,
            "../manuscript-import/word-symbol.docx": self.word_symbol,
            "../manuscript-import/word-markers.docx": self.word_markers,
            "photo-exif6.jpg": self.jpeg,
            "photo-exif8.jpg": self.jpeg,
            "map-exif6.png": self.png,
            "map-exif6.webp": self.webp,
            "scene-separators.md": self.markdown_scene_separators,
            "world-schema-v3.sqlite3": self.world_v3,
            "world-schema-v14.sqlite3": self.world_v14,
        }

    def listed_in_readme(self) -> set[str]:
        text = README.read_text(encoding="utf-8")
        return set(re.findall(r"^\| `([^`]+)`\s*\|", text, flags=re.MULTILINE))

    def test_every_file_of_the_folder_has_a_route_and_a_readme_entry(self):
        routes = set(self.routes())
        own = {path.name for path in FOLDER.iterdir() if path.name != "README.md"}
        referenced = {name for name in routes if name.startswith("../")}
        self.assertEqual(own, routes - referenced, "files and routes differ")
        self.assertEqual(self.listed_in_readme(), routes, "README and routes differ")

    def test_every_file_goes_through_its_route(self):
        for name, route in self.routes().items():
            with self.subTest(file=name):
                path = (FOLDER / name).resolve()
                self.assertTrue(path.is_file(), f"{name} is missing")
                route(path)


if __name__ == "__main__":
    unittest.main()
