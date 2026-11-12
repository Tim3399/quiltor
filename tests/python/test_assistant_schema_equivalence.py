"""The lac-schema-v1 rebuild (T-179 part 3) leaves the assistant's verdicts unchanged.

The schemas as they were before the rebuild are frozen in
``tests/fixtures/assistant-schemas/pre-lac-schema-v1.json``. Every sample here is judged
against that old schema by a reference checker written for its keywords (``oneOf`` meaning
exactly one branch, ``const``), and against the new check schema by ``schema_check``. Both
must agree on every sample. Tool steps are compared unwrapped against the old schema and
wrapped in ``{"step": ...}`` against the new one, which is the whole of that change.
"""

import copy
import json
import re
import unittest
from pathlib import Path

from quiltor.application.story_world.read_tools import read_tool_catalog
from quiltor.modules.assistant.schema_check import check
from quiltor.modules.assistant.schemas import (
    KINDS,
    STEP_KEY,
    json_schema_format,
    planner_schema,
    reply_schema,
    tool_step_schema,
)

FROZEN = Path(__file__).resolve().parents[1] / "fixtures/assistant-schemas/pre-lac-schema-v1.json"


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _type_ok(value, expected):
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if isinstance(value, bool):
        return False
    if expected == "integer":
        return isinstance(value, int)
    return isinstance(value, (int, float))


def old_valid(value, schema):
    """Reference verdict for the pre-rebuild schema vocabulary."""

    known = {
        "type", "properties", "required", "additionalProperties", "enum", "const", "pattern",
        "oneOf", "items", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength",
        "minimum", "maximum",
    }  # fmt: skip
    assert set(schema) <= known, set(schema) - known
    if "type" in schema and not _type_ok(value, schema["type"]):
        return False
    if "const" in schema and _canonical(value) != _canonical(schema["const"]):
        return False
    if "enum" in schema and _canonical(value) not in {_canonical(v) for v in schema["enum"]}:
        return False
    if "oneOf" in schema and sum(old_valid(value, b) for b in schema["oneOf"]) != 1:
        return False
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            return False
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            return False
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            return False
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            return False
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            return False
        if schema.get("uniqueItems") and len({_canonical(v) for v in value}) != len(value):
            return False
        if "items" in schema and not all(old_valid(v, schema["items"]) for v in value):
            return False
    if isinstance(value, dict):
        properties = schema.get("properties") or {}
        if any(name not in value for name in schema.get("required") or []):
            return False
        for name, item in value.items():
            if name in properties:
                if not old_valid(item, properties[name]):
                    return False
            elif schema.get("additionalProperties") is False:
                return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            return False
        if "maximum" in schema and value > schema["maximum"]:
            return False
    return True


MINIMAL = {
    "create_element": {"kind": "create_element", "tempId": "new:a", "element": {"name": "A"}},
    "update_element": {"kind": "update_element", "elementId": "a", "patch": {}},
    "create_timeline_moment": {
        "kind": "create_timeline_moment",
        "tempId": "new:m",
        "moment": {"title": "M"},
    },
    "create_relationship": {
        "kind": "create_relationship",
        "relationship": {
            "from": "a",
            "to": "b",
            "label": "kennt",
            "directed": False,
            "lineStyle": "solid",
            "relationshipKind": "general",
            "color": "auto",
        },
    },
    "set_relationship_at_moment": {
        "kind": "set_relationship_at_moment",
        "relationshipId": "r",
        "momentId": "m",
        "patch": {},
    },
    "mark_deceased": {"kind": "mark_deceased", "elementId": "a", "momentId": "m"},
    "arrange_elements": {"kind": "arrange_elements", "strategy": "grid"},
    "set_presence": {"kind": "set_presence", "elementId": "a", "placeId": "p"},
}

# Where each kind keeps a length-limited text, and its limit: (path to the dict, key, limit).
TEXTS = {
    "create_element": [(("element",), "name", 160), (("element",), "sub", 1000)],
    "update_element": [(("patch",), "name", 160), (("patch",), "label", 160)],
    "create_timeline_moment": [(("moment",), "title", 160), (("moment",), "date", 20)],
    "create_relationship": [(("relationship",), "label", 160)],
    "set_relationship_at_moment": [(("patch",), "label", 160)],
}
ALIASES = {"create_element": ("element",), "update_element": ("patch",)}


