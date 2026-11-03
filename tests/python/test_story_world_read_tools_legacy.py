"""The strictly typed read tools and queries answer as the ones before T-19 did.

The read tools are what the assistant and MCP see of the world. Both versions get every
story world and manuscript in `contracts/fixtures` plus the characterisation's worlds, and
every call in `CALLS`, valid or not, one by one and as a batch. The envelopes must be equal;
an exception counts as an answer. T-19 P12 deletes this test together with
`tests/python/legacy`.
"""

from __future__ import annotations

import copy
import json
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from quiltor.application.story_world import queries, read_tools
from tests.python.legacy import story_world_queries_758f2fa as legacy_queries
from tests.python.legacy import story_world_read_tools_758f2fa as legacy_read_tools
from tests.python.test_story_world_read_tools import _manuscript, _world
from tests.python.test_story_world_read_tools_branches import rich_world

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"

CALLS: list[tuple[Any, Any]] = [
    ("resolve_entity", {"mention": "Ada"}),
    (
        "resolve_entity",
        {"mention": "Die Kartografin", "entityType": "person", "contextIds": ["ben"]},
    ),
    ("resolve_entity", {"mention": "Nordhafen", "vocabulary": ["Hafen"]}),
    ("resolve_entity", {"mention": "Ada", "entityType": "drache"}),
    ("resolve_entity", {"mention": "  "}),
    ("get_entity", {"elementId": "ada"}),
    ("get_entity", {"elementId": "ben"}),
    ("get_entity", {"elementId": "nobody"}),
    ("get_entity", {"elementId": "ada", "apply": True}),
    ("get_entity", None),
    ("get_relationships", {"elementId": "ada"}),
    ("get_relationships", {"elementId": "ada", "otherElementId": "ben", "limit": 1}),
    ("get_relationships", {"elementId": "ada", "otherElementId": "nobody"}),
    ("get_relationships", {"elementId": "ada", "limit": True}),
    ("find_timeline_events", {}),
    ("find_timeline_events", {"query": "Bruch"}),
    ("find_timeline_events", {"query": "  Ada und  ", "limit": 2}),
    ("find_timeline_events", {"entityId": "ada"}),
    ("find_timeline_events", {"entityId": "nobody"}),
    ("get_world_state", {"momentId": "start"}),
    ("get_world_state", {"momentId": "break", "phase": "after", "entityIds": ["ben"]}),
    ("get_world_state", {"momentId": "break", "phase": "before", "relationshipIds": ["bond"]}),
    ("get_world_state", {"momentId": "break", "relationshipIds": ["nobody"]}),
    ("get_world_state", {"momentId": "start", "phase": "during"}),
    ("get_world_state", {"momentId": "missing"}),
    ("search_manuscript", {"query": "Ben"}),
    ("search_manuscript", {"query": "Ben", "chapterIds": ["c1"], "limit": 1}),
    ("search_manuscript", {"query": "Drache"}),
    ("search_manuscript", {"query": "Ben", "chapterIds": ["c1", "c1"]}),
    ("delete_world", {}),
    (None, {}),
]


def objects_with(value: Any, key: str) -> Iterator[Any]:
    if isinstance(value, dict):
        if key in value:
            yield value
        for item in value.values():
            yield from objects_with(item, key)
    elif isinstance(value, list):
        for item in value:
            yield from objects_with(item, key)


def fixture_documents(key: str) -> list[Any]:
    return [
        document
        for path in sorted((CONTRACTS / "fixtures").rglob("*.json"))
        for document in objects_with(json.loads(path.read_text(encoding="utf-8")), key)
    ]


