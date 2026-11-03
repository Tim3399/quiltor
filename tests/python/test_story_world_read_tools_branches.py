"""Every error, empty and filter branch of the story-world queries and read tools.

Characterisation before T-19 P10 types `application/story_world/queries.py` and
`read_tools.py` strictly. Each error code is checked as the whole envelope the assistant or
MCP receives; each filter and skip with the result it shapes. `CALLS` and `SNAPSHOTS` are
shared with `test_story_world_read_tools_legacy`, which runs them against the copies of both
modules from before the rewrite.
"""

from __future__ import annotations

import copy
import threading
import unittest
from typing import Any, cast

from quiltor.application.story_world.queries import StoryWorldQueries
from quiltor.application.story_world.read_tools import (
    MAX_READ_TOOL_CALLS,
    StoryWorldReadTools,
    execute_read_tool,
    execute_read_tools,
    read_tool_catalog,
)
from tests.python.test_story_world_read_tools import _manuscript, _world

REVISION = 17


def error(name: str, code: str, revision: int = REVISION) -> dict[str, Any]:
    messages = {
        "unknown_tool": "The requested read tool is not available.",
        "invalid_arguments": "The read tool arguments are invalid or exceed their limits.",
        "invalid_snapshot": "The supplied read snapshot is invalid.",
        "not_found": "The requested exact reference was not found.",
        "unavailable": "The requested facts cannot be projected from this snapshot.",
        "too_many_calls": "The read tool call limit was exceeded.",
        "result_too_large": "The bounded read result exceeded its output limit.",
    }
    return {
        "name": name,
        "ok": False,
        "readOnly": True,
        "sideEffectFree": True,
        "worldRevision": revision,
        "error": {"code": code, "message": messages[code]},
    }


def run(name: Any, arguments: Any, figures: Any = None, manuscript: Any = None) -> Any:
    return execute_read_tool(
        name,
        arguments,
        manuscript=_manuscript() if manuscript is None else manuscript,
        figures=_world() if figures is None else figures,
        world_revision=REVISION,
    )


def rich_world() -> dict[str, Any]:
    """The read-tool world plus the irregular shapes the filters have to step over."""

    world = _world()
    ada = world["nodes"][0]
    ada["aliases"].append("not an alias")
    ada["profile"] = {
        "notes": "Misstrauisch",
        "fields": [{"id": "f1", "key": "Alter", "value": 31}, "bad"],
    }
    ada["diedMomentId"] = "end"
    world["nodes"].append("not a node")
    world["edges"].append("not an edge")
    world["edges"].append(
        {
            "id": "a-rival",
            "from": "harbor",
            "to": "ada",
            "directed": True,
            "active": False,
            "versions": ["bad", {"momentId": "start", "active": "yes", "directed": 1}],
        }
    )
    world["edges"].append(
        {"id": "other", "from": "ben", "to": "harbor", "versions": [{"momentId": "late"}]}
    )
    world["timeline"] += [
        "not a moment",
        {"id": 5, "title": "Zahl-ID"},
        {
            "id": "end",
            "title": "Ende",
            "date": "1421-05-01",
            "precision": "day",
            "endTime": 9,
            "time": 8,
        },
        {"id": "late", "title": "Spät", "note": "Ada und Ben am Kai", "position": 7},
        {"id": "floating", "title": "Ohne Zeit Bruch"},
    ]
    world["presence"].append("not a stay")
    world["presence"].append(
        {"id": "ada-late", "elementId": "ada", "placeId": "harbor", "momentId": "late"}
    )
    return world


