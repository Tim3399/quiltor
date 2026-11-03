"""Reaches every rejection branch of the story-world validators before they were typed (T-19 P4).

Each case starts from a valid payload and breaks exactly one thing. The tables are shared
with the differential test, which runs them through the frozen old validator as well.
"""

from __future__ import annotations

import unittest
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from quiltor.domain.story_world.validation import valid_figures, valid_manuscript

type Payload = dict[str, Any]
type Case = Callable[[Payload], object]


def figures() -> Payload:
    return {
        "nodes": [
            {
                "id": "ada",
                "name": "Ada",
                "x": 0,
                "y": 1.5,
                "type": "person",
                "diedMomentId": "storm",
                "aliases": [{"alias": "Adi"}, {"alias": "Die Lotsin", "source": "manuscript"}],
                "profile": {
                    "notes": "Hallo Welt",
                    "noteReferences": [
                        {
                            "id": "r1",
                            "from": 0,
                            "to": 5,
                            "target": {"kind": "entity", "id": "ben"},
                            "surface": "Hallo",
                        },
                        {
                            "id": "r2",
                            "from": 6,
                            "to": 10,
                            "target": {"kind": "place", "id": "harbor"},
                            "surface": "Welt",
                        },
                    ],
                    "noteMarks": [{"kind": "bold", "from": 0, "to": 5}],
                    "alter": "40",
                    "extra": [{"k": "Narbe", "v": "links"}],
                    "fields": [{"id": "f1", "key": "Beruf", "value": "Lotsin"}],
                },
            },
            {"id": "ben", "name": "Ben", "x": 2, "y": 3, "mapX": 1, "mapY": 2.5},
            {
                "id": "harbor",
                "name": "Hafen",
                "x": 10,
                "y": 10,
                "type": "ort",
                "mapImageId": "img-1",
                "mapImageU": 0.5,
                "mapImageV": 1,
                "mapImageZoom": 2,
                "mapExpanded": True,
                "placeDisplay": "pin",
                "mapWidth": 800,
                "mapHeight": 600.5,
                "mapScale": {"unitsPer100px": 5, "unitLabel": "km"},
            },
            {
                "id": "quay",
                "name": "Kai",
                "x": 11,
                "y": 11,
                "type": "ort",
                "parentPlaceId": "harbor",
                "mapU": 0,
                "mapV": 0.25,
                "placeDisplay": "card",
            },
        ],
        "edges": [
            {
                "id": "knows",
                "from": "ada",
                "to": "ben",
                "style": "dashed",
                "color": "gold",
                "lineStyle": "dotted",
                "relationshipKind": "kinship",
                "versions": [
                    {
                        "momentId": "storm",
                        "active": False,
                        "from": "ben",
                        "to": "ada",
                        "label": "verliert",
                        "style": "blood",
                        "directed": True,
                        "color": "rose",
                        "lineStyle": "dashed",
                        "relationshipKind": "general",
                    }
                ],
            },
            {"id": "sees", "from": "ben", "to": "harbor"},
        ],
        "timeline": [
            {"id": "dawn", "title": "Anfang", "time": -4, "position": 0, "precision": "year"},
            {
                "id": "storm",
                "title": "Sturm",
                "date": "1. Eins",
                "note": "Regen",
                "noteMarks": [{"kind": "italic", "from": 0, "to": 5}],
                "time": 0,
                "position": 1,
                "endTime": 3,
                "endPrecision": "day",
            },
        ],
        "presence": [
            {"id": "p1", "elementId": "ada", "placeId": "harbor", "momentId": "dawn"},
            {"id": "p2", "elementId": "ada", "placeId": "quay"},
        ],
        "timeSystem": {
            "id": "ts",
            "name": "Hafenkalender",
            "kind": "custom",
            "unit": "day",
            "eraName": "nach Gründung",
            "eraAbbreviation": "n.G.",
            "displayFormat": "{day}.{month}.{year}",
            "epochTime": 0,
            "epochYear": 1,
            "epochMonth": 2,
            "epochDay": 3,
            "epochWeekday": 1,
            "months": [
                {"name": "Eins", "shortName": "E", "dayCount": 10},
                {"name": "Zwei", "dayCount": 20},
            ],
            "weekdays": [{"name": "Mo", "shortName": "M"}, {"name": "Di"}],
        },
    }


