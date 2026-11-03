# pyright: strict
"""Pure Storyboard document values and structural validation.

Storyboard is author-owned planning material.  This module deliberately knows
nothing about manuscript canon, Story World aggregates, storage, or a concrete
canvas library.
"""

from __future__ import annotations

from collections.abc import Mapping
from math import isfinite
from typing import Literal, NotRequired, Required, TypedDict, TypeGuard

from quiltor.domain.json_values import JsonObject, as_array, as_object
from quiltor.domain.notes import valid_note_marks

DEFAULT_STORYBOARD_ID = "main-storyboard"
DEFAULT_STORYBOARD_TITLE = "Main Storyboard"
MAX_SAFE_INTEGER = 9_007_199_254_740_991

StoryboardNodeKind = Literal["note", "reference", "storyboard", "group"]
StoryboardReferenceKind = Literal["entity", "place", "timeline", "chapter", "storyboard"]
GraphEdgeColor = Literal["auto", "ink", "gold", "rose", "moss", "blue"]
GraphEdgeLineStyle = Literal["solid", "dashed", "dotted"]

_NODE_KINDS = {"note", "reference", "storyboard", "group"}
_REFERENCE_KINDS = {"entity", "place", "timeline", "chapter"}
_ALL_REFERENCE_KINDS = {*_REFERENCE_KINDS, "storyboard"}
_EDGE_COLORS = {"auto", "ink", "gold", "rose", "moss", "blue"}
_EDGE_LINE_STYLES = {"solid", "dashed", "dotted"}
MAX_BOARDS = 10_000
MAX_NODES = 100_000
MAX_EDGES = 200_000
MAX_ID_LENGTH = 500
MAX_TITLE_LENGTH = 1_000
MAX_TEXT_LENGTH = 100_000


class StoryboardBoard(TypedDict, total=False):
    id: Required[str]
    title: Required[str]


class StoryboardReferenceTarget(TypedDict, total=False):
    kind: Required[StoryboardReferenceKind]
    id: Required[str]


class StoryboardNode(TypedDict, total=False):
    id: Required[str]
    boardId: Required[str]
    kind: Required[StoryboardNodeKind]
    x: Required[float]
    y: Required[float]
    width: NotRequired[float]
    height: NotRequired[float]
    zIndex: NotRequired[int]
    text: NotRequired[str]
    target: NotRequired[StoryboardReferenceTarget]
    noteReferences: NotRequired[list[JsonObject]]
    noteMarks: NotRequired[list[JsonObject]]


class StoryboardEdge(TypedDict, total=False):
    id: Required[str]
    boardId: Required[str]
    sourceNodeId: Required[str]
    targetNodeId: Required[str]
    label: NotRequired[str]
    directed: NotRequired[bool]
    color: NotRequired[GraphEdgeColor]
    lineStyle: NotRequired[GraphEdgeLineStyle]


class StoryboardDocument(TypedDict, total=False):
    boards: Required[list[StoryboardBoard]]
    nodes: Required[list[StoryboardNode]]
    edges: Required[list[StoryboardEdge]]


def default_storyboard_document() -> StoryboardDocument:
    """Return a fresh empty document with one stable initial board."""

    return {
        "boards": [{"id": DEFAULT_STORYBOARD_ID, "title": DEFAULT_STORYBOARD_TITLE}],
        "nodes": [],
        "edges": [],
    }