class QueriesTest(unittest.TestCase):
    def test_get_entity_matches_the_exact_id_and_skips_other_shapes(self):
        world = rich_world()
        entity = StoryWorldQueries.get_entity(world, "ada")
        self.assertIsNotNone(entity)
        assert entity is not None
        self.assertEqual(entity["name"], "Ada Stern")
        entity["name"] = "changed"
        self.assertEqual(world["nodes"][0]["name"], "Ada Stern")
        self.assertIsNone(StoryWorldQueries.get_entity(world, "Ada Stern"))
        self.assertIsNone(StoryWorldQueries.get_entity({}, "ada"))

    def test_get_relationships_filters_sorts_and_bounds(self):
        world = rich_world()
        ids = [edge["id"] for edge in StoryWorldQueries.get_relationships(world, "ada")]
        self.assertEqual(ids, ["a-rival", "bond"])
        self.assertEqual(
            [
                e["id"]
                for e in StoryWorldQueries.get_relationships(world, "ada", other_element_id="ben")
            ],
            ["bond"],
        )
        self.assertEqual(
            StoryWorldQueries.get_relationships(world, "ada", limit=1)[0]["id"], "a-rival"
        )
        self.assertEqual(StoryWorldQueries.get_relationships(world, "ada", limit=-3), [])
        self.assertEqual(StoryWorldQueries.get_relationships(world, "nobody"), [])

    def test_find_timeline_events_scopes_to_an_entity_through_death_presence_and_edges(self):
        world = rich_world()
        moments = StoryWorldQueries.find_timeline_events(world, entity_id="ada", limit=20)
        # death (end), presence (late), edge versions of bond (break) and a-rival (start);
        # the edge "other" does not touch Ada, so its "late" counts only through presence.
        self.assertEqual([moment["id"] for moment in moments], ["start", "break", "end", "late"])
        self.assertEqual(StoryWorldQueries.find_timeline_events(world, entity_id="nobody"), [])

    def test_find_timeline_events_skips_malformed_moments_and_orders_chronologically(self):
        world = rich_world()
        moments = StoryWorldQueries.find_timeline_events(world, limit=20)
        # Moments with an integer time first by time, then the rest by position or index.
        self.assertEqual(
            [moment["id"] for moment in moments], ["start", "break", "end", "late", "floating"]
        )

    def test_find_timeline_events_ranks_phrase_over_tokens_and_drops_non_matches(self):
        world = rich_world()
        self.assertEqual(
            [m["id"] for m in StoryWorldQueries.find_timeline_events(world, "der bruch", limit=20)],
            # The phrase wins; tokens match inside words, so "Aufbruch" counts for "bruch".
            ["break", "start", "floating"],
        )
        self.assertEqual(
            [
                m["id"]
                for m in StoryWorldQueries.find_timeline_events(world, "  Ada   und ", limit=20)
            ],
            # Equal scores fall back to the timeline: break has a time, late only a position.
            ["break", "late"],
        )
        self.assertEqual(StoryWorldQueries.find_timeline_events(world, "Drache"), [])
        # A one-letter query has no tokens and only matches as a phrase.
        self.assertEqual(StoryWorldQueries.find_timeline_events(world, "x", limit=20), [])
        self.assertEqual(
            [m["id"] for m in StoryWorldQueries.find_timeline_events(world, "K", limit=20)],
            ["late"],
        )
        self.assertEqual(StoryWorldQueries.find_timeline_events(world, limit=0), [])

    def test_get_world_state_refuses_an_unknown_phase(self):
        with self.assertRaises(ValueError):
            StoryWorldQueries.get_world_state(_world(), "start", phase="during")
        for phase in ("before", "at", "after"):
            with self.subTest(phase=phase):
                self.assertEqual(
                    StoryWorldQueries.get_world_state(_world(), "break", phase=phase)["phase"],
                    phase,
                )

    def test_search_manuscript_filters_chapters_and_returns_only_prose_chunks(self):
        manuscript: dict[str, Any] = _manuscript()
        chapters: list[Any] = manuscript["chapters"]
        chapters.append("not a chapter")
        hits = StoryWorldQueries.search_manuscript(manuscript, "Ben")
        self.assertEqual([hit["id"] for hit in hits], ["chapter-note:c1", "chapter:c2:0"])
        self.assertTrue(all(hit["kind"] in {"chapter", "chapter-note"} for hit in hits))
        only_c1 = StoryWorldQueries.search_manuscript(manuscript, "Ben", chapter_ids=["c1"])
        self.assertEqual([hit["id"] for hit in only_c1], ["chapter-note:c1"])
        self.assertEqual(StoryWorldQueries.search_manuscript(manuscript, "Ben", limit=-1), [])
        self.assertEqual(StoryWorldQueries.search_manuscript(manuscript, "Drache"), [])


