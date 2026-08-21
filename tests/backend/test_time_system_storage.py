import copy
import tempfile
import unittest
from pathlib import Path

from backend.core import storage


class TimeSystemStorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original = (
            storage.DATA,
            storage.DB,
            storage.BACKUPS,
            storage.WORLDS,
            storage.ACTIVE_WORLD_ID,
        )
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""

    def tearDown(self):
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = (
            self.original
        )
        self.temp.cleanup()

    def state(self):
        return {
            "nodes": [],
            "edges": [],
            "timeline": [
                {"id": "past", "title": "Vorher", "time": -4, "position": 0},
                {"id": "origin", "title": "Beginn", "time": 0, "position": 1},
                {"id": "future", "title": "Danach", "time": 8, "position": 2},
            ],
        }

    def custom_system(self):
        return {
            "id": "primary",
            "name": "Nordkalender",
            "kind": "custom",
            "unit": "day",
            "eraName": "Nach der Flut",
            "eraAbbreviation": "NF",
            "epochTime": 0,
            "epochYear": 417,
            "epochMonth": 1,
            "epochDay": 1,
            "epochWeekday": 2,
            "displayFormat": "{day} {monthName}, {year} {era}",
            "futureSystem": {"source": "author"},
            "months": [
                {
                    "name": "Frostfall",
                    "shortName": "Frost",
                    "dayCount": 30,
                    "futureMonth": True,
                },
                {"name": "Ember", "shortName": "Emb", "dayCount": 20},
            ],
            "weekdays": [
                {"name": "Ersttag", "shortName": "E", "futureWeekday": 1},
                {"name": "Zweittag", "shortName": "Z"},
                {"name": "Dritttag", "shortName": "D"},
            ],
        }

    def test_v5_world_has_one_explicit_primary_relative_time_system(self):
        storage.initialize()
        loaded = storage.load_figures()
        self.assertEqual(loaded["timeSystem"]["id"], "primary")
        self.assertEqual(loaded["timeSystem"]["kind"], "relative")
        self.assertIn(loaded["timeSystem"]["unit"], {"day", "abstract"})
        with storage.connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM time_systems WHERE is_primary=1").fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                "5",
            )

    def test_custom_time_system_roundtrips_unknown_fields_and_stable_rows(self):
        storage.initialize()
        state = {**self.state(), "timeSystem": self.custom_system()}
        storage.save_figures(copy.deepcopy(state))
        loaded = storage.load_figures()
        self.assertEqual(loaded["timeSystem"], state["timeSystem"])
        with storage.connection() as conn:
            before = {
                table: [tuple(row) for row in conn.execute(f"SELECT rowid,* FROM {table}")]
                for table in ("time_systems", "calendar_months", "calendar_weekdays")
            }
        storage.save_figures(copy.deepcopy(loaded))
        with storage.connection() as conn:
            after = {
                table: [tuple(row) for row in conn.execute(f"SELECT rowid,* FROM {table}")]
                for table in ("time_systems", "calendar_months", "calendar_weekdays")
            }
        self.assertEqual(after, before)

    def test_switching_projection_never_mutates_canonical_moment_time(self):
        storage.initialize()
        state = {**self.state(), "timeSystem": self.custom_system()}
        storage.save_figures(copy.deepcopy(state))
        before = {moment["id"]: moment["time"] for moment in storage.load_figures()["timeline"]}
        state["timeSystem"] = {
            **state["timeSystem"],
            "kind": "gregorian",
            "epochYear": 2026,
            "epochMonth": 8,
            "epochDay": 18,
        }
        storage.save_figures(copy.deepcopy(state))
        after = {moment["id"]: moment["time"] for moment in storage.load_figures()["timeline"]}
        self.assertEqual(after, before)
        self.assertEqual(storage.load_figures()["timeSystem"]["months"], self.custom_system()["months"])

    def test_schema_v4_world_gets_default_system_without_revision_change(self):
        storage.initialize()
        with storage.connection() as conn:
            conn.execute("DROP TABLE calendar_weekdays")
            conn.execute("DROP TABLE calendar_months")
            conn.execute("DROP TABLE time_systems")
            conn.execute("UPDATE meta SET value='4' WHERE key='schema_version'")
            conn.execute("UPDATE meta SET value='9' WHERE key='figures_revision'")
        storage.initialize()
        self.assertEqual(storage.revision("figures"), 9)
        self.assertEqual(storage.load_figures()["timeSystem"]["kind"], "relative")


if __name__ == "__main__":
    unittest.main()
