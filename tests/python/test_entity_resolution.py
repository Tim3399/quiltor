import copy
import json
import tempfile
import unittest
from pathlib import Path

from quiltor.domain.story_world.entity_resolution import (
    name_distance,
    normalize_entity_name,
    resolve_entity,
)
from quiltor.infrastructure.persistence.sqlite import config, revisions, schema, story_world
from quiltor.infrastructure.persistence.sqlite.connection import connection


FIXTURE = json.loads(
    (
        Path(__file__).parents[2] / "contracts/fixtures/story-world/entity-resolution.v2.json"
    ).read_text(encoding="utf-8")
)


class EntityResolverTest(unittest.TestCase):
    def test_shared_folding_and_distance_vectors(self):
        for case in FIXTURE["fold"]:
            self.assertEqual(normalize_entity_name(case["input"]), case["expected"])
        for case in FIXTURE["distance"]:
            self.assertEqual(
                name_distance(
                    case["mention"].casefold(), case["candidate"].casefold(), case["budget"]
                ),
                case["expected"],
            )

    def test_exact_name_id_alias_and_folded_spelling_resolve(self):
        figures = FIXTURE["figures"]
        self.assertEqual(resolve_entity(figures, "tarek").resolved_id, "tarek")
        self.assertEqual(resolve_entity(figures, "Tarek Venn").resolved_id, "tarek")
        self.assertEqual(resolve_entity(figures, "Der Falke").resolved_id, "tarek")
        self.assertEqual(resolve_entity(figures, "Muller").resolved_id, "mueller")
        self.assertEqual(
            resolve_entity(figures, "Strassental", entity_type="ort").resolved_id, "strassental"
        )

    def test_fuzzy_matching_is_conservative_and_ties_stay_ambiguous(self):
        figures = FIXTURE["figures"]
        self.assertEqual(resolve_entity(figures, "Tarek Vennn").resolved_id, "tarek")
        self.assertEqual(resolve_entity(figures, "Mull").status, "not_found")
        tied = resolve_entity(figures, "Halver")
        self.assertEqual(tied.status, "ambiguous")
        self.assertEqual({item.element_id for item in tied.candidates}, {"halvar", "halvor"})
        self.assertEqual(
            resolve_entity(figures, "Halver", vocabulary=["Halver"]).status, "not_found"
        )

    def test_type_filter_never_silently_crosses_entity_kinds(self):
        figures = FIXTURE["figures"]
        self.assertEqual(
            resolve_entity(figures, "Strassental", entity_type="person").status, "not_found"
        )


class EntityAliasStorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original = config.DATA, config.DB, config.BACKUPS, config.WORLDS
        config.DATA = root
        config.DB = root / "aliases.sqlite3"
        config.BACKUPS = root / "backups"
        config.WORLDS = root / "worlds"

    def tearDown(self):
        config.DATA, config.DB, config.BACKUPS, config.WORLDS = self.original
        self.temp.cleanup()

    def test_aliases_roundtrip_with_stable_rows_unknown_fields_and_cascade(self):
        schema.initialize()
        state = copy.deepcopy(FIXTURE["figures"])
        state["nodes"][0]["aliases"][0]["futureField"] = {"kept": True}
        story_world.save(state)
        loaded = story_world.load()
        self.assertEqual(loaded["nodes"][0]["aliases"], state["nodes"][0]["aliases"])
        with connection() as conn:
            before = conn.execute(
                "SELECT rowid,* FROM entity_aliases WHERE element_id='tarek'"
            ).fetchone()
        story_world.save(copy.deepcopy(loaded))
        with connection() as conn:
            after = conn.execute(
                "SELECT rowid,* FROM entity_aliases WHERE element_id='tarek'"
            ).fetchone()
        self.assertEqual(tuple(after), tuple(before))
        loaded["nodes"][0]["aliases"] = []
        story_world.save(loaded)
        with connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM entity_aliases").fetchone()[0], 0)

    def test_v5_world_migrates_without_revision_change(self):
        schema.initialize()
        with connection() as conn:
            conn.execute("DROP INDEX alias_lookup")
            conn.execute("DROP TABLE entity_aliases")
            conn.execute("UPDATE meta SET value='5' WHERE key='schema_version'")
            conn.execute("UPDATE meta SET value='11' WHERE key='figures_revision'")
        schema.initialize()
        self.assertEqual(revisions.revision("figures"), 11)
        with connection() as conn:
            self.assertEqual(
                conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                str(schema.SCHEMA_VERSION),
            )
            self.assertIsNotNone(
                conn.execute(
                    "SELECT name FROM sqlite_master WHERE name='entity_aliases'"
                ).fetchone()
            )


if __name__ == "__main__":
    unittest.main()
