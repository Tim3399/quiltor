"""Reaches every rejection of the v1 document wire, with its reason and field (T-19 P7).

Written against the module before it was typed strictly. Each case breaks one rule of a
valid envelope and names the `reason` and `field` the client receives; those are API and
must not change. The tables are shared with the differential test.

A few wire rules repeat a check the domain validator already made, or one the integer
canonicalisation already enforces, so `decode_document_v1` can never reach them. Those are
pinned by calling the private rule directly, in `ShadowedWireRuleTests`.
"""

from __future__ import annotations

import unittest
from collections.abc import Callable
from typing import Any
from unittest.mock import patch

from quiltor.application.document_wire_v1 import (
    DocumentKind,
    DocumentWireV1,
    InvalidDocumentWireV1,
    _acyclic_place_levels,
    _manuscript_wire_failure,
    _story_world_wire_failure,
    _valid_book_layout,
    _valid_import_source,
    _valid_place_level,
    decode_document_v1,
    encode_document_v1,
)
from tests.python.test_story_world_validation_branches import figures, manuscript
from tests.python.test_storyboard_model import wire_payload as storyboard_payload

type Payload = dict[str, Any]
type Envelope = Callable[[], object]

CONTRACTS: dict[DocumentKind, str] = {
    "figures": "quiltor.story-world",
    "manuscript": "quiltor.manuscript",
    "storyboards": "quiltor.storyboards",
}
PAYLOADS: dict[DocumentKind, Callable[[], Payload]] = {
    "figures": figures,
    "manuscript": manuscript,
    "storyboards": storyboard_payload,
}


def book_layout() -> Payload:
    return {
        "version": 1,
        "preset": "quiltor-novel",
        "pageFormat": "6x9",
        "pageWidthMm": 152.4,
        "pageHeightMm": 228.6,
        "mirrorMargins": True,
        "marginInnerMm": 20,
        "marginOuterMm": 15,
        "marginTopMm": 18,
        "marginBottomMm": 20,
        "gutterMm": 5,
        "fontFamily": "eb-garamond",
        "fontSizePt": 11,
        "lineHeight": 1.4,
        "alignment": "justify",
        "hyphenation": True,
        "firstLineIndent": True,
        "firstLineIndentEm": 1.2,
        "paragraphSpacingEm": 0,
        "widows": 2,
        "orphans": 2,
        "chapterStart": "right-page",
        "chapterTopMm": 40,
        "chapterNumber": True,
        "chapterNumberStyle": "chapter",
        "chapterTitle": True,
        "chapterTitleSizePt": 20,
        "chapterAlignment": "center",
        "dropCap": False,
        "chapterFirstIndent": False,
        "sceneSymbol": "* * *",
        "sceneSpaceBeforeMm": 6,
        "sceneSpaceAfterMm": 6,
        "pageNumbers": True,
        "pageNumberPosition": "bottom-outside",
        "hideChapterPageNumbers": True,
        "hideTitlePageNumber": True,
        "numberFromFirstChapter": False,
        "showNovelLabel": True,
        "showVersion": False,
        "showDate": False,
        "bookTitle": "Der Hafen",
        "subtitle": "",
        "author": "Tim",
        "series": "",
        "volume": "",
    }


def import_source() -> Payload:
    return {
        "version": 2,
        "fileName": "Hafen.docx",
        "format": "docx",
        "sourceSha256": "0123456789abcdef" * 4,
        "importedAt": "2026-01-02T03:04:05.123Z",
        "counts": {
            "sourceWords": 10,
            "sourceParagraphs": 2,
            "importedWords": 9,
            "importedParagraphs": 2,
        },
        "warnings": [{"code": "images", "count": 1}, {"code": "comments", "count": 3}],
    }


def rich_manuscript() -> Payload:
    payload = manuscript()
    payload["bookLayout"] = book_layout()
    payload["importSource"] = import_source()
    payload["hiddenElements"] = ["ben"]
    return payload


