"""Acceptance tests for TECH-011's independent Storyboard document.

These tests intentionally describe the target v1 persistence boundary before
the Storyboard UI exists.  Storyboard planning data is revisioned separately
from both canon (Story World) and manuscript prose.
"""

from __future__ import annotations

import copy
import json
import math
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from quiltor.domain.storyboard import valid_storyboard_document
from quiltor.infrastructure.persistence.sqlite import config, revisions, schema, storyboards
from quiltor.infrastructure.persistence.sqlite.connection import connection as sqlite_connection


def realistic_storyboards() -> dict:
    """A complete v1 document, including every node kind and extension level."""

    return {
        "boards": [
            {
                "id": "main-storyboard",
                "title": "Main Storyboard",
                "extension": {"viewport": {"x": 12.0, "y": -8.0, "zoom": 0.85}},
            },
            {
                "id": "act-two",
                "title": "Akt II",
            },
        ],
        "nodes": [
            {
                "id": "note-opening",
                "boardId": "main-storyboard",
                "kind": "note",
                "x": 80.5,
                "y": -24.25,
                "width": 320.0,
                "height": 220.0,
                "zIndex": 2,
                "text": "Anna trifft @Mara im Archiv.",
                "noteReferences": [
                    {
                        "id": "note-ref-mara",
                        "target": {"kind": "entity", "id": "figure-mara"},
                        "from": 12,
                        "to": 17,
                        "surface": "@Mara",
                    }
                ],
                "noteMarks": [{"from": 0, "to": 28, "kind": "heading", "level": 1}],
                "extension": {"colour": "moss"},
            },
            {
                "id": "reference-anna",
                "boardId": "main-storyboard",
                "kind": "reference",
                "x": 470.0,
                "y": 40.0,
                "width": 240.0,
                "height": 144.0,
                "zIndex": 1,
                "text": "@Anna begleitet die Szene.",
                "noteReferences": [
                    {
                        "id": "reference-ref-anna",
                        "target": {"kind": "entity", "id": "figure-anna"},
                        "from": 0,
                        "to": 5,
                        "surface": "@Anna",
                    }
                ],
                "noteMarks": [{"from": 0, "to": 5, "kind": "bold"}],
                "target": {"kind": "entity", "id": "figure-anna"},
                "extension": {"caption": "Protagonistin"},
            },
            {
                "id": "link-act-two",
                "boardId": "main-storyboard",
                "kind": "storyboard",
                "x": 780.0,
                "y": 48.0,
                "width": 260.0,
                "height": 150.0,
                "zIndex": 3,
                "text": "@Archiv wird wichtig.",
                "noteReferences": [
                    {
                        "id": "storyboard-ref-archive",
                        "target": {"kind": "place", "id": "place-archive"},
                        "from": 0,
                        "to": 7,
                        "surface": "@Archiv",
                    }
                ],
                "noteMarks": [{"from": 0, "to": 7, "kind": "italic"}],
                "target": {"kind": "storyboard", "id": "act-two"},
                "extension": {"openInPlace": True},
            },
            {
                "id": "group-opening",
                "boardId": "main-storyboard",
                "kind": "group",
                "x": 40.0,
                "y": -80.0,
                "width": 720.0,
                "height": 420.0,
                "zIndex": 0,
                "label": "Auftakt",
                "text": "@Akt II vorbereiten.",
                "noteReferences": [
                    {
                        "id": "group-ref-act-two",
                        "target": {"kind": "storyboard", "id": "act-two"},
                        "from": 0,
                        "to": 7,
                        "surface": "@Akt II",
                    }
                ],
                "noteMarks": [{"from": 0, "to": 20, "kind": "heading", "level": 2}],
                "extension": {"frameStyle": "quiet"},
            },
            {
                "id": "link-main",
                "boardId": "act-two",
                "kind": "storyboard",
                "x": 25.0,
                "y": 35.0,
                "zIndex": 0,
                "target": {"kind": "storyboard", "id": "main-storyboard"},
            },
            {
                "id": "reference-archive",
                "boardId": "act-two",
                "kind": "reference",
                "x": 330.0,
                "y": 35.0,
                "zIndex": 0,
                "target": {"kind": "place", "id": "place-archive"},
            },
        ],
        "edges": [
            {
                "id": "edge-opening-anna",
                "boardId": "main-storyboard",
                "sourceNodeId": "note-opening",
                "targetNodeId": "reference-anna",
                "label": "betrifft",
                "directed": True,
                "lineStyle": "dotted",
                "extension": {"lineStyle": "dashed"},
            },
            {
                "id": "edge-return",
                "boardId": "act-two",
                "sourceNodeId": "link-main",
                "targetNodeId": "reference-archive",
                "label": "",
            },
        ],
        "extension": {"source": "tech-011-acceptance"},
    }


class StoryboardStorageAcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "storyboards.sqlite3"
        self.original_db = config.DB
        config.DB = self.database

    def tearDown(self) -> None:
        config.DB = self.original_db
        self.temp.cleanup()

    def test_schema_v10_migrates_to_v11_once_without_touching_existing_revisions(self) -> None:
        with closing(sqlite3.connect(self.database)) as legacy:
            legacy.executescript(
                """
                PRAGMA foreign_keys = ON;
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE legacy_v10_sentinel (
                  id TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );
                INSERT INTO legacy_v10_sentinel(id,value) VALUES('kept','existing world data');
                INSERT INTO meta(key,value) VALUES('schema_version','10');
                INSERT INTO meta(key,value) VALUES('manuscript_revision','17');
                INSERT INTO meta(key,value) VALUES('figures_revision','41');
                """
            )

        schema.initialize(self.database)

        # A v10 database is brought all the way to the current tip, not to 11.
        self.assertGreaterEqual(schema.SCHEMA_VERSION, 11)
        with sqlite_connection(self.database) as upgraded:
            tables = {
                row[0]
                for row in upgraded.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            self.assertTrue({"storyboards", "storyboard_nodes", "storyboard_edges"} <= tables)
            metadata = dict(upgraded.execute("SELECT key,value FROM meta"))
            self.assertEqual(metadata["schema_version"], str(schema.SCHEMA_VERSION))
            self.assertEqual(metadata["manuscript_revision"], "17")
            self.assertEqual(metadata["figures_revision"], "41")
            self.assertEqual(metadata["storyboards_revision"], "0")
            self.assertEqual(
                upgraded.execute(
                    "SELECT value FROM legacy_v10_sentinel WHERE id='kept'"
                ).fetchone()[0],
                "existing world data",
            )
            self.assertEqual(upgraded.execute("PRAGMA foreign_key_check").fetchall(), [])

        first = storyboards.load(self.database)
        schema.initialize(self.database)
        second = storyboards.load(self.database)
        self.assertEqual(second, first)
        with sqlite_connection(self.database) as reopened:
            self.assertEqual(reopened.execute("SELECT COUNT(*) FROM storyboards").fetchone()[0], 1)

        contract = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "contracts"
                / "fixtures"
                / "persistence"
                / "sqlite-migration-chain.v1.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(contract["currentSchemaVersion"], schema.SCHEMA_VERSION)
        # This test owns one step of the chain, which stops being the last one
        # the moment a later release appends to it.
        step = next(
            entry for entry in contract["steps"] if (entry["from"], entry["to"]) == (10, 11)
        )
        self.assertIn("storyboard", " ".join(step["guarantees"]).lower())

    def test_new_world_has_one_stable_empty_main_storyboard(self) -> None:
        schema.initialize(self.database)

        first = storyboards.load(self.database)
        second = storyboards.load(self.database)

        self.assertEqual(second, first)
        self.assertEqual(len(first["boards"]), 1)
        main = first["boards"][0]
        self.assertEqual(main["id"], "main-storyboard")
        self.assertEqual(main["title"], "Main Storyboard")
        self.assertEqual(first["nodes"], [])
        self.assertEqual(first["edges"], [])
        with sqlite_connection(self.database) as database:
            self.assertEqual(
                tuple(database.execute("SELECT id,position,title FROM storyboards").fetchone()),
                ("main-storyboard", 0, "Main Storyboard"),
            )

    def test_multiple_boards_nodes_edges_and_extensions_round_trip_exactly(self) -> None:
        schema.initialize(self.database)
        state = realistic_storyboards()

        storyboards.save(state, db_path=self.database)
        first = storyboards.load(self.database)
        storyboards.save(copy.deepcopy(first), db_path=self.database)
        second = storyboards.load(self.database)

        self.assertEqual(first, state)
        self.assertEqual(second, state)
        self.assertEqual(
            [board["id"] for board in second["boards"]],
            ["main-storyboard", "act-two"],
        )
        self.assertEqual(
            [node["id"] for node in second["nodes"]],
            [
                "note-opening",
                "reference-anna",
                "link-act-two",
                "group-opening",
                "link-main",
                "reference-archive",
            ],
        )
        self.assertEqual(
            second["nodes"][0]["noteReferences"][0]["target"],
            {"kind": "entity", "id": "figure-mara"},
        )
        self.assertEqual(
            second["boards"][0]["extension"]["viewport"],
            {"x": 12.0, "y": -8.0, "zoom": 0.85},
        )
        with sqlite_connection(self.database) as database:
            edge_extra = database.execute(
                "SELECT extra_json FROM storyboard_edges WHERE id='edge-opening-anna'"
            ).fetchone()[0]
        self.assertIs(json.loads(edge_extra)["directed"], True)
        self.assertEqual(json.loads(edge_extra)["lineStyle"], "dotted")

    def test_notes_on_every_node_kind_round_trip_exactly(self) -> None:
        schema.initialize(self.database)
        state = realistic_storyboards()
        expected_notes = {
            node["id"]: {
                "text": node["text"],
                "noteReferences": node["noteReferences"],
                "noteMarks": node["noteMarks"],
            }
            for node in state["nodes"][:4]
        }

        storyboards.save(state, db_path=self.database)

        loaded = storyboards.load(self.database)
        actual_notes = {
            node["id"]: {
                "text": node["text"],
                "noteReferences": node["noteReferences"],
                "noteMarks": node["noteMarks"],
            }
            for node in loaded["nodes"][:4]
        }
        self.assertEqual(actual_notes, expected_notes)
        self.assertEqual(
            {node["kind"] for node in loaded["nodes"][:4]},
            {"note", "reference", "storyboard", "group"},
        )

    def test_legacy_nodes_without_optional_note_fields_round_trip_exactly(self) -> None:
        schema.initialize(self.database)
        legacy = realistic_storyboards()
        for node in legacy["nodes"]:
            node.pop("noteReferences", None)
            node.pop("noteMarks", None)
            if node["kind"] != "note":
                node.pop("text", None)

        self.assertTrue(valid_storyboard_document(legacy))
        storyboards.save(legacy, db_path=self.database)

        self.assertEqual(storyboards.load(self.database), legacy)

    def test_edge_label_direction_and_reversed_endpoints_round_trip_exactly(self) -> None:
        schema.initialize(self.database)
        state = realistic_storyboards()
        edge = state["edges"][0]
        original_source = edge["sourceNodeId"]
        original_target = edge["targetNodeId"]
        edge.update(
            {
                "sourceNodeId": original_target,
                "targetNodeId": original_source,
                "label": "führt zurück",
                "directed": True,
                "color": "rose",
            }
        )

        storyboards.save(state, db_path=self.database)
        loaded = storyboards.load(self.database)

        self.assertEqual(
            loaded["edges"][0],
            {
                **edge,
                "sourceNodeId": original_target,
                "targetNodeId": original_source,
                "label": "führt zurück",
                "directed": True,
                "color": "rose",
            },
        )
        self.assertNotIn(
            "directed",
            loaded["edges"][1],
            "legacy undirected edges must not be rewritten with a synthetic flag",
        )
        with sqlite_connection(self.database) as database:
            stored_extra = json.loads(
                database.execute(
                    "SELECT extra_json FROM storyboard_edges WHERE id='edge-opening-anna'"
                ).fetchone()[0]
            )
        self.assertEqual(stored_extra["color"], "rose")
        self.assertEqual(stored_extra["lineStyle"], "dotted")

    def test_repeated_position_updates_preserve_stable_sqlite_identities(self) -> None:
        schema.initialize(self.database)
        state = realistic_storyboards()
        storyboards.save(state, db_path=self.database)
        with sqlite_connection(self.database) as database:
            before = {
                "board": database.execute(
                    "SELECT rowid FROM storyboards WHERE id='main-storyboard'"
                ).fetchone()[0],
                "node": database.execute(
                    "SELECT rowid FROM storyboard_nodes WHERE id='note-opening'"
                ).fetchone()[0],
                "edge": database.execute(
                    "SELECT rowid FROM storyboard_edges WHERE id='edge-opening-anna'"
                ).fetchone()[0],
            }

        moved = copy.deepcopy(state)
        moved["nodes"][0]["x"] = 640.25
        moved["nodes"][0]["y"] = 480.75
        storyboards.save(moved, db_path=self.database)

        with sqlite_connection(self.database) as database:
            after = {
                "board": database.execute(
                    "SELECT rowid FROM storyboards WHERE id='main-storyboard'"
                ).fetchone()[0],
                "node": database.execute(
                    "SELECT rowid FROM storyboard_nodes WHERE id='note-opening'"
                ).fetchone()[0],
                "edge": database.execute(
                    "SELECT rowid FROM storyboard_edges WHERE id='edge-opening-anna'"
                ).fetchone()[0],
            }
        self.assertEqual(after, before)
        self.assertEqual(storyboards.load(self.database), moved)

    def test_database_foreign_keys_cascade_nodes_edges_and_whole_boards(self) -> None:
        schema.initialize(self.database)
        storyboards.save(realistic_storyboards(), db_path=self.database)

        with sqlite_connection(self.database) as database:
            database.execute("DELETE FROM storyboard_nodes WHERE id='note-opening'")
            self.assertIsNone(
                database.execute(
                    "SELECT id FROM storyboard_edges WHERE id='edge-opening-anna'"
                ).fetchone()
            )
            database.execute("DELETE FROM storyboards WHERE id='act-two'")
            self.assertEqual(
                database.execute(
                    "SELECT COUNT(*) FROM storyboard_nodes WHERE board_id='act-two'"
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                database.execute(
                    "SELECT COUNT(*) FROM storyboard_edges WHERE board_id='act-two'"
                ).fetchone()[0],
                0,
            )
            self.assertEqual(database.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_validator_rejects_broken_identity_geometry_and_board_references(self) -> None:
        valid = realistic_storyboards()
        self.assertTrue(valid_storyboard_document(valid))

        empty_note = copy.deepcopy(valid)
        empty_note["nodes"][0]["text"] = ""
        empty_note["nodes"][0].pop("noteReferences", None)
        empty_note["nodes"][0].pop("noteMarks", None)
        self.assertTrue(
            valid_storyboard_document(empty_note),
            "new or cleared note cards must remain persistable",
        )

        optional_empty_notes = copy.deepcopy(valid)
        for node in optional_empty_notes["nodes"]:
            if node["kind"] == "note":
                continue
            node.pop("text", None)
            node["noteReferences"] = []
            node["noteMarks"] = []
        self.assertTrue(
            valid_storyboard_document(optional_empty_notes),
            "non-note nodes treat an absent optional text as an empty note",
        )

        reference_without_text = copy.deepcopy(valid)
        reference_without_text["nodes"][1].pop("text")
        self.assertFalse(
            valid_storyboard_document(reference_without_text),
            "references must still match the node's own text",
        )

        invalid_documents: dict[str, dict] = {}

        missing_edge_target = copy.deepcopy(valid)
        missing_edge_target["edges"][0]["targetNodeId"] = "missing-node"
        invalid_documents["missing edge endpoint"] = missing_edge_target

        cross_board_edge = copy.deepcopy(valid)
        cross_board_edge["edges"][0]["targetNodeId"] = "reference-archive"
        invalid_documents["cross-board edge"] = cross_board_edge

        missing_board_target = copy.deepcopy(valid)
        missing_board_target["nodes"][2]["target"]["id"] = "missing-board"
        invalid_documents["missing linked board"] = missing_board_target

        duplicate_board = copy.deepcopy(valid)
        duplicate_board["boards"][1]["id"] = "main-storyboard"
        invalid_documents["duplicate board id"] = duplicate_board

        duplicate_node = copy.deepcopy(valid)
        duplicate_node["nodes"][4]["id"] = "note-opening"
        invalid_documents["duplicate node id"] = duplicate_node

        duplicate_edge = copy.deepcopy(valid)
        duplicate_edge["edges"][1]["id"] = "edge-opening-anna"
        invalid_documents["duplicate edge id"] = duplicate_edge

        invalid_direction = copy.deepcopy(valid)
        invalid_direction["edges"][0]["directed"] = "yes"
        invalid_documents["non-boolean edge direction"] = invalid_direction

        nan_coordinate = copy.deepcopy(valid)
        nan_coordinate["nodes"][0]["x"] = math.nan
        invalid_documents["NaN coordinate"] = nan_coordinate

        infinite_size = copy.deepcopy(valid)
        infinite_size["nodes"][0]["width"] = math.inf
        invalid_documents["infinite size"] = infinite_size

        for label, document in invalid_documents.items():
            with self.subTest(case=label):
                self.assertFalse(valid_storyboard_document(document))

        # Boards form a navigation graph, not a parent tree. A -> B -> A is valid.
        self.assertTrue(valid_storyboard_document(valid), "board-link cycles must remain valid")

    def test_storyboard_revision_is_independent_and_conflicts_prevent_lost_updates(self) -> None:
        schema.initialize(self.database)
        original = realistic_storyboards()

        self.assertEqual(
            revisions.save_with_revision(
                "storyboards", original, expected=0, db_path=self.database
            ),
            1,
        )
        self.assertEqual(revisions.revision("storyboards", db_path=self.database), 1)
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 0)
        self.assertEqual(revisions.revision("figures", db_path=self.database), 0)

        stale = copy.deepcopy(original)
        stale["boards"][0]["title"] = "Veraltete Änderung"
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision("storyboards", stale, expected=0, db_path=self.database)

        self.assertEqual(storyboards.load(self.database), original)
        self.assertEqual(revisions.revision("storyboards", db_path=self.database), 1)

    def test_restore_revision_advance_includes_storyboards_and_invalidates_stale_etags(
        self,
    ) -> None:
        schema.initialize(self.database)
        original = realistic_storyboards()
        revisions.save_with_revision("storyboards", original, 0, db_path=self.database)
        with sqlite_connection(self.database) as database:
            database.execute("UPDATE meta SET value='4' WHERE key='manuscript_revision'")
            database.execute("UPDATE meta SET value='7' WHERE key='figures_revision'")
            database.execute("UPDATE meta SET value='11' WHERE key='storyboards_revision'")

        advanced = revisions.advance_restore_revisions(
            {"manuscript": 40, "figures": 50, "storyboards": 60},
            db_path=self.database,
        )

        self.assertEqual(
            advanced,
            {"manuscript": 41, "figures": 51, "storyboards": 61},
        )
        self.assertEqual(revisions.revision("storyboards", db_path=self.database), 61)
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision(
                "storyboards", original, expected=11, db_path=self.database
            )


if __name__ == "__main__":
    unittest.main()
