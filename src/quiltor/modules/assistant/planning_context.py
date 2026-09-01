"""Projection of non-canonical Storyboard material into assistant context."""

from __future__ import annotations

from typing import Any

from quiltor.domain.story_world.knowledge import KnowledgeChunk, KnowledgeContextClass

MAX_PLANNING_CONTEXT_CHUNKS = 2_000
MAX_PLANNING_CONTEXT_TEXT = 4_000


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def build_storyboard_knowledge(storyboards: dict[str, Any]) -> list[KnowledgeChunk]:
    """Project every non-empty Storyboard note with stable planning provenance.

    Storyboard remains a separate author-owned planning aggregate. Node IDs are
    document-wide identities, while each target also retains its board identity
    so a cited planning source can be opened at the exact surface.
    """

    board_titles = {
        board["id"]: _clean(board.get("title")) or str(board["id"])
        for board in storyboards.get("boards") or []
        if isinstance(board, dict) and isinstance(board.get("id"), str) and board["id"]
    }
    nodes = [node for node in storyboards.get("nodes") or [] if isinstance(node, dict)]
    chunks: list[KnowledgeChunk] = []
    ordered_nodes = sorted(
        nodes, key=lambda item: (str(item.get("boardId", "")), str(item.get("id", "")))
    )
    for node in ordered_nodes:
        node_id = node.get("id")
        board_id = node.get("boardId")
        text = node.get("text")
        if (
            not isinstance(node_id, str)
            or not node_id
            or not isinstance(board_id, str)
            or not board_id
            or not isinstance(text, str)
            or not text.strip()
        ):
            continue
        board_title = board_titles.get(board_id, board_id)
        label = _clean(node.get("label")) or _clean(text)[:60]
        chunks.append(
            KnowledgeChunk(
                id=f"storyboard:{node_id}",
                kind="storyboard-note",
                title=f"{board_title} · {label}",
                text=text.strip()[:MAX_PLANNING_CONTEXT_TEXT],
                target={"workspace": "storyboard", "id": node_id, "boardId": board_id},
                context_class=KnowledgeContextClass.PLANNING,
            )
        )
        if len(chunks) >= MAX_PLANNING_CONTEXT_CHUNKS:
            break
    return chunks