def rich_figures() -> Payload:
    payload = figures()
    payload["canvasSize"] = {"w": 1200, "h": 800.5}
    payload["mapScale"] = {"unitsPer100px": 2.5, "unitLabel": "km"}
    ada = payload["nodes"][0]
    ada.update(accent="gold", label="Ada", sub="Lotsin", dash=False, pinned=True, important=True)
    payload["edges"][0].update(
        label="kennt", fromHandle="r", toHandle="l", directed=True, active=True
    )
    return payload


def envelope(
    kind: DocumentKind, change: Callable[[Payload], object] = lambda payload: None, **fields: Any
) -> Envelope:
    """A builder for one valid envelope of `kind`, its payload passed through `change`."""

    def build() -> object:
        payload = (
            rich_manuscript()
            if kind == "manuscript"
            else rich_figures()
            if kind == "figures"
            else PAYLOADS[kind]()
        )
        change(payload)
        value: Payload = {
            "contract": CONTRACTS[kind],
            "version": 1,
            "revision": 7,
            "payload": payload,
        }
        for key, item in fields.items():
            if item is _ABSENT:
                del value[key]
            else:
                value[key] = item
        return value

    return build


_ABSENT = object()


def _set(*path: Any, value: object) -> Callable[[Payload], None]:
    def apply(payload: Payload) -> None:
        target: Any = payload
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return apply


def _drop(*path: Any) -> Callable[[Payload], None]:
    def apply(payload: Payload) -> None:
        target: Any = payload
        for key in path[:-1]:
            target = target[key]
        del target[path[-1]]

    return apply


def raw(value: object) -> Envelope:
    return lambda: value


NODE = ("nodes", 0)
HARBOR = ("nodes", 2)
EDGE = ("edges", 0)
MENTION = ("chapters", 0, "mentions", 0)
SOURCE = ("importSource",)
LAYOUT = ("bookLayout",)

