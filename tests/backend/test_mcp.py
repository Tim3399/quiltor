import unittest

from unittest.mock import patch

from mcp.quiltor_server import TOOLS, _proposal, call_tool, respond


class McpTest(unittest.TestCase):
    def test_server_advertises_only_read_and_proposal_tools(self):
        names = {tool["name"] for tool in TOOLS}
        self.assertIn("search_world", names)
        self.assertIn("propose_create_relationship", names)
        self.assertFalse(any(name.startswith(("write_", "apply_", "delete_")) for name in names))

    def test_mutation_tool_returns_a_proposal_without_applying_it(self):
        figures = {"nodes": [{"id": "a"}, {"id": "b"}], "edges": [], "timeline": []}
        result = _proposal({"from": "a", "to": "b", "label": "Freunde"}, figures, "create_relationship")
        self.assertEqual(result["kind"], "create_relationship")
        self.assertEqual(result["relationship"]["label"], "Freunde")

    def test_initialize_explains_confirmation_boundary(self):
        result = respond({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        self.assertIn("Confirm proposals", result["result"]["instructions"])

    def test_element_tool_supports_animals(self):
        tool = next(tool for tool in TOOLS if tool["name"] == "propose_create_element")
        kinds = tool["inputSchema"]["properties"]["type"]["enum"]
        self.assertTrue({"tier", "organisation", "objekt"}.issubset(kinds))

    def test_every_proposal_tool_returns_only_a_confirmable_proposal(self):
        figures = {"nodes": [{"id": "a"}, {"id": "b"}], "edges": [{"id": "e1"}], "timeline": [{"id": "t1"}]}
        cases = {
            "propose_create_element": {"name": "Ada"},
            "propose_update_element": {"elementId": "a", "sub": "Archivarin"},
            "propose_create_relationship": {"from": "a", "to": "b", "label": "Verbündet"},
            "propose_timeline_moment": {"title": "Prozess"},
            "propose_relationship_state": {"relationshipId": "e1", "momentId": "t1", "label": "Misstrauen"},
            "propose_death_marker": {"elementId": "a", "momentId": "t1"},
            "propose_arrange_elements": {"strategy": "thematic"},
        }
        with patch("mcp.quiltor_server._world", return_value=({}, figures)):
            for name, arguments in cases.items():
                with self.subTest(name=name):
                    result = call_tool(name, {"worldId": "world", **arguments})
                    self.assertIn("kind", result["proposal"])
                    self.assertTrue(result["requiresConfirmation"])
                    self.assertFalse(result["applied"])


if __name__ == "__main__":
    unittest.main()
