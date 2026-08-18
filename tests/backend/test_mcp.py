import unittest

from unittest.mock import patch

from hosts.mcp.quiltor_server import TOOLS, _proposal, call_tool, respond


class McpTest(unittest.TestCase):
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
        self.assertIn("propose_create_relationship", names)
        self.assertFalse(any(name.startswith(("write_", "apply_", "delete_")) for name in names))

    def test_mutation_tool_returns_a_proposal_without_applying_it(self):
        figures = {"nodes": [{"id": "a"}, {"id": "b"}], "edges": [], "timeline": []}
        result = _proposal(
            {"from": "a", "to": "b", "label": "Freunde"}, figures, "create_relationship"
        )
        self.assertEqual(result["kind"], "create_relationship")
        self.assertEqual(result["relationship"]["label"], "Freunde")

    def test_structured_read_tools_return_complete_collections(self):
        figures = {
            "nodes": [{"id": "a", "x": 10, "y": 20}],
            "edges": [{"id": "e1", "from": "a", "to": "a", "versions": []}],
            "timeline": [{"id": "t1"}],
        }
        with patch("hosts.mcp.quiltor_server._world", return_value=({}, figures)):
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

    def test_element_tool_supports_animals(self):
        tool = next(tool for tool in TOOLS if tool["name"] == "propose_create_element")
        kinds = tool["inputSchema"]["properties"]["type"]["enum"]
        self.assertTrue({"tier", "organisation", "objekt"}.issubset(kinds))

    def test_every_proposal_tool_returns_only_a_confirmable_proposal(self):
        figures = {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [{"id": "e1"}],
            "timeline": [{"id": "t1"}],
        }
        cases = {
            "propose_create_element": {"name": "Ada"},
            "propose_update_element": {"elementId": "a", "sub": "Archivarin"},
            "propose_create_relationship": {"from": "a", "to": "b", "label": "Verbündet"},
            "propose_timeline_moment": {"title": "Prozess"},
            "propose_relationship_state": {
                "relationshipId": "e1",
                "momentId": "t1",
                "label": "Misstrauen",
            },
            "propose_death_marker": {"elementId": "a", "momentId": "t1"},
            "propose_arrange_elements": {"strategy": "thematic"},
        }
        with patch("hosts.mcp.quiltor_server._world", return_value=({}, figures)):
            for name, arguments in cases.items():
                with self.subTest(name=name):
                    result = call_tool(name, {"worldId": "world", **arguments})
                    self.assertIn("kind", result["proposal"])
                    self.assertTrue(result["requiresConfirmation"])
                    self.assertFalse(result["applied"])


if __name__ == "__main__":
    unittest.main()