# name -> (kind, envelope, reason, field)
REJECTIONS: dict[str, tuple[DocumentKind, Envelope, str, str | None]] = {
    # envelope
    "envelope a list": ("figures", raw([]), "envelope_not_object", None),
    "envelope a string": ("manuscript", raw("{}"), "envelope_not_object", None),
    "envelope with an unknown field": (
        "figures",
        envelope("figures", extra=1),
        "envelope_unknown_field",
        None,
    ),
    "envelope without payload": (
        "figures",
        envelope("figures", payload=_ABSENT),
        "envelope_incomplete",
        "/payload",
    ),
    "envelope without contract and version": (
        "storyboards",
        envelope("storyboards", contract=_ABSENT, version=_ABSENT),
        "envelope_incomplete",
        "/contract",
    ),
    "envelope without version": (
        "manuscript",
        envelope("manuscript", version=_ABSENT),
        "envelope_incomplete",
        "/version",
    ),
    "contract of another kind": (
        "figures",
        envelope("figures", contract="quiltor.manuscript"),
        "contract_mismatch",
        "/contract",
    ),
    "contract missing its kind": (
        "storyboards",
        envelope("storyboards", contract=None),
        "contract_mismatch",
        "/contract",
    ),
    "version 2": ("figures", envelope("figures", version=2), "version_invalid", "/version"),
    "version 0": ("figures", envelope("figures", version=0), "version_invalid", "/version"),
    "version a string": (
        "figures",
        envelope("figures", version="1"),
        "version_invalid",
        "/version",
    ),
    "version a fraction": (
        "figures",
        envelope("figures", version=1.5),
        "version_invalid",
        "/version",
    ),
    "version a bool": ("figures", envelope("figures", version=True), "version_invalid", "/version"),
    "revision negative": (
        "figures",
        envelope("figures", revision=-1),
        "revision_invalid",
        "/revision",
    ),
    "revision unsafe": (
        "figures",
        envelope("figures", revision=9_007_199_254_740_992),
        "revision_invalid",
        "/revision",
    ),
    "revision a string": (
        "figures",
        envelope("figures", revision="7"),
        "revision_invalid",
        "/revision",
    ),
    "revision null": (
        "figures",
        envelope("figures", revision=None),
        "revision_invalid",
        "/revision",
    ),
    "revision infinite": (
        "figures",
        envelope("figures", revision=float("inf")),
        "revision_invalid",
        "/revision",
    ),
    # integer canonicalisation inside the payload
    "mention start a fraction": (
        "manuscript",
        envelope("manuscript", _set(*MENTION, "from", value=0.5)),
        "integer_invalid",
        "/payload",
    ),
    "mention end zero": (
        "manuscript",
        envelope("manuscript", _set(*MENTION, "to", value=0)),
        "integer_invalid",
        "/payload",
    ),
    "chapter mark start a string": (
        "manuscript",
        envelope("manuscript", _set("chapters", 0, "marks", 0, "from", value="0")),
        "integer_invalid",
        "/payload",
    ),
    "note mark level four": (
        "manuscript",
        envelope(
            "manuscript",
            _set(
                "chapters",
                0,
                "noteMarks",
                0,
                value={"kind": "heading", "from": 0, "to": 5, "level": 4},
            ),
        ),
        "integer_invalid",
        "/payload",
    ),
    "note reference start negative": (
        "figures",
        envelope("figures", _set(*NODE, "profile", "noteReferences", 0, "from", value=-1)),
        "integer_invalid",
        "/payload",
    ),
    "trash position a fraction": (
        "manuscript",
        envelope("manuscript", _set("trash", 0, "treeItem", "position", value=0.5)),
        "integer_invalid",
        "/payload",
    ),
    "trashed chapter mention unsafe": (
        "manuscript",
        envelope(
            "manuscript",
            _set("trash", 0, "chapter", "mentions", value=[{"from": 0, "to": 2**60}]),
        ),
        "integer_invalid",
        "/payload",
    ),
    "book layout version 2": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "version", value=2)),
        "integer_invalid",
        "/payload",
    ),
    "book layout widows six": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "widows", value=6)),
        "integer_invalid",
        "/payload",
    ),
    "book layout orphans a string": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "orphans", value="2")),
        "integer_invalid",
        "/payload",
    ),
    "import version three": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "version", value=3)),
        "integer_invalid",
        "/payload",
    ),
    "import count negative": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "counts", "sourceWords", value=-1)),
        "integer_invalid",
        "/payload",
    ),
    "import warning count zero": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "warnings", 0, "count", value=0)),
        "integer_invalid",
        "/payload",
    ),
    "moment time a fraction": (
        "figures",
        envelope("figures", _set("timeline", 0, "time", value=-4.5)),
        "integer_invalid",
        "/payload",
    ),
    "moment position unsafe": (
        "figures",
        envelope("figures", _set("timeline", 0, "position", value=9_007_199_254_740_992)),
        "integer_invalid",
        "/payload",
    ),
    "epoch day a string": (
        "figures",
        envelope("figures", _set("timeSystem", "epochDay", value="3")),
        "integer_invalid",
        "/payload",
    ),
    "month day count zero": (
        "figures",
        envelope("figures", _set("timeSystem", "months", 0, "dayCount", value=0)),
        "integer_invalid",
        "/payload",
    ),
    "storyboard z index a fraction": (
        "storyboards",
        envelope("storyboards", lambda payload: payload["nodes"][0].update(zIndex=1.5)),
        "integer_invalid",
        "/payload",
    ),
    # non-finite numbers
    "infinite node x": (
        "figures",
        envelope("figures", _set(*NODE, "x", value=float("inf"))),
        "payload_number_not_finite",
        "/payload",
    ),
    "nan inside a manuscript list": (
        "manuscript",
        envelope("manuscript", _set("words", value=["Kai", float("nan")])),
        "payload_number_not_finite",
        "/payload",
    ),
    "negative infinity in a storyboard": (
        "storyboards",
        envelope("storyboards", lambda payload: payload.update(extra={"x": float("-inf")})),
        "payload_number_not_finite",
        "/payload",
    ),
    # domain validators
    "payload not an object (figures)": (
        "figures",
        envelope("figures", payload=[]),
        "payload_invalid",
        "/payload",
    ),
    "payload null (manuscript)": (
        "manuscript",
        envelope("manuscript", payload=None),
        "payload_invalid",
        "/payload",
    ),
    "payload a string (storyboards)": (
        "storyboards",
        envelope("storyboards", payload="boards"),
        "payload_invalid",
        "/payload",
    ),
    "figures without edges": (
        "figures",
        envelope("figures", _drop("edges")),
        "payload_invalid",
        "/payload",
    ),
    "manuscript chapter without id": (
        "manuscript",
        envelope("manuscript", _drop("chapters", 1, "id")),
        "payload_invalid",
        "/payload",
    ),
    "storyboards without boards": (
        "storyboards",
        envelope("storyboards", _drop("boards")),
        "payload_invalid",
        "/payload",
    ),
    # list items that are not objects: canonicalisation skips them, the domain refuses them
    "note reference not an object": (
        "manuscript",
        envelope("manuscript", _set("chapters", 0, "noteReferences", value=["r1"])),
        "payload_invalid",
        "/payload",
    ),
    "note mark not an object": (
        "figures",
        envelope("figures", _set(*NODE, "profile", "noteMarks", value=[5])),
        "payload_invalid",
        "/payload",
    ),
    "mention not an object": (
        "manuscript",
        envelope("manuscript", _set(*MENTION, value="m1")),
        "payload_invalid",
        "/payload",
    ),
    "chapter not an object": (
        "manuscript",
        envelope("manuscript", _set("chapters", 1, value="c2")),
        "payload_invalid",
        "/payload",
    ),
    "trash entry not an object": (
        "manuscript",
        envelope("manuscript", _set("trash", 0, value="old")),
        "payload_invalid",
        "/payload",
    ),
    "storyboard node not an object": (
        "storyboards",
        envelope("storyboards", lambda payload: payload["nodes"].append("node")),
        "payload_invalid",
        "/payload",
    ),
    "figure node not an object": (
        "figures",
        envelope("figures", lambda payload: payload["nodes"].append(None)),
        "payload_invalid",
        "/payload",
    ),
    "moment not an object": (
        "figures",
        envelope("figures", lambda payload: payload["timeline"].append([])),
        "payload_invalid",
        "/payload",
    ),
    # manuscript wire rules
    "book layout not an object": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, value=[])),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout missing a key": (
        "manuscript",
        envelope("manuscript", _drop(*LAYOUT, "volume")),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout enum unknown": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "fontFamily", value="comic-sans")),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout enum not a string": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "alignment", value=1)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout flag an integer": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "dropCap", value=0)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout size below range": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "fontSizePt", value=5.9)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout size above range": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "lineHeight", value=3.01)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout size a bool": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "gutterMm", value=True)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout size a string": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "marginTopMm", value="18")),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout metadata too long": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "author", value="a" * 1001)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "book layout metadata not a string": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "series", value=None)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "scene symbol only blanks": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "sceneSymbol", value="   ")),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "scene symbol too long": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "sceneSymbol", value="*" * 33)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "scene symbol not a string": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "sceneSymbol", value=1)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "type area too narrow": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "marginOuterMm", value=100)),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "type area too short": (
        "manuscript",
        envelope(
            "manuscript",
            lambda payload: payload["bookLayout"].update(
                pageHeightMm=100, marginTopMm=40, marginBottomMm=40
            ),
        ),
        "payload_invalid",
        "/payload/bookLayout",
    ),
    "import source not an object": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, value="Hafen.docx")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import source missing a key": (
        "manuscript",
        envelope("manuscript", _drop(*SOURCE, "warnings")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import v1 from markdown": (
        "manuscript",
        envelope(
            "manuscript",
            lambda payload: payload["importSource"].update(version=1, format="markdown"),
        ),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import format unknown": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "format", value="pdf")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import format not a string": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "format", value=None)),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import file name blank": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "fileName", value="  ")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import file name too long": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "fileName", value="f" * 1001)),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import file name not a string": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "fileName", value=5)),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import hash upper case": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "sourceSha256", value="0123456789ABCDEF" * 4)),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import hash too short": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "sourceSha256", value="ab")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import hash not a string": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "sourceSha256", value=1)),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import time without Z": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "importedAt", value="2026-01-02T03:04:05+00:00")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import time not a string": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "importedAt", value=0)),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import time no calendar date": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "importedAt", value="2026-02-30T03:04:05Z")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import counts not an object": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "counts", value=[])),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import counts missing a key": (
        "manuscript",
        envelope("manuscript", _drop(*SOURCE, "counts", "importedWords")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import warnings not a list": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "warnings", value={})),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import warning not an object": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "warnings", 0, value="images")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import warning code unknown": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "warnings", 0, "code", value="macros")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import warning code missing": (
        "manuscript",
        envelope("manuscript", _drop(*SOURCE, "warnings", 0, "code")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import warning count missing": (
        "manuscript",
        envelope("manuscript", _drop(*SOURCE, "warnings", 0, "count")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "import warning code twice": (
        "manuscript",
        envelope("manuscript", _set(*SOURCE, "warnings", 1, "code", value="images")),
        "payload_invalid",
        "/payload/importSource",
    ),
    "hidden elements not a list": (
        "manuscript",
        envelope("manuscript", _set("hiddenElements", value="ben")),
        "payload_invalid",
        "/payload/hiddenElements",
    ),
    "hidden element not a string": (
        "manuscript",
        envelope("manuscript", _set("hiddenElements", value=["ben", 2])),
        "payload_invalid",
        "/payload/hiddenElements",
    ),
    # story-world wire rules
    "node type unknown": (
        "figures",
        envelope("figures", _set("nodes", 1, "type", value="drache")),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node accent unknown": (
        "figures",
        envelope("figures", _set(*NODE, "accent", value="red")),
        "payload_invalid",
        "/payload/nodes",
    ),
    # T-142: an unhashable value must be refused, not raise TypeError in the set lookup.
    "node accent unhashable": (
        "figures",
        envelope("figures", _set(*NODE, "accent", value={})),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node type unhashable": (
        "figures",
        envelope("figures", _set(*NODE, "type", value=[])),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node label not a string": (
        "figures",
        envelope("figures", _set(*NODE, "label", value=1)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node sub not a string": (
        "figures",
        envelope("figures", _set(*NODE, "sub", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node dash an integer": (
        "figures",
        envelope("figures", _set(*NODE, "dash", value=0)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node pinned a string": (
        "figures",
        envelope("figures", _set(*NODE, "pinned", value="true")),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node x a bool": (
        "figures",
        envelope("figures", _set(*NODE, "x", value=True)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node mapY a bool": (
        "figures",
        envelope("figures", _set("nodes", 1, "mapY", value=False)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node mapX null": (
        "figures",
        envelope("figures", _set("nodes", 1, "mapX", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "parent place null": (
        "figures",
        envelope("figures", _set("nodes", 3, "parentPlaceId", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "map image id null": (
        "figures",
        envelope("figures", _set(*HARBOR, "mapImageId", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "map u null": (
        "figures",
        envelope("figures", _set("nodes", 3, "mapU", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "map image zoom null": (
        "figures",
        envelope("figures", _set(*HARBOR, "mapImageZoom", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "map expanded null": (
        "figures",
        envelope("figures", _set(*HARBOR, "mapExpanded", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "map width null": (
        "figures",
        envelope("figures", _set(*HARBOR, "mapWidth", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "node map scale null": (
        "figures",
        envelope("figures", _set(*HARBOR, "mapScale", value=None)),
        "payload_invalid",
        "/payload/nodes",
    ),
    "edge label not a string": (
        "figures",
        envelope("figures", _set(*EDGE, "label", value=1)),
        "payload_invalid",
        "/payload/edges",
    ),
    "edge handle not a string": (
        "figures",
        envelope("figures", _set(*EDGE, "toHandle", value=None)),
        "payload_invalid",
        "/payload/edges",
    ),
    "edge directed a string": (
        "figures",
        envelope("figures", _set(*EDGE, "directed", value="yes")),
        "payload_invalid",
        "/payload/edges",
    ),
    "edge active an integer": (
        "figures",
        envelope("figures", _set(*EDGE, "active", value=1)),
        "payload_invalid",
        "/payload/edges",
    ),
    "canvas not an object": (
        "figures",
        envelope("figures", _set("canvasSize", value=[1200, 800])),
        "payload_invalid",
        "/payload/canvasSize",
    ),
    "canvas width zero": (
        "figures",
        envelope("figures", _set("canvasSize", "w", value=0)),
        "payload_invalid",
        "/payload/canvasSize",
    ),
    "canvas height negative": (
        "figures",
        envelope("figures", _set("canvasSize", "h", value=-1)),
        "payload_invalid",
        "/payload/canvasSize",
    ),
    "canvas height missing": (
        "figures",
        envelope("figures", _drop("canvasSize", "h")),
        "payload_invalid",
        "/payload/canvasSize",
    ),
    "canvas width a bool": (
        "figures",
        envelope("figures", _set("canvasSize", "w", value=True)),
        "payload_invalid",
        "/payload/canvasSize",
    ),
    "world map scale null": (
        "figures",
        envelope("figures", _set("mapScale", value=None)),
        "payload_invalid",
        "/payload/mapScale",
    ),
    "world map scale without label": (
        "figures",
        envelope("figures", _drop("mapScale", "unitLabel")),
        "payload_invalid",
        "/payload/mapScale",
    ),
    "world map scale units zero": (
        "figures",
        envelope("figures", _set("mapScale", "unitsPer100px", value=0)),
        "payload_invalid",
        "/payload/mapScale",
    ),
}

ACCEPTANCES: dict[str, tuple[DocumentKind, Envelope]] = {
    "figures in full": ("figures", envelope("figures")),
    "manuscript in full": ("manuscript", envelope("manuscript")),
    "storyboards": ("storyboards", envelope("storyboards")),
    "without revision": ("figures", envelope("figures", revision=_ABSENT)),
    "revision zero": ("manuscript", envelope("manuscript", revision=0)),
    "integral float version and revision": (
        "storyboards",
        envelope("storyboards", version=1.0, revision=7.0),
    ),
    "integral float positions": (
        "manuscript",
        envelope(
            "manuscript",
            lambda payload: (
                payload["chapters"][0]["mentions"][0].update(**{"from": 0.0, "to": 3.0}),
                payload["trash"][0]["treeItem"].update(position=0.0),
                payload["bookLayout"].update(version=1.0, widows=2.0),
                payload["importSource"]["counts"].update(sourceWords=10.0),
            ),
        ),
    ),
    "integral float moment time": (
        "figures",
        envelope("figures", _set("timeline", 1, "time", value=0.0)),
    ),
    "plain manuscript": (
        "manuscript",
        envelope(
            "manuscript",
            lambda payload: [
                payload.pop(key) for key in ("bookLayout", "importSource", "hiddenElements")
            ],
        ),
    ),
    "import v1 from docx": (
        "manuscript",
        envelope(
            "manuscript", lambda payload: payload["importSource"].update(version=1, warnings=[])
        ),
    ),
    "empty scene symbol": (
        "manuscript",
        envelope("manuscript", _set(*LAYOUT, "sceneSymbol", value="")),
    ),
    "type area just wide and high enough": (
        "manuscript",
        envelope(
            "manuscript",
            lambda payload: payload["bookLayout"].update(
                pageWidthMm=80,
                marginInnerMm=20,
                marginOuterMm=25,
                gutterMm=5,
                pageHeightMm=80,
                marginTopMm=25,
                marginBottomMm=25,
            ),
        ),
    ),
    "legacy profile fields": (
        "figures",
        envelope(
            "figures",
            lambda payload: payload["nodes"][0].update(
                profile={"alter": "40", "extra": [{"k": "a", "v": "b"}]}
            ),
        ),
    ),
    "unordered note marks": (
        "manuscript",
        envelope(
            "manuscript",
            _set(
                "chapters",
                0,
                "noteMarks",
                value=[
                    {"kind": "italic", "from": 2, "to": 4},
                    {"kind": "bold", "from": 0, "to": 5.0},
                ],
            ),
        ),
    ),
}


def rejection(kind: DocumentKind, build: Envelope) -> InvalidDocumentWireV1:
    try:
        decode_document_v1(kind, build())
    except InvalidDocumentWireV1 as error:
        return error
    raise AssertionError("the envelope was accepted")


class WireRejectionTests(unittest.TestCase):
    def test_every_rejection_names_its_reason_and_field(self) -> None:
        for name, (kind, build, reason, field) in REJECTIONS.items():
            with self.subTest(name):
                error = rejection(kind, build)
                self.assertEqual((error.reason, error.field), (reason, field))

    def test_every_acceptance_decodes(self) -> None:
        for name, (kind, build) in ACCEPTANCES.items():
            with self.subTest(name):
                decode_document_v1(kind, build())

    def test_integral_floats_are_canonicalised_to_int(self) -> None:
        wire = decode_document_v1(
            "storyboards", envelope("storyboards", version=1.0, revision=7.0)()
        )
        self.assertIs(type(wire.revision), int)
        positions = decode_document_v1("manuscript", ACCEPTANCES["integral float positions"][1]())
        mention = positions.payload["chapters"][0]["mentions"][0]
        self.assertEqual((type(mention["from"]), type(mention["to"])), (int, int))
        self.assertIs(type(positions.payload["bookLayout"]["widows"]), int)

    def test_note_marks_are_sorted_once_they_are_integers(self) -> None:
        wire = decode_document_v1("manuscript", ACCEPTANCES["unordered note marks"][1]())
        self.assertEqual(
            wire.payload["chapters"][0]["noteMarks"],
            [{"kind": "bold", "from": 0, "to": 5}, {"kind": "italic", "from": 2, "to": 4}],
        )

    def test_legacy_profiles_arrive_in_the_canonical_shape(self) -> None:
        wire = decode_document_v1("figures", ACCEPTANCES["legacy profile fields"][1]())
        profile = wire.payload["nodes"][0]["profile"]
        self.assertNotIn("alter", profile)
        self.assertNotIn("extra", profile)
        self.assertEqual([field["key"] for field in profile["fields"]], ["Alter", "a"])


class EncodeTests(unittest.TestCase):
    def test_encode_builds_the_canonical_envelope_with_and_without_revision(self) -> None:
        payload = storyboard_payload()
        self.assertEqual(
            encode_document_v1("storyboards", payload, 3),
            {"contract": "quiltor.storyboards", "version": 1, "payload": payload, "revision": 3},
        )
        self.assertNotIn("revision", encode_document_v1("storyboards", payload))
        self.assertEqual(DocumentWireV1("figures", {}).contract, "quiltor.story-world")

    def test_encode_canonicalises_and_refuses_what_decode_refuses(self) -> None:
        payload = rich_manuscript()
        payload["bookLayout"]["widows"] = 2.0
        self.assertIs(
            type(encode_document_v1("manuscript", payload)["payload"]["bookLayout"]["widows"]), int
        )
        payload["bookLayout"]["widows"] = 9
        with self.assertRaises(InvalidDocumentWireV1) as caught:
            encode_document_v1("manuscript", payload)
        self.assertEqual(
            (caught.exception.reason, caught.exception.field), ("integer_invalid", "/payload")
        )
        with self.assertRaises(InvalidDocumentWireV1) as caught:
            encode_document_v1("figures", {"nodes": []}, -1)
        self.assertEqual(
            (caught.exception.reason, caught.exception.field), ("revision_invalid", "/revision")
        )


class ShadowedWireRuleTests(unittest.TestCase):
    """Wire rules that an earlier check always decides first; reached by a direct call."""

    def test_place_level_rules_already_enforced_by_the_domain(self) -> None:
        self.assertTrue(_valid_place_level({"placeDisplay": "card"}))
        for node in (
            {"placeDisplay": "badge"},
            {"placeDisplay": 1},
            {"mapU": 2},
            {"mapImageZoom": 9},
        ):
            with self.subTest(node=node):
                self.assertFalse(_valid_place_level(node))

    def test_place_level_cycles_already_refused_by_the_domain(self) -> None:
        places = [
            {"id": "a", "type": "ort", "parentPlaceId": "b"},
            {"id": "b", "type": "ort", "parentPlaceId": "a"},
        ]
        self.assertFalse(_acyclic_place_levels(places))
        self.assertFalse(
            _acyclic_place_levels([{"id": "a", "parentPlaceId": "b"}, {"id": "b", "type": "ort"}])
        )
        self.assertTrue(
            _acyclic_place_levels(
                [{"id": "a", "type": "ort", "parentPlaceId": "b"}, {"id": "b", "type": "ort"}]
            )
        )
        self.assertEqual(_story_world_wire_failure({"nodes": places, "edges": []}), "nodes")

    def test_profile_rules_already_enforced_by_the_domain(self) -> None:
        for profile in (
            "Ada",
            {"alter": 40},
            {"extra": {}},
            {"extra": ["x"]},
            {"extra": [{"k": "a"}]},
            {"fields": {}},
            {"fields": ["x"]},
            {"fields": [{"id": "", "key": "k", "value": "v"}]},
            {
                "fields": [
                    {"id": "f", "key": "k", "value": "v"},
                    {"id": "f", "key": "k", "value": "v"},
                ]
            },
            {"fields": [{"id": "f", "key": 1, "value": "v"}]},
        ):
            with self.subTest(profile=profile):
                payload = {"nodes": [{"id": "ada", "profile": profile}], "edges": []}
                self.assertEqual(_story_world_wire_failure(payload), "nodes")

    def test_edge_style_rules_already_enforced_by_the_domain(self) -> None:
        for edge in (
            {"style": "wavy"},
            {"lineStyle": 1},
            {"relationshipKind": "rival"},
            {"color": "red"},
            {"versions": [{"style": "wavy"}]},
            {"versions": [{"lineStyle": "double"}]},
            {"versions": [{"relationshipKind": 1}]},
            {"versions": [{"color": None}]},
        ):
            with self.subTest(edge=edge):
                self.assertEqual(_story_world_wire_failure({"nodes": [], "edges": [edge]}), "edges")

    def test_timeline_position_range_already_enforced_by_canonicalisation(self) -> None:
        for position in (9_007_199_254_740_992, "1"):
            with self.subTest(position=position):
                payload = {"nodes": [], "edges": [], "timeline": [{"position": position}]}
                self.assertEqual(_story_world_wire_failure(payload), "timeline")
        self.assertIsNone(_story_world_wire_failure({"nodes": [], "edges": [], "timeline": [{}]}))

    def test_words_rule_already_enforced_by_the_domain(self) -> None:
        for words in ("Kai", [1], [{"d": "x"}], [{"w": "a", "d": 1}]):
            with self.subTest(words=words):
                self.assertEqual(_manuscript_wire_failure({"words": words}), "words")
        self.assertIsNone(_manuscript_wire_failure({"words": ["a", {"w": "b"}]}))

    def test_book_layout_integers_already_enforced_by_canonicalisation(self) -> None:
        for key, value in (
            ("version", 2),
            ("version", "1"),
            ("widows", 6),
            ("orphans", 0),
            ("orphans", 2.0),
        ):
            with self.subTest(key=key, value=value):
                layout = book_layout()
                layout[key] = value
                self.assertFalse(_valid_book_layout(layout))
        self.assertTrue(_valid_book_layout(book_layout()))

    def test_a_version_other_than_one_after_the_range_check(self) -> None:
        # `_envelope_integer` already pins the version to 1; the guard behind it is only
        # reachable if that range ever widens.
        with patch(f"{decode_document_v1.__module__}._envelope_integer", return_value=2):
            error = rejection("figures", envelope("figures"))
        self.assertEqual(
            (str(error), error.reason, error.field),
            ("unsupported document contract version", "version_invalid", "/version"),
        )

    def test_import_integers_already_enforced_by_canonicalisation(self) -> None:
        changes: list[Callable[[Payload], object]] = [
            lambda source: source.update(version=3),
            lambda source: source.update(version="2"),
            lambda source: source["counts"].update(sourceWords=-1),
            lambda source: source["counts"].update(sourceWords="1"),
            lambda source: source["warnings"][0].update(count=0),
            lambda source: source["warnings"][0].update(count=1.0),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                source = import_source()
                change(source)
                self.assertFalse(_valid_import_source(source))
        self.assertTrue(_valid_import_source(import_source()))


if __name__ == "__main__":
    unittest.main()