class ReadToolErrorsTest(unittest.TestCase):
    def test_an_invalid_revision_is_an_invalid_snapshot_at_revision_zero(self):
        for revision in (-1, True, 2**53, "17"):
            with self.subTest(revision=revision):
                result = execute_read_tool(
                    "get_entity",
                    {"elementId": "ada"},
                    manuscript=_manuscript(),
                    figures=_world(),
                    world_revision=cast(Any, revision),  # deliberately not a valid revision
                )
                self.assertEqual(result, error("get_entity", "invalid_snapshot", 0))

    def test_an_unknown_tool_is_named_unknown(self):
        self.assertEqual(run("delete_world", {}), error("unknown", "unknown_tool"))
        self.assertEqual(run(None, {}), error("unknown", "unknown_tool"))

    def test_a_snapshot_that_is_not_a_mapping_is_invalid(self):
        self.assertEqual(
            run("get_entity", {"elementId": "ada"}, figures=[]),
            error("get_entity", "invalid_snapshot"),
        )
        self.assertEqual(
            run("get_entity", {"elementId": "ada"}, manuscript="x"),
            error("get_entity", "invalid_snapshot"),
        )

    def test_a_snapshot_that_cannot_be_copied_is_invalid(self):
        figures = {**_world(), "lock": threading.Lock()}
        self.assertEqual(
            run("get_entity", {"elementId": "ada"}, figures=figures),
            error("get_entity", "invalid_snapshot"),
        )

    def test_arguments_must_be_a_mapping_with_only_allowed_and_all_required_keys(self):
        for arguments in (None, ["elementId"], {}, {"elementId": "ada", "apply": True}):
            with self.subTest(arguments=arguments):
                self.assertEqual(
                    run("get_entity", arguments), error("get_entity", "invalid_arguments")
                )

    def test_text_arguments_must_be_strings_within_their_limit_and_not_blank(self):
        for value in (None, 5, "", "   ", "x" * 201):
            with self.subTest(value=value):
                self.assertEqual(
                    run("get_entity", {"elementId": value}),
                    error("get_entity", "invalid_arguments"),
                )
        self.assertEqual(run("find_timeline_events", {"query": "   "})["result"]["count"], 2)

    def test_string_lists_must_be_short_lists_of_distinct_non_blank_strings(self):
        for ids in ("ada", ["ada"] * 13, [" "], [5], ["x" * 201], ["ada", " ada "]):
            with self.subTest(ids=ids):
                self.assertEqual(
                    run("get_world_state", {"momentId": "start", "entityIds": ids}),
                    error("get_world_state", "invalid_arguments"),
                )

    def test_limits_must_be_integers_inside_their_range(self):
        for limit in (0, 13, True, 2.0, "3"):
            with self.subTest(limit=limit):
                self.assertEqual(
                    run("get_relationships", {"elementId": "ada", "limit": limit}),
                    error("get_relationships", "invalid_arguments"),
                )

    def test_an_unknown_entity_type_is_invalid(self):
        self.assertEqual(
            run("resolve_entity", {"mention": "Ada", "entityType": "drache"}),
            error("resolve_entity", "invalid_arguments"),
        )

    def test_an_unknown_phase_is_invalid(self):
        self.assertEqual(
            run("get_world_state", {"momentId": "start", "phase": "during"}),
            error("get_world_state", "invalid_arguments"),
        )

    def test_unknown_exact_references_are_not_found(self):
        cases = [
            ("get_entity", {"elementId": "nobody"}),
            ("get_relationships", {"elementId": "nobody"}),
            ("get_relationships", {"elementId": "ada", "otherElementId": "nobody"}),
            ("find_timeline_events", {"entityId": "nobody"}),
            ("get_world_state", {"momentId": "start", "entityIds": ["nobody"]}),
            ("get_world_state", {"momentId": "start", "relationshipIds": ["nobody"]}),
        ]
        for name, arguments in cases:
            with self.subTest(name=name, arguments=arguments):
                self.assertEqual(run(name, arguments), error(name, "not_found"))

    def test_a_result_beyond_the_output_limit_is_replaced_by_an_error(self):
        world = _world()
        wide = "€" * 1_000
        world["nodes"][0]["sub"] = wide
        world["nodes"][0]["profile"] = {
            "notes": wide,
            "fields": [{"id": f"f{index}", "key": "€" * 160, "value": wide} for index in range(8)],
        }
        self.assertEqual(
            run("get_entity", {"elementId": "ada"}, figures=world),
            error("get_entity", "result_too_large"),
        )


class ReadToolCatalogMethodTest(unittest.TestCase):
    def test_the_service_hands_out_the_same_catalog(self):
        self.assertEqual(StoryWorldReadTools().catalog(), read_tool_catalog())


