"""Pure hierarchy rules for the manuscript binder."""

from __future__ import annotations

from collections.abc import Iterable
from copy import deepcopy
from typing import Any


class ManuscriptTreeError(ValueError):
    """The binder structure violates a domain invariant."""


def flat_structure(chapter_ids: Iterable[str]) -> dict[str, list[dict[str, Any]]]:
    """Place an existing flat manuscript at the root without changing its order."""

    return {
        "folders": [],
        "items": [
            {
                "id": f"chapter:{chapter_id}",
                "kind": "chapter",
                "chapterId": chapter_id,
                "position": position,
            }
            for position, chapter_id in enumerate(chapter_ids)
        ],
    }


def structure_or_flat(
    chapter_ids: Iterable[str], structure: Any
) -> dict[str, list[dict[str, Any]]]:
    """Return persisted structure, or the lossless projection for legacy payloads."""

    ids = list(chapter_ids)
    if not isinstance(structure, dict) or not isinstance(structure.get("folders"), list):
        return flat_structure(ids)
    if not isinstance(structure.get("items"), list):
        return flat_structure(ids)
    candidate = {
        "folders": deepcopy(structure["folders"]),
        "items": deepcopy(structure["items"]),
    }
    validate_tree(ids, candidate)
    folder_by_id = {folder["id"]: folder for folder in candidate["folders"]}
    ordered_folders: list[dict[str, Any]] = []
    ordered_items: list[dict[str, Any]] = []

    def visit(parent_folder_id: str | None) -> None:
        for item in _ordered_children(candidate["items"], parent_folder_id):
            ordered_items.append(item)
            if item["kind"] == "folder":
                ordered_folders.append(folder_by_id[item["folderId"]])
                visit(item["folderId"])

    visit(None)
    return {"folders": ordered_folders, "items": ordered_items}


def _parent(item: dict[str, Any]) -> str | None:
    value = item.get("parentFolderId")
    return value if isinstance(value, str) and value else None


def _ordered_children(
    items: list[dict[str, Any]], parent_folder_id: str | None
) -> list[dict[str, Any]]:
    return sorted(
        (item for item in items if _parent(item) == parent_folder_id),
        key=lambda item: (item["position"], item["id"]),
    )


def normalize_positions(structure: Any) -> dict[str, list[dict[str, Any]]]:
    """Return a copy with contiguous positions at every parent."""

    if not isinstance(structure, dict):
        raise ManuscriptTreeError("manuscript structure must be an object")
    folders = deepcopy(structure.get("folders"))
    items = deepcopy(structure.get("items"))
    if not isinstance(folders, list) or not isinstance(items, list):
        raise ManuscriptTreeError("manuscript structure needs folder and item lists")
    parents = {_parent(item) for item in items if isinstance(item, dict)}
    for parent in parents:
        for position, item in enumerate(_ordered_children(items, parent)):
            item["position"] = position
    return {"folders": folders, "items": items}


def descendants(folder_id: str, structure: Any) -> set[str]:
    """Return all recursively nested folder IDs."""

    if not isinstance(structure, dict) or not isinstance(structure.get("items"), list):
        raise ManuscriptTreeError("manuscript structure needs an item list")
    result: set[str] = set()
    pending = [folder_id]
    while pending:
        parent = pending.pop()
        children = [
            item["folderId"]
            for item in structure["items"]
            if isinstance(item, dict) and item.get("kind") == "folder" and _parent(item) == parent
        ]
        for child in children:
            if child not in result:
                result.add(child)
                pending.append(child)
    return result


