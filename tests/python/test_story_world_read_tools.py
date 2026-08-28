import copy
import json
import unittest

from quiltor.application.story_world import (
    MAX_READ_TOOL_CALLS,
    MAX_READ_TOOL_OUTPUT_BYTES,
    READ_TOOL_NAMES,
    StoryWorldReadTools,
    execute_read_tool,
    execute_read_tools,
    read_tool_catalog,
)
from quiltor.domain.story_world.integrity import validate_world as domain_validate_world
from quiltor.modules.assistant.audit import validate_world as assistant_validate_world
from quiltor.modules.assistant.ports import AssistantReadToolExecutor


def _world():
    return {
        "nodes": [
            {
                "id": "ada",
                "name": "Ada Stern",
                "type": "person",
                "x": 0,
                "y": 0,
                "aliases": [{"alias": "Die Kartografin", "source": "manual"}],
                "profile": {
                    "fields": [
                        {"id": "role", "key": "Rolle in der Geschichte", "value": "Navigatorin"}
                    ]
                },
            },
            {
                "id": "ben",
                "name": "Ben",
                "type": "person",
                "x": 1,
                "y": 1,
                "aliases": [],
            },
            {
                "id": "harbor",
                "name": "Nordhafen",
                "type": "ort",
                "x": 2,
                "y": 2,
                "aliases": [{"alias": "Westkai", "source": "manual"}],
            },
        ],
        "edges": [
            {
                "id": "bond",
                "from": "ada",
                "to": "ben",
                "label": "Freunde",
                "style": "solid",
                "gerichtet": False,
                "versions": [
                    {
                        "momentId": "break",
                        "label": "Rivalen",
                        "active": False,
                        "gerichtet": False,
                        "style": "dashed",
                    }
                ],
            }
        ],
        "timeline": [
            {"id": "start", "title": "Aufbruch", "time": 0, "position": 0},
            {
                "id": "break",
                "title": "Der Bruch",
                "date": "1421-03-14",
                "note": "Ada und Ben zerstreiten sich.",
                "time": 4,
                "position": 1,
            },
        ],
        "presence": [
            {"id": "ada-home", "elementId": "ada", "placeId": "harbor"},
            {
                "id": "ben-start",
                "elementId": "ben",
                "placeId": "harbor",
                "momentId": "start",
            },
        ],
    }


def _manuscript():
    return {
        "chapters": [
            {
                "id": "c1",
                "title": "Sturmzeichen",
                "body": "Ada findet im Archiv eine gefälschte Karte.",
                "note": "Der Fund löst den Streit mit Ben aus.",
            },
            {
                "id": "c2",
                "title": "Am Kai",
                "body": "Ben wartet am Nordhafen.",
                "note": "",
            },
        ]
    }


class ReadToolCatalogTests(unittest.TestCase):
    def test_catalog_is_exact_strict_and_read_only(self):
        catalog = read_tool_catalog()
        self.assertEqual(tuple(spec["name"] for spec in catalog), READ_TOOL_NAMES)
        self.assertEqual(
            set(READ_TOOL_NAMES),
            {
                "resolve_entity",
                "get_entity",
                "get_relationships",
                "find_timeline_events",
                "get_world_state",
                "search_manuscript",
            },
        )
        for spec in catalog:
            with self.subTest(tool=spec["name"]):
                self.assertEqual(
                    set(spec),
                    {"name", "description", "inputSchema", "readOnly", "sideEffectFree", "limits"},
                )
                self.assertTrue(spec["readOnly"])
                self.assertTrue(spec["sideEffectFree"])
                self.assertFalse(spec["inputSchema"]["additionalProperties"])
                self.assertLessEqual(spec["limits"]["maxOutputBytes"], 16_384)
        names = " ".join(spec["name"] for spec in catalog)
        self.assertNotRegex(names, r"apply|delete|write|save|mutate")

    def test_catalog_returns_fresh_schemas_and_service_satisfies_the_port(self):
        first = read_tool_catalog()
        first[0]["inputSchema"]["properties"].clear()
        second = read_tool_catalog()
        self.assertIn("mention", second[0]["inputSchema"]["properties"])
        self.assertIsInstance(StoryWorldReadTools(), AssistantReadToolExecutor)