def manuscript() -> Payload:
    return {
        "language": "de-DE",
        "grammarMode": "automatic",
        "words": ["Kai", {"w": "Lotsin", "d": "Beruf"}, {"w": "Ada"}],
        "activeSymbols": ["ada"],
        "chapters": [
            {
                "id": "c1",
                "title": "Ankunft",
                "body": "Ada lief zum Kai.",
                "note": "Notiz",
                "inBook": True,
                "storyTime": {"startMomentId": "dawn"},
                "noteMarks": [{"kind": "bold", "from": 0, "to": 5}],
                "mentions": [
                    {
                        "id": "m1",
                        "from": 0,
                        "to": 3,
                        "elementId": "ada",
                        "surface": "Ada",
                        "source": "helper",
                        "confidence": 1,
                    },
                    {
                        "id": "m2",
                        "from": 13,
                        "to": 16,
                        "elementId": "quay",
                        "surface": "Kai",
                        "source": "llm-assisted",
                        "confidence": 0.5,
                    },
                ],
                "marks": [
                    {"kind": "bold", "from": 0, "to": 3},
                    {"kind": "italic", "from": 0, "to": 8},
                    {"kind": "bold", "from": 3, "to": 8},
                ],
            },
            {"id": "c2"},
        ],
        "trash": [
            {
                "chapter": {"id": "old", "title": "Verworfen", "body": "Weg."},
                "deletedAt": "2026-01-02T03:04:05Z",
                "treeItem": {
                    "id": "chapter:old",
                    "kind": "chapter",
                    "chapterId": "old",
                    "position": 0,
                    "parentFolderId": "inner",
                },
                "originalFolderPath": [
                    {"id": "outer", "title": "Teil I"},
                    {"id": "inner", "title": "Ankunft"},
                ],
            },
            {
                "chapter": {"id": "older"},
                "deletedAt": "2025-12-31T23:59:59.5Z",
                "treeItem": {
                    "id": "chapter:older",
                    "kind": "chapter",
                    "chapterId": "older",
                    "position": 3,
                },
                "originalFolderPath": [],
            },
        ],
        "structure": {
            "folders": [{"id": "part", "title": "Teil"}],
            "items": [
                {"id": "i-part", "kind": "folder", "folderId": "part", "position": 0},
                {
                    "id": "i-c1",
                    "kind": "chapter",
                    "chapterId": "c1",
                    "parentFolderId": "part",
                    "position": 0,
                },
                {"id": "i-c2", "kind": "chapter", "chapterId": "c2", "position": 1},
            ],
        },
    }


def _node(payload: Payload, node_id: str) -> Payload:
    return next(node for node in payload["nodes"] if node["id"] == node_id)


def _step(target: Any, key: Any) -> Any:
    """One path step; ``"@id"`` picks the list entry with that id, so cases survive reordering."""

    if isinstance(key, str) and key.startswith("@"):
        return next(entry for entry in target if entry["id"] == key[1:])
    return target[key]


def _set(path: tuple[Any, ...], value: object) -> Case:
    def apply(payload: Payload) -> None:
        target: Any = payload
        for key in path[:-1]:
            target = _step(target, key)
        target[path[-1]] = value

    return apply


def _drop(path: tuple[Any, ...]) -> Case:
    def apply(payload: Payload) -> None:
        target: Any = payload
        for key in path[:-1]:
            target = _step(target, key)
        del target[path[-1]]

    return apply


def _append(path: tuple[Any, ...], value: object) -> Case:
    def apply(payload: Payload) -> None:
        target: Any = payload
        for key in path:
            target = _step(target, key)
        target.append(deepcopy(value))

    return apply


PROFILE = ("nodes", "@ada", "profile")
REFERENCE = (*PROFILE, "noteReferences", 0)
HARBOR = ("nodes", "@harbor")
TIME_SYSTEM = ("timeSystem",)
STORM = ("timeline", 1)
EDGE = ("edges", 0)
VERSION = (*EDGE, "versions", 0)
PRESENCE = ("presence", 0)

