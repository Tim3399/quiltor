import threading
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch

from quiltor.application.documents.types import VersionedDocument
from quiltor.application.story_world import read_tools
from quiltor.bootstrap.application import build_assistant_services
from quiltor.hosts.mcp.quiltor_server import TOOLS, _proposal, _world, call_tool, respond
from quiltor.modules.assistant import tool_loop
from quiltor.modules.assistant.ports import AssistantReadToolExecutor


def story_world() -> dict:
    return {
        "nodes": [
            {
                "id": "ada",
                "name": "Ada",
                "type": "person",
                "x": 0,
                "y": 0,
                "label": "Kartografin",
                "aliases": [{"alias": "Die Kartografin", "source": "manual"}],
            },
            {"id": "tarek", "name": "Tarek", "type": "person", "x": 100, "y": 0},
            {
                "id": "archive",
                "name": "Archiv",
                "type": "ort",
                "x": 200,
                "y": 0,
                "aliases": [{"alias": "Das Archiv", "source": "manual"}],
            },
        ],
        "edges": [
            {
                "id": "bond",
                "from": "ada",
                "to": "tarek",
                "label": "Verbündet",
                "gerichtet": False,
                "style": "solid",
                "versions": [],
            }
        ],
        "timeline": [{"id": "arrival", "title": "Ankunft", "date": "2024-01-01"}],
        "presence": [],
    }


