import copy
import json
import tempfile
import unittest
from pathlib import Path

from quiltor.application.story_world import StoryWorldUseCases
from quiltor.domain.story_world.entity_resolution import (
    name_distance,
    normalize_entity_name,
    resolve_entity,
)
from quiltor.infrastructure.persistence.sqlite import config, revisions, schema, story_world
from quiltor.infrastructure.persistence.sqlite.connection import connection


FIXTURE = json.loads(
    (
        Path(__file__).parents[2] / "contracts/fixtures/story-world/entity-resolution.v3.json"
    ).read_text(encoding="utf-8")
)


def _public_resolution(result):
    return {
        "status": result.status,
        "resolvedId": result.resolved_id,
        "candidates": [
            {
                "elementId": candidate.element_id,
                "score": candidate.score,
                "reasons": candidate.reasons,
            }
            for candidate in result.candidates
        ],
    }


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
        self.assertEqual(resolve_entity(figures, "Der Sturmvogel").resolved_id, "tarek")
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

    def test_v3_golden_resolution_vectors_freeze_status_reasons_scores_and_order(self):
        figures = FIXTURE["figures"]
        for case in FIXTURE["resolution"]:
            with self.subTest(case=case["id"]):
                result = resolve_entity(
                    figures,
                    case["mention"],
                    entity_type=case.get("entityType"),
                    context_ids=case.get("contextIds", []),
                    vocabulary=case.get("vocabulary", []),
                )
                self.assertEqual(_public_resolution(result), case["expected"])

    def test_fuzzy_alias_is_independent_from_canonical_name_initial(self):
        result = resolve_entity(FIXTURE["figures"], "Nachtfalk")
        self.assertEqual(result.status, "resolved")
        self.assertEqual(result.resolved_id, "night-herald")
        self.assertEqual(result.candidates[0].reasons, ["fuzzy_alias"])

    def test_fuzzy_matching_never_repairs_the_first_character(self):
        result = resolve_entity(FIXTURE["figures"], "Darek Venn")
        self.assertEqual(result.status, "not_found")
        self.assertIsNone(result.resolved_id)

    def test_exact_identity_collisions_ignore_context_and_stay_ambiguous(self):
        figures = FIXTURE["figures"]
        name_alias = resolve_entity(figures, "Der Falke", context_ids=["watch-captain"])
        duplicate_name = resolve_entity(figures, "Mira", context_ids=["mira-north"])
        self.assertEqual(name_alias.status, "ambiguous")
        self.assertIsNone(name_alias.resolved_id)
        self.assertEqual(
            [candidate.element_id for candidate in name_alias.candidates],
            ["tarek", "watch-captain"],
        )
        self.assertEqual(duplicate_name.status, "ambiguous")
        self.assertIsNone(duplicate_name.resolved_id)

    def test_context_only_breaks_a_tie_when_exactly_one_candidate_is_local(self):
        figures = FIXTURE["figures"]
        connected = resolve_entity(figures, "Halver", context_ids=["ally"])
        local = resolve_entity(figures, "Halver", context_ids=["halvor"])
        self.assertEqual(connected.resolved_id, "halvar")
        self.assertEqual(connected.candidates[0].reasons[-1], "connected_context")
        self.assertEqual(local.resolved_id, "halvor")
        self.assertEqual(local.candidates[0].reasons[-1], "local_context")

        both_connected = copy.deepcopy(figures)
        both_connected["edges"].append(
            {"id": "halvor-ally", "from": "halvor", "to": "ally"}
        )
        unresolved = resolve_entity(both_connected, "Halver", context_ids=["ally"])
        self.assertEqual(unresolved.status, "ambiguous")
        self.assertEqual(
            [candidate.element_id for candidate in unresolved.candidates],
            ["halvar", "halvor"],
        )

    def test_candidate_order_does_not_depend_on_document_order(self):
        figures = copy.deepcopy(FIXTURE["figures"])
        expected = _public_resolution(resolve_entity(figures, "Halver"))
        figures["nodes"].reverse()
        figures["edges"].reverse()
        self.assertEqual(_public_resolution(resolve_entity(figures, "Halver")), expected)

    def test_type_filter_never_silently_crosses_entity_kinds(self):
        figures = FIXTURE["figures"]
        self.assertEqual(
            resolve_entity(figures, "Strassental", entity_type="person").status, "not_found"
        )
        self.assertEqual(resolve_entity(figures, "Hafen").status, "ambiguous")
        typed = resolve_entity(figures, "Hafen", entity_type="ort")
        self.assertEqual(typed.resolved_id, "haven-place")
        self.assertEqual(typed.candidates[0].reasons, ["exact_name", "type_match"])


class EntityResolutionUseCaseTest(unittest.TestCase):
    def test_application_operation_returns_transport_safe_explicit_result(self):
        case = next(
            case
            for case in FIXTURE["resolution"]
            if case["id"] == "unique-local-context-breaks-fuzzy-tie"
        )
        result = StoryWorldUseCases.resolve_entity(
            FIXTURE["figures"],
            case["mention"],
            context_ids=case["contextIds"],
        )
        self.assertEqual(
            result,
            {
                "mention": case["mention"],
                **case["expected"],
            },
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
        for node in loaded["nodes"]:
            node["aliases"] = []
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