FIGURE_REJECTIONS: dict[str, Case] = {
    # valid_figures, document shape
    "payload is a list": lambda payload: payload.clear(),
    "nodes missing": _drop(("nodes",)),
    "edges are an object": _set(("edges",), {}),
    # _valid_time_system
    "time system is a list": _set(TIME_SYSTEM, []),
    "time system id empty": _set((*TIME_SYSTEM, "id"), ""),
    "time system id missing": _drop((*TIME_SYSTEM, "id")),
    "time system name not a string": _set((*TIME_SYSTEM, "name"), 5),
    "time system kind unknown": _set((*TIME_SYSTEM, "kind"), "lunar"),
    "time system unit unknown": _set((*TIME_SYSTEM, "unit"), "hour"),
    "calendar with abstract unit": _set((*TIME_SYSTEM, "unit"), "abstract"),
    "era name not a string": _set((*TIME_SYSTEM, "eraName"), 5),
    "display format not a string": _set((*TIME_SYSTEM, "displayFormat"), None),
    "epoch year not an integer": _set((*TIME_SYSTEM, "epochYear"), "1"),
    "epoch time a bool": _set((*TIME_SYSTEM, "epochTime"), True),
    "epoch time unsafe": _set((*TIME_SYSTEM, "epochTime"), 9_007_199_254_740_992),
    "epoch weekday a float": _set((*TIME_SYSTEM, "epochWeekday"), 1.0),
    "months not a list": _set((*TIME_SYSTEM, "months"), {}),
    "weekdays not a list": _set((*TIME_SYSTEM, "weekdays"), "Mo"),
    "custom calendar without months": _set((*TIME_SYSTEM, "months"), []),
    "month not an object": _set((*TIME_SYSTEM, "months", 1), "Zwei"),
    "month name missing": _drop((*TIME_SYSTEM, "months", 1, "name")),
    "month short name not a string": _set((*TIME_SYSTEM, "months", 0, "shortName"), 1),
    "month day count a string": _set((*TIME_SYSTEM, "months", 0, "dayCount"), "10"),
    "month day count zero": _set((*TIME_SYSTEM, "months", 0, "dayCount"), 0),
    "month day count unsafe": _set((*TIME_SYSTEM, "months", 0, "dayCount"), 9_007_199_254_740_992),
    "weekday not an object": _set((*TIME_SYSTEM, "weekdays", 0), "Mo"),
    "weekday name missing": _drop((*TIME_SYSTEM, "weekdays", 1, "name")),
    "weekday short name not a string": _set((*TIME_SYSTEM, "weekdays", 0, "shortName"), []),
    "epoch weekday beyond the week": _set((*TIME_SYSTEM, "epochWeekday"), 2),
    "epoch weekday negative": _set((*TIME_SYSTEM, "epochWeekday"), -1),
    "custom epoch month beyond the year": _set((*TIME_SYSTEM, "epochMonth"), 3),
    "custom epoch month zero": _set((*TIME_SYSTEM, "epochMonth"), 0),
    "custom epoch day beyond the month": _set((*TIME_SYSTEM, "epochDay"), 21),
    "custom epoch day zero": _set((*TIME_SYSTEM, "epochDay"), 0),
    "gregorian epoch is no date": lambda payload: payload["timeSystem"].update(
        kind="gregorian", epochMonth=2, epochDay=30
    ),
    # _acyclic_place_levels
    "person with a parent place": _set(("nodes", "@ben", "parentPlaceId"), "harbor"),
    "place inside a person": _set(("nodes", "@quay", "parentPlaceId"), "ben"),
    "place inside an unknown place": _set(("nodes", "@quay", "parentPlaceId"), "nowhere"),
    "two places contain each other": _set((*HARBOR, "parentPlaceId"), "quay"),
    "place contains itself": _set((*HARBOR, "parentPlaceId"), "harbor"),
    # node identity and geometry
    "node id empty": _set(("nodes", "@ben", "id"), ""),
    "node id not a string": _set(("nodes", 1, "id"), 7),
    "node name missing": _drop(("nodes", "@ben", "name")),
    "node x a string": _set(("nodes", "@ben", "x"), "2"),
    "node y missing": _drop(("nodes", "@ben", "y")),
    "node mapX a string": _set(("nodes", "@ben", "mapX"), "1"),
    "node mapY a list": _set(("nodes", "@ben", "mapY"), [1]),
    "duplicate node ids": _set(("nodes", "@ben", "id"), "ada"),
    # _valid_place_level
    "parent place id empty": _set(("nodes", "@quay", "parentPlaceId"), ""),
    "map image id not a string": _set((*HARBOR, "mapImageId"), 5),
    "map u above one": _set(("nodes", "@quay", "mapU"), 1.5),
    "map v negative": _set(("nodes", "@quay", "mapV"), -0.1),
    "map image u a bool": _set((*HARBOR, "mapImageU"), True),
    "map image v a string": _set((*HARBOR, "mapImageV"), "1"),
    "map image zoom below one": _set((*HARBOR, "mapImageZoom"), 0.5),
    "map image zoom above eight": _set((*HARBOR, "mapImageZoom"), 9),
    "map image zoom a bool": _set((*HARBOR, "mapImageZoom"), True),
    "map image zoom a string": _set((*HARBOR, "mapImageZoom"), "2"),
    "map expanded an integer": _set((*HARBOR, "mapExpanded"), 1),
    "place display unknown": _set((*HARBOR, "placeDisplay"), "badge"),
    "place display not a string": _set((*HARBOR, "placeDisplay"), None),
    "map width zero": _set((*HARBOR, "mapWidth"), 0),
    "map height a bool": _set((*HARBOR, "mapHeight"), True),
    "map height a string": _set((*HARBOR, "mapHeight"), "600"),
    "map scale not an object": _set((*HARBOR, "mapScale"), 5),
    "map scale without units": _drop((*HARBOR, "mapScale", "unitsPer100px")),
    "map scale units zero": _set((*HARBOR, "mapScale", "unitsPer100px"), 0),
    "map scale units a bool": _set((*HARBOR, "mapScale", "unitsPer100px"), True),
    "map scale label missing": _drop((*HARBOR, "mapScale", "unitLabel")),
    # _valid_profile
    "profile not an object": _set(PROFILE, "Ada"),
    "profile notes not a string": _set((*PROFILE, "notes"), 5),
    "profile legacy value not a string": _set((*PROFILE, "alter"), 40),
    "profile extra not a list": _set((*PROFILE, "extra"), {}),
    "profile extra row not an object": _set((*PROFILE, "extra", 0), "Narbe"),
    "profile extra key not a string": _set((*PROFILE, "extra", 0, "k"), 1),
    "profile extra value missing": _drop((*PROFILE, "extra", 0, "v")),
    "profile fields not a list": _set((*PROFILE, "fields"), {}),
    "profile field not an object": _set((*PROFILE, "fields", 0), "Beruf"),
    "profile field id empty": _set((*PROFILE, "fields", 0, "id"), ""),
    "profile field id not a string": _set((*PROFILE, "fields", 0, "id"), 1),
    "profile field key missing": _drop((*PROFILE, "fields", 0, "key")),
    "profile field value not a string": _set((*PROFILE, "fields", 0, "value"), None),
    "duplicate profile field ids": _append(
        (*PROFILE, "fields"), {"id": "f1", "key": "k", "value": "v"}
    ),
    "profile note marks invalid": _set((*PROFILE, "noteMarks", 0, "kind"), "underline"),
    # _valid_note_references, through the profile
    "note references not a list": _set((*PROFILE, "noteReferences"), {}),
    "too many note references": _set((*PROFILE, "noteReferences"), [{}] * 10_001),
    "note reference not an object": _set(REFERENCE, "r1"),
    "note reference start negative": _set((*REFERENCE, "from"), -1),
    "note reference empty range": _set((*REFERENCE, "to"), 0),
    "note reference start a bool": _set((*REFERENCE, "from"), False),
    "note reference beyond the note": _set((*REFERENCE, "to"), 50),
    "note reference id empty": _set((*REFERENCE, "id"), ""),
    "note reference id too long": _set((*REFERENCE, "id"), "r" * 501),
    "duplicate note reference ids": _set((*PROFILE, "noteReferences", 1, "id"), "r1"),
    "note reference target not an object": _set((*REFERENCE, "target"), "ben"),
    "note reference target kind unknown": _set((*REFERENCE, "target", "kind"), "person"),
    "note reference target id empty": _set((*REFERENCE, "target", "id"), ""),
    "note reference target id missing": _drop((*REFERENCE, "target", "id")),
    "note reference surface empty": _set((*REFERENCE, "surface"), ""),
    "note reference surface too long": _set((*REFERENCE, "surface"), "s" * 1001),
    "note reference surface differs": _set((*REFERENCE, "surface"), "Hallo!"),
    "note references overlap": _set((*PROFILE, "noteReferences", 1, "from"), 4),
    # aliases
    "aliases not a list": _set(("nodes", "@ada", "aliases"), "Adi"),
    "alias not an object": _set(("nodes", "@ada", "aliases", 0), "Adi"),
    "alias not a string": _set(("nodes", "@ada", "aliases", 0, "alias"), 1),
    "alias without letters": _set(("nodes", "@ada", "aliases", 0, "alias"), " - "),
    "alias source unknown": _set(("nodes", "@ada", "aliases", 0, "source"), "rumour"),
    "aliases equal after normalising": _set(("nodes", "@ada", "aliases", 1, "alias"), "ADI"),
    # timeline
    "timeline not a list": _set(("timeline",), {}),
    "moment not an object": _set(("timeline", 0), "dawn"),
    "moment id empty": _set(("timeline", 0, "id"), ""),
    "moment title not a string": _set(("timeline", 0, "title"), 1),
    "moment date not a string": _set((*STORM, "date"), None),
    "moment note not a string": _set((*STORM, "note"), 5),
    "moment note references invalid": _set((*STORM, "noteReferences"), "x"),
    "moment note marks invalid": _set((*STORM, "noteMarks", 0, "to"), 99),
    "moment time a string": _set((*STORM, "time"), "0"),
    "moment time unsafe": _set((*STORM, "time"), -9_007_199_254_740_992),
    "moment position a float": _set((*STORM, "position"), 1.0),
    "moment precision unknown": _set(("timeline", 0, "precision"), "week"),
    "moment end time a string": _set((*STORM, "endTime"), "3"),
    "moment end time unsafe": _set((*STORM, "endTime"), 9_007_199_254_740_992),
    "moment ends before it starts": _set((*STORM, "endTime"), -1),
    "end precision without end time": _drop((*STORM, "endTime")),
    "end precision unknown": _set((*STORM, "endPrecision"), "hour"),
    "duplicate moment ids": _set(("timeline", 0, "id"), "storm"),
    # deaths
    "died moment not a string": _set(("nodes", "@ada", "diedMomentId"), 1),
    "died moment empty": _set(("nodes", "@ada", "diedMomentId"), ""),
    "died moment unknown": _set(("nodes", "@ada", "diedMomentId"), "later"),
    # edges
    "edge not an object": _set(("edges", 1), "sees"),
    "edge id empty": _set((*EDGE, "id"), ""),
    "edge from unknown": _set((*EDGE, "from"), "cid"),
    "edge to missing": _drop((*EDGE, "to")),
    "edge style unknown": _set((*EDGE, "style"), "wavy"),
    "edge style not a string": _set((*EDGE, "style"), ["solid"]),
    "edge color unknown": _set((*EDGE, "color"), "red"),
    "edge color not a string": _set((*EDGE, "color"), None),
    "edge line style unknown": _set((*EDGE, "lineStyle"), "double"),
    "edge line style not a string": _set((*EDGE, "lineStyle"), 1),
    "edge relationship kind unknown": _set((*EDGE, "relationshipKind"), "rival"),
    "edge relationship kind not a string": _set((*EDGE, "relationshipKind"), {}),
    "edge versions not a list": _set((*EDGE, "versions"), {}),
    "version not an object": _set(VERSION, "storm"),
    "version moment unknown": _set((*VERSION, "momentId"), "later"),
    "version active missing": _drop((*VERSION, "active")),
    "version active an integer": _set((*VERSION, "active"), 0),
    "version from unknown": _set((*VERSION, "from"), "cid"),
    "version to unknown": _set((*VERSION, "to"), None),
    "version label not a string": _set((*VERSION, "label"), 3),
    "version style unknown": _set((*VERSION, "style"), "wavy"),
    "version style not a string": _set((*VERSION, "style"), None),
    "version directed not a bool": _set((*VERSION, "directed"), "yes"),
    "version color unknown": _set((*VERSION, "color"), "red"),
    "version color not a string": _set((*VERSION, "color"), 0),
    "version line style unknown": _set((*VERSION, "lineStyle"), "double"),
    "version line style not a string": _set((*VERSION, "lineStyle"), []),
    "version relationship kind unknown": _set((*VERSION, "relationshipKind"), "rival"),
    "version relationship kind not a string": _set((*VERSION, "relationshipKind"), 1),
    "two versions at one moment": _append(
        (*EDGE, "versions"), {"momentId": "storm", "active": True}
    ),
    "duplicate edge ids": _set(("edges", 1, "id"), "knows"),
    # presence
    "presence not a list": _set(("presence",), {}),
    "presence entry not an object": _set(PRESENCE, "p1"),
    "presence id empty": _set((*PRESENCE, "id"), ""),
    "presence element unknown": _set((*PRESENCE, "elementId"), "cid"),
    "presence place is a person": _set((*PRESENCE, "placeId"), "ben"),
    "presence place missing": _drop((*PRESENCE, "placeId")),
    "presence moment not a string": _set((*PRESENCE, "momentId"), 1),
    "presence moment empty": _set((*PRESENCE, "momentId"), ""),
    "presence moment unknown": _set((*PRESENCE, "momentId"), "later"),
    "duplicate presence ids": _set(("presence", 1, "id"), "p1"),
    "two placements of one element at one moment": _drop((*PRESENCE, "momentId")),
}

