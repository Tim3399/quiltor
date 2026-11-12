"""Filling in the size of a map that carries a picture but no frame size.

A map frame is the picture drawn at `mapWidth` x `mapHeight`. The product writes both
whenever it sets a picture, so a map without them only arrives as data -- an older
document, an import, a document made elsewhere. Rather than let the client invent a
size, the frame takes the picture's own pixel size, which the image catalogue knows.

Both sides come from the picture even when one is present: a frame whose one side is
the author's and the other the picture's would not have the picture's proportions.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

PLACE_KIND = "ort"


def _positive(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and value > 0


def _lacks_size(node: Mapping[str, Any]) -> bool:
    return not (_positive(node.get("mapWidth")) and _positive(node.get("mapHeight")))


def _nodes(state: Mapping[str, Any]) -> list[object]:
    nodes = state.get("nodes")
    return cast(list[object], nodes) if isinstance(nodes, list) else []


def with_map_dimensions(
    state: dict[str, Any], dims: Mapping[str, tuple[int, int]]
) -> dict[str, Any]:
    """`state` with every sizeless map sized from its picture; `state` itself is untouched.

    A picture the catalogue does not know leaves the map as it is: there is nothing true
    to fill in, and the picture could not be shown anyway.
    """

    completed: list[object] = []
    for raw in _nodes(state):
        node = cast(dict[str, Any], raw) if isinstance(raw, dict) else None
        image_id = node.get("mapImageId") if node is not None else None
        if (
            node is not None
            and isinstance(image_id, str)
            and node.get("type") == PLACE_KIND
            and image_id in dims
            and _lacks_size(node)
        ):
            width, height = dims[image_id]
            completed.append({**node, "mapWidth": width, "mapHeight": height})
        else:
            completed.append(node if node is not None else cast(object, raw))
    if not isinstance(state.get("nodes"), list):
        return dict(state)
    return {**state, "nodes": completed}


def map_image_ids(state: Mapping[str, Any]) -> set[str]:
    """The pictures the places of `state` are drawn on."""

    ids: set[str] = set()
    for raw in _nodes(state):
        if isinstance(raw, dict):
            image_id = cast(dict[str, Any], raw).get("mapImageId")
            if isinstance(image_id, str):
                ids.add(image_id)
    return ids


__all__ = ["map_image_ids", "with_map_dimensions"]
