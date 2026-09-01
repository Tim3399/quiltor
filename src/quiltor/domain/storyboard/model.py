"""Pure Storyboard document values and structural validation.

Storyboard is author-owned planning material.  This module deliberately knows
nothing about manuscript canon, Story World aggregates, storage, or a concrete
canvas library.
"""

from __future__ import annotations

from math import isfinite
from typing import Any, Literal, NotRequired, Required, TypedDict

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
    noteReferences: NotRequired[list[dict[str, Any]]]
    noteMarks: NotRequired[list[dict[str, Any]]]


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


def valid_storyboard_document(value: Any) -> bool:
    """Validate local Storyboard invariants without consulting canonical data.

    External reference targets intentionally remain ID-only.  A deleted Figure,
    Place, Timeline moment, or Chapter therefore leaves a resolvable missing
    reference instead of coupling this planning document to another aggregate.
    Board links and edges, in contrast, are local and must resolve here.
    """

    if not _valid_json_value(value) or not isinstance(value, dict):
        return False
    boards = value.get("boards")
    nodes = value.get("nodes")
    edges = value.get("edges")
    if not isinstance(boards, list) or not isinstance(nodes, list) or not isinstance(edges, list):
        return False
    if not boards or len(boards) > MAX_BOARDS or len(nodes) > MAX_NODES or len(edges) > MAX_EDGES:
        return False

    board_ids: set[str] = set()
    for board in boards:
        if (
            not isinstance(board, dict)
            or not _non_empty_id(board.get("id"))
            or not isinstance(board.get("title"), str)
            or len(board["title"]) > MAX_TITLE_LENGTH
            or board["id"] in board_ids
        ):
            return False
        board_ids.add(board["id"])

    node_ids: set[str] = set()
    nodes_by_id: dict[str, dict[str, Any]] = {}
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


def _valid_node(value: Any, board_ids: set[str]) -> bool:
    if not isinstance(value, dict):
        return False
    node_id = value.get("id")
    board_id = value.get("boardId")
    kind = value.get("kind")
    if (
        not _non_empty_id(node_id)
        or not _non_empty_id(board_id)
        or board_id not in board_ids
        or not isinstance(kind, str)
        or kind not in _NODE_KINDS
        or not _finite_coordinate(value.get("x"))
        or not _finite_coordinate(value.get("y"))
    ):
        return False
    for dimension in ("width", "height"):
        if dimension in value and (
            not _finite_coordinate(value[dimension]) or value[dimension] <= 0
        ):
            return False
    if kind == "group" and ("width" not in value or "height" not in value):
        return False
    z_index = value.get("zIndex", 0)
    if type(z_index) is not int or abs(z_index) > MAX_SAFE_INTEGER:
        return False

    if "text" in value and (
        not isinstance(value["text"], str) or len(value["text"]) > MAX_TEXT_LENGTH
    ):
        return False
    if "label" in value and (
        not isinstance(value["label"], str) or len(value["label"]) > MAX_TITLE_LENGTH
    ):
        return False
    if kind == "note" and "text" not in value:
        return False

    has_target = "target" in value
    target = value.get("target")
    if kind == "reference":
        if not _valid_target(target, _REFERENCE_KINDS):
            return False
    elif kind == "storyboard":
        if not _valid_target(target, {"storyboard"}) or target["id"] not in board_ids:
            return False
    elif has_target:
        return False

    return ("noteReferences" not in value or _valid_note_references(value, board_ids)) and (
        "noteMarks" not in value or valid_note_marks(value, "text")
    )


def _valid_target(value: Any, allowed: set[str]) -> bool:
    if not isinstance(value, dict):
        return False
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in allowed:
        return False
    target_id = value.get("id")
    if kind == "storyboard":
        return _non_empty_id(target_id)
    # Canonical source-document IDs predate Storyboard's bounded local IDs.
    # Keep them lossless and only require a non-empty string at this boundary.
    return isinstance(target_id, str) and len(target_id) > 0


def _valid_edge(
    value: Any,
    board_ids: set[str],
    nodes_by_id: dict[str, dict[str, Any]],
) -> bool:
    if not isinstance(value, dict):
        return False
    board_id = value.get("boardId")
    source_id = value.get("sourceNodeId")
    target_id = value.get("targetNodeId")
    if not _non_empty_id(board_id) or not _non_empty_id(source_id) or not _non_empty_id(target_id):
        return False
    source = nodes_by_id.get(source_id)
    target = nodes_by_id.get(target_id)
    return (
        _non_empty_id(value.get("id"))
        and board_id in board_ids
        and source is not None
        and target is not None
        and source["boardId"] == board_id
        and target["boardId"] == board_id
        and isinstance(value.get("label", ""), str)
        and len(value.get("label", "")) <= MAX_TITLE_LENGTH
        and ("directed" not in value or type(value["directed"]) is bool)
        and isinstance(value.get("color", "auto"), str)
        and value.get("color", "auto") in _EDGE_COLORS
        and isinstance(value.get("lineStyle", "solid"), str)
        and value.get("lineStyle", "solid") in _EDGE_LINE_STYLES
    )


def _valid_note_references(owner: dict[str, Any], board_ids: set[str]) -> bool:
    text = owner.get("text", "")
    references = owner.get("noteReferences")
    if not isinstance(text, str) or not isinstance(references, list) or len(references) > 10_000:
        return False
    ids: set[str] = set()
    previous_end = -1
    for reference in sorted(
        references,
        key=lambda item: (
            item.get("from", -1) if isinstance(item, dict) and type(item.get("from")) is int else -1
        ),
    ):
        if not isinstance(reference, dict):
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


def _non_empty_id(value: Any) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= MAX_ID_LENGTH and value == value.strip()


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def _finite_coordinate(value: Any) -> bool:
    return _finite_number(value) and abs(value) <= MAX_SAFE_INTEGER


def _valid_json_value(value: Any, depth: int = 0) -> bool:
    if depth > 100:
        return False
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return isfinite(value)
    if isinstance(value, list):
        return all(_valid_json_value(item, depth + 1) for item in value)
    if isinstance(value, dict):
        return all(
            isinstance(key, str) and _valid_json_value(item, depth + 1)
            for key, item in value.items()
        )
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
