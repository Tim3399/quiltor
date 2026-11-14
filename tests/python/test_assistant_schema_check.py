import copy
import importlib.util
import json
import unittest
from pathlib import Path

from quiltor.application.story_world import StoryWorldReadTools
from quiltor.application.story_world.read_tools import read_tool_catalog
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.modules.assistant import AssistantRuntime
from quiltor.modules.assistant.jobs import classify_assistant_error
from quiltor.modules.assistant.ports import InferenceValidationError
from quiltor.modules.assistant.schema_check import (
    KEYWORDS,
    UnsupportedSchemaKeyword,
    check,
)
from quiltor.modules.assistant.schemas import (
    KINDS,
    PROPOSAL_SCHEMAS,
    json_schema_format,
    planner_schema,
    reply_schema,
    tool_step_schema,
)

ORACLE_SCHEMAS = Path(__file__).resolve().parents[2] / "tools/evaluation/browser-inference/schemas"
HAS_JSONSCHEMA = importlib.util.find_spec("jsonschema") is not None


def keywords(value):
    return [violation.keyword for violation in check(*value)]


# One valid and one invalid value per keyword: (schema, valid, invalid).
CASES = {
    "type": ({"type": "integer"}, 3, True),
    "properties": ({"properties": {"a": {"type": "string"}}}, {"a": "x"}, {"a": 1}),
    "required": ({"type": "object", "required": ["a"]}, {"a": 1}, {}),
    "additionalProperties": (
        {"type": "object", "additionalProperties": False, "properties": {"a": {}}},
        {"a": 1},
        {"a": 1, "b": 2},
    ),
    "enum": ({"enum": ["thematic", "grid"]}, "grid", "spiral"),
    "const": ({"const": "create_element"}, "create_element", "update_element"),
    "pattern": ({"type": "string", "pattern": "^new:.*$"}, "new:a", "old:a"),
    "oneOf": (
        {"oneOf": [{"type": "string"}, {"type": "integer"}]},
        "x",
        None,
    ),
    "items": ({"type": "array", "items": {"type": "string"}}, ["a"], ["a", 1]),
    "minItems": ({"type": "array", "minItems": 1}, [1], []),
    "maxItems": ({"type": "array", "maxItems": 1}, [1], [1, 2]),
    "uniqueItems": ({"type": "array", "uniqueItems": True}, [{"a": 1}, {"a": 2}], [1, 1]),
    "minLength": ({"type": "string", "minLength": 2}, "äö", "ä"),
    "maxLength": ({"type": "string", "maxLength": 2}, "äö", "äöü"),
    "minimum": ({"type": "integer", "minimum": 1}, 1, 0),
    "maximum": ({"type": "integer", "maximum": 50}, 50, 51),
}

EXPECTED_KEYWORD = {"properties": "type", "items": "type"}


def all_schemas():
    catalog = read_tool_catalog()
    yield "reply", reply_schema()
    yield "reply_no_proposals", reply_schema(())
    yield "planner", planner_schema(KINDS)
    yield "tool_step", tool_step_schema(catalog, KINDS)
    yield from PROPOSAL_SCHEMAS.items()


def proposal(index=0):
    return {"kind": "arrange_elements", "strategy": "grid" if index % 2 else "thematic"}


def reply(**overrides):
    return {"message": "Gut.", "citations": [], "proposals": [], **overrides}


class KeywordTests(unittest.TestCase):
    def test_every_keyword_has_a_case(self):
        self.assertEqual(set(CASES), set(KEYWORDS))

    def test_each_keyword_accepts_the_valid_and_names_itself_on_the_invalid_value(self):
        for keyword, (schema, valid, invalid) in CASES.items():
            with self.subTest(keyword=keyword):
                self.assertEqual(check(valid, schema), [])
                found = keywords((invalid, schema))
                self.assertIn(EXPECTED_KEYWORD.get(keyword, keyword), found)

    def test_a_boolean_is_not_an_integer_or_a_number(self):
        self.assertEqual(keywords((True, {"type": "number"})), ["type"])
        self.assertEqual(keywords((False, {"type": "integer"})), ["type"])

    def test_one_of_rejects_a_value_matching_two_branches(self):
        schema = {"oneOf": [{"type": "integer"}, {"type": "number"}]}
        self.assertEqual(keywords((3, schema)), ["oneOf"])

    def test_violations_carry_the_path(self):
        violations = check(reply(proposals=[{"kind": "x"}]), reply_schema())
        self.assertEqual([str(item) for item in violations], ["$.proposals[0] oneOf"])

    def test_a_schema_deeper_than_the_limit_is_refused(self):
        nested = {"type": "array"}
        for _ in range(70):
            nested = {"type": "array", "items": nested}
        with self.assertRaises(UnsupportedSchemaKeyword):
            check([], nested)


class RequiredCaseTests(unittest.TestCase):
    def test_duplicate_citations_violate_unique_items(self):
        self.assertEqual(
            [str(item) for item in check(reply(citations=["c1", "c1"]), reply_schema())],
            ["$.citations uniqueItems"],
        )

    def test_twenty_one_proposals_violate_max_items(self):
        self.assertEqual(
            check(reply(proposals=[proposal(i) for i in range(20)]), reply_schema()), []
        )
        self.assertEqual(
            [
                str(item)
                for item in check(reply(proposals=[proposal(i) for i in range(21)]), reply_schema())
            ],
            ["$.proposals maxItems"],
        )


