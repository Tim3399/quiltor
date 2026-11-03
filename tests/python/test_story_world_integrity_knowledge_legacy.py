"""The strictly typed integrity check and knowledge index answer as the ones before T-19 did.

Both versions see every story world and manuscript in `contracts/fixtures` and a set of
variants built from the characterisation's world, and must agree on every finding, every
chunk and every retrieval. An exception counts as an answer. T-19 P12 deletes this test
together with `tests/python/legacy`.
"""

from __future__ import annotations

import copy
import dataclasses
import json
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from quiltor.domain.story_world import integrity, knowledge
from tests.python.legacy import story_world_integrity_272ec96 as legacy_integrity
from tests.python.legacy import story_world_knowledge_272ec96 as legacy_knowledge
from tests.python.test_story_world_integrity_knowledge import MANUSCRIPT, TIMELINE, stay, world

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
QUERIES = ("", "Mara", "hafen archiv", "Krönung", "Bruder Iven", "Drache")


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


def variants() -> list[dict[str, Any]]:
    """Worlds that between them reach every branch of both modules."""

    edges = [
        {
            "id": "e1",
            "from": "mara",
            "to": "iven",
            "label": "Bruder",
            "versions": [{"momentId": "m1"}],
        },
        {"id": "e2", "from": "iven", "to": "mara", "directed": True, "versions": []},
        {"id": "e3", "from": "iven", "to": "mara"},
        {
            "id": "e4",
            "from": "ghost",
            "to": "mara",
            "versions": [{"momentId": "gone"}, {"momentId": "gone"}],
        },
        {
            "id": "e5",
            "from": "mara",
            "to": "iven",
            "versions": [{"momentId": "m2", "active": True}, {"momentId": "m2"}],
        },
        {"id": "e6", "from": "mara", "to": "ghost"},
    ]
    presence = [
        stay("mara", "hafen", "m1"),
        stay("mara", "burg", "m3"),
        stay("mara", "hafen", "m2"),
        stay("mara", "burg", "m5"),
        stay("mara", "burg", "m6"),
        stay("mara", "hafen", "gone"),
        stay("mara", "burg", None),
        stay("iven", "hafen", "m4"),
        stay("ghost", "nowhere", "m1"),
    ]
    same_day = [stay("mara", "hafen", "m1"), stay("mara", "burg", "m2")]
    worlds = [world(), world(edges=edges, presence=presence), world(presence=same_day), {}]
    for died in ("m1", "m3", "gone"):
        dead = world(edges=edges, presence=presence)
        dead["nodes"][0]["diedMomentId"] = died
        worlds.append(dead)
    unnamed = world(presence=presence)
    unnamed["nodes"][0]["name"] = ""
    worlds.append(unnamed)
    profiled = world(edges=edges[:1])
    profiled["nodes"][0].update(
        {
            "label": "Archivarin",
            "sub": "aus Asterheim",
            "profile": {"notes": "Misstrauisch", "fields": [{"key": "Alter", "value": "31"}]},
        }
    )
    profiled["nodes"][1]["profile"] = {"alter": "40", "extra": [{"k": "Narbe", "v": "links"}]}
    worlds.append(profiled)
    return worlds


def answer(call: Callable[[], Any]) -> Any:
    try:
        return ("ok", call())
    except Exception as error:
        return ("raises", type(error).__name__)


def built(module: Any, manuscript: Any, figures: Any, chapter_ids: Any = None) -> list[Any]:
    """The chunks of `module`, with T-133's one deliberate difference taken out of the old ones.

    The old index wrote the English word "directed" into the German text of a directed
    relationship; T-133 made it "gerichtet". Nothing else about the text changed.
    """

    result = module.build_knowledge(manuscript, figures, chapter_ids)
    if module is not legacy_knowledge:
        return result
    return [
        dataclasses.replace(chunk, text=chunk.text.replace("\nArt: directed", "\nArt: gerichtet"))
        for chunk in result
    ]


def chunks(module: Any, manuscript: Any, figures: Any, chapter_ids: Any = None) -> Any:
    return [chunk.public() for chunk in built(module, manuscript, figures, chapter_ids)]