FIGURE_ACCEPTANCES: dict[str, Case] = {
    "the full example": lambda payload: None,
    "minimal": lambda payload: (payload.clear(), payload.update(nodes=[], edges=[])),
    "without presence": _drop(("presence",)),
    "without time system": _drop(("timeSystem",)),
    "relative abstract time": _set(
        TIME_SYSTEM, {"id": "r", "name": "Relativ", "kind": "relative", "unit": "abstract"}
    ),
    "gregorian calendar": _set(
        TIME_SYSTEM,
        {
            "id": "g",
            "name": "Gregor",
            "kind": "gregorian",
            "epochYear": 2024,
            "epochMonth": 2,
            "epochDay": 29,
        },
    ),
    "custom calendar without weekdays": _drop((*TIME_SYSTEM, "weekdays")),
    "end time equal to time": _set((*STORM, "endTime"), 0),
    "end time without time": _drop((*STORM, "time")),
    "map coordinates at their bounds": lambda payload: _node(payload, "harbor").update(
        mapU=1, mapV=0, mapImageZoom=8, mapExpanded=False
    ),
    "null place fields": lambda payload: _node(payload, "harbor").update(
        mapImageId=None,
        mapU=None,
        mapImageZoom=None,
        mapExpanded=None,
        mapWidth=None,
        mapScale=None,
    ),
    "profile without fields": _drop((*PROFILE, "fields")),
    "empty profile": _set(PROFILE, {}),
    "edge without versions": _drop((*EDGE, "versions")),
}