class ReadToolBatchTest(unittest.TestCase):
    def many(
        self, calls: Any, revision: Any = REVISION, figures: Any = None, manuscript: Any = None
    ) -> Any:
        return execute_read_tools(
            calls,
            manuscript=_manuscript() if manuscript is None else manuscript,
            figures=_world() if figures is None else figures,
            world_revision=revision,
        )

    def test_a_batch_fails_as_one_error_for_bad_input(self):
        self.assertEqual(self.many("calls"), (error("unknown", "invalid_snapshot"),))
        self.assertEqual(self.many([], revision=-1), (error("unknown", "invalid_snapshot", 0),))
        self.assertEqual(self.many([], figures=[]), (error("unknown", "invalid_snapshot"),))
        self.assertEqual(self.many([], manuscript=5), (error("unknown", "invalid_snapshot"),))
        self.assertEqual(
            self.many([{}] * (MAX_READ_TOOL_CALLS + 1)), (error("unknown", "too_many_calls"),)
        )
        self.assertEqual(
            self.many([], figures={"lock": threading.Lock()}),
            (error("unknown", "invalid_snapshot"),),
        )

    def test_each_call_of_a_batch_answers_on_its_own(self):
        results = self.many(
            (
                "not a call",
                {"name": "delete_world", "arguments": {}},
                {"name": "get_entity", "arguments": {"elementId": "nobody"}},
                {"name": "get_entity"},
                {"name": "get_entity", "arguments": {"elementId": "ada"}},
            )
        )
        self.assertEqual(
            results[:4],
            (
                error("unknown", "invalid_arguments"),
                error("unknown", "unknown_tool"),
                error("get_entity", "not_found"),
                error("get_entity", "invalid_arguments"),
            ),
        )
        self.assertTrue(results[4]["ok"])
        self.assertEqual(self.many([]), ())

    def test_an_unexpected_failure_is_reported_as_unavailable(self):
        broken = _world()
        broken["timeline"][0].pop("time")
        self.assertEqual(
            run("get_world_state", {"momentId": "start"}, figures=broken),
            error("get_world_state", "unavailable"),
        )