class SelfTest(unittest.TestCase):
    def test_every_assistant_schema_uses_only_supported_keywords(self):
        for name, schema in all_schemas():
            with self.subTest(schema=name):
                check({}, schema)

    def test_an_unknown_keyword_raises(self):
        schema = copy.deepcopy(reply_schema())
        schema["properties"]["message"] = {"anyOf": [{"type": "string"}]}
        with self.assertRaises(UnsupportedSchemaKeyword):
            check(reply(), schema)

    def test_an_unknown_keyword_raises_in_a_branch_the_value_never_reaches(self):
        schema = copy.deepcopy(tool_step_schema(read_tool_catalog(), KINDS))
        schema["oneOf"][0]["properties"]["toolCalls"]["format"] = "x"
        with self.assertRaises(UnsupportedSchemaKeyword):
            check({"action": "final", "final": reply()}, schema)

    def test_an_unlisted_pattern_raises(self):
        with self.assertRaises(UnsupportedSchemaKeyword):
            check("a", {"type": "string", "pattern": "(a+)+$"})


@unittest.skipUnless(HAS_JSONSCHEMA, "jsonschema is not installed")
class OracleTests(unittest.TestCase):
    """The T-54 schema exports, checked by both this module and the jsonschema library."""

    SAMPLES = (
        reply(),
        reply(citations=["c1", "c1"]),
        reply(proposals=[proposal(i) for i in range(21)]),
        reply(proposals=[{"kind": "create_element", "tempId": "new:a", "element": {"name": "A"}}]),
        reply(proposals=[{"kind": "create_element", "tempId": "a", "element": {"name": "A"}}]),
        {"action": "final", "final": reply()},
        {
            "action": "tool_calls",
            "toolCalls": [{"name": "get_entity", "arguments": {"elementId": "a"}}],
        },
        {"action": "tool_calls", "toolCalls": []},
        {"goal": "g", "steps": [], "searchQueries": ["a", "a"], "requiredKinds": []},
        {"goal": "g", "steps": ["s"], "searchQueries": [], "requiredKinds": ["mark_deceased"]},
        {"message": True},
        [],
    )

    def test_the_verdict_matches_jsonschema_for_every_export_and_sample(self):
        jsonschema = importlib.import_module("jsonschema")

        paths = sorted(ORACLE_SCHEMAS.glob("*.json"))
        self.assertTrue(paths)
        for path in paths:
            schema = json.loads(path.read_text(encoding="utf-8"))
            validator = jsonschema.Draft202012Validator(schema)
            for index, sample in enumerate(self.SAMPLES):
                with self.subTest(schema=path.name, sample=index):
                    self.assertEqual(check(sample, schema) == [], validator.is_valid(sample))


class FakeInference:
    identity = "http://mock"

    def __init__(self, *replies):
        self.replies = list(replies)

    def reload(self):
        pass

    def status(self):
        return {"available": True, "mode": "local", "reason": ""}

    def invoke(self, payload):
        return dict(self.replies.pop(0))

    def count_tokens(self, text):
        return 0

    def close(self):
        pass


class _Progress:
    def start(self, *args, **kwargs):
        pass

    def finish(self, *args, **kwargs):
        pass

    def update(self, *args, **kwargs):
        pass

    def read(self, *args, **kwargs):
        return None


class InvokeIntegrationTests(unittest.TestCase):
    def runtime(self, *replies):
        return AssistantRuntime(
            Path("."),
            Path("."),
            FakeInference(*replies),
            progress=_Progress(),
            read_tools=StoryWorldReadTools(),
            token_cache=BoundedTokenCountCache(),
        )

    def test_duplicate_citations_from_the_engine_end_as_validation_error(self):
        runtime = self.runtime(reply(citations=["c1", "c1"]))
        payload = {"messages": [], "response_format": json_schema_format(reply_schema())}
        with self.assertRaises(InferenceValidationError) as raised:
            runtime._invoke(payload)
        self.assertEqual(str(raised.exception), "schema: $.citations uniqueItems")
        self.assertEqual(classify_assistant_error(raised.exception), "validation_error")

    def test_a_valid_reply_passes_and_a_payload_without_schema_is_not_checked(self):
        runtime = self.runtime(reply(), {"anything": 1})
        payload = {"messages": [], "response_format": json_schema_format(reply_schema())}
        self.assertEqual(runtime._invoke(payload), reply())
        self.assertEqual(runtime._invoke({"messages": []}), {"anything": 1})

    def test_a_complete_request_with_duplicate_citations_fails_as_validation_error(self):
        figures = {
            "nodes": [{"id": "tarek", "name": "Tarek Venn", "type": "person"}],
            "edges": [],
            "timeline": [],
        }
        runtime = self.runtime(reply(citations=["c1", "c1"]))
        with self.assertRaises(InferenceValidationError) as raised:
            runtime.complete("Wie geht es Tarek?", {}, figures, history=None)
        self.assertEqual(classify_assistant_error(raised.exception), "validation_error")


if __name__ == "__main__":
    unittest.main()