class LegacyIntegrityKnowledgeTests(unittest.TestCase):
    def same(self, name: str, current: Callable[[], Any], legacy: Callable[[], Any]) -> None:
        with self.subTest(case=name):
            self.assertEqual(answer(current), answer(legacy))

    def worlds(self) -> list[tuple[str, Any]]:
        fixtures = [
            (f"fixture-{index}", document)
            for index, document in enumerate(fixture_documents("nodes"))
        ]
        self.assertGreaterEqual(len(fixtures), 4)
        return fixtures + [
            (f"variant-{index}", document) for index, document in enumerate(variants())
        ]

    def manuscripts(self) -> list[tuple[str, Any]]:
        fixtures = [
            (f"manuscript-{index}", document)
            for index, document in enumerate(fixture_documents("chapters"))
        ]
        self.assertGreaterEqual(len(fixtures), 3)
        long_chapter = {
            "chapters": [
                {"id": "c1", "title": "T", "body": f"{'b' * 900}\n\n{'c' * 600}\n\n{'a' * 1500}"}
            ]
        }
        return [
            *fixtures,
            ("manuscript-local", MANUSCRIPT),
            ("manuscript-long", long_chapter),
            ("manuscript-empty", {}),
        ]

    def test_validate_world_and_presence_issues(self):
        for name, figures in self.worlds():
            self.same(
                f"validate:{name}",
                lambda f=figures: integrity.validate_world(copy.deepcopy(f)),
                lambda f=figures: legacy_integrity.validate_world(copy.deepcopy(f)),
            )
            self.same(
                f"presence:{name}",
                lambda f=figures: integrity.presence_consistency_issues(copy.deepcopy(f)),
                lambda f=figures: legacy_integrity.presence_consistency_issues(copy.deepcopy(f)),
            )

    def test_build_knowledge_and_scoped_chapters(self):
        for manuscript_name, manuscript in self.manuscripts():
            for chapter_ids in (None, [], ["c1", "c3", "missing"]):
                self.same(
                    f"scoped:{manuscript_name}:{chapter_ids}",
                    lambda m=manuscript, c=chapter_ids: knowledge.scoped_chapters(
                        copy.deepcopy(m), c
                    ),
                    lambda m=manuscript, c=chapter_ids: legacy_knowledge.scoped_chapters(
                        copy.deepcopy(m), c
                    ),
                )
            for world_name, figures in self.worlds():
                self.same(
                    f"knowledge:{manuscript_name}:{world_name}",
                    lambda m=manuscript, f=figures: chunks(
                        knowledge, copy.deepcopy(m), copy.deepcopy(f)
                    ),
                    lambda m=manuscript, f=figures: chunks(
                        legacy_knowledge, copy.deepcopy(m), copy.deepcopy(f)
                    ),
                )

    def test_retrieve(self):
        for world_name, figures in self.worlds():
            current = knowledge.build_knowledge(MANUSCRIPT, copy.deepcopy(figures))
            legacy = built(legacy_knowledge, MANUSCRIPT, copy.deepcopy(figures))
            for query in QUERIES:
                for limit in (1, 3, 14):
                    for fallback in (True, False):
                        self.same(
                            f"retrieve:{world_name}:{query}:{limit}:{fallback}",
                            lambda q=query, n=limit, b=fallback, k=current: [
                                c.id for c in knowledge.retrieve(k, q, n, fallback=b)
                            ],
                            lambda q=query, n=limit, b=fallback, k=legacy: [
                                c.id for c in legacy_knowledge.retrieve(k, q, n, fallback=b)
                            ],
                        )

    def test_moment_order(self):
        for moment_id in (None, "", "m1", "m4", "m6", "gone", 3):
            self.same(
                f"order:{moment_id}",
                lambda m=moment_id: knowledge.moment_order(TIMELINE, m),
                lambda m=moment_id: legacy_knowledge.moment_order(TIMELINE, m),
            )

    def test_the_one_deliberate_difference_is_the_direction_word(self):
        # T-133: the old index said "directed", the new one says "gerichtet", nowhere else.
        figures = world(edges=[{"id": "e1", "from": "mara", "to": "iven", "directed": True}])
        old = legacy_knowledge.build_knowledge(MANUSCRIPT, copy.deepcopy(figures))
        new = knowledge.build_knowledge(MANUSCRIPT, copy.deepcopy(figures))
        differing = [(a.text, b.text) for a, b in zip(old, new, strict=True) if a.text != b.text]
        self.assertEqual(len(differing), 1)
        self.assertIn("\nArt: directed", differing[0][0])
        self.assertEqual(differing[0][1], differing[0][0].replace("directed", "gerichtet"))

    def test_the_legacy_copy_still_reports_every_kind_of_finding(self):
        # Guards the comparison itself: two copies that both report nothing would agree.
        keys = {
            item["key"]
            for figures in variants()
            for item in legacy_integrity.validate_world(copy.deepcopy(figures))["issueItems"]
        }
        self.assertEqual(
            keys,
            {
                "issueMissingEndpoint",
                "issueDuplicateRelationship",
                "issueMissingMoment",
                "issueDuplicateMomentState",
                "issuePresenceBackward",
                "issuePresenceSameDay",
            },
        )


if __name__ == "__main__":
    unittest.main()