class ReadToolViewsTest(unittest.TestCase):
    def test_entity_view_keeps_listed_fields_skips_malformed_aliases_and_profile_fields(self):
        result = run("get_entity", {"elementId": "ada"}, figures=rich_world())["result"]
        self.assertEqual(
            result,
            {
                "entity": {
                    "id": "ada",
                    "name": "Ada Stern",
                    "type": "person",
                    "diedMomentId": "end",
                    "aliases": [{"alias": "Die Kartografin", "source": "manual"}],
                    "profile": {
                        "notes": "Misstrauisch",
                        "fields": [{"id": "f1", "key": "Alter", "value": "31"}],
                    },
                },
                "truncated": False,
            },
        )

    def test_entity_view_without_profile_or_aliases(self):
        world = _world()
        world["nodes"][1].pop("aliases")
        world["nodes"][1]["aliases"] = "Benny"
        result = run("get_entity", {"elementId": "ben"}, figures=world)["result"]
        self.assertEqual(
            result["entity"], {"id": "ben", "name": "Ben", "type": "person", "aliases": []}
        )

    def test_entity_view_marks_clipped_and_dropped_items_as_truncated(self):
        world = _world()
        world["nodes"][0]["aliases"] = [{"alias": f"a{index}"} for index in range(9)]
        result = run("get_entity", {"elementId": "ada"}, figures=world)["result"]
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["entity"]["aliases"]), 8)
        self.assertEqual(result["entity"]["aliases"][0], {"alias": "a0", "source": "manual"})
        world = _world()
        world["nodes"][0]["name"] = "N" * 161
        self.assertTrue(
            run("get_entity", {"elementId": "ada"}, figures=world)["result"]["truncated"]
        )

    def test_relationship_view_copies_versions_and_normalises_flags(self):
        result = run("get_relationships", {"elementId": "ada"}, figures=rich_world())["result"]
        self.assertEqual(result["count"], 2)
        self.assertFalse(result["truncated"])
        rival = result["relationships"][0]
        self.assertEqual(
            rival,
            {
                "directed": True,
                "active": False,
                "id": "a-rival",
                "from": "harbor",
                "to": "ada",
                "versions": [{"momentId": "start", "active": False, "directed": True}],
            },
        )
        self.assertEqual(
            result["relationships"][1]["versions"],
            [
                {
                    "momentId": "break",
                    "label": "Rivalen",
                    "style": "dashed",
                    "active": False,
                    "directed": False,
                }
            ],
        )

    def test_relationship_and_event_reads_mark_a_cut_list_as_truncated(self):
        relationships = run(
            "get_relationships", {"elementId": "ada", "limit": 1}, figures=rich_world()
        )["result"]
        self.assertEqual((relationships["count"], relationships["truncated"]), (1, True))
        events = run("find_timeline_events", {"limit": 2}, figures=rich_world())["result"]
        self.assertEqual((events["count"], events["truncated"]), (2, True))

    def test_event_view_keeps_text_fields_and_only_integer_times(self):
        events = run("find_timeline_events", {"query": "Ende"}, figures=rich_world())["result"][
            "events"
        ]
        self.assertEqual(
            events,
            [
                {
                    "id": "end",
                    "title": "Ende",
                    "date": "1421-05-01",
                    "precision": "day",
                    "time": 8,
                    "endTime": 9,
                }
            ],
        )
        scoped = run("find_timeline_events", {"entityId": "ben"}, figures=rich_world())["result"][
            "events"
        ]
        self.assertEqual([event["id"] for event in scoped], ["start", "break", "late"])

    def test_world_state_selects_named_or_first_ids_and_reports_totals(self):
        named = run(
            "get_world_state",
            {
                "momentId": "break",
                "phase": "after",
                "entityIds": ["ben"],
                "relationshipIds": ["bond"],
            },
        )["result"]
        self.assertEqual(named["momentId"], "break")
        self.assertEqual(named["phase"], "after")
        self.assertEqual(list(named["entities"]), ["ben"])
        self.assertEqual(list(named["relationships"]), ["bond"])
        self.assertEqual(named["totals"], {"entities": 3, "relationships": 1})
        self.assertFalse(named["truncated"])
        default = run("get_world_state", {"momentId": "start"})["result"]
        self.assertEqual(sorted(default["entities"]), ["ada", "ben", "harbor"])
        self.assertEqual(default["phase"], "at")
        self.assertEqual(default["entities"]["ben"], {"alive": "unknown", "location": "harbor"})

    def test_world_state_marks_more_than_twelve_entities_as_truncated(self):
        world = _world()
        world["nodes"] += [
            {"id": f"n{index:02}", "name": f"N{index}", "type": "person", "x": 0, "y": 0}
            for index in range(12)
        ]
        result = run("get_world_state", {"momentId": "start"}, figures=world)["result"]
        self.assertEqual(len(result["entities"]), 12)
        self.assertEqual(result["totals"]["entities"], 15)
        self.assertTrue(result["truncated"])

    def test_search_view_clips_and_keeps_only_workspace_and_id_of_the_target(self):
        result = run("search_manuscript", {"query": "Ben", "limit": 1})["result"]
        self.assertEqual(result["count"], 1)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["matches"][0]["target"], {"workspace": "text", "id": "c1"})
        self.assertEqual(set(result["matches"][0]), {"id", "kind", "title", "text", "target"})
        only = run("search_manuscript", {"query": "Ben", "chapterIds": ["c1"]})["result"]
        self.assertEqual([match["id"] for match in only["matches"]], ["chapter-note:c1"])

    def test_resolution_is_bounded_and_counts_every_candidate(self):
        world = _world()
        world["nodes"] += [
            {"id": f"ada{index}", "name": "Ada", "type": "person", "x": 0, "y": 0}
            for index in range(9)
        ]
        result = run("resolve_entity", {"mention": "Ada"}, figures=world)["result"]
        self.assertLessEqual(len(result["candidates"]), 8)
        self.assertEqual(result["truncated"], result["candidateCount"] > 8)

    def test_every_tool_works_on_a_copy(self):
        world = rich_world()
        before = copy.deepcopy(world)
        tools = StoryWorldReadTools()
        for name, arguments in (
            ("get_entity", {"elementId": "ada"}),
            ("get_relationships", {"elementId": "ada"}),
            ("find_timeline_events", {"query": "Bruch"}),
            ("get_world_state", {"momentId": "break"}),
        ):
            tools.execute(
                name, arguments, manuscript=_manuscript(), figures=world, world_revision=REVISION
            )
        self.assertEqual(world, before)


if __name__ == "__main__":
    unittest.main()