def answer(call: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """The result of a call on deep copies of its arguments; an exception is an answer too."""

    try:
        return ("ok", call(*copy.deepcopy(args), **copy.deepcopy(kwargs)))
    except Exception as error:
        return ("raises", type(error).__name__)


def query_cases(
    world: Any, manuscript: Any
) -> list[tuple[str, str, tuple[Any, ...], dict[str, Any]]]:
    return [
        ("entity", "get_entity", (world, "ada"), {}),
        ("relationships", "get_relationships", (world, "ada"), {"limit": 20}),
        ("events", "find_timeline_events", (world, ""), {"limit": 20}),
        ("events-ada", "find_timeline_events", (world, "a"), {"entity_id": "ada"}),
        ("state", "get_world_state", (world, "break"), {"phase": "after"}),
        ("state-phase", "get_world_state", (world, "break"), {"phase": "x"}),
        ("search", "search_manuscript", (manuscript, "Ben"), {"chapter_ids": ["c1", "c2"]}),
    ]


class LegacyReadToolsTests(unittest.TestCase):
    def snapshots(self) -> list[tuple[str, Any, Any]]:
        worlds = [("world", _world()), ("rich", rich_world())] + [
            (f"fixture-{index}", world) for index, world in enumerate(fixture_documents("nodes"))
        ]
        manuscripts = [("manuscript", _manuscript())] + [
            (f"manuscript-{index}", manuscript)
            for index, manuscript in enumerate(fixture_documents("chapters"))
        ]
        self.assertGreaterEqual(len(worlds), 6)
        self.assertGreaterEqual(len(manuscripts), 4)
        return [
            (f"{world_name}/{manuscript_name}", world, manuscript)
            for world_name, world in worlds
            for manuscript_name, manuscript in manuscripts
        ]

    def test_every_call_on_every_snapshot(self):
        for snapshot, world, manuscript in self.snapshots():
            for name, arguments in CALLS:
                snapshot_arguments = {
                    "manuscript": manuscript,
                    "figures": world,
                    "world_revision": 3,
                }
                with self.subTest(snapshot=snapshot, name=name, arguments=arguments):
                    self.assertEqual(
                        answer(read_tools.execute_read_tool, name, arguments, **snapshot_arguments),
                        answer(
                            legacy_read_tools.execute_read_tool,
                            name,
                            arguments,
                            **snapshot_arguments,
                        ),
                    )

    def test_batches(self):
        batches: list[Any] = [
            [{"name": name, "arguments": arguments} for name, arguments in CALLS[:6]],
            ["not a call", {"name": "get_entity"}],
            [{}] * 7,
            "calls",
            [],
        ]
        for index, calls in enumerate(batches):
            for revision in (3, -1):
                snapshot_arguments = {
                    "manuscript": _manuscript(),
                    "figures": rich_world(),
                    "world_revision": revision,
                }
                with self.subTest(batch=index, revision=revision):
                    self.assertEqual(
                        answer(read_tools.execute_read_tools, calls, **snapshot_arguments),
                        answer(legacy_read_tools.execute_read_tools, calls, **snapshot_arguments),
                    )

    def test_queries_directly(self):
        for snapshot, world, manuscript in self.snapshots():
            for name, method, args, kwargs in query_cases(world, manuscript):
                with self.subTest(snapshot=snapshot, query=name):
                    self.assertEqual(
                        answer(getattr(queries.StoryWorldQueries, method), *args, **kwargs),
                        answer(getattr(legacy_queries.StoryWorldQueries, method), *args, **kwargs),
                    )

    def test_the_catalog(self):
        self.assertEqual(read_tools.read_tool_catalog(), legacy_read_tools.read_tool_catalog())

    def test_the_legacy_copy_still_answers_every_error_code(self):
        # Guards the comparison itself: two copies that both fail the same way would agree.
        codes = set[str]()
        for name, arguments in CALLS:
            envelope = legacy_read_tools.execute_read_tool(
                name, arguments, manuscript=_manuscript(), figures=rich_world(), world_revision=3
            )
            if not envelope["ok"]:
                codes.add(envelope["error"]["code"])
        self.assertEqual(codes, {"invalid_arguments", "not_found", "unknown_tool", "unavailable"})


if __name__ == "__main__":
    unittest.main()