def move_item(
    chapter_ids: Iterable[str],
    structure: Any,
    item_id: str,
    target_folder_id: str | None,
    before_item_id: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Move one chapter or complete folder subtree and normalize sibling order."""

    chapters = list(chapter_ids)
    candidate = structure_or_flat(chapters, structure)
    folder_ids = {folder["id"] for folder in candidate["folders"]}
    if target_folder_id is not None and target_folder_id not in folder_ids:
        raise ManuscriptTreeError("target folder does not exist")
    item = next((entry for entry in candidate["items"] if entry["id"] == item_id), None)
    if item is None:
        raise ManuscriptTreeError("tree item does not exist")
    if item["kind"] == "folder" and (
        target_folder_id == item["folderId"]
        or target_folder_id in descendants(item["folderId"], candidate)
    ):
        raise ManuscriptTreeError("folder cannot move below itself")
    if before_item_id == item_id:
        return candidate

    siblings = [
        entry
        for entry in _ordered_children(candidate["items"], target_folder_id)
        if entry["id"] != item_id
    ]
    if before_item_id is None:
        destination = len(siblings)
    else:
        destination = next(
            (index for index, entry in enumerate(siblings) if entry["id"] == before_item_id),
            -1,
        )
        if destination < 0:
            raise ManuscriptTreeError("drop anchor is not a target sibling")
    if target_folder_id is None:
        item.pop("parentFolderId", None)
    else:
        item["parentFolderId"] = target_folder_id
    siblings.insert(destination, item)
    for position, sibling in enumerate(siblings):
        sibling["position"] = position
    candidate = normalize_positions(candidate)
    validate_tree(chapters, candidate)
    return candidate


def delete_folder(
    chapter_ids: Iterable[str], structure: Any, folder_id: str
) -> dict[str, list[dict[str, Any]]]:
    """Delete organizational metadata while moving direct children to its parent."""

    chapters = list(chapter_ids)
    candidate = structure_or_flat(chapters, structure)
    folder_item = next(
        (
            item
            for item in candidate["items"]
            if item["kind"] == "folder" and item["folderId"] == folder_id
        ),
        None,
    )
    if folder_item is None:
        raise ManuscriptTreeError("folder does not exist")
    parent = _parent(folder_item)
    children = _ordered_children(candidate["items"], folder_id)
    parent_siblings = [
        item
        for item in _ordered_children(candidate["items"], parent)
        if item["id"] != folder_item["id"]
    ]
    insert_at = folder_item["position"]
    for child in children:
        if parent is None:
            child.pop("parentFolderId", None)
        else:
            child["parentFolderId"] = parent
    parent_siblings[insert_at:insert_at] = children
    for position, sibling in enumerate(parent_siblings):
        sibling["position"] = position
    candidate["folders"] = [folder for folder in candidate["folders"] if folder["id"] != folder_id]
    candidate["items"] = [item for item in candidate["items"] if item["id"] != folder_item["id"]]
    candidate = normalize_positions(candidate)
    validate_tree(chapters, candidate)
    return candidate


def validate_tree(chapter_ids: Iterable[str], structure: Any) -> None:
    """Validate ownership, sibling order, references and recursive acyclicity."""

    chapters = list(chapter_ids)
    if len(chapters) != len(set(chapters)) or any(
        not isinstance(item, str) or not item for item in chapters
    ):
        raise ManuscriptTreeError("chapter IDs must be unique non-empty strings")
    if not isinstance(structure, dict):
        raise ManuscriptTreeError("manuscript structure must be an object")
    folders = structure.get("folders")
    items = structure.get("items")
    if not isinstance(folders, list) or not isinstance(items, list):
        raise ManuscriptTreeError("manuscript structure needs folder and item lists")

    folder_ids: set[str] = set()
    for folder in folders:
        if not isinstance(folder, dict):
            raise ManuscriptTreeError("folder must be an object")
        folder_id = folder.get("id")
        title = folder.get("title")
        if (
            not isinstance(folder_id, str)
            or not folder_id
            or len(folder_id) > 200
            or folder_id in folder_ids
            or not isinstance(title, str)
            or len(title) > 1000
        ):
            raise ManuscriptTreeError("folder identity or title is invalid")
        folder_ids.add(folder_id)

    item_ids: set[str] = set()
    owned_chapters: set[str] = set()
    owned_folders: set[str] = set()
    sibling_positions: dict[str | None, set[int]] = {}
    folder_parents: dict[str, str | None] = {}
    for item in items:
        if not isinstance(item, dict):
            raise ManuscriptTreeError("tree item must be an object")
        item_id = item.get("id")
        kind = item.get("kind")
        position = item.get("position")
        parent = _parent(item)
        if (
            not isinstance(item_id, str)
            or not item_id
            or len(item_id) > 500
            or item_id in item_ids
            or type(position) is not int
            or position < 0
        ):
            raise ManuscriptTreeError("tree item identity or position is invalid")
        if "parentFolderId" in item and item.get("parentFolderId") not in {None, parent}:
            raise ManuscriptTreeError("parent folder must be a non-empty string or null")
        if parent is not None and parent not in folder_ids:
            raise ManuscriptTreeError("tree item references an unknown parent folder")
        positions = sibling_positions.setdefault(parent, set())
        if position in positions:
            raise ManuscriptTreeError("sibling positions must be unique")
        positions.add(position)
        item_ids.add(item_id)

        if kind == "chapter":
            chapter_id = item.get("chapterId")
            if (
                not isinstance(chapter_id, str)
                or chapter_id not in chapters
                or chapter_id in owned_chapters
                or "folderId" in item
            ):
                raise ManuscriptTreeError("chapter ownership is invalid")
            owned_chapters.add(chapter_id)
        elif kind == "folder":
            folder_id = item.get("folderId")
            if (
                not isinstance(folder_id, str)
                or folder_id not in folder_ids
                or folder_id in owned_folders
                or "chapterId" in item
            ):
                raise ManuscriptTreeError("folder ownership is invalid")
            if parent == folder_id:
                raise ManuscriptTreeError("folder cannot contain itself")
            owned_folders.add(folder_id)
            folder_parents[folder_id] = parent
        else:
            raise ManuscriptTreeError("tree item kind is invalid")

    if owned_chapters != set(chapters):
        raise ManuscriptTreeError("every chapter must appear exactly once")
    if owned_folders != folder_ids:
        raise ManuscriptTreeError("every folder must appear exactly once")
    for positions in sibling_positions.values():
        if positions != set(range(len(positions))):
            raise ManuscriptTreeError("sibling positions must be contiguous")

    for folder_id in folder_ids:
        seen = {folder_id}
        parent = folder_parents.get(folder_id)
        while parent is not None:
            if parent in seen:
                raise ManuscriptTreeError("folder hierarchy contains a cycle")
            seen.add(parent)
            parent = folder_parents.get(parent)


def flatten_tree(chapter_ids: Iterable[str], structure: Any) -> list[str]:
    """Depth-first chapter order shared by ordered manuscript consumers."""

    chapters = list(chapter_ids)
    normalized = structure_or_flat(chapters, structure)
    items = normalized["items"]
    result: list[str] = []

    def visit(parent_folder_id: str | None) -> None:
        for item in _ordered_children(items, parent_folder_id):
            if item["kind"] == "chapter":
                result.append(item["chapterId"])
            else:
                visit(item["folderId"])

    visit(None)
    return result


def breadcrumb_for_chapter(
    chapter_id: str, chapter_ids: Iterable[str], structure: Any
) -> list[str]:
    """Return folder titles from root to the chapter's immediate parent."""

    chapters = list(chapter_ids)
    normalized = structure_or_flat(chapters, structure)
    folders = {folder["id"]: folder["title"] for folder in normalized["folders"]}
    folder_parents = {
        item["folderId"]: _parent(item) for item in normalized["items"] if item["kind"] == "folder"
    }
    chapter_item = next(
        (item for item in normalized["items"] if item.get("chapterId") == chapter_id), None
    )
    if chapter_item is None:
        raise ManuscriptTreeError("chapter is absent from the binder")
    result: list[str] = []
    parent = _parent(chapter_item)
    while parent is not None:
        result.append(folders[parent])
        parent = folder_parents[parent]
    result.reverse()
    return result


__all__ = [
    "ManuscriptTreeError",
    "breadcrumb_for_chapter",
    "delete_folder",
    "descendants",
    "flat_structure",
    "flatten_tree",
    "move_item",
    "normalize_positions",
    "structure_or_flat",
    "validate_tree",
]
