import copy
import tempfile
import unittest
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import config, revisions, schema, story_world
from quiltor.infrastructure.persistence.sqlite.connection import connection


class TimeSystemStorageTest(unittest.TestCase):
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

    def tearDown(self):
        config.DATA, config.DB, config.BACKUPS, config.WORLDS = self.original
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

    def test_v6_world_has_one_explicit_primary_relative_time_system(self):
        schema.initialize()
        loaded = story_world.load()
        self.assertEqual(loaded["timeSystem"]["id"], "primary")
        self.assertEqual(loaded["timeSystem"]["kind"], "relative")
        self.assertIn(loaded["timeSystem"]["unit"], {"day", "abstract"})
        with connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM time_systems WHERE is_primary=1").fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                str(schema.SCHEMA_VERSION),
            )

    def test_custom_time_system_roundtrips_unknown_fields_and_stable_rows(self):
        schema.initialize()
        state = {**self.state(), "timeSystem": self.custom_system()}
        story_world.save(copy.deepcopy(state))
        loaded = story_world.load()
        self.assertEqual(loaded["timeSystem"], state["timeSystem"])
        with connection() as conn:
            before = {
                table: [tuple(row) for row in conn.execute(f"SELECT rowid,* FROM {table}")]
                for table in ("time_systems", "calendar_months", "calendar_weekdays")
            }
        story_world.save(copy.deepcopy(loaded))
        with connection() as conn:
            after = {
                table: [tuple(row) for row in conn.execute(f"SELECT rowid,* FROM {table}")]
                for table in ("time_systems", "calendar_months", "calendar_weekdays")
            }
        self.assertEqual(after, before)

    def test_switching_projection_never_mutates_canonical_moment_time(self):
        schema.initialize()
        state = {**self.state(), "timeSystem": self.custom_system()}
        story_world.save(copy.deepcopy(state))
        before = {moment["id"]: moment["time"] for moment in story_world.load()["timeline"]}
        state["timeSystem"] = {
            **state["timeSystem"],
            "kind": "gregorian",
            "epochYear": 2026,
            "epochMonth": 8,
            "epochDay": 18,
        }
        story_world.save(copy.deepcopy(state))
        after = {moment["id"]: moment["time"] for moment in story_world.load()["timeline"]}
        self.assertEqual(after, before)
        self.assertEqual(story_world.load()["timeSystem"]["months"], self.custom_system()["months"])

    def test_schema_v4_world_gets_default_system_without_revision_change(self):
        schema.initialize()
        with connection() as conn:
            conn.execute("DROP TABLE calendar_weekdays")
            conn.execute("DROP TABLE calendar_months")
            conn.execute("DROP TABLE time_systems")
            conn.execute("UPDATE meta SET value='4' WHERE key='schema_version'")
            conn.execute("UPDATE meta SET value='9' WHERE key='figures_revision'")
        schema.initialize()
        self.assertEqual(revisions.revision("figures"), 9)
        self.assertEqual(story_world.load()["timeSystem"]["kind"], "relative")


if __name__ == "__main__":
    unittest.main()