def _chapter(index: int = 0) -> tuple[Any, ...]:
    return ("chapters", index)


CHAPTER = _chapter()
MENTION = (*CHAPTER, "mentions", 0)
MARK = (*CHAPTER, "marks", 0)
TRASH = ("trash", 0)
TREE_ITEM = (*TRASH, "treeItem")
FOLDER = (*TRASH, "originalFolderPath", 0)

MANUSCRIPT_REJECTIONS: dict[str, Case] = {
    # document shape and settings
    "payload is a list": lambda payload: payload.clear(),
    "chapters missing": _drop(("chapters",)),
    "chapters an object": _set(("chapters",), {}),
    "language not German": _set(("language",), "en-US"),
    "grammar mode unknown": _set(("grammarMode",), "strict"),
    "words not a list": _set(("words",), "Kai"),
    "word a number": _set(("words", 0), 1),
    "word object without w": _set(("words", 1), {"d": "Beruf"}),
    "word w not a string": _set(("words", 2, "w"), 1),
    "word d not a string": _set(("words", 1, "d"), None),
    "active symbols not a list": _set(("activeSymbols",), "ada"),
    "active symbol not a string": _set(("activeSymbols", 0), 1),
    # chapters
    "chapter not an object": _set(_chapter(1), "c2"),
    "chapter id empty": _set((*_chapter(1), "id"), ""),
    "chapter id missing": _drop((*_chapter(1), "id")),
    "chapter title not a string": _set((*CHAPTER, "title"), 1),
    "chapter body not a string": _set((*_chapter(1), "body"), None),
    "chapter in book not a bool": _set((*CHAPTER, "inBook"), 1),
    "chapter id too long": _set((*_chapter(1), "id"), "c" * 201),
    "chapter title too long": _set((*_chapter(1), "title"), "t" * 1001),
    "chapter note too long": _set((*_chapter(1), "note"), "n" * 100_001),
    "chapter body too long": _set((*_chapter(1), "body"), "b" * 10_000_001),
    "chapter story time invalid": _set((*CHAPTER, "storyTime"), {"startMomentId": ""}),
    "chapter note references invalid": _set((*CHAPTER, "noteReferences"), [{"from": 0, "to": 1}]),
    "chapter note marks invalid": _set((*CHAPTER, "noteMarks", 0, "to"), 50),
    "duplicate chapter ids": _set((*_chapter(1), "id"), "c1"),
    # mentions
    "mentions not a list": _set((*CHAPTER, "mentions"), {}),
    "too many mentions": _set((*CHAPTER, "mentions"), [{}] * 10_001),
    "mention not an object": _set(MENTION, "m1"),
    "mention start a string": _set((*MENTION, "from"), "0"),
    "mention empty range": _set((*MENTION, "to"), 0),
    "mention start negative": _set((*MENTION, "from"), -2),
    "mention beyond the body": _set((*MENTION, "to"), 99),
    "mention id missing": _drop((*MENTION, "id")),
    "mention element empty": _set((*MENTION, "elementId"), ""),
    "mention surface too long": lambda payload: payload["chapters"][0]["mentions"][0].update(
        surface="s" * 501
    ),
    "mention source not a string": _set((*MENTION, "source"), 1),
    "mention source unknown": _set((*MENTION, "source"), "guess"),
    "mention confidence missing": _drop((*MENTION, "confidence")),
    "mention confidence a bool": _set((*MENTION, "confidence"), True),
    "mention confidence negative": _set((*MENTION, "confidence"), -0.1),
    "mention confidence above one": _set((*MENTION, "confidence"), 1.01),
    "mention surface differs": _set((*MENTION, "surface"), "Adi"),
    "mentions overlap": lambda payload: payload["chapters"][0]["mentions"][1].update(
        **{"from": 2, "to": 5, "surface": "a l"}
    ),
    "duplicate mention ids": _set((*CHAPTER, "mentions", 1, "id"), "m1"),
    # _valid_marks
    "marks not a list": _set((*CHAPTER, "marks"), {}),
    "too many marks": _set((*CHAPTER, "marks"), [{}] * 10_001),
    "mark not an object": _set(MARK, "bold"),
    "mark kind unknown": _set((*MARK, "kind"), "heading"),
    "mark start a float": _set((*MARK, "from"), 0.0),
    "mark empty range": _set((*MARK, "to"), 0),
    "mark beyond the body": _set((*MARK, "to"), 40),
    "marks of one kind overlap": _set((*CHAPTER, "marks", 2, "from"), 2),
    # trash
    "trash not a list": _set(("trash",), {}),
    "too much trash": _set(("trash",), [{}] * 1001),
    "trash entry not an object": _set(TRASH, "old"),
    "trashed chapter missing": _drop((*TRASH, "chapter")),
    "trashed chapter invalid": _set((*TRASH, "chapter", "id"), ""),
    "trashed chapter still live": _set((*TRASH, "chapter", "id"), "c1"),
    "chapter trashed twice": lambda payload: payload["trash"][1].update(
        chapter={"id": "old"},
        treeItem={"id": "chapter:old", "kind": "chapter", "chapterId": "old", "position": 3},
    ),
    "deletion time not a string": _set((*TRASH, "deletedAt"), 0),
    "deletion time without Z": _set((*TRASH, "deletedAt"), "2026-01-02T03:04:05+00:00"),
    "deletion time no timestamp": _set((*TRASH, "deletedAt"), "gesternZ"),
    "tree item not an object": _set(TREE_ITEM, "chapter:old"),
    "tree item kind folder": _set((*TREE_ITEM, "kind"), "folder"),
    "tree item names another chapter": _set((*TREE_ITEM, "chapterId"), "c1"),
    "tree item id empty": _set((*TREE_ITEM, "id"), ""),
    "tree item id too long": _set((*TREE_ITEM, "id"), "i" * 501),
    "tree item position a string": _set((*TREE_ITEM, "position"), "0"),
    "tree item position negative": _set((*TREE_ITEM, "position"), -1),
    "tree item position unsafe": _set((*TREE_ITEM, "position"), 9_007_199_254_740_992),
    "tree item carries a folder id": _set((*TREE_ITEM, "folderId"), "inner"),
    "tree item parent empty": _set((*TREE_ITEM, "parentFolderId"), ""),
    "tree item parent not a string": _set((*TREE_ITEM, "parentFolderId"), 5),
    "tree item parent too long": lambda payload: (
        payload["trash"][0]["treeItem"].update(parentFolderId="p" * 201),
        payload["trash"][0]["originalFolderPath"][1].update(id="p" * 201),
    ),
    "folder path not a list": _set((*TRASH, "originalFolderPath"), {}),
    "folder path too deep": _set((*TRASH, "originalFolderPath"), [{}] * 101),
    "folder not an object": _set(FOLDER, "outer"),
    "folder id empty": _set((*FOLDER, "id"), ""),
    "folder id too long": _set((*FOLDER, "id"), "f" * 201),
    "folder appears twice in the path": _set((*FOLDER, "id"), "inner"),
    "folder title missing": _drop((*FOLDER, "title")),
    "folder title too long": _set((*FOLDER, "title"), "t" * 1001),
    "root chapter with a folder path": _drop((*TREE_ITEM, "parentFolderId")),
    "parent without a folder path": _set((*TRASH, "originalFolderPath"), []),
    "parent is not the last folder": _set((*TREE_ITEM, "parentFolderId"), "outer"),
    # structure
    "structure misses a chapter": _drop(("structure", "items", 2)),
}

