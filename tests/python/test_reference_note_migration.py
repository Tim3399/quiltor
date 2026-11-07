"""Schema 15: the text of a Storyboard reference card joins the one note of its element (T-177).

Each test builds a world the way 3.25 left it -- reference cards that still carry text, written
straight into the tables because today's validator no longer accepts them -- marks it as
schema 14 and opens it, which is what a user upgrading does.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from typing import Any

from quiltor.application.document_wire_v1 import DocumentKind
from quiltor.domain.story_world.validation import valid_figures, valid_manuscript
from quiltor.domain.storyboard import valid_storyboard_document
from quiltor.domain.storyboard.element_notes import (
    ElementNote,
    ReferenceCardNote,
    append_reference_notes,
    move_reference_notes,
)
from quiltor.domain.text_offsets import utf16_offsets_to_indices
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.sqlite import migrations, revisions, schema
from quiltor.infrastructure.persistence.sqlite.connection import connection

MAIN = "main-storyboard"
DOCUMENTS = SQLiteDocumentRepository()


def _surface(text: str, row: dict[str, Any]) -> str:
    indices = utf16_offsets_to_indices(text, [row["from"], row["to"]])
    assert indices is not None, row
    return text[indices[row["from"]] : indices[row["to"]]]


class _World:
    """A schema-15 world that is turned back into the schema-14 shape 3.25 wrote."""

    def __init__(self, root: Path) -> None:
        self.path = root / "world.sqlite3"
        schema.initialize(self.path)

    def save(self, kind: DocumentKind, state: dict[str, Any]) -> None:
        DOCUMENTS.save(kind, state, None, self.path)  # type: ignore[arg-type]

    def board(self, board_id: str, title: str, position: int) -> None:
        with connection(self.path) as database:
            database.execute(
                "INSERT OR REPLACE INTO storyboards(id,position,title,extra_json) VALUES(?,?,?,'{}')",
                (board_id, position, title),
            )

    def card(
        self,
        card_id: str,
        target_kind: str,
        target_id: str,
        text: str | None,
        *,
        board: str = MAIN,
        position: int = 0,
        references: list[dict[str, Any]] | None = None,
        marks: list[dict[str, Any]] | None = None,
        column_text: str | None = None,
    ) -> None:
        extra: dict[str, Any] = {}
        if text is not None:
            extra["text"] = text
        if references is not None:
            extra["noteReferences"] = references
        if marks is not None:
            extra["noteMarks"] = marks
        with connection(self.path) as database:
            database.execute(
                "INSERT INTO storyboard_nodes("
                " id,board_id,position,kind,x,y,text,target_kind,target_id,extra_json"
                ") VALUES(?,?,?,'reference',0,0,?,?,?,?)",
                (
                    card_id,
                    board,
                    position,
                    column_text if column_text is not None else text or "",
                    target_kind,
                    target_id,
                    json.dumps(extra, ensure_ascii=False),
                ),
            )

    def open_as_upgrade(self) -> None:
        with connection(self.path) as database:
            database.execute("UPDATE meta SET value='14' WHERE key='schema_version'")
        schema.initialize(self.path)

    def load(self, kind: DocumentKind) -> dict[str, Any]:
        return DOCUMENTS.load(kind, self.path)  # type: ignore[arg-type]

    def revision(self, kind: DocumentKind) -> int:
        return revisions.revision(kind, db_path=self.path)  # type: ignore[arg-type]

    def discarded(self) -> list[dict[str, Any]]:
        with connection(self.path) as database:
            row = database.execute(
                "SELECT value FROM meta WHERE key=?", (migrations.DISCARDED_NOTES_META_KEY,)
            ).fetchone()
        return json.loads(row[0]) if row else []


def _chapter(chapter_id: str, note: str = "", **extra: Any) -> dict[str, Any]:
    return {"id": chapter_id, "title": chapter_id, "body": "", "note": note, **extra}


class ReferenceNoteMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.world = _World(Path(self.temporary.name))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_no_character_of_any_card_is_lost(self) -> None:
        world = self.world
        world.save(
            "manuscript",
            {
                "chapters": [
                    _chapter(
                        "k1",
                        "😀 Hafen",
                        noteMarks=[{"from": 3, "to": 8, "kind": "bold"}],
                    ),
                    _chapter("k2"),
                ]
            },
        )
        world.board("plot", "Plot", 1)
        # Board order is MAIN (0) before plot (1); inside a board, card position, then id.
        world.card(
            "n3",
            "chapter",
            "k1",
            "Mira 🐙 kommt",
            board="plot",
            position=0,
            references=[
                {
                    "id": "r1",
                    "target": {"kind": "entity", "id": "mira"},
                    "from": 0,
                    "to": 4,
                    "surface": "Mira",
                }
            ],
            marks=[{"from": 5, "to": 7, "kind": "italic"}],
        )
        world.card("n1", "chapter", "k1", "Erst 🌊 das Meer.", position=1)
        world.card("n2", "chapter", "k1", "   ", position=2)
        world.card("n4", "chapter", "k2", "Nur hier.", board="plot", position=1)
        world.card("n5", "chapter", "k2", "", board="plot", position=2)

        world.open_as_upgrade()

        manuscript = world.load("manuscript")
        k1, k2 = manuscript["chapters"]
        self.assertEqual(
            k1["note"],
            "😀 Hafen"
            "\n\n— Aus Storyboard „Main Storyboard“ —\nErst 🌊 das Meer."
            "\n\n— Aus Storyboard „Plot“ —\nMira 🐙 kommt",
        )
        self.assertEqual(k2["note"], "— Aus Storyboard „Plot“ —\nNur hier.")
        self.assertEqual([_surface(k1["note"], mark) for mark in k1["noteMarks"]], ["Hafen", "🐙"])
        self.assertEqual(
            [(ref["id"], _surface(k1["note"], ref)) for ref in k1["noteReferences"]],
            [("r1", "Mira")],
        )
        self.assertTrue(valid_manuscript(manuscript))
        storyboards = world.load("storyboards")
        self.assertTrue(valid_storyboard_document(storyboards))
        for node in storyboards["nodes"]:
            self.assertFalse(node.get("text"), node["id"])
            self.assertFalse(node.get("noteReferences"), node["id"])
            self.assertFalse(node.get("noteMarks"), node["id"])
        self.assertEqual(world.discarded(), [])

    def test_figures_places_and_moments_receive_their_cards(self) -> None:
        world = self.world
        world.save(
            "figures",
            {
                "nodes": [
                    {"id": "mira", "x": 0, "y": 0, "name": "Mira", "profile": {"notes": "Alt."}},
                    {"id": "hafen", "x": 0, "y": 0, "name": "Hafen", "type": "ort"},
                ],
                "edges": [],
                "timeline": [{"id": "t1", "title": "Ankunft", "time": 0}],
            },
        )
        world.card("a", "entity", "mira", "Figur.")
        world.card("b", "place", "hafen", "Ort.", position=1)
        world.card("c", "timeline", "t1", "Zeit.", position=2)
        before = world.revision("figures")

        world.open_as_upgrade()

        figures = world.load("figures")
        mira, hafen = figures["nodes"]
        self.assertEqual(
            mira["profile"]["notes"], "Alt.\n\n— Aus Storyboard „Main Storyboard“ —\nFigur."
        )
        self.assertEqual(hafen["profile"]["notes"], "— Aus Storyboard „Main Storyboard“ —\nOrt.")
        self.assertEqual(
            figures["timeline"][0]["note"], "— Aus Storyboard „Main Storyboard“ —\nZeit."
        )
        self.assertTrue(valid_figures(figures))
        self.assertEqual(world.revision("figures"), before + 1)

    def test_texts_without_an_element_or_beyond_a_limit_are_dropped_and_counted(self) -> None:
        world = self.world
        world.save(
            "manuscript",
            {
                "chapters": [_chapter("k1", "Vorhanden.")],
                "trash": [],
            },
        )
        world.card("gone-figure", "entity", "nobody", "Weg.")
        world.card("trashed-chapter", "chapter", "k-trash", "Auch weg.", position=1)
        world.card("too-long", "chapter", "k1", "x" * 100_000, position=2)
        world.card("other-too-long", "chapter", "k1", "y" * 100_000, position=3)

        world.open_as_upgrade()

        self.assertEqual(world.load("manuscript")["chapters"][0]["note"], "Vorhanden.")
        self.assertEqual(
            sorted(world.discarded(), key=lambda entry: entry["targetId"]),
            [
                {
                    "storyboard": MAIN,
                    "targetKind": "chapter",
                    "targetId": "k-trash",
                    "reason": "missing_element",
                    "count": 1,
                },
                {
                    "storyboard": MAIN,
                    "targetKind": "chapter",
                    "targetId": "k1",
                    "reason": "limit",
                    "count": 2,
                },
                {
                    "storyboard": MAIN,
                    "targetKind": "entity",
                    "targetId": "nobody",
                    "reason": "missing_element",
                    "count": 1,
                },
            ],
        )
        self.assertNotIn("Weg.", json.dumps(world.discarded()))
        for node in world.load("storyboards")["nodes"]:
            self.assertFalse(node.get("text"), node["id"])

    def test_one_reference_id_on_two_cards_stays_unique(self) -> None:
        world = self.world
        world.save("manuscript", {"chapters": [_chapter("k1")]})

        def mira(card_id: str) -> None:
            world.card(
                card_id,
                "chapter",
                "k1",
                "Mira",
                position=int(card_id[-1]),
                references=[
                    {
                        "id": "r1",
                        "target": {"kind": "entity", "id": "mira"},
                        "from": 0,
                        "to": 4,
                        "surface": "Mira",
                    }
                ],
            )

        mira("n1")
        mira("n2")
        mira("n3")

        world.open_as_upgrade()

        chapter = world.load("manuscript")["chapters"][0]
        self.assertEqual(
            [ref["id"] for ref in chapter["noteReferences"]], ["r1", "r1-sb1", "r1-sb2"]
        )
        self.assertTrue(valid_manuscript(world.load("manuscript")))

    def test_text_kept_only_in_the_column_is_moved_as_well(self) -> None:
        self.world.save("manuscript", {"chapters": [_chapter("k1")]})
        self.world.card("n1", "chapter", "k1", None, column_text="Nur in der Spalte.")

        self.world.open_as_upgrade()

        self.assertEqual(
            self.world.load("manuscript")["chapters"][0]["note"],
            "— Aus Storyboard „Main Storyboard“ —\nNur in der Spalte.",
        )
        with connection(self.world.path) as database:
            self.assertEqual(
                database.execute("SELECT text FROM storyboard_nodes WHERE id='n1'").fetchone()[0],
                "",
            )

    def test_revisions_move_only_for_what_changed_and_a_second_run_changes_nothing(self) -> None:
        world = self.world
        world.save("manuscript", {"chapters": [_chapter("k1")]})
        world.card("empty", "chapter", "k1", "")
        before = {kind: world.revision(kind) for kind in ("manuscript", "figures", "storyboards")}

        world.open_as_upgrade()

        after = {kind: world.revision(kind) for kind in ("manuscript", "figures", "storyboards")}
        self.assertEqual(after, before)
        world.card("full", "chapter", "k1", "Text.", position=1)
        world.open_as_upgrade()
        once = world.load("manuscript")
        self.assertEqual(world.revision("manuscript"), before["manuscript"] + 1)
        self.assertEqual(world.revision("storyboards"), before["storyboards"] + 1)
        self.assertEqual(world.revision("figures"), before["figures"])

        world.open_as_upgrade()

        self.assertEqual(world.load("manuscript"), once)
        self.assertEqual(world.revision("manuscript"), before["manuscript"] + 1)

    def test_a_database_with_only_meta_survives_the_step(self) -> None:
        database = sqlite3.connect(":memory:")
        database.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        migrations.migrate(database, 14)
        self.assertEqual(
            database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
            str(schema.SCHEMA_VERSION),
        )


class ReferenceCardRuleTests(unittest.TestCase):
    def _document(self, **note: Any) -> dict[str, Any]:
        card = {
            "id": "c",
            "boardId": MAIN,
            "kind": "reference",
            "x": 0,
            "y": 0,
            "target": {"kind": "chapter", "id": "k1"},
            **note,
        }
        return {"boards": [{"id": MAIN, "title": "Main"}], "nodes": [card], "edges": []}

    def test_empty_note_fields_are_what_the_client_sends_and_stay_allowed(self) -> None:
        self.assertTrue(valid_storyboard_document(self._document()))
        self.assertTrue(
            valid_storyboard_document(self._document(text="", noteReferences=[], noteMarks=[]))
        )

    def test_a_reference_card_with_a_note_of_its_own_is_rejected(self) -> None:
        self.assertFalse(valid_storyboard_document(self._document(text="Eigener Text")))
        self.assertFalse(
            valid_storyboard_document(
                self._document(text="Ab", noteMarks=[{"from": 0, "to": 2, "kind": "bold"}])
            )
        )


class MoveReferenceNotesOnDocumentsTests(unittest.TestCase):
    def test_archive_documents_get_the_same_move_and_stay_untouched(self) -> None:
        manuscript = {"chapters": [_chapter("k1", "Notiz.")]}
        figures = {"nodes": [{"id": "mira", "x": 0, "y": 0, "name": "Mira"}], "edges": []}
        storyboards = {
            "boards": [{"id": MAIN, "title": "Main"}],
            "nodes": [
                {
                    "id": "c1",
                    "boardId": MAIN,
                    "kind": "reference",
                    "x": 0,
                    "y": 0,
                    "target": {"kind": "chapter", "id": "k1"},
                    "text": "Karte.",
                },
                {
                    "id": "c2",
                    "boardId": MAIN,
                    "kind": "reference",
                    "x": 0,
                    "y": 0,
                    "target": {"kind": "entity", "id": "mira"},
                    "text": "Figur.",
                },
            ],
            "edges": [],
        }
        original = json.dumps([manuscript, figures, storyboards])

        moved_manuscript, moved_figures, moved_storyboards, discarded = move_reference_notes(
            manuscript, figures, storyboards
        )

        self.assertEqual(json.dumps([manuscript, figures, storyboards]), original)
        self.assertEqual(
            moved_manuscript["chapters"][0]["note"], "Notiz.\n\n— Aus Storyboard „Main“ —\nKarte."
        )
        self.assertEqual(
            moved_figures["nodes"][0]["profile"]["notes"], "— Aus Storyboard „Main“ —\nFigur."
        )
        self.assertTrue(valid_storyboard_document(moved_storyboards))
        self.assertEqual(discarded, ())

    def test_the_offset_counts_utf16_units(self) -> None:
        card = ReferenceCardNote(
            board_id="b",
            board_title="P",
            board_position=0,
            card_id="c",
            card_position=0,
            target_kind="chapter",
            target_id="k",
            text="Mira",
            references=(
                {
                    "id": "r",
                    "target": {"kind": "entity", "id": "m"},
                    "from": 0,
                    "to": 4,
                    "surface": "Mira",
                },
            ),
        )
        result = append_reference_notes([card], {("chapter", "k"): ElementNote("😀")})
        note = result.notes[("chapter", "k")]
        self.assertEqual(_surface(note.text, note.references[0]), "Mira")


if __name__ == "__main__":
    unittest.main()