def valid_storyboard_document(value: object) -> bool:
    """Validate local Storyboard invariants without consulting canonical data.

    External reference targets intentionally remain ID-only.  A deleted Figure,
    Place, Timeline moment, or Chapter therefore leaves a resolvable missing
    reference instead of coupling this planning document to another aggregate.
    Board links and edges, in contrast, are local and must resolve here.
    """

    document = as_object(value)
    if not _valid_json_value(value) or document is None:
        return False
    boards = as_array(document.get("boards"))
    nodes = as_array(document.get("nodes"))
    edges = as_array(document.get("edges"))
    if boards is None or nodes is None or edges is None:
        return False
    if not boards or len(boards) > MAX_BOARDS or len(nodes) > MAX_NODES or len(edges) > MAX_EDGES:
        return False

    board_ids: set[str] = set()
    for board in boards:
        if not _valid_board(board) or board["id"] in board_ids:
            return False
        board_ids.add(board["id"])

    node_ids: set[str] = set()
    nodes_by_id: dict[str, StoryboardNode] = {}
    for node in nodes:
        if not _valid_node(node, board_ids) or node["id"] in node_ids:
            return False
        node_ids.add(node["id"])
        nodes_by_id[node["id"]] = node

    edge_ids: set[str] = set()
    for edge in edges:
        if not _valid_edge(edge, board_ids, nodes_by_id) or edge["id"] in edge_ids:
            return False
        edge_ids.add(edge["id"])
    return True


def _valid_board(value: object) -> TypeGuard[StoryboardBoard]:
    board = as_object(value)
    if board is None:
        return False
    title = board.get("title")
    return (
        _non_empty_id(board.get("id")) and isinstance(title, str) and len(title) <= MAX_TITLE_LENGTH
    )


def _valid_node(value: object, board_ids: set[str]) -> TypeGuard[StoryboardNode]:
    node = as_object(value)
    if node is None:
        return False
    node_id = node.get("id")
    board_id = node.get("boardId")
    kind = node.get("kind")
    if (
        not _non_empty_id(node_id)
        or not _non_empty_id(board_id)
        or board_id not in board_ids
        or not isinstance(kind, str)
        or kind not in _NODE_KINDS
        or not _finite_coordinate(node.get("x"))
        or not _finite_coordinate(node.get("y"))
    ):
        return False
    for dimension in ("width", "height"):
        size = node.get(dimension)
        if dimension in node and (not _finite_coordinate(size) or size <= 0):
            return False
    if kind == "group" and ("width" not in node or "height" not in node):
        return False
    z_index = node.get("zIndex", 0)
    if type(z_index) is not int or abs(z_index) > MAX_SAFE_INTEGER:
        return False

    text = node.get("text")
    if "text" in node and (not isinstance(text, str) or len(text) > MAX_TEXT_LENGTH):
        return False
    label = node.get("label")
    if "label" in node and (not isinstance(label, str) or len(label) > MAX_TITLE_LENGTH):
        return False
    if kind == "note" and "text" not in node:
        return False

    has_target = "target" in node
    target = node.get("target")
    if kind == "reference":
        if not _valid_target(target, _REFERENCE_KINDS):
            return False
    elif kind == "storyboard":
        if not _valid_target(target, {"storyboard"}) or target["id"] not in board_ids:
            return False
    elif has_target:
        return False

    return ("noteReferences" not in node or _valid_note_references(node, board_ids)) and (
        "noteMarks" not in node or valid_note_marks(node, "text")
    )


def _valid_target(value: object, allowed: set[str]) -> TypeGuard[StoryboardReferenceTarget]:
    target = as_object(value)
    if target is None:
        return False
    kind = target.get("kind")
    if not isinstance(kind, str) or kind not in allowed:
        return False
    target_id = target.get("id")
    if kind == "storyboard":
        return _non_empty_id(target_id)
    # Canonical source-document IDs predate Storyboard's bounded local IDs.
    # Keep them lossless and only require a non-empty string at this boundary.
    return isinstance(target_id, str) and len(target_id) > 0