class ReadToolExecutionTests(unittest.TestCase):
    def setUp(self):
        self.figures = _world()
        self.manuscript = _manuscript()

    def execute(self, name, arguments):
        return execute_read_tool(
            name,
            arguments,
            manuscript=self.manuscript,
            figures=self.figures,
            world_revision=17,
        )

    def test_resolve_and_exact_entity_read_use_the_canonical_resolver(self):
        resolution = self.execute("resolve_entity", {"mention": "Die Kartografin"})
        entity = self.execute("get_entity", {"elementId": "ada"})
        missing = self.execute("get_entity", {"elementId": "Die Kartografin"})
        self.assertTrue(resolution["ok"])
        self.assertEqual(resolution["result"]["resolvedId"], "ada")
        self.assertEqual(resolution["result"]["candidateCount"], 1)
        self.assertEqual(
            entity["result"]["entity"]["profile"]["fields"],
            [{"id": "role", "key": "Rolle in der Geschichte", "value": "Navigatorin"}],
        )
        self.assertFalse(missing["ok"])
        self.assertEqual(missing["error"]["code"], "not_found")

    def test_relationship_timeline_and_world_state_reads_are_bounded_structured_facts(self):
        relationships = self.execute("get_relationships", {"elementId": "ada"})
        timeline = self.execute(
            "find_timeline_events",
            {"query": "Bruch", "entityId": "ada"},
        )
        state = self.execute(
            "get_world_state",
            {
                "momentId": "break",
                "phase": "at",
                "entityIds": ["ada"],
                "relationshipIds": ["bond"],
            },
        )
        self.assertEqual(relationships["result"]["relationships"][0]["id"], "bond")
        self.assertEqual(timeline["result"]["events"][0]["id"], "break")
        self.assertEqual(state["result"]["entities"]["ada"]["location"], "harbor")
        self.assertEqual(state["result"]["relationships"]["bond"]["label"], "Rivalen")
        self.assertEqual(state["result"]["relationships"]["bond"]["active"], False)

    def test_manuscript_search_never_mixes_world_model_chunks_into_results(self):
        result = self.execute(
            "search_manuscript",
            {"query": "gefälschte Karte", "chapterIds": ["c1"], "limit": 4},
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["result"]["matches"])
        self.assertTrue(
            all(
                match["kind"] in {"chapter", "chapter-note"}
                for match in result["result"]["matches"]
            )
        )
        self.assertTrue(all(match["target"]["id"] == "c1" for match in result["result"]["matches"]))

    def test_manuscript_search_returns_no_false_evidence_when_nothing_matches(self):
        result = self.execute(
            "search_manuscript",
            {"query": "zzzz-kein-treffer", "limit": 4},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["matches"], [])
        self.assertEqual(result["result"]["count"], 0)

    def test_every_execution_uses_a_copy_and_leaves_both_snapshots_unchanged(self):
        manuscript_before = copy.deepcopy(self.manuscript)
        figures_before = copy.deepcopy(self.figures)
        calls = [
            {"name": "resolve_entity", "arguments": {"mention": "Ada Stern"}},
            {"name": "get_entity", "arguments": {"elementId": "ada"}},
            {"name": "get_relationships", "arguments": {"elementId": "ada"}},
            {"name": "find_timeline_events", "arguments": {"query": "Bruch"}},
            {"name": "get_world_state", "arguments": {"momentId": "break"}},
            {"name": "search_manuscript", "arguments": {"query": "Karte"}},
        ]
        results = execute_read_tools(
            calls,
            manuscript=self.manuscript,
            figures=self.figures,
            world_revision=17,
        )
        self.assertEqual(len(results), MAX_READ_TOOL_CALLS)
        self.assertTrue(all(result["ok"] for result in results))
        self.assertEqual(self.manuscript, manuscript_before)
        self.assertEqual(self.figures, figures_before)

    def test_unknown_write_like_and_invalid_arguments_fail_closed_without_echoing_input(self):
        secret = "C:/private/world.sqlite SELECT * FROM secrets " + "x" * 600
        unknown = self.execute("delete_world", {"path": secret})
        invalid = self.execute("search_manuscript", {"query": secret})
        extra = self.execute("get_entity", {"elementId": "ada", "apply": True})
        for result in (unknown, invalid, extra):
            payload = json.dumps(result, ensure_ascii=False)
            self.assertFalse(result["ok"])
            self.assertNotIn("private", payload)
            self.assertNotIn("SELECT", payload)
            self.assertNotIn("apply", payload)

    def test_batch_and_output_limits_are_hard_and_non_sequence_input_never_crashes(self):
        calls = [
            {"name": "get_entity", "arguments": {"elementId": "ada"}}
            for _ in range(MAX_READ_TOOL_CALLS + 1)
        ]
        too_many = execute_read_tools(
            calls,
            manuscript=self.manuscript,
            figures=self.figures,
            world_revision=17,
        )
        invalid = StoryWorldReadTools().execute_many(
            None,
            manuscript=self.manuscript,
            figures=self.figures,
            world_revision=17,
        )
        self.assertEqual(len(too_many), 1)
        self.assertEqual(too_many[0]["error"]["code"], "too_many_calls")
        self.assertEqual(invalid[0]["error"]["code"], "invalid_snapshot")

        large = copy.deepcopy(self.figures)
        large["nodes"][0]["profile"] = {
            "notizen": "x" * 50_000,
            "extra": [{"k": "k" * 500, "v": "v" * 50_000} for _ in range(100)],
        }
        bounded = execute_read_tool(
            "get_entity",
            {"elementId": "ada"},
            manuscript=self.manuscript,
            figures=large,
            world_revision=17,
        )
        encoded = json.dumps(bounded, ensure_ascii=False).encode("utf-8")
        self.assertLessEqual(len(encoded), MAX_READ_TOOL_OUTPUT_BYTES)
        self.assertTrue(bounded["result"]["truncated"])

    def test_world_projection_errors_are_static_and_do_not_expose_exception_details(self):
        broken = copy.deepcopy(self.figures)
        broken["timeline"][0].pop("time")
        result = execute_read_tool(
            "get_world_state",
            {"momentId": "start"},
            manuscript=self.manuscript,
            figures=broken,
            world_revision=17,
        )
        self.assertEqual(result["error"]["code"], "unavailable")
        self.assertNotIn("canonical integer time", json.dumps(result))


class DomainIntegrityExtractionTests(unittest.TestCase):
    def test_assistant_compatibility_wrapper_returns_exact_domain_audit(self):
        world = _world()
        world["edges"].append(
            {
                "id": "dangling",
                "from": "ada",
                "to": None,
                "gerichtet": False,
                "versions": [{"momentId": "missing"}, {"momentId": "missing"}],
            }
        )
        expected = domain_validate_world(world)
        self.assertEqual(assistant_validate_world(world), expected)
        self.assertIn("Beziehung dangling hat einen fehlenden Endpunkt", expected["issues"])
        self.assertEqual(
            expected["issueItems"],
            [
                {"key": "issueMissingEndpoint", "params": {"id": "dangling"}},
                {
                    "key": "issueMissingMoment",
                    "params": {"id": "dangling", "momentId": "missing"},
                },
                {
                    "key": "issueMissingMoment",
                    "params": {"id": "dangling", "momentId": "missing"},
                },
                {
                    "key": "issueDuplicateMomentState",
                    "params": {"id": "dangling", "momentId": "missing"},
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