def _at(value, path):
    for key in path:
        value = value[key]
    return value


def _with(base, path, key, item):
    value = copy.deepcopy(base)
    _at(value, path)[key] = item
    return value


def proposal_samples():
    """(label, proposal) pairs, valid and invalid, for every kind."""

    for kind, base in MINIMAL.items():
        yield f"{kind} minimal", base
        yield f"{kind} unknown key", {**base, "extra": 1}
        yield f"{kind} without kind", {k: v for k, v in base.items() if k != "kind"}
        yield f"{kind} unknown kind", {**base, "kind": "delete_all"}
        for other in KINDS:
            if other != kind:
                yield f"{kind} fields with kind {other}", {**base, "kind": other}
        for name in base:
            if name != "kind":
                yield f"{kind} without {name}", {k: v for k, v in base.items() if k != name}
        for path, key, limit in TEXTS.get(kind, []):
            yield f"{kind} {key} at {limit}", _with(base, path, key, "ä" * limit)
            yield f"{kind} {key} at {limit + 1}", _with(base, path, key, "ä" * (limit + 1))
        if kind in ("create_element", "create_timeline_moment"):
            limited = "name" if kind == "create_element" else "title"
            inner = ALIASES.get(kind, ("moment",))
            yield f"{kind} empty {limited}", _with(base, inner, limited, "")
            yield f"{kind} tempId without prefix", {**base, "tempId": "a"}
        if kind in ALIASES:
            path = ALIASES[kind]
            yield f"{kind} 16 aliases", _with(base, path, "aliases", [f"a{i}" for i in range(16)])
            yield f"{kind} 17 aliases", _with(base, path, "aliases", [f"a{i}" for i in range(17)])
            yield f"{kind} duplicate aliases", _with(base, path, "aliases", ["Mara", "Mara"])
            yield f"{kind} empty alias", _with(base, path, "aliases", [""])
            yield f"{kind} alias 161", _with(base, path, "aliases", ["x" * 161])
            yield (
                f"{kind} profile notes 1001",
                _with(base, path, "profile", {"notes": "n" * 1001}),
            )
            yield f"{kind} profile unknown", _with(base, path, "profile", {"x": "1"})
    yield "set_presence with moment", {**MINIMAL["set_presence"], "momentId": "m"}
    yield "element type outside enum", _with(MINIMAL["create_element"], ("element",), "type", "x")
    yield "strategy outside enum", {**MINIMAL["arrange_elements"], "strategy": "spiral"}
    yield "no object", "create_element"


def reply(**overrides):
    return {"message": "Gut.", "citations": [], "proposals": [], **overrides}


def reply_samples():
    yield "minimal", reply()
    yield "duplicate citations", reply(citations=["c1", "c1"])
    yield "two citations", reply(citations=["c1", "c2"])
    yield "citation not a string", reply(citations=[1])
    yield "20 proposals", reply(proposals=[MINIMAL["arrange_elements"]] * 20)
    yield "21 proposals", reply(proposals=[MINIMAL["arrange_elements"]] * 21)
    yield "message a number", reply(message=3)
    yield "unknown key", reply(extra=1)
    yield "without citations", {"message": "a", "proposals": []}
    yield "no object", []
    for label, item in proposal_samples():
        yield f"proposal: {label}", reply(proposals=[item])


def planner_samples():
    base = {"goal": "g", "steps": [], "searchQueries": [], "requiredKinds": []}
    yield "minimal", base
    yield "8 steps", {**base, "steps": ["s"] * 8}
    yield "9 steps", {**base, "steps": ["s"] * 9}
    yield "4 queries", {**base, "searchQueries": list("abcd")}
    yield "5 queries", {**base, "searchQueries": list("abcde")}
    yield "duplicate query", {**base, "searchQueries": ["a", "a"]}
    yield "query 300", {**base, "searchQueries": ["q" * 300]}
    yield "query 301", {**base, "searchQueries": ["q" * 301]}
    yield "every kind", {**base, "requiredKinds": list(KINDS)}
    yield "duplicate kind", {**base, "requiredKinds": ["mark_deceased", "mark_deceased"]}
    yield "unknown kind", {**base, "requiredKinds": ["delete_all"]}
    yield "without goal", {k: v for k, v in base.items() if k != "goal"}
    yield "unknown key", {**base, "x": 1}