def _valid_edge(
    value: object,
    board_ids: set[str],
    nodes_by_id: Mapping[str, StoryboardNode],
) -> TypeGuard[StoryboardEdge]:
    edge = as_object(value)
    if edge is None:
        return False
    board_id = edge.get("boardId")
    source_id = edge.get("sourceNodeId")
    target_id = edge.get("targetNodeId")
    if not _non_empty_id(board_id) or not _non_empty_id(source_id) or not _non_empty_id(target_id):
        return False
    source = nodes_by_id.get(source_id)
    target = nodes_by_id.get(target_id)
    label = edge.get("label", "")
    color = edge.get("color", "auto")
    line_style = edge.get("lineStyle", "solid")
    return (
        _non_empty_id(edge.get("id"))
        and board_id in board_ids
        and source is not None
        and target is not None
        and source["boardId"] == board_id
        and target["boardId"] == board_id
        and isinstance(label, str)
        and len(label) <= MAX_TITLE_LENGTH
        and ("directed" not in edge or type(edge["directed"]) is bool)
        and isinstance(color, str)
        and color in _EDGE_COLORS
        and isinstance(line_style, str)
        and line_style in _EDGE_LINE_STYLES
    )


def _valid_note_references(owner: JsonObject, board_ids: set[str]) -> bool:
    text = owner.get("text", "")
    references = as_array(owner.get("noteReferences"))
    if not isinstance(text, str) or references is None or len(references) > 10_000:
        return False
    ids: set[str] = set()
    previous_end = -1
    for item in sorted(references, key=_reference_start):
        reference = as_object(item)
        if reference is None:
            return False
        start, end = reference.get("from"), reference.get("to")
        target = reference.get("target")
        surface = reference.get("surface")
        reference_id = reference.get("id")
        if (
            not _non_empty_id(reference_id)
            or reference_id in ids
            or not _valid_target(target, _ALL_REFERENCE_KINDS)
            or type(start) is not int
            or type(end) is not int
            or start > MAX_SAFE_INTEGER
            or end > MAX_SAFE_INTEGER
            or start < previous_end
            or end <= start
            or not isinstance(surface, str)
            or not surface
            or len(surface) > MAX_TITLE_LENGTH
        ):
            return False
        if target["kind"] == "storyboard" and target["id"] not in board_ids:
            return False
        indices = _utf16_offsets_to_indices(text, (start, end))
        if indices is None or text[indices[0] : indices[1]] != surface:
            return False
        ids.add(reference_id)
        previous_end = end
    return True


def _reference_start(item: object) -> int:
    """The sort key of a note reference: its integer start, or -1 for anything else."""

    reference = as_object(item)
    start = None if reference is None else reference.get("from", -1)
    return start if type(start) is int else -1


def _utf16_offsets_to_indices(text: str, offsets: tuple[int, int]) -> tuple[int, int] | None:
    wanted = set(offsets)
    found: dict[int, int] = {}
    units = 0
    if 0 in wanted:
        found[0] = 0
    for index, character in enumerate(text, start=1):
        units += 2 if ord(character) > 0xFFFF else 1
        if units in wanted:
            found[units] = index
    if any(offset not in found for offset in offsets):
        return None
    return found[offsets[0]], found[offsets[1]]


def _non_empty_id(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and 1 <= len(value) <= MAX_ID_LENGTH and value == value.strip()


def _finite_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def _finite_coordinate(value: object) -> TypeGuard[int | float]:
    return _finite_number(value) and abs(value) <= MAX_SAFE_INTEGER


def _valid_json_value(value: object, depth: int = 0) -> bool:
    if depth > 100:
        return False
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return isfinite(value)
    items = as_array(value)
    if items is not None:
        return all(_valid_json_value(item, depth + 1) for item in items)
    # as_object refuses a dict with a key that is not a str, as JSON has none.
    entries = as_object(value)
    if entries is not None:
        return all(_valid_json_value(item, depth + 1) for item in entries.values())
    return False


__all__ = [
    "DEFAULT_STORYBOARD_ID",
    "DEFAULT_STORYBOARD_TITLE",
    "GraphEdgeColor",
    "GraphEdgeLineStyle",
    "StoryboardBoard",
    "StoryboardDocument",
    "StoryboardEdge",
    "StoryboardNode",
    "StoryboardNodeKind",
    "StoryboardReferenceKind",
    "StoryboardReferenceTarget",
    "default_storyboard_document",
    "valid_storyboard_document",
]
