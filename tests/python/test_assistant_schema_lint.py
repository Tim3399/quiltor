import copy
import unittest

from quiltor.application.story_world.read_tools import read_tool_catalog
from quiltor.modules.assistant.schema_lint import NOT_ENFORCED, SchemaLintError, lint
from quiltor.modules.assistant.schemas import (
    KINDS,
    PROPOSAL_SCHEMAS,
    json_schema_format,
    planner_schema,
    reply_schema,
    tool_step_schema,
    wire_schema,
)


def built_schemas():
    yield "reply", reply_schema(KINDS)
    yield "reply_no_proposals", reply_schema(())
    yield "planner", planner_schema(KINDS)
    yield "tool_step", tool_step_schema(read_tool_catalog(), KINDS)
    yield from PROPOSAL_SCHEMAS.items()


def obj(**properties):
    return {
        "type": "object",
        "required": list(properties),
        "additionalProperties": False,
        "properties": properties,
    }


def branch(tag):
    return obj(kind={"enum": [tag]})


class SelfTest(unittest.TestCase):
    def test_every_schema_the_assistant_sends_is_lint_clean(self):
        for name, schema in built_schemas():
            with self.subTest(schema=name):
                self.assertEqual(lint(wire_schema(schema)), [])
                json_schema_format(schema, name)

    def test_the_one_rule_left_out_is_named(self):
        self.assertEqual(set(NOT_ENFORCED), {"every property in required"})
        self.assertIn("T-265", NOT_ENFORCED["every property in required"])


class RuleTests(unittest.TestCase):
    def assert_flags(self, schema, fragment):
        problems = lint(schema)
        self.assertTrue(any(fragment in item for item in problems), problems)

    def test_a_clean_schema_passes(self):
        self.assertEqual(lint(obj(a={"type": "string"})), [])

    def test_the_root_must_be_an_object_and_never_a_union(self):
        self.assert_flags({"anyOf": [branch("a"), branch("b")]}, "root must be type object")
        self.assert_flags({"anyOf": [branch("a"), branch("b")]}, "anyOf is not allowed at the root")
        self.assert_flags({"type": "array"}, "root must be type object")

    def test_forbidden_keywords_are_refused(self):
        for keyword, value in (
            ("const", "x"),
            ("oneOf", [{"type": "string"}]),
            ("allOf", [{"type": "string"}]),
            ("maxLength", 3),
            ("minLength", 1),
            ("uniqueItems", True),
            ("format", "email"),
            ("not", {}),
        ):
            with self.subTest(keyword=keyword):
                self.assert_flags(obj(a={keyword: value}), f"keyword {keyword!r}")

    def test_an_object_needs_additional_properties_false(self):
        schema = obj(a={"type": "string"})
        del schema["additionalProperties"]
        self.assert_flags(schema, "additionalProperties false")

    def test_any_of_next_to_properties_is_refused(self):
        inner = {**obj(a={"type": "string"}), "anyOf": [branch("a")]}
        self.assert_flags(obj(x=inner), "anyOf next to properties")

    def test_any_of_branches_need_distinct_required_discriminators(self):
        self.assertEqual(lint(obj(x={"anyOf": [branch("a"), branch("b")]})), [])
        self.assert_flags(obj(x={"anyOf": [branch("a"), branch("a")]}), "repeats branch 0")
        self.assert_flags(
            obj(x={"anyOf": [{"type": "string"}, {"type": "integer"}]}),
            "needs a required single-value enum",
        )
        optional = branch("a")
        optional["required"] = []
        self.assert_flags(obj(x={"anyOf": [optional]}), "needs a required single-value enum")

    def test_a_pattern_must_be_anchored(self):
        self.assert_flags(obj(a={"type": "string", "pattern": "new:.*"}), "^...$")
        self.assertEqual(lint(obj(a={"type": "string", "pattern": "^new:.*$"})), [])

    def test_minimum_and_maximum_only_on_integers(self):
        self.assert_flags(obj(a={"type": "number", "minimum": 1}), "only on integer")
        self.assertEqual(lint(obj(a={"type": "integer", "minimum": 1, "maximum": 5})), [])

    def test_ten_levels_pass_and_eleven_do_not(self):
        def nested(levels):
            schema = {"type": "string"}
            for _ in range(levels - 1):
                schema = obj(a=schema)
            return schema

        self.assertEqual(lint(nested(10)), [])
        self.assert_flags(nested(11), "deeper than 10")

    def test_json_schema_format_refuses_a_schema_outside_the_subset(self):
        schema = copy.deepcopy(reply_schema(KINDS))
        schema["properties"]["proposals"]["items"]["oneOf"] = schema["properties"]["proposals"][
            "items"
        ].pop("anyOf")
        with self.assertRaises(SchemaLintError):
            json_schema_format(schema)


if __name__ == "__main__":
    unittest.main()