def step_samples():
    call = {"name": "get_entity", "arguments": {"elementId": "a"}}
    yield "one call", {"action": "tool_calls", "toolCalls": [call]}
    yield "six calls", {"action": "tool_calls", "toolCalls": [call] * 6}
    yield "seven calls", {"action": "tool_calls", "toolCalls": [call] * 7}
    yield "no calls", {"action": "tool_calls", "toolCalls": []}
    yield "unknown tool", {"action": "tool_calls", "toolCalls": [{**call, "name": "write"}]}
    yield "call without arguments", {"action": "tool_calls", "toolCalls": [{"name": "get_entity"}]}
    yield "unknown action", {"action": "other", "toolCalls": [call]}
    yield "final with calls", {"action": "final", "final": reply(), "toolCalls": [call]}
    yield "tool_calls with final", {"action": "tool_calls", "toolCalls": [call], "final": reply()}
    for label, value in reply_samples():
        yield f"final: {label}", {"action": "final", "final": value}


class EquivalenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = json.loads(FROZEN.read_text(encoding="utf-8"))["schemas"]
        catalog = read_tool_catalog()
        cls.new = {
            "reply_schema": reply_schema(KINDS),
            "reply_schema_no_proposals": reply_schema(()),
            "planner_schema": planner_schema(KINDS),
            "tool_step_schema": tool_step_schema(catalog, KINDS),
        }

    def assert_same_verdicts(self, name, samples, wrap=lambda value: value):
        valid = invalid = 0
        for label, value in samples:
            with self.subTest(schema=name, sample=label):
                expected = old_valid(value, self.old[name])
                self.assertEqual(check(wrap(value), self.new[name]) == [], expected)
                valid += expected
                invalid += not expected
        # A corpus that is all valid or all invalid would prove nothing.
        self.assertGreater(valid, 0)
        self.assertGreater(invalid, 0)

    def test_the_reply_decides_as_before(self):
        self.assert_same_verdicts("reply_schema", reply_samples())

    def test_the_reply_without_proposals_decides_as_before(self):
        self.assert_same_verdicts("reply_schema_no_proposals", reply_samples())

    def test_the_planner_decides_as_before(self):
        self.assert_same_verdicts("planner_schema", planner_samples())

    def test_the_tool_step_decides_as_before_once_wrapped(self):
        self.assert_same_verdicts("tool_step_schema", step_samples(), lambda v: {STEP_KEY: v})

    def test_the_boundary_probes_are_decided_the_expected_way(self):
        schema = self.new["reply_schema"]
        verdicts = {label: check(value, schema) == [] for label, value in reply_samples()}
        self.assertTrue(verdicts["proposal: create_element name at 160"])
        self.assertFalse(verdicts["proposal: create_element name at 161"])
        self.assertTrue(verdicts["proposal: create_element 16 aliases"])
        self.assertFalse(verdicts["proposal: create_element 17 aliases"])
        self.assertFalse(verdicts["proposal: create_element duplicate aliases"])
        self.assertFalse(verdicts["duplicate citations"])
        self.assertFalse(verdicts["proposal: create_element fields with kind update_element"])

    def test_the_frozen_schemas_are_the_old_vocabulary(self):
        text = FROZEN.read_text(encoding="utf-8")
        self.assertIn('"oneOf"', text)
        self.assertIn('"const"', text)
        self.assertNotIn('"anyOf"', text)

    def test_what_is_sent_is_the_check_schema_minus_lengths_and_uniqueness(self):
        for name, schema in self.new.items():
            with self.subTest(schema=name):
                envelope = json_schema_format(schema, name)
                self.assertIs(envelope.check_schema, schema)
                wire = json.dumps(envelope["json_schema"]["schema"])
                for keyword in ("maxLength", "minLength", "uniqueItems", "oneOf", "const"):
                    self.assertNotIn(f'"{keyword}"', wire)
                self.assertEqual(json.loads(json.dumps(envelope)), dict(envelope))


if __name__ == "__main__":
    unittest.main()
