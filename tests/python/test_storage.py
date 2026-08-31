import copy
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from quiltor.infrastructure.persistence import mirror
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.sqlite import (
    config,
    restore,
    revisions,
    schema,
    story_world,
    world_catalog,
)
from quiltor.infrastructure.persistence.sqlite import (
    manuscript as manuscript_store,
)
from quiltor.infrastructure.persistence.sqlite.connection import connection as sqlite_connection

LEGACY_V3_FIGURE_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE figure_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  canvas_width INTEGER NOT NULL DEFAULT 2400,
  canvas_height INTEGER NOT NULL DEFAULT 1600,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE figures (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'person'
    CHECK (kind IN ('person','tier','ort','organisation','objekt','konzept')),
  label TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'ink',
  dashed INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE profiles (
  figure_id TEXT PRIMARY KEY REFERENCES figures(id) ON DELETE CASCADE,
  age TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE profile_fields (
  figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (figure_id, position)
);
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'solid',
  directed INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
"""


def realistic_figure_state():
    """A complete aggregate fixture with children and forward-compatible fields."""
    return {
        "nodes": [
            {
                "id": "figure-ada",
                "x": 120.5,
                "y": 240.25,
                "type": "person",
                "label": "POV",
                "name": "Ada Morgenstern",
                "sub": "Kartografin",
                "accent": "gold",
                "dash": False,
                "pinned": True,
                "important": True,
                "futureNodeField": {"kept": True},
                "profile": {
                    "alter": "34",
                    "rolle": "Protagonistin",
                    "aussehen": "Silberne Haarsträhne",
                    "herkunft": "Nordhafen",
                    "stimme": "ruhig",
                    "notizen": "Verbirgt die alte Karte.",
                    "futureProfileField": "bleibt erhalten",
                    "extra": [
                        {"k": "Motiv", "v": "Heimkehr"},
                        {"k": "Furcht", "v": "Offenes Meer"},
                    ],
                },
            },
            {
                "id": "figure-ben",
                "x": 480.0,
                "y": 160.0,
                "type": "person",
                "label": "Verbündeter",
                "name": "Ben Tal",
                "sub": "Lotse",
                "accent": "ink",
                "dash": True,
                "pinned": False,
                "profile": {
                    "alter": "51",
                    "rolle": "Mentor",
                    "aussehen": "Wettergegerbtes Gesicht",
                    "herkunft": "Südbucht",
                    "stimme": "heiser",
                    "notizen": "Kennt die Untiefen.",
                    "extra": [{"k": "Versprechen", "v": "Ada beschützen"}],
                },
            },
            {
                "id": "place-harbor",
                "x": 760.0,
                "y": 420.0,
                "type": "ort",
                "label": "Hafen",
                "name": "Nordhafen",
                "sub": "Stadt",
                "accent": "blue",
                "dash": False,
                "pinned": False,
                "profile": {"notizen": "Ausgangspunkt der Reise.", "extra": []},
            },
        ],
        "edges": [
            {
                "id": "edge-ada-ben",
                "from": "figure-ada",
                "to": "figure-ben",
                "label": "Vertrauen",
                "style": "solid",
                "gerichtet": False,
                "versions": [{"momentId": "moment-storm", "label": "Misstrauen"}],
            },
            {
                "id": "edge-ben-harbor",
                "from": "figure-ben",
                "to": "place-harbor",
                "label": "kennt",
                "style": "dashed",
                "gerichtet": True,
            },
        ],
        "timeline": [
            {"id": "moment-start", "title": "Aufbruch"},
            {"id": "moment-storm", "title": "Der Sturm", "date": "1420-03-12"},
        ],
        "presence": [
            {
                "id": "presence-ada",
                "elementId": "figure-ada",
                "placeId": "place-harbor",
                "momentId": "moment-start",
            }
        ],
        "canvasSize": {"w": 1800, "h": 1200},
        "mapScale": {"metersPerPixel": 2.5},
        "futureAggregateField": ["wird", "bewahrt"],
    }


def temporal_figure_state():
    """FigureState fixture exercising normalized temporal rows and compatibility JSON."""
    state = realistic_figure_state()
    state["nodes"][1]["diedMomentId"] = "moment-storm"
    state["timeline"] = [
        {
            "id": "moment-prologue",
            "time": -12,
            "title": "Der erste Sturm",
            "date": "1408-09-03",
            "note": "Lange vor der Reise.",
            "futureMomentField": {"source": "import"},
        },
        {
            "id": "moment-start",
            "time": 0,
            "title": "Aufbruch",
        },
        {
            "id": "moment-mutiny",
            "time": 4,
            "title": "Die Meuterei",
            "note": "Gleichzeitig, aber zuerst angezeigt.",
        },
        {
            "id": "moment-storm",
            "time": 4,
            "title": "Der Sturm",
            "date": "1420-03-12",
        },
    ]
    state["edges"][0]["versions"] = [
        {
            "momentId": "moment-start",
            "active": True,
            "label": "Vertrauen",
            "gerichtet": False,
            "style": "solid",
            "futureRelationshipField": "confirmed",
        },
        {
            "momentId": "moment-storm",
            "active": True,
            "label": "Misstrauen",
            "gerichtet": True,
            "style": "dashed",
        },
        {
            "momentId": "moment-mutiny",
            "active": False,
            "label": "Bruch",
            "gerichtet": True,
            "style": "blood",
        },
    ]
    state["presence"] = [
        {
            "id": "presence-ada-base",
            "elementId": "figure-ada",
            "placeId": "place-harbor",
            "futurePresenceField": ["manual"],
        },
        {
            "id": "presence-ben-start",
            "elementId": "figure-ben",
            "placeId": "place-harbor",
            "momentId": "moment-start",
        },
        {
            "id": "presence-ada-storm",
            "elementId": "figure-ada",
            "placeId": "place-harbor",
            "momentId": "moment-storm",
        },
    ]
    return state


def table_rows_with_rowid(conn, table):
    assert table in {
        "figures",
        "profiles",
        "profile_fields",
        "connections",
        "timeline_moments",
        "relationship_states",
        "presence_states",
    }
    return [tuple(row) for row in conn.execute(f"SELECT rowid, * FROM {table} ORDER BY rowid")]


def profile_field_rows_with_rowid(conn, figure_id):
    return [
        tuple(row)
        for row in conn.execute(
            "SELECT rowid, * FROM profile_fields WHERE figure_id=? ORDER BY rowid", (figure_id,)
        )
    ]


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original = (
            config.DATA,
            config.DB,
            config.BACKUPS,
            config.WORLDS,
        )
        config.DATA = root
        config.DB = root / "test.sqlite3"
        config.BACKUPS = root / "backups"
        config.WORLDS = root / "worlds"
        self.paths = config.SQLitePaths(
            data=config.DATA,
            database=config.DB,
            backups=config.BACKUPS,
            worlds=config.WORLDS,
        )

    def tearDown(self):
        config.DATA, config.DB, config.BACKUPS, config.WORLDS = self.original
        self.temp.cleanup()

    def create_world(self, title, backup_url="", owner_sub=None):
        return world_catalog.create_world(title, backup_url, owner_sub=owner_sub, paths=self.paths)

    def list_worlds(self, owner_sub=None):
        return world_catalog.list_worlds(owner_sub=owner_sub, paths=self.paths)

    def world_db_path(self, world_id):
        return world_catalog.world_db_path(world_id, paths=self.paths)

    def world_owner(self, world_id):
        return world_catalog.get_world_owner(world_id, paths=self.paths)

    def delete_world(self, world_id, owner_sub=None):
        return world_catalog.delete_world(world_id, owner_sub=owner_sub, paths=self.paths)

    def test_managed_connection_closes_its_file_handle(self):
        schema.initialize()
        with sqlite_connection() as conn:
            self.assertEqual(conn.execute("SELECT 1").fetchone()[0], 1)

        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")
        config.DB.unlink()
        self.assertFalse(config.DB.exists())

    def test_sqlite_round_trips_unknown_fields(self):
        manuscript_input = {
            "chapters": [
                {
                    "id": "c1",
                    "title": "Eins",
                    "body": "Hallo Welt",
                    "note": "N",
                    "noteReferences": [
                        {
                            "id": "chapter-note-reference",
                            "target": {"kind": "entity", "id": "n1"},
                            "from": 0,
                            "to": 1,
                            "surface": "N",
                        }
                    ],
                    "mood": "still",
                    "mentions": [
                        {
                            "id": "m1",
                            "elementId": "n1",
                            "from": 0,
                            "to": 5,
                            "surface": "Hallo",
                            "source": "helper",
                            "confidence": 1,
                        }
                    ],
                    "marks": [{"from": 6, "to": 10, "kind": "italic"}],
                }
            ],
            "words": [{"w": "Arcène", "d": "Ort"}],
            "zeichenAktiv": ["…"],
            "future": True,
        }
        figures_input = {
            "nodes": [
                {
                    "id": "n1",
                    "x": 1,
                    "y": 2,
                    "type": "person",
                    "name": "A",
                    "future": 7,
                    "important": True,
                    "pinned": True,
                    "diedMomentId": "t2",
                    "profile": {
                        "rolle": "Held",
                        "notizen": "A vertraut B.",
                        "noteReferences": [
                            {
                                "id": "profile-note-reference",
                                "target": {"kind": "place", "id": "n2"},
                                "from": 10,
                                "to": 11,
                                "surface": "B",
                            }
                        ],
                        "extra": [{"k": "Motiv", "v": "Heimkehr"}],
                        "future": "yes",
                    },
                },
                {"id": "n2", "x": 3, "y": 4, "type": "ort", "name": "B"},
            ],
            "edges": [
                {
                    "id": "e1",
                    "from": "n1",
                    "to": "n2",
                    "label": "Freunde",
                    "versions": [{"momentId": "t2", "label": "Feinde", "active": True}],
                }
            ],
            "timeline": [
                {"id": "t1", "title": "Vorher"},
                {
                    "id": "t2",
                    "title": "Verrat",
                    "date": "1420-03-12",
                    "note": "Verrat im Hafen.",
                    "noteReferences": [
                        {
                            "id": "moment-note-reference",
                            "target": {"kind": "place", "id": "n2"},
                            "from": 10,
                            "to": 15,
                            "surface": "Hafen",
                        }
                    ],
                },
            ],
            "presence": [
                {"id": "p1", "elementId": "n1", "placeId": "n2", "momentId": "t2"},
                {"id": "p0", "elementId": "n1", "placeId": "n2"},
            ],
            "canvasSize": {"w": 900, "h": 700},
            "future": "kept",
        }
        schema.initialize()
        manuscript_store.save(manuscript_input)
        story_world.save(figures_input)
        manuscript = manuscript_store.load()
        figures = story_world.load()
        self.assertEqual(manuscript["chapters"][0]["mood"], "still")
        self.assertEqual(manuscript["chapters"][0]["mentions"][0]["elementId"], "n1")
        self.assertEqual(
            manuscript["chapters"][0]["noteReferences"][0]["target"],
            {"kind": "entity", "id": "n1"},
        )
        mirror_dir = config.DATA / "manuskript"
        mirror.mirror_text(manuscript["chapters"], mirror_dir)
        exported = next(mirror_dir.glob("*.md")).read_text(encoding="utf-8")
        # Der Kapiteltext bleibt in der Datenbank reine Prosa; erst der Markdown-Spiegel
        # schreibt die Auszeichnungsbereiche als Marker.
        self.assertEqual(manuscript["chapters"][0]["body"], "Hallo Welt")
        self.assertEqual(
            manuscript["chapters"][0]["marks"], [{"from": 6, "to": 10, "kind": "italic"}]
        )
        self.assertIn("Hallo *Welt*", exported)
        self.assertNotIn("elementId", exported)
        self.assertNotIn('"m1"', exported)
        self.assertTrue(manuscript["future"])
        self.assertEqual(manuscript["language"], "de-DE")
        self.assertEqual(manuscript["grammarMode"], "manual")
        self.assertEqual(
            [(field["key"], field["value"]) for field in figures["nodes"][0]["profile"]["fields"]],
            [("Rolle in der Geschichte", "Held"), ("Motiv", "Heimkehr")],
        )
        self.assertEqual(
            figures["nodes"][0]["profile"]["noteReferences"][0]["target"],
            {"kind": "place", "id": "n2"},
        )
        self.assertEqual(figures["nodes"][0]["future"], 7)
        self.assertEqual(figures["nodes"][0]["diedMomentId"], "t2")
        self.assertTrue(figures["nodes"][0]["important"])
        self.assertTrue(figures["nodes"][0]["pinned"])
        self.assertEqual(figures["edges"][0]["versions"][0]["label"], "Feinde")
        self.assertEqual(figures["timeline"][1]["date"], "1420-03-12")
        self.assertEqual(figures["timeline"][1]["noteReferences"][0]["id"], "moment-note-reference")
        self.assertEqual(figures["future"], "kept")
        presence_by_id = {entry["id"]: entry for entry in figures["presence"]}
        self.assertEqual(presence_by_id["p1"]["momentId"], "t2")
        self.assertNotIn("momentId", presence_by_id["p0"])
        with sqlite_connection() as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_rejecting_orphan_is_enforced_by_database(self):
        schema.initialize()
        state = {
            "nodes": [{"id": "n1", "x": 0, "y": 0, "name": "A"}],
            "edges": [{"id": "e1", "from": "missing", "to": "n1"}],
        }
        story_world.save(state)
        self.assertEqual(story_world.load()["edges"], [])

    def test_presence_entries_without_targets_are_dropped(self):
        schema.initialize()
        state = {
            "nodes": [
                {"id": "n1", "x": 0, "y": 0, "name": "A"},
                {"id": "n2", "x": 0, "y": 0, "type": "ort", "name": "Ort"},
            ],
            "edges": [],
            "timeline": [{"id": "t1", "title": "Vorher"}],
            "presence": [
                {"id": "p1", "elementId": "n1", "placeId": "n2", "momentId": "t1"},
                {"id": "p2", "elementId": "missing", "placeId": "n2"},
                {"id": "p3", "elementId": "n1", "placeId": "missing"},
                {"id": "p4", "elementId": "n1", "placeId": "n2", "momentId": "missing-moment"},
            ],
        }
        story_world.save(state)
        self.assertEqual([entry["id"] for entry in story_world.load()["presence"]], ["p1"])

    def test_temporal_rows_roundtrip_defaults_unknown_fields_and_canonical_order(self):
        schema.initialize()
        state = temporal_figure_state()
        state["edges"][0]["color"] = "rose"
        state["edges"][0]["lineStyle"] = "dotted"
        state["edges"][0]["relationshipKind"] = "kinship"
        state["edges"][0]["versions"][0]["color"] = "blue"
        state["edges"][0]["versions"][0]["lineStyle"] = "dashed"
        state["edges"][0]["versions"][0]["relationshipKind"] = "general"
        state["edges"][0]["versions"][1]["color"] = "gold"
        story_world.save(state)

        loaded = story_world.load()
        self.assertEqual(
            [moment["id"] for moment in loaded["timeline"]],
            ["moment-prologue", "moment-start", "moment-mutiny", "moment-storm"],
        )
        self.assertEqual([moment["time"] for moment in loaded["timeline"]], [-12, 0, 4, 4])
        self.assertEqual([moment["position"] for moment in loaded["timeline"]], [0, 1, 2, 3])
        self.assertEqual(loaded["timeline"][0]["date"], "1408-09-03")
        self.assertEqual(loaded["timeline"][0]["futureMomentField"], {"source": "import"})
        versions = loaded["edges"][0]["versions"]
        self.assertEqual(loaded["edges"][0]["color"], "rose")
        self.assertEqual(loaded["edges"][0]["lineStyle"], "dotted")
        self.assertEqual(loaded["edges"][0]["relationshipKind"], "kinship")
        self.assertEqual(
            [version["momentId"] for version in versions],
            ["moment-start", "moment-mutiny", "moment-storm"],
        )
        self.assertTrue(versions[0]["active"])
        self.assertEqual(versions[0]["color"], "blue")
        self.assertEqual(versions[0]["lineStyle"], "dashed")
        self.assertEqual(versions[0]["relationshipKind"], "general")
        self.assertEqual(versions[0]["futureRelationshipField"], "confirmed")
        self.assertFalse(versions[1]["active"])
        self.assertEqual(versions[2]["color"], "gold")
        self.assertEqual(loaded["nodes"][1]["diedMomentId"], "moment-storm")
        base_presence = next(
            entry for entry in loaded["presence"] if entry["id"] == "presence-ada-base"
        )
        self.assertNotIn("momentId", base_presence)
        self.assertEqual(base_presence["futurePresenceField"], ["manual"])
        with sqlite_connection() as conn:
            edge_extra = json.loads(
                conn.execute(
                    "SELECT extra_json FROM connections WHERE id='edge-ada-ben'"
                ).fetchone()[0]
            )
            self.assertEqual(edge_extra["color"], "rose")
            self.assertEqual(edge_extra["lineStyle"], "dotted")
            self.assertEqual(edge_extra["relationshipKind"], "kinship")
            version_extra = json.loads(
                conn.execute(
                    """
                    SELECT extra_json FROM relationship_states
                    WHERE relationship_id='edge-ada-ben' AND moment_id='moment-start'
                    """
                ).fetchone()[0]
            )
            self.assertEqual(version_extra["color"], "blue")
            self.assertEqual(version_extra["lineStyle"], "dashed")
            self.assertEqual(version_extra["relationshipKind"], "general")
            self.assertEqual(
                [
                    tuple(row)
                    for row in conn.execute(
                        "SELECT time,position FROM timeline_moments ORDER BY time,position"
                    )
                ],
                [(-12, 0), (0, 1), (4, 2), (4, 3)],
            )
            self.assertEqual(
                conn.execute(
                    "SELECT death_moment_id FROM figures WHERE id='figure-ben'"
                ).fetchone()[0],
                "moment-storm",
            )
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_unchanged_temporal_save_preserves_stable_rows_and_children(self):
        schema.initialize()
        story_world.save(temporal_figure_state())
        roundtrip = story_world.load()
        with sqlite_connection() as conn:
            before = {
                table: table_rows_with_rowid(conn, table)
                for table in (
                    "timeline_moments",
                    "relationship_states",
                    "presence_states",
                )
            }

        story_world.save(copy.deepcopy(roundtrip))

        self.assertEqual(story_world.load(), roundtrip)
        with sqlite_connection() as conn:
            after = {
                table: table_rows_with_rowid(conn, table)
                for table in (
                    "timeline_moments",
                    "relationship_states",
                    "presence_states",
                )
            }
        self.assertEqual(after, before)

    def test_implicit_moment_times_are_signed_deterministic_and_survive_reordering(self):
        schema.initialize()
        state = realistic_figure_state()
        state["timeline"] = [
            {"id": "zero", "title": "Erster angelegter Moment"},
            {"id": "after", "title": "Danach"},
        ]
        story_world.save(state)
        changed = copy.deepcopy(state)
        changed["timeline"] = [
            {"id": "before", "title": "Davor"},
            changed["timeline"][0],
            changed["timeline"][1],
        ]
        story_world.save(changed)
        changed["timeline"] = [
            changed["timeline"][2],
            changed["timeline"][0],
            changed["timeline"][1],
        ]
        story_world.save(changed)

        with sqlite_connection() as conn:
            self.assertEqual(
                {
                    row["id"]: (row["time"], row["position"])
                    for row in conn.execute("SELECT id,time,position FROM timeline_moments")
                },
                {"before": (-1, 1), "after": (1, 0), "zero": (0, 2)},
            )
        # Canonical time, not later array reordering, defines the loaded chronology.
        self.assertEqual(
            [moment["id"] for moment in story_world.load()["timeline"]],
            ["before", "zero", "after"],
        )

    def test_temporal_sync_deletes_only_missing_rows_and_respects_foreign_keys(self):
        schema.initialize()
        story_world.save(temporal_figure_state())
        with sqlite_connection() as conn:
            retained_moment_rowid = conn.execute(
                "SELECT rowid FROM timeline_moments WHERE id='moment-start'"
            ).fetchone()[0]
            retained_version_rowid = conn.execute(
                "SELECT rowid FROM relationship_states "
                "WHERE relationship_id='edge-ada-ben' AND moment_id='moment-start'"
            ).fetchone()[0]

        changed = temporal_figure_state()
        changed["timeline"] = [
            moment for moment in changed["timeline"] if moment["id"] != "moment-mutiny"
        ]
        changed["nodes"][1].pop("diedMomentId")
        changed["edges"][0]["versions"] = [
            version
            for version in changed["edges"][0]["versions"]
            if version["momentId"] != "moment-storm"
        ]
        changed["presence"] = [
            entry for entry in changed["presence"] if entry["id"] != "presence-ben-start"
        ]
        story_world.save(changed)

        with sqlite_connection() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT rowid FROM timeline_moments WHERE id='moment-start'"
                ).fetchone()[0],
                retained_moment_rowid,
            )
            self.assertEqual(
                conn.execute(
                    "SELECT rowid FROM relationship_states "
                    "WHERE relationship_id='edge-ada-ben' AND moment_id='moment-start'"
                ).fetchone()[0],
                retained_version_rowid,
            )
            self.assertIsNone(
                conn.execute("SELECT 1 FROM timeline_moments WHERE id='moment-mutiny'").fetchone()
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT death_moment_id FROM figures WHERE id='figure-ben'"
                ).fetchone()[0]
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT 1 FROM relationship_states "
                    "WHERE relationship_id='edge-ada-ben' AND moment_id='moment-mutiny'"
                ).fetchone()
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT 1 FROM relationship_states "
                    "WHERE relationship_id='edge-ada-ben' AND moment_id='moment-storm'"
                ).fetchone()
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT 1 FROM presence_states WHERE id='presence-ben-start'"
                ).fetchone()
            )
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_temporal_revision_failure_rolls_back_rows_and_etag_atomically(self):
        schema.initialize()
        original = temporal_figure_state()
        self.assertEqual(revisions.save_with_revision("figures", original, 0), 1)
        before = story_world.load()

        invalid = temporal_figure_state()
        invalid["timeline"][0]["title"] = "Darf nicht sichtbar werden"
        invalid["timeline"].append({"title": "Ohne stabile ID", "time": 99})
        with self.assertRaises((KeyError, sqlite3.IntegrityError)):
            revisions.save_with_revision("figures", invalid, 1)

        self.assertEqual(story_world.load(), before)
        self.assertEqual(revisions.revision("figures"), 1)
        with sqlite_connection() as conn:
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_unchanged_figure_save_preserves_rows_and_semantic_children(self):
        schema.initialize()
        state = realistic_figure_state()
        story_world.save(state)
        roundtrip = story_world.load()
        with sqlite_connection() as conn:
            before = {
                table: table_rows_with_rowid(conn, table)
                for table in ("figures", "profiles", "profile_fields", "connections")
            }

        story_world.save(copy.deepcopy(roundtrip))

        self.assertEqual(story_world.load(), roundtrip)
        with sqlite_connection() as conn:
            after = {
                table: table_rows_with_rowid(conn, table)
                for table in ("figures", "profiles", "profile_fields", "connections")
            }
        self.assertEqual(after, before)

    def test_changing_one_figure_keeps_unrelated_rows_and_child_identity(self):
        schema.initialize()
        story_world.save(realistic_figure_state())
        with sqlite_connection() as conn:
            before_ben = tuple(
                conn.execute("SELECT rowid, * FROM figures WHERE id='figure-ben'").fetchone()
            )
            before_ben_profile = tuple(
                conn.execute(
                    "SELECT rowid, * FROM profiles WHERE figure_id='figure-ben'"
                ).fetchone()
            )
            before_ben_fields = profile_field_rows_with_rowid(conn, "figure-ben")
            before_unrelated_edge = tuple(
                conn.execute(
                    "SELECT rowid, * FROM connections WHERE id='edge-ben-harbor'"
                ).fetchone()
            )

        changed = realistic_figure_state()
        changed["nodes"][0]["name"] = "Ada von Morgenstern"
        changed["nodes"][0]["profile"]["extra"][0]["v"] = "Wahrheit"
        story_world.save(changed)

        with sqlite_connection() as conn:
            self.assertEqual(
                tuple(
                    conn.execute("SELECT rowid, * FROM figures WHERE id='figure-ben'").fetchone()
                ),
                before_ben,
            )
            self.assertEqual(
                tuple(
                    conn.execute(
                        "SELECT rowid, * FROM profiles WHERE figure_id='figure-ben'"
                    ).fetchone()
                ),
                before_ben_profile,
            )
            self.assertEqual(
                profile_field_rows_with_rowid(conn, "figure-ben"),
                before_ben_fields,
            )
            self.assertEqual(
                tuple(
                    conn.execute(
                        "SELECT rowid, * FROM connections WHERE id='edge-ben-harbor'"
                    ).fetchone()
                ),
                before_unrelated_edge,
            )

    def test_figure_save_synchronizes_removed_entities_connections_and_profile_fields(self):
        schema.initialize()
        state = realistic_figure_state()
        story_world.save(state)

        changed = realistic_figure_state()
        changed["nodes"] = [node for node in changed["nodes"] if node["id"] != "figure-ben"]
        changed["nodes"][0]["profile"]["extra"] = [changed["nodes"][0]["profile"]["extra"][0]]
        changed["edges"] = []
        story_world.save(changed)

        with sqlite_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT 1 FROM figures WHERE id='figure-ben'").fetchone()
            )
            self.assertIsNone(
                conn.execute("SELECT 1 FROM profiles WHERE figure_id='figure-ben'").fetchone()
            )
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) FROM profile_fields WHERE figure_id='figure-ben'"
                ).fetchone()[0],
                0,
            )
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM connections").fetchone()[0], 0)
            self.assertEqual(
                [
                    tuple(row)
                    for row in conn.execute(
                        "SELECT position, label, value FROM profile_fields "
                        "WHERE figure_id='figure-ada' ORDER BY position"
                    )
                ],
                [
                    (0, "Alter", "34"),
                    (1, "Rolle in der Geschichte", "Protagonistin"),
                    (2, "Aussehen", "Silberne Haarsträhne"),
                    (3, "Herkunft & Vorgeschichte", "Nordhafen"),
                    (4, "Stimme & Sprechweise", "ruhig"),
                    (5, "Motiv", "Heimkehr"),
                ],
            )
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_canonical_profile_fields_round_trip_edit_and_delete_without_fixed_columns(self):
        schema.initialize()
        state = {
            "nodes": [
                {
                    "id": "figure-mara",
                    "x": 12,
                    "y": 24,
                    "type": "person",
                    "name": "Mara",
                    "profile": {
                        "notizen": "Mara kennt das Archiv.",
                        "noteReferences": [
                            {
                                "id": "profile-reference-archive",
                                "target": {"kind": "place", "id": "place-archive"},
                                "from": 15,
                                "to": 21,
                                "surface": "Archiv",
                            }
                        ],
                        "futureProfileField": {"kept": True},
                        "fields": [
                            {
                                "id": "profile-field-role",
                                "key": "Rolle",
                                "value": "Zeugin",
                                "futureFieldData": {"source": "import"},
                            },
                            {
                                "id": "profile-field-motive",
                                "key": "Motiv",
                                "value": "Wahrheit",
                            },
                        ],
                    },
                },
                {
                    "id": "place-archive",
                    "x": 240,
                    "y": 24,
                    "type": "ort",
                    "name": "Archiv",
                },
            ],
            "edges": [],
        }

        story_world.save(state)
        profile = story_world.load()["nodes"][0]["profile"]
        self.assertEqual(profile["notizen"], "Mara kennt das Archiv.")
        self.assertEqual(profile["noteReferences"], state["nodes"][0]["profile"]["noteReferences"])
        self.assertEqual(profile["futureProfileField"], {"kept": True})
        self.assertEqual(profile["fields"], state["nodes"][0]["profile"]["fields"])

        with sqlite_connection() as database:
            self.assertEqual(
                tuple(
                    database.execute(
                        "SELECT age,role,appearance,origin,voice,notes "
                        "FROM profiles WHERE figure_id='figure-mara'"
                    ).fetchone()
                ),
                ("", "", "", "", "", "Mara kennt das Archiv."),
            )
            rows = database.execute(
                "SELECT rowid,field_id,position,label,value,extra_json "
                "FROM profile_fields WHERE figure_id='figure-mara' ORDER BY position"
            ).fetchall()
            self.assertEqual(
                [tuple(row)[1:5] for row in rows],
                [
                    ("profile-field-role", 0, "Rolle", "Zeugin"),
                    ("profile-field-motive", 1, "Motiv", "Wahrheit"),
                ],
            )
            self.assertEqual(json.loads(rows[0][5]), {"futureFieldData": {"source": "import"}})
            retained_rowid = rows[0][0]

        changed = story_world.load()
        changed_profile = changed["nodes"][0]["profile"]
        changed_profile["fields"] = [{**changed_profile["fields"][0], "value": "Hauptzeugin"}]
        story_world.save(changed)

        profile = story_world.load()["nodes"][0]["profile"]
        self.assertEqual(
            profile["fields"],
            [
                {
                    "id": "profile-field-role",
                    "key": "Rolle",
                    "value": "Hauptzeugin",
                    "futureFieldData": {"source": "import"},
                }
            ],
        )
        self.assertEqual(profile["noteReferences"], state["nodes"][0]["profile"]["noteReferences"])
        self.assertEqual(profile["futureProfileField"], {"kept": True})
        with sqlite_connection() as database:
            self.assertEqual(
                tuple(
                    database.execute(
                        "SELECT age,role,appearance,origin,voice,notes "
                        "FROM profiles WHERE figure_id='figure-mara'"
                    ).fetchone()
                ),
                ("", "", "", "", "", "Mara kennt das Archiv."),
            )
            rows = database.execute(
                "SELECT rowid,field_id,position,label,value "
                "FROM profile_fields WHERE figure_id='figure-mara' ORDER BY position"
            ).fetchall()
            self.assertEqual(
                [tuple(row)[1:] for row in rows],
                [("profile-field-role", 0, "Rolle", "Hauptzeugin")],
            )
            self.assertEqual(rows[0][0], retained_rowid)
            self.assertEqual(database.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_figure_state_roundtrip_is_stable_across_repeated_saves(self):
        schema.initialize()
        story_world.save(realistic_figure_state())
        first = story_world.load()
        story_world.save(copy.deepcopy(first))
        second = story_world.load()
        self.assertEqual(second, first)

    def test_figure_revision_and_conflict_semantics_remain_unchanged(self):
        schema.initialize()
        state = realistic_figure_state()
        self.assertEqual(revisions.save_with_revision("figures", state, 0), 1)
        # A successful PUT still advances the ETag/revision even for an unchanged payload.
        self.assertEqual(revisions.save_with_revision("figures", copy.deepcopy(state), 1), 2)
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision("figures", state, 1)
        self.assertEqual(revisions.revision("figures"), 2)

    def test_failed_figure_sync_rolls_back_state_and_revision_atomically(self):
        schema.initialize()
        original = realistic_figure_state()
        self.assertEqual(revisions.save_with_revision("figures", original, 0), 1)
        before = story_world.load()

        invalid = realistic_figure_state()
        invalid["nodes"][0]["name"] = "Diese Teiländerung darf nicht sichtbar werden"
        invalid["nodes"].append({"name": "Ohne stabile ID", "x": 10, "y": 20})
        with self.assertRaises((KeyError, sqlite3.IntegrityError)):
            revisions.save_with_revision("figures", invalid, 1)

        self.assertEqual(story_world.load(), before)
        self.assertEqual(revisions.revision("figures"), 1)
        with sqlite_connection() as conn:
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_rewiring_connection_away_from_deleted_figure_preserves_connection_identity(self):
        schema.initialize()
        original = realistic_figure_state()
        story_world.save(original)
        with sqlite_connection() as conn:
            conn.execute(
                "CREATE TABLE connection_evidence("
                "id TEXT PRIMARY KEY, "
                "connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE, "
                "note TEXT NOT NULL)"
            )
            conn.execute(
                "INSERT INTO connection_evidence(id, connection_id, note) VALUES(?,?,?)",
                ("evidence-1", "edge-ada-ben", "Vom Nutzer bestätigt"),
            )
            connection_rowid = conn.execute(
                "SELECT rowid FROM connections WHERE id='edge-ada-ben'"
            ).fetchone()[0]

        changed = realistic_figure_state()
        changed["nodes"] = [node for node in changed["nodes"] if node["id"] != "figure-ben"]
        changed["edges"] = [
            {
                **changed["edges"][0],
                "to": "place-harbor",
                "label": "kennt den Weg nach",
            }
        ]
        story_world.save(changed)

        with sqlite_connection() as conn:
            rewired = conn.execute(
                "SELECT rowid, source_id, target_id FROM connections WHERE id='edge-ada-ben'"
            ).fetchone()
            self.assertEqual(tuple(rewired), (connection_rowid, "figure-ada", "place-harbor"))
            self.assertEqual(
                tuple(
                    conn.execute(
                        "SELECT connection_id, note FROM connection_evidence WHERE id='evidence-1'"
                    ).fetchone()
                ),
                ("edge-ada-ben", "Vom Nutzer bestätigt"),
            )
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_reordering_connections_preserves_dependent_rows_and_payload_order(self):
        schema.initialize()
        original = realistic_figure_state()
        story_world.save(original)
        with sqlite_connection() as conn:
            conn.execute(
                "CREATE TABLE connection_kinds("
                "connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE, "
                "kind TEXT NOT NULL)"
            )
            conn.execute(
                "INSERT INTO connection_kinds(connection_id, kind) VALUES(?,?)",
                ("edge-ada-ben", "chosen-family"),
            )

        reordered = realistic_figure_state()
        reordered["edges"] = list(reversed(reordered["edges"]))
        story_world.save(reordered)

        self.assertEqual(
            [edge["id"] for edge in story_world.load()["edges"]],
            ["edge-ben-harbor", "edge-ada-ben"],
        )
        with sqlite_connection() as conn:
            self.assertEqual(
                tuple(
                    conn.execute(
                        "SELECT connection_id, kind FROM connection_kinds "
                        "WHERE connection_id='edge-ada-ben'"
                    ).fetchone()
                ),
                ("edge-ada-ben", "chosen-family"),
            )
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_schema_v9_profiles_migrate_once_with_stable_fields_extensions_and_revisions(self):
        legacy_db = config.DATA / "legacy-v9-profiles.sqlite3"
        schema.initialize(legacy_db)
        note_references = [
            {
                "id": "legacy-profile-reference",
                "target": {"kind": "entity", "id": "legacy-figure"},
                "from": 0,
                "to": 4,
                "surface": "Mara",
            }
        ]
        with sqlite_connection(legacy_db) as database:
            database.execute("DROP TABLE profile_fields")
            database.execute(
                "CREATE TABLE profile_fields("
                "figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,"
                "position INTEGER NOT NULL,"
                "label TEXT NOT NULL DEFAULT '',"
                "value TEXT NOT NULL DEFAULT '',"
                "PRIMARY KEY(figure_id,position))"
            )
            database.execute("UPDATE meta SET value='9' WHERE key='schema_version'")
            database.execute("UPDATE meta SET value='41' WHERE key='figures_revision'")
            database.execute("UPDATE meta SET value='17' WHERE key='manuscript_revision'")
            database.execute(
                "INSERT INTO figures(id,position,x,y,kind,label,name,subtitle,accent,dashed,"
                "pinned,extra_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "legacy-figure",
                    0,
                    12.0,
                    24.0,
                    "person",
                    "Zeugin",
                    "Mara",
                    "Archivarin",
                    "ink",
                    0,
                    0,
                    '{"legacyNodeField":true}',
                ),
            )
            database.execute(
                "INSERT INTO profiles(figure_id,age,role,appearance,origin,voice,notes,"
                "extra_json) VALUES(?,?,?,?,?,?,?,?)",
                (
                    "legacy-figure",
                    "62",
                    "Zeugin",
                    "",
                    "Westen",
                    "",
                    "Mara kennt das Archiv.",
                    json.dumps(
                        {
                            "noteReferences": note_references,
                            "futureProfileField": {"kept": True},
                        }
                    ),
                ),
            )
            database.execute(
                "INSERT INTO profile_fields(figure_id,position,label,value) VALUES(?,?,?,?)",
                ("legacy-figure", 0, "Erinnerung", "Der erste Sturm"),
            )

        schema.initialize(legacy_db)
        expected_fields = [
            {
                "id": "profile-field:legacy-figure:legacy:alter",
                "key": "Alter",
                "value": "62",
            },
            {
                "id": "profile-field:legacy-figure:legacy:rolle",
                "key": "Rolle in der Geschichte",
                "value": "Zeugin",
            },
            {
                "id": "profile-field:legacy-figure:legacy:herkunft",
                "key": "Herkunft & Vorgeschichte",
                "value": "Westen",
            },
            {
                "id": "profile-field:legacy-figure:extra:0",
                "key": "Erinnerung",
                "value": "Der erste Sturm",
            },
        ]
        profile = story_world.load(db_path=legacy_db)["nodes"][0]["profile"]
        self.assertEqual(profile["notizen"], "Mara kennt das Archiv.")
        self.assertEqual(profile["noteReferences"], note_references)
        self.assertEqual(profile["futureProfileField"], {"kept": True})
        self.assertEqual(profile["fields"], expected_fields)
        with sqlite_connection(legacy_db) as upgraded:
            first_rows = [
                tuple(row)
                for row in upgraded.execute(
                    "SELECT rowid,field_id,position,label,value,extra_json "
                    "FROM profile_fields WHERE figure_id='legacy-figure' ORDER BY position"
                )
            ]
            self.assertEqual(
                [row[1:5] for row in first_rows],
                [
                    (
                        field["id"],
                        position,
                        field["key"],
                        field["value"],
                    )
                    for position, field in enumerate(expected_fields)
                ],
            )
            self.assertTrue(all(row[5] == "{}" for row in first_rows))
            self.assertEqual(
                tuple(
                    upgraded.execute(
                        "SELECT age,role,appearance,origin,voice,notes,extra_json "
                        "FROM profiles WHERE figure_id='legacy-figure'"
                    ).fetchone()
                ),
                (
                    "62",
                    "Zeugin",
                    "",
                    "Westen",
                    "",
                    "Mara kennt das Archiv.",
                    json.dumps(
                        {
                            "noteReferences": note_references,
                            "futureProfileField": {"kept": True},
                        }
                    ),
                ),
            )
            self.assertEqual(revisions.revision("figures", db_path=legacy_db), 41)
            self.assertEqual(revisions.revision("manuscript", db_path=legacy_db), 17)

        schema.initialize(legacy_db)
        with sqlite_connection(legacy_db) as reopened:
            second_rows = [
                tuple(row)
                for row in reopened.execute(
                    "SELECT rowid,field_id,position,label,value,extra_json "
                    "FROM profile_fields WHERE figure_id='legacy-figure' ORDER BY position"
                )
            ]
            self.assertEqual(second_rows, first_rows)
            self.assertEqual(
                reopened.execute("SELECT COUNT(*) FROM profile_fields").fetchone()[0],
                len(expected_fields),
            )
            self.assertEqual(revisions.revision("figures", db_path=legacy_db), 41)
            self.assertEqual(revisions.revision("manuscript", db_path=legacy_db), 17)
            self.assertEqual(reopened.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_schema_v9_preserves_authoritative_canonical_fields_from_profile_extensions(self):
        schema.initialize()
        canonical_fields = [
            {
                "id": "already-stable-role",
                "key": "Rolle",
                "value": "Zeugin",
                "source": "early-client",
            },
            {"id": "already-stable-motive", "key": "Motiv", "value": "Wahrheit"},
        ]
        story_world.save(
            {
                "nodes": [
                    {
                        "id": "figure-early",
                        "x": 0,
                        "y": 0,
                        "name": "Mara",
                        "profile": {"fields": canonical_fields},
                    }
                ],
                "edges": [],
            }
        )
        with sqlite_connection() as database:
            database.execute("DROP TABLE profile_fields")
            database.execute(
                "CREATE TABLE profile_fields("
                "figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,"
                "position INTEGER NOT NULL,label TEXT NOT NULL DEFAULT '',"
                "value TEXT NOT NULL DEFAULT '',PRIMARY KEY(figure_id,position))"
            )
            database.execute(
                "INSERT INTO profile_fields(figure_id,position,label,value) VALUES(?,?,?,?)",
                ("figure-early", 0, "Legacy custom", "Must not reappear"),
            )
            database.execute(
                "UPDATE profiles SET age='9',extra_json=? WHERE figure_id='figure-early'",
                (json.dumps({"fields": canonical_fields, "future": {"kept": True}}),),
            )
            database.execute("UPDATE meta SET value='9' WHERE key='schema_version'")
            database.execute("UPDATE meta SET value='23' WHERE key='figures_revision'")

        schema.initialize()
        profile = story_world.load()["nodes"][0]["profile"]
        self.assertEqual(profile["fields"], canonical_fields)
        self.assertEqual(profile["future"], {"kept": True})
        with sqlite_connection() as database:
            first_rows = [
                tuple(row)
                for row in database.execute(
                    "SELECT rowid,field_id,position,label,value,extra_json "
                    "FROM profile_fields ORDER BY position"
                )
            ]
            self.assertEqual(
                [row[1] for row in first_rows], [field["id"] for field in canonical_fields]
            )
            self.assertEqual(json.loads(first_rows[0][5]), {"source": "early-client"})
            stored_extensions = json.loads(
                database.execute(
                    "SELECT extra_json FROM profiles WHERE figure_id='figure-early'"
                ).fetchone()[0]
            )
            self.assertEqual(stored_extensions, {"future": {"kept": True}})
            self.assertEqual(revisions.revision("figures"), 23)

        schema.initialize()
        with sqlite_connection() as database:
            second_rows = [
                tuple(row)
                for row in database.execute(
                    "SELECT rowid,field_id,position,label,value,extra_json "
                    "FROM profile_fields ORDER BY position"
                )
            ]
            self.assertEqual(second_rows, first_rows)
            self.assertEqual(revisions.revision("figures"), 23)

    def test_schema_v9_rejects_invalid_canonical_profile_fields_atomically(self):
        schema.initialize()
        story_world.save(
            {
                "nodes": [{"id": "figure-invalid", "x": 0, "y": 0, "name": "Mara"}],
                "edges": [],
            }
        )
        with sqlite_connection() as database:
            database.execute("DROP TABLE profile_fields")
            database.execute(
                "CREATE TABLE profile_fields("
                "figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,"
                "position INTEGER NOT NULL,label TEXT NOT NULL DEFAULT '',"
                "value TEXT NOT NULL DEFAULT '',PRIMARY KEY(figure_id,position))"
            )
            database.execute(
                "UPDATE profiles SET extra_json=? WHERE figure_id='figure-invalid'",
                (json.dumps({"fields": None}),),
            )
            database.execute("UPDATE meta SET value='9' WHERE key='schema_version'")

        with self.assertRaisesRegex(ValueError, "invalid canonical profile fields"):
            schema.initialize()
        with sqlite_connection() as database:
            columns = {row[1] for row in database.execute("PRAGMA table_info(profile_fields)")}
            self.assertNotIn("field_id", columns)
            self.assertEqual(
                database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                "9",
            )

    def test_schema_v3_world_upgrades_and_accepts_stable_figure_saves(self):
        legacy_db = config.DATA / "legacy-v3.sqlite3"
        legacy_db.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(legacy_db)
        try:
            conn.executescript(LEGACY_V3_FIGURE_SCHEMA)
            conn.execute("INSERT INTO meta(key, value) VALUES('schema_version', '3')")
            conn.execute("INSERT INTO meta(key, value) VALUES('figures_revision', '7')")
            conn.execute(
                "INSERT INTO figures(id, position, x, y, kind, label, name, subtitle, "
                "accent, dashed, pinned, extra_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "legacy-figure",
                    0,
                    12.0,
                    24.0,
                    "person",
                    "Alt",
                    "Mara",
                    "Archivarin",
                    "ink",
                    0,
                    0,
                    '{"legacyFlag":true}',
                ),
            )
            conn.execute(
                "INSERT INTO profiles(figure_id, age, role, appearance, origin, voice, notes, "
                "extra_json) VALUES(?,?,?,?,?,?,?,?)",
                ("legacy-figure", "62", "Zeugin", "", "Westen", "", "", "{}"),
            )
            conn.execute(
                "INSERT INTO profile_fields(figure_id, position, label, value) VALUES(?,?,?,?)",
                ("legacy-figure", 0, "Erinnerung", "Der erste Sturm"),
            )
            conn.commit()
        finally:
            conn.close()

        schema.initialize(legacy_db)
        loaded = story_world.load(db_path=legacy_db)
        self.assertTrue(loaded["nodes"][0]["legacyFlag"])
        self.assertEqual(
            loaded["nodes"][0]["profile"]["fields"],
            [
                {
                    "id": "profile-field:legacy-figure:legacy:alter",
                    "key": "Alter",
                    "value": "62",
                },
                {
                    "id": "profile-field:legacy-figure:legacy:rolle",
                    "key": "Rolle in der Geschichte",
                    "value": "Zeugin",
                },
                {
                    "id": "profile-field:legacy-figure:legacy:herkunft",
                    "key": "Herkunft & Vorgeschichte",
                    "value": "Westen",
                },
                {
                    "id": "profile-field:legacy-figure:extra:0",
                    "key": "Erinnerung",
                    "value": "Der erste Sturm",
                },
            ],
        )
        story_world.save(copy.deepcopy(loaded), db_path=legacy_db)
        normalized = story_world.load(db_path=legacy_db)
        self.assertEqual(normalized["nodes"], loaded["nodes"])
        self.assertEqual(normalized["edges"], loaded["edges"])
        self.assertEqual(normalized["canvasSize"], {"w": 2400, "h": 1600})
        story_world.save(copy.deepcopy(normalized), db_path=legacy_db)
        self.assertEqual(story_world.load(db_path=legacy_db), normalized)
        self.assertEqual(revisions.revision("figures", db_path=legacy_db), 7)
        with sqlite_connection(legacy_db) as upgraded:
            self.assertEqual(
                upgraded.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                str(schema.SCHEMA_VERSION),
            )
            self.assertEqual(upgraded.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_schema_v3_temporal_json_migrates_once_without_changing_figure_state(self):
        legacy_db = config.DATA / "legacy-v3-temporal.sqlite3"
        legacy_db.parent.mkdir(parents=True, exist_ok=True)
        legacy_timeline = [
            {"id": "legacy-before", "title": "Vorher", "futureMoment": "kept"},
            {
                "id": "legacy-zero",
                "title": "Verrat",
                "date": "1420-03-12",
                "note": "Der Wendepunkt",
            },
            {"id": "legacy-after", "title": "Danach"},
        ]
        legacy_presence = [
            {
                "id": "legacy-base-presence",
                "elementId": "legacy-person",
                "placeId": "legacy-place",
                "futurePresence": True,
            },
            {
                "id": "legacy-moment-presence",
                "elementId": "legacy-person",
                "placeId": "legacy-place",
                "momentId": "legacy-zero",
            },
            {
                "id": "legacy-moment-presence-final",
                "elementId": "legacy-person",
                "placeId": "legacy-place",
                "momentId": "legacy-zero",
                "futurePresence": "last wins",
            },
            {
                "id": "dangling-presence",
                "elementId": "legacy-person",
                "placeId": "legacy-place",
                "momentId": "deleted-moment",
            },
        ]
        legacy_versions = [
            {"momentId": "legacy-before", "label": "Freunde", "active": True},
            {
                "momentId": "legacy-zero",
                "label": "Feinde",
                "active": True,
                "gerichtet": True,
                "style": "dashed",
                "futureVersion": {"certainty": 0.8},
            },
            {
                "momentId": "legacy-zero",
                "label": "Erbfeinde",
                "active": True,
                "futureVersion": {"certainty": 1},
            },
            {"momentId": "legacy-after", "active": False},
            {"momentId": "deleted-moment", "active": True},
        ]
        conn = sqlite3.connect(legacy_db)
        try:
            conn.executescript(LEGACY_V3_FIGURE_SCHEMA)
            conn.execute("INSERT INTO meta(key, value) VALUES('schema_version', '3')")
            conn.execute("INSERT INTO meta(key, value) VALUES('figures_revision', '11')")
            conn.execute(
                "INSERT INTO figure_settings(id, canvas_width, canvas_height, extra_json) "
                "VALUES(1,2400,1600,?)",
                (
                    json.dumps(
                        {
                            "timeline": legacy_timeline,
                            "presence": legacy_presence,
                            "futureAggregate": "kept",
                        }
                    ),
                ),
            )
            conn.executemany(
                "INSERT INTO figures(id, position, x, y, kind, label, name, subtitle, "
                "accent, dashed, pinned, extra_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        "legacy-person",
                        0,
                        10,
                        20,
                        "person",
                        "",
                        "Mara",
                        "",
                        "ink",
                        0,
                        0,
                        json.dumps(
                            {
                                "diedMomentId": "legacy-after",
                                "futureNode": "kept",
                            }
                        ),
                    ),
                    (
                        "legacy-place",
                        1,
                        30,
                        40,
                        "ort",
                        "",
                        "Hafen",
                        "",
                        "blue",
                        0,
                        0,
                        "{}",
                    ),
                ],
            )
            conn.execute(
                "INSERT INTO connections(id, source_id, target_id, label, style, directed, "
                "extra_json) VALUES(?,?,?,?,?,?,?)",
                (
                    "legacy-edge",
                    "legacy-person",
                    "legacy-place",
                    "kennt",
                    "solid",
                    0,
                    json.dumps({"versions": legacy_versions, "futureConnection": "kept"}),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        schema.initialize(legacy_db)
        loaded = story_world.load(db_path=legacy_db)
        self.assertEqual(
            loaded["timeline"],
            [
                {**moment, "time": position, "position": position}
                for position, moment in enumerate(legacy_timeline)
            ],
        )
        self.assertEqual(loaded["presence"], [legacy_presence[0], legacy_presence[2]])
        self.assertEqual(
            loaded["edges"][0]["versions"],
            [legacy_versions[0], legacy_versions[2], legacy_versions[3]],
        )
        self.assertEqual(loaded["futureAggregate"], "kept")
        self.assertEqual(loaded["edges"][0]["futureConnection"], "kept")
        self.assertEqual(loaded["nodes"][0]["futureNode"], "kept")
        self.assertEqual(loaded["nodes"][0]["diedMomentId"], "legacy-after")
        self.assertEqual(revisions.revision("figures", db_path=legacy_db), 11)

        with sqlite_connection(legacy_db) as upgraded:
            self.assertEqual(
                [
                    tuple(row)
                    for row in upgraded.execute(
                        "SELECT id, time, position FROM timeline_moments ORDER BY time, position"
                    )
                ],
                [
                    ("legacy-before", 0, 0),
                    ("legacy-zero", 1, 1),
                    ("legacy-after", 2, 2),
                ],
            )
            self.assertEqual(
                tuple(
                    upgraded.execute(
                        "SELECT active,label,directed,style FROM relationship_states "
                        "WHERE relationship_id='legacy-edge' AND moment_id='legacy-after'"
                    ).fetchone()
                ),
                (0, "", 0, "solid"),
            )
            before = {
                table: table_rows_with_rowid(upgraded, table)
                for table in (
                    "timeline_moments",
                    "relationship_states",
                    "presence_states",
                )
            }
            settings_extra = json.loads(
                upgraded.execute("SELECT extra_json FROM figure_settings WHERE id=1").fetchone()[0]
            )
            connection_extra = json.loads(
                upgraded.execute(
                    "SELECT extra_json FROM connections WHERE id='legacy-edge'"
                ).fetchone()[0]
            )
            figure_extra = json.loads(
                upgraded.execute(
                    "SELECT extra_json FROM figures WHERE id='legacy-person'"
                ).fetchone()[0]
            )
            self.assertNotIn("timeline", settings_extra)
            self.assertNotIn("presence", settings_extra)
            self.assertNotIn("versions", connection_extra)
            self.assertNotIn("diedMomentId", figure_extra)
            self.assertEqual(upgraded.execute("PRAGMA foreign_key_check").fetchall(), [])

        # Re-opening an already migrated world must not duplicate or replace rows.
        schema.initialize(legacy_db)
        with sqlite_connection(legacy_db) as upgraded:
            after = {
                table: table_rows_with_rowid(upgraded, table)
                for table in (
                    "timeline_moments",
                    "relationship_states",
                    "presence_states",
                )
            }
            self.assertEqual(after, before)
            self.assertEqual(
                upgraded.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                str(schema.SCHEMA_VERSION),
            )
            self.assertEqual(upgraded.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_revision_conflicts_prevent_lost_updates(self):
        schema.initialize()
        state = {"chapters": [{"id": "c1", "title": "A", "body": "eins", "note": ""}]}
        first = revisions.save_with_revision("manuscript", state, 0)
        self.assertEqual(first, 1)
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision(
                "manuscript",
                {**state, "chapters": [{**state["chapters"][0], "body": "veraltet"}]},
                0,
            )
        self.assertEqual(manuscript_store.load()["chapters"][0]["body"], "eins")

    def test_backup_can_be_restored(self):
        schema.initialize()
        original = {"chapters": [{"id": "c1", "title": "A", "body": "Original", "note": ""}]}
        revisions.save_with_revision("manuscript", original, 0)
        restore.backup_if_due()
        name = restore.list_backups()[0]["name"]
        changed = {"chapters": [{"id": "c1", "title": "A", "body": "Geändert", "note": ""}]}
        revisions.save_with_revision("manuscript", changed, 1)
        restore.restore_backup(name)
        self.assertEqual(manuscript_store.load()["chapters"][0]["body"], "Original")

    def test_restore_revisions_are_strictly_above_replaced_and_restored_etags(self):
        schema.initialize()
        with sqlite_connection() as connection:
            connection.execute("UPDATE meta SET value='2' WHERE key='manuscript_revision'")
            connection.execute("UPDATE meta SET value='3' WHERE key='figures_revision'")
            connection.execute("UPDATE meta SET value='4' WHERE key='storyboards_revision'")
        restore.backup_if_due(force=True)
        backup_name = restore.list_backups()[0]["name"]
        with sqlite_connection() as connection:
            connection.execute("UPDATE meta SET value='20' WHERE key='manuscript_revision'")
            connection.execute("UPDATE meta SET value='30' WHERE key='figures_revision'")
            connection.execute("UPDATE meta SET value='40' WHERE key='storyboards_revision'")

        restore.restore_backup(backup_name)

        self.assertEqual(revisions.revision("manuscript"), 21)
        self.assertEqual(revisions.revision("figures"), 31)
        self.assertEqual(revisions.revision("storyboards"), 41)
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision("manuscript", manuscript_store.load(), expected=2)

    def test_remote_restore_finalization_invalidates_pre_restore_etags(self):
        schema.initialize()
        world = self.create_world("Remote", "", owner_sub="owner")
        database = self.world_db_path(world["id"])
        with sqlite_connection(database) as connection:
            connection.execute("UPDATE meta SET value='4' WHERE key='manuscript_revision'")
            connection.execute("UPDATE meta SET value='7' WHERE key='figures_revision'")
            connection.execute("UPDATE meta SET value='9' WHERE key='storyboards_revision'")

        SQLiteWorldRepository(self.paths).finalize_restore(
            world["id"],
            "owner",
            {"manuscript": 50, "figures": 60, "storyboards": 70},
        )

        self.assertEqual(revisions.revision("manuscript", db_path=database), 51)
        self.assertEqual(revisions.revision("figures", db_path=database), 61)
        self.assertEqual(revisions.revision("storyboards", db_path=database), 71)
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision(
                "manuscript",
                manuscript_store.load(database),
                expected=4,
                db_path=database,
            )

    def test_restoring_v3_backup_migrates_temporal_state_before_it_is_loaded(self):
        schema.initialize()
        revisions.save_with_revision("figures", temporal_figure_state(), 0)
        config.BACKUPS.mkdir(parents=True, exist_ok=True)
        backup_name = "backup-20200101-000000-000000.sqlite3"
        legacy_backup = config.BACKUPS / backup_name
        conn = sqlite3.connect(legacy_backup)
        try:
            conn.executescript(LEGACY_V3_FIGURE_SCHEMA)
            conn.executemany(
                "INSERT INTO meta(key,value) VALUES(?,?)",
                [
                    ("schema_version", "3"),
                    ("figures_revision", "5"),
                    ("manuscript_revision", "8"),
                    ("last_restore_at", ""),
                ],
            )
            conn.execute(
                "INSERT INTO figure_settings(id,canvas_width,canvas_height,extra_json) "
                "VALUES(1,2400,1600,?)",
                (
                    json.dumps(
                        {
                            "timeline": [{"id": "backup-moment", "title": "Aus Sicherung"}],
                            "presence": [
                                {
                                    "id": "backup-presence",
                                    "elementId": "backup-person",
                                    "placeId": "backup-place",
                                    "momentId": "backup-moment",
                                }
                            ],
                        }
                    ),
                ),
            )
            conn.executemany(
                "INSERT INTO figures(id,position,x,y,kind,label,name,subtitle,accent,dashed,"
                "pinned,extra_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        "backup-person",
                        0,
                        0,
                        0,
                        "person",
                        "",
                        "Gesicherte Figur",
                        "",
                        "ink",
                        0,
                        0,
                        "{}",
                    ),
                    (
                        "backup-place",
                        1,
                        1,
                        1,
                        "ort",
                        "",
                        "Gesicherter Ort",
                        "",
                        "blue",
                        0,
                        0,
                        "{}",
                    ),
                ],
            )
            conn.commit()
        finally:
            conn.close()

        restore.restore_backup(backup_name)

        loaded = story_world.load()
        self.assertEqual(
            loaded["timeline"],
            [
                {
                    "id": "backup-moment",
                    "title": "Aus Sicherung",
                    "time": 0,
                    "position": 0,
                }
            ],
        )
        self.assertEqual(
            loaded["presence"],
            [
                {
                    "id": "backup-presence",
                    "elementId": "backup-person",
                    "placeId": "backup-place",
                    "momentId": "backup-moment",
                }
            ],
        )
        # Restore advances each revision from the restored backup, not the replaced world.
        self.assertEqual(revisions.revision("figures"), 6)
        self.assertEqual(revisions.revision("manuscript"), 9)
        with sqlite_connection() as restored:
            self.assertEqual(
                restored.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                str(schema.SCHEMA_VERSION),
            )
            self.assertTrue(
                restored.execute("SELECT value FROM meta WHERE key='last_restore_at'").fetchone()[0]
            )
            self.assertEqual(restored.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_worlds_are_created_in_separate_databases_without_activation_state(self):
        first = self.create_world("Der letzte Garten", "https://backup.example.com")
        second = self.create_world("Stadt aus Glas", "https://backup.example.com/glass")
        self.assertEqual(first["title"], "Der letzte Garten")
        first_database = self.world_db_path(first["id"])
        second_database = self.world_db_path(second["id"])
        manuscript_store.save(
            {"chapters": [{"id": "c1", "title": "Anfang", "body": "Neu", "note": ""}]},
            db_path=first_database,
        )
        self.assertEqual(
            manuscript_store.load(db_path=first_database)["chapters"][0]["body"],
            "Neu",
        )
        self.assertEqual(len(manuscript_store.load(db_path=second_database)["chapters"]), 1)
        self.assertEqual(
            manuscript_store.load(db_path=second_database)["chapters"][0]["body"],
            "",
        )

    def test_backup_endpoint_is_optional(self):
        local_only = self.create_world("Nur lokal")
        self.assertEqual(local_only["backupUrl"], "")
        hosted = self.create_world("Gehostet", "https://backup.example.com")
        self.assertEqual(hosted["backupUrl"], "https://backup.example.com")

    def test_plain_http_backup_endpoints_are_refused_except_on_loopback(self):
        """A backup carries the whole manuscript; a typo must not be what decides
        whether it crosses a network unencrypted."""
        with self.assertRaises(ValueError):
            self.create_world("Unsicher", "http://backup.example.com")
        local = self.create_world("Eigener Rechner", "http://127.0.0.1:9000")
        self.assertEqual(local["backupUrl"], "http://127.0.0.1:9000")

    def test_world_deletion_removes_local_data_but_not_other_worlds(self):
        doomed = self.create_world("Delete me", "https://backup.example.com")
        survivor = self.create_world("Keep me")
        roots = ("backups", "history", "manuscripts", "profiles")
        for root in roots:
            for world in (doomed, survivor):
                directory = config.DATA / root / world["id"]
                directory.mkdir(parents=True)
                (directory / "sentinel.txt").write_text(world["title"])
        doomed_database = config.WORLDS / f"{doomed['id']}.sqlite3"
        survivor_database = config.WORLDS / f"{survivor['id']}.sqlite3"
        for suffix in ("-wal", "-shm"):
            Path(f"{doomed_database}{suffix}").write_text("doomed")
            Path(f"{survivor_database}{suffix}").write_text("survivor")

        self.delete_world(doomed["id"])

        self.assertFalse(doomed_database.exists())
        self.assertFalse(Path(f"{doomed_database}-wal").exists())
        self.assertFalse(Path(f"{doomed_database}-shm").exists())
        for root in roots:
            self.assertFalse((config.DATA / root / doomed["id"]).exists())
            self.assertTrue((config.DATA / root / survivor["id"] / "sentinel.txt").exists())
        self.assertTrue(survivor_database.exists())
        self.assertTrue(Path(f"{survivor_database}-wal").exists())
        self.assertTrue(Path(f"{survivor_database}-shm").exists())
        self.assertEqual([world["title"] for world in self.list_worlds()], ["Keep me"])

    def test_world_listing_ignores_sqlite_files_without_a_world_id(self):
        world = self.create_world("Valid world")
        shutil.copy2(self.world_db_path(world["id"]), config.WORLDS / "notes.sqlite3")

        self.assertEqual([listed["id"] for listed in self.list_worlds()], [world["id"]])

    def test_list_worlds_filters_by_owner_sub(self):
        mine = self.create_world("Meine Welt", owner_sub="alice")
        self.create_world("Fremde Welt", owner_sub="bob")
        self.assertEqual([w["id"] for w in self.list_worlds(owner_sub="alice")], [mine["id"]])
        self.assertEqual(len(self.list_worlds(owner_sub="carol")), 0)
        self.assertEqual(len(self.list_worlds()), 2)

    def test_local_owner_is_nonempty_and_in_the_reserved_subject_namespace(self):
        self.assertTrue(config.LOCAL_OWNER)
        self.assertTrue(config.LOCAL_OWNER.startswith("quiltor-internal:"))

    def test_local_owner_worlds_are_filtered_like_any_other_owner(self):
        mine = self.create_world("Lokale Welt", owner_sub=config.LOCAL_OWNER)
        theirs = self.create_world("Fremde Welt", owner_sub="alice")
        listed = [w["id"] for w in self.list_worlds(owner_sub=config.LOCAL_OWNER)]
        self.assertEqual(listed, [mine["id"]])
        self.assertNotIn(theirs["id"], listed)
        self.assertEqual(self.world_owner(mine["id"]), config.LOCAL_OWNER)

    def test_v6_empty_local_owner_is_migrated_to_the_reserved_subject(self):
        world = self.create_world("Legacy owner", owner_sub="temporary")
        path = self.world_db_path(world["id"])
        with sqlite_connection(path) as connection:
            connection.execute("UPDATE meta SET value='6' WHERE key='schema_version'")
            connection.execute("UPDATE meta SET value='' WHERE key='owner_sub'")
        schema.initialize(path)
        self.assertEqual(self.world_owner(world["id"]), config.LOCAL_OWNER)

    def test_current_empty_owner_is_treated_as_the_local_user(self):
        world = self.create_world("Legacy local world", owner_sub="temporary")
        path = self.world_db_path(world["id"])
        with sqlite_connection(path) as database:
            database.execute("UPDATE meta SET value='' WHERE key='owner_sub'")

        self.assertEqual(self.world_owner(world["id"]), config.LOCAL_OWNER)
        self.assertEqual(
            [listed["id"] for listed in self.list_worlds(owner_sub=config.LOCAL_OWNER)],
            [world["id"]],
        )
        self.assertEqual(self.list_worlds(owner_sub="temporary"), [])

        self.delete_world(world["id"], owner_sub=config.LOCAL_OWNER)
        self.assertFalse(path.exists())

    def test_create_world_stamps_owner_sub(self):
        world = self.create_world("Welt", owner_sub="alice")
        self.assertEqual(self.world_owner(world["id"]), "alice")

    def test_new_world_without_an_explicit_owner_belongs_to_the_local_user(self):
        world = self.create_world("Unclaimed")
        self.assertEqual(self.world_owner(world["id"]), config.LOCAL_OWNER)
        self.assertIsNone(self.world_owner("0" * 32))

    def test_delete_world_rejects_non_owner(self):
        world = self.create_world("Meine Welt", owner_sub="alice")
        with self.assertRaises(PermissionError):
            self.delete_world(world["id"], owner_sub="bob")
        self.assertTrue((config.WORLDS / f"{world['id']}.sqlite3").exists())
        self.delete_world(world["id"], owner_sub="alice")
        self.assertFalse((config.WORLDS / f"{world['id']}.sqlite3").exists())
        with self.assertRaises(FileNotFoundError):
            self.delete_world(world["id"], owner_sub="alice")

    def test_explicit_db_paths_are_isolated_without_global_activation(self):
        world_a = self.create_world("A")
        world_b = self.create_world("B")
        path_a = self.world_db_path(world_a["id"])
        path_b = self.world_db_path(world_b["id"])
        manuscript_store.save(
            {"chapters": [{"id": "c1", "title": "A", "body": "von A", "note": ""}]}, db_path=path_a
        )
        manuscript_store.save(
            {"chapters": [{"id": "c1", "title": "B", "body": "von B", "note": ""}]}, db_path=path_b
        )
        self.assertEqual(manuscript_store.load(db_path=path_a)["chapters"][0]["body"], "von A")
        self.assertEqual(manuscript_store.load(db_path=path_b)["chapters"][0]["body"], "von B")

    def test_explicit_backups_dir_is_isolated_per_world(self):
        world_a = self.create_world("A")
        world_b = self.create_world("B")
        path_a, backups_a = (
            self.world_db_path(world_a["id"]),
            config.DATA / "backups" / world_a["id"],
        )
        path_b, backups_b = (
            self.world_db_path(world_b["id"]),
            config.DATA / "backups" / world_b["id"],
        )
        restore.backup_if_due(force=True, db_path=path_a, backups_dir=backups_a)
        restore.backup_if_due(force=True, db_path=path_b, backups_dir=backups_b)
        self.assertEqual(len(restore.list_backups(backups_dir=backups_a)), 1)
        self.assertEqual(len(restore.list_backups(backups_dir=backups_b)), 1)
        self.assertNotEqual(
            restore.list_backups(backups_dir=backups_a)[0]["name"],
            restore.list_backups(backups_dir=backups_b)[0]["name"],
        )


if __name__ == "__main__":
    unittest.main()
