import unittest

from mcp.quiltor_server import TOOLS, _proposal, respond


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


if __name__ == "__main__":
    unittest.main()