MANUSCRIPT_ACCEPTANCES: dict[str, Case] = {
    "the full example": lambda payload: None,
    "minimal": lambda payload: (payload.clear(), payload.update(chapters=[])),
    "without structure": _drop(("structure",)),
    "malformed structure falls back to flat": _set(("structure",), {"folders": "x"}),
    "without trash": _drop(("trash",)),
    "manual grammar": _set(("grammarMode",), "manual"),
    "limits exactly reached": lambda payload: (
        payload.pop("structure")
        and payload["chapters"][1].update(id="c" * 200, title="t" * 1000, note="n" * 100_000)
    ),
    "mention confidence zero": _set((*MENTION, "confidence"), 0),
}


def _apply(build: Callable[[], Payload], case: Case) -> Payload:
    payload = build()
    case(payload)
    return payload


class FigureValidationBranchTests(unittest.TestCase):
    def test_every_figure_rejection_is_rejected(self) -> None:
        for name, case in FIGURE_REJECTIONS.items():
            with self.subTest(name):
                self.assertFalse(valid_figures(_apply(figures, case)))

    def test_figure_acceptances_are_accepted(self) -> None:
        for name, case in FIGURE_ACCEPTANCES.items():
            with self.subTest(name):
                self.assertTrue(valid_figures(_apply(figures, case)))

    def test_non_object_payloads_are_rejected(self) -> None:
        for payload in (None, [], "nodes", 5):
            with self.subTest(payload=payload):
                self.assertFalse(valid_figures(payload))


class ManuscriptValidationBranchTests(unittest.TestCase):
    def test_every_manuscript_rejection_is_rejected(self) -> None:
        for name, case in MANUSCRIPT_REJECTIONS.items():
            with self.subTest(name):
                self.assertFalse(valid_manuscript(_apply(manuscript, case)))

    def test_manuscript_acceptances_are_accepted(self) -> None:
        for name, case in MANUSCRIPT_ACCEPTANCES.items():
            with self.subTest(name):
                self.assertTrue(valid_manuscript(_apply(manuscript, case)))

    def test_non_object_payloads_are_rejected(self) -> None:
        for payload in (None, [], "chapters", 5):
            with self.subTest(payload=payload):
                self.assertFalse(valid_manuscript(payload))


if __name__ == "__main__":
    unittest.main()