class McpTest(unittest.TestCase):
    def test_shared_assistant_read_catalog_is_side_effect_free(self):
        catalog = read_tools.read_tool_catalog()
        names = tuple(spec["name"] for spec in catalog)
        self.assertEqual(names, read_tools.READ_TOOL_NAMES)
        self.assertTrue(all(spec["readOnly"] is True for spec in catalog))
        self.assertTrue(all(spec["sideEffectFree"] is True for spec in catalog))
        self.assertFalse(
            any(forbidden in name for name in names for forbidden in ("apply", "delete", "write"))
        )

        catalog[0]["name"] = "write_world"
        self.assertEqual(read_tools.read_tool_catalog()[0]["name"], "resolve_entity")

        manuscript = {
            "chapters": [{"id": "chapter-1", "title": "Ankunft", "content": "Ada kommt an."}]
        }
        figures = story_world()
        figures["timeline"][0].update({"time": 0, "position": 0})
        original_manuscript, original_figures = deepcopy(manuscript), deepcopy(figures)
        calls = {
            "resolve_entity": {"mention": "Ada"},
            "get_entity": {"elementId": "ada"},
            "get_relationships": {"elementId": "ada"},
            "find_timeline_events": {"query": "Ankunft"},
            "get_world_state": {"momentId": "arrival"},
            "search_manuscript": {"query": "Ada"},
        }
        for name, arguments in calls.items():
            with self.subTest(name=name):
                result = read_tools.execute_read_tool(
                    name,
                    arguments,
                    manuscript=manuscript,
                    figures=figures,
                    world_revision=5,
                )
                self.assertTrue(result["ok"])
        self.assertEqual(manuscript, original_manuscript)
        self.assertEqual(figures, original_figures)

    def test_assistant_port_accepts_the_same_read_tool_implementation_used_by_mcp(self):
        self.assertIsInstance(read_tools.StoryWorldReadTools(), AssistantReadToolExecutor)
        assistant_source = Path(tool_loop.__file__).read_text(encoding="utf-8")
        self.assertNotIn("quiltor.application", assistant_source)

        figures = story_world()
        figures["timeline"][0].update({"time": 0, "position": 0})
        manuscript = {
            "chapters": [{"id": "chapter-1", "title": "Ankunft", "content": "Ada kommt an."}]
        }
        calls = {
            "resolve_entity": {"mention": "Die Kartografin"},
            "get_entity": {"elementId": "ada"},
            "get_relationships": {"elementId": "ada"},
            "find_timeline_events": {"query": "Ankunft"},
            "get_world_state": {"momentId": "arrival"},
            "search_manuscript": {"query": "Ada"},
        }
        with patch(
            "quiltor.hosts.mcp.quiltor_server._world",
            return_value=(manuscript, figures, 23),
        ):
            for name, arguments in calls.items():
                with self.subTest(name=name):
                    through_mcp = call_tool(name, {"worldId": "world", **arguments})
                    through_shared_api = read_tools.execute_read_tool(
                        name,
                        arguments,
                        manuscript=manuscript,
                        figures=figures,
                        world_revision=23,
                    )
                    self.assertEqual(through_mcp, through_shared_api)
                    self.assertTrue(through_mcp["ok"])

    def test_bootstrap_injects_shared_read_tools_through_the_assistant_port(self):
        runtime, jobs = object(), object()
        with (
            patch(
                "quiltor.bootstrap.application.SQLiteAssistantProgressStore",
                return_value=object(),
            ),
            patch(
                "quiltor.bootstrap.application.BoundedTokenCountCache",
                return_value=object(),
            ),
            patch(
                "quiltor.bootstrap.application.LockedAssistantInteractionLogger",
                return_value=object(),
            ),
            patch(
                "quiltor.bootstrap.application.ApplicationAssistantWorldAccess",
                return_value=object(),
            ),
            patch(
                "quiltor.bootstrap.application.AssistantRuntime",
                return_value=runtime,
            ) as runtime_factory,
            patch(
                "quiltor.bootstrap.application.AssistantJobRunner",
                return_value=jobs,
            ),
        ):
            services = build_assistant_services(
                base=Path("."),
                data=Path("."),
                assistant=object(),
                lock=threading.Lock(),
                observability=SimpleNamespace(logger=object(), metrics=object()),
                capabilities=object(),
                inference=object(),
            )
        self.assertIs(services.runtime, runtime)
        self.assertIs(services.jobs, jobs)
        self.assertIsInstance(
            runtime_factory.call_args.kwargs["read_tools"],
            read_tools.StoryWorldReadTools,
        )

    def test_mcp_shared_reads_require_world_and_delegate_without_host_arguments(self):
        catalog = {tool["name"]: tool for tool in TOOLS}
        for name in read_tools.READ_TOOL_NAMES:
            with self.subTest(name=name):
                tool = catalog[name]
                self.assertIn("worldId", tool["inputSchema"]["required"])
                self.assertTrue(tool["annotations"]["readOnlyHint"])
                self.assertFalse(tool["annotations"]["destructiveHint"])

        expected = {
            "name": "resolve_entity",
            "ok": True,
            "readOnly": True,
            "sideEffectFree": True,
            "worldRevision": 29,
            "result": {"resolvedId": "ada"},
        }
        manuscript, figures = {"chapters": []}, story_world()
        with (
            patch(
                "quiltor.hosts.mcp.quiltor_server._world",
                return_value=(manuscript, figures, 29),
            ),
            patch(
                "quiltor.hosts.mcp.quiltor_server.execute_read_tool",
                return_value=expected,
            ) as execute,
        ):
            result = call_tool(
                "resolve_entity",
                {"worldId": "world", "mention": "Ada"},
            )
        self.assertEqual(result, expected)
        execute.assert_called_once_with(
            "resolve_entity",
            {"mention": "Ada"},
            manuscript=manuscript,
            figures=figures,
            world_revision=29,
        )

    def test_server_advertises_only_read_and_proposal_tools(self):
        names = {tool["name"] for tool in TOOLS}
        self.assertIn("search_world", names)
        self.assertTrue(
            {
                "list_elements",
                "list_relationships",
                "get_relationship_history",
                "list_timeline_moments",
                "get_board_layout",
                "validate_world",
            }.issubset(names)
        )
        self.assertTrue(
            {
                "propose_create_element",
                "propose_update_element",
                "propose_create_relationship",
                "propose_timeline_moment",
                "propose_relationship_state",
                "propose_death_marker",
                "propose_set_presence",
                "propose_arrange_elements",
            }.issubset(names)
        )
        self.assertFalse(any(name.startswith(("write_", "apply_", "delete_")) for name in names))

    def test_mutation_tool_returns_a_proposal_without_applying_it(self):
        figures = story_world()
        figures["edges"] = []
        result = _proposal(
            {"from": "Ada", "to": "Tarek", "label": "Freunde"},
            figures,
            "create_relationship",
            4,
        )
        self.assertEqual(result["proposal"]["kind"], "create_relationship")
        self.assertEqual(result["proposal"]["relationship"]["label"], "Freunde")
        self.assertEqual(result["proposal"]["relationship"]["from"], "ada")
        self.assertTrue(result["requiresConfirmation"])
        self.assertFalse(result["applied"])
        self.assertEqual(result["resolution"]["proof"]["worldRevision"], 4)

    def test_world_loads_the_real_figures_revision(self):
        figures = story_world()
        database = Path("world.sqlite3")
        opened = SimpleNamespace(
            paths=SimpleNamespace(documents=SimpleNamespace(database=database))
        )
        manuscript_document = VersionedDocument({"chapters": []}, 2)
        figures_document = VersionedDocument(figures, 17)
        with (
            patch("quiltor.hosts.mcp.quiltor_server.WORLDS.open", return_value=opened),
            patch(
                "quiltor.hosts.mcp.quiltor_server.DOCUMENTS.load",
                side_effect=[manuscript_document, figures_document],
            ) as load,
        ):
            manuscript, loaded_figures, revision = _world("world")
        self.assertEqual(manuscript, {"chapters": []})
        self.assertEqual(loaded_figures, figures)
        self.assertEqual(revision, 17)
        self.assertEqual(
            load.call_args_list,
            [call("manuscript", database), call("figures", database)],
        )

    def test_structured_read_tools_return_complete_collections(self):
        figures = {
            "nodes": [{"id": "a", "x": 10, "y": 20}],
            "edges": [{"id": "e1", "from": "a", "to": "a", "versions": []}],
            "timeline": [{"id": "t1"}],
        }
        with patch("quiltor.hosts.mcp.quiltor_server._world", return_value=({}, figures, 7)):
            self.assertEqual(call_tool("list_elements", {"worldId": "world"})["count"], 1)
            self.assertEqual(call_tool("list_relationships", {"worldId": "world"})["count"], 1)
            self.assertEqual(call_tool("list_timeline_moments", {"worldId": "world"})["count"], 1)
            self.assertEqual(
                call_tool("get_relationship_history", {"worldId": "world", "relationshipId": "e1"})[
                    "relationship"
                ]["id"],
                "e1",
            )
            self.assertEqual(
                call_tool("get_board_layout", {"worldId": "world"})["elements"][0]["x"], 10
            )

    def test_initialize_explains_confirmation_boundary(self):
        result = respond({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        self.assertIn("Confirm proposals", result["result"]["instructions"])

    def test_initialize_advertises_the_product_version_source_of_truth(self):
        result = respond({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        expected = (
            (Path(__file__).resolve().parents[2] / "VERSION").read_text(encoding="utf-8").strip()
        )
        self.assertEqual(result["result"]["serverInfo"]["version"], expected)

    def test_element_tool_supports_animals(self):
        tool = next(tool for tool in TOOLS if tool["name"] == "propose_create_element")
        kinds = tool["inputSchema"]["properties"]["type"]["enum"]
        self.assertTrue({"tier", "organisation", "objekt"}.issubset(kinds))

    def test_every_proposal_tool_returns_only_a_confirmable_proposal(self):
        figures = story_world()
        cases = {
            "propose_create_element": {"name": "Nova"},
            "propose_update_element": {
                "elementId": "Die Kartografin",
                "sub": "Archivarin",
            },
            "propose_create_relationship": {
                "from": "Ada",
                "to": "Das Archiv",
                "label": "Besucht",
            },
            "propose_timeline_moment": {"title": "Prozess"},
            "propose_relationship_state": {
                "relationshipId": "bond",
                "momentId": "arrival",
                "label": "Misstrauen",
            },
            "propose_death_marker": {
                "elementId": "Die Kartografin",
                "momentId": "arrival",
            },
            "propose_set_presence": {
                "elementId": "Tarekk",
                "placeId": "Das Archiv",
                "momentId": "arrival",
            },
            "propose_arrange_elements": {"strategy": "thematic"},
        }
        with patch("quiltor.hosts.mcp.quiltor_server._world", return_value=({}, figures, 8)):
            for name, arguments in cases.items():
                with self.subTest(name=name):
                    result = call_tool(name, {"worldId": "world", **arguments})
                    self.assertIn("kind", result["proposal"])
                    self.assertTrue(result["requiresConfirmation"])
                    self.assertFalse(result["applied"])
                    self.assertFalse(result["operationSatisfied"])
                    self.assertEqual(result["resolution"]["proof"]["worldRevision"], 8)

    def test_element_ensure_reuses_exact_alias_and_unique_fuzzy_matches(self):
        figures = story_world()
        for mention, expected in (
            ("Ada", "ada"),
            ("Die Kartografin", "ada"),
            ("Tarekk", "tarek"),
        ):
            with self.subTest(mention=mention):
                result = _proposal({"name": mention}, figures, "create_element", world_revision=11)
                self.assertIsNone(result["proposal"])
                self.assertFalse(result["requiresConfirmation"])
                self.assertTrue(result["operationSatisfied"])
                self.assertEqual(result["resolution"]["resolvedId"], expected)
                self.assertEqual(result["resolution"]["proof"]["worldRevision"], 11)

    def test_exact_alias_and_fuzzy_ambiguity_fail_closed(self):
        cases = [
            (
                "Alexandra",
                [
                    {"id": "alex-a", "name": "Alexandra", "type": "person"},
                    {"id": "alex-b", "name": "Alexandra", "type": "person"},
                ],
            ),
            (
                "Der Falke",
                [
                    {
                        "id": "falke-a",
                        "name": "Ari",
                        "type": "person",
                        "aliases": [{"alias": "Der Falke", "source": "manual"}],
                    },
                    {
                        "id": "falke-b",
                        "name": "Bela",
                        "type": "person",
                        "aliases": [{"alias": "Der Falke", "source": "manual"}],
                    },
                ],
            ),
            (
                "Marel",
                [
                    {"id": "maren", "name": "Maren", "type": "person"},
                    {"id": "marek", "name": "Marek", "type": "person"},
                ],
            ),
        ]
        for mention, nodes in cases:
            with self.subTest(mention=mention):
                figures = {"nodes": nodes, "edges": [], "timeline": [], "presence": []}
                with self.assertRaisesRegex(ValueError, "ambiguous"):
                    _proposal(
                        {
                            "name": mention,
                            "proof": {"checked": True, "status": "resolved"},
                        },
                        figures,
                        "create_element",
                        12,
                    )

    def test_relationship_duplicate_is_an_idempotent_noop_after_alias_resolution(self):
        result = _proposal(
            {
                "from": "Die Kartografin",
                "to": "Tarekk",
                "label": "Verbündet",
                "directed": False,
                "style": "solid",
            },
            story_world(),
            "create_relationship",
            13,
        )
        self.assertIsNone(result["proposal"])
        self.assertTrue(result["operationSatisfied"])
        self.assertEqual(result["resolution"]["resolvedId"], "bond")

    def test_timeline_create_has_stable_identity_and_existing_moment_is_a_noop(self):
        figures = story_world()
        first = _proposal({"title": "Prozess"}, figures, "create_timeline_moment", 14)
        repeated = _proposal({"title": "Prozess"}, figures, "create_timeline_moment", 14)
        other = _proposal({"title": "Urteil"}, figures, "create_timeline_moment", 14)
        existing = _proposal(
            {"title": "Ankunft", "date": "2024-01-01"},
            figures,
            "create_timeline_moment",
            14,
        )
        self.assertEqual(first["proposal"]["tempId"], repeated["proposal"]["tempId"])
        self.assertNotEqual(first["proposal"]["tempId"], other["proposal"]["tempId"])
        self.assertIsNone(existing["proposal"])
        self.assertTrue(existing["operationSatisfied"])

    def test_presence_resolves_aliases_and_repeated_state_is_a_noop(self):
        figures = story_world()
        created = _proposal(
            {"elementId": "Die Kartografin", "placeId": "Das Archiv"},
            figures,
            "set_presence",
            15,
        )
        self.assertEqual(created["proposal"]["elementId"], "ada")
        self.assertEqual(created["proposal"]["placeId"], "archive")
        figures["presence"] = [{"id": "presence-1", "elementId": "ada", "placeId": "archive"}]
        repeated = _proposal(
            {"elementId": "Die Kartografin", "placeId": "Das Archiv"},
            figures,
            "set_presence",
            16,
        )
        self.assertIsNone(repeated["proposal"])
        self.assertTrue(repeated["operationSatisfied"])
        self.assertEqual(repeated["resolution"]["resolvedId"], "presence-1")

    def test_relationship_state_and_death_marker_are_idempotent(self):
        figures = story_world()
        figures["edges"][0]["versions"] = [
            {
                "momentId": "arrival",
                "label": "Misstrauen",
                "active": True,
                "gerichtet": False,
                "style": "solid",
            }
        ]
        figures["nodes"][0]["diedMomentId"] = "arrival"
        relationship = _proposal(
            {
                "relationshipId": "bond",
                "momentId": "arrival",
                "label": "Misstrauen",
            },
            figures,
            "set_relationship_at_moment",
            17,
        )
        death = _proposal(
            {"elementId": "Die Kartografin", "momentId": "arrival"},
            figures,
            "mark_deceased",
            17,
        )
        self.assertIsNone(relationship["proposal"])
        self.assertTrue(relationship["operationSatisfied"])
        self.assertIsNone(death["proposal"])
        self.assertTrue(death["operationSatisfied"])

    def test_ambiguous_mutation_is_reported_as_an_mcp_error(self):
        figures = {
            "nodes": [
                {"id": "alex-a", "name": "Alex", "type": "person"},
                {"id": "alex-b", "name": "Alex", "type": "person"},
            ],
            "edges": [],
            "timeline": [],
            "presence": [],
        }
        request = {
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": {
                "name": "propose_create_element",
                "arguments": {"worldId": "world", "name": "Alex"},
            },
        }
        with patch("quiltor.hosts.mcp.quiltor_server._world", return_value=({}, figures, 18)):
            response = respond(request)
        self.assertTrue(response["result"]["isError"])
        self.assertIn("ambiguous", response["result"]["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
