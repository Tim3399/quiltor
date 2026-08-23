"""Pure structured story-world queries shared by read-tool transports."""

from __future__ import annotations

from collections.abc import Sequence
from copy import deepcopy
from typing import Any

from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.domain.story_world.world_state import state_after, state_at, state_before


class StoryWorldQueries:
    @staticmethod
    def get_entity(story_world: dict[str, Any], element_id: str) -> dict[str, Any] | None:
        """Return one entity by exact canonical id, never by a guessed text match."""

        return next(
            (
                deepcopy(node)
                for node in story_world.get("nodes") or []
                if isinstance(node, dict) and node.get("id") == element_id
            ),
            None,
        )

    @staticmethod
    def get_relationships(
        story_world: dict[str, Any],
        element_id: str,
        *,
        other_element_id: str | None = None,
        limit: int = 12,
    ) -> list[dict[str, Any]]:
        """Read a deterministic, bounded set of edges touching an exact entity id."""

        matches = [
            deepcopy(edge)
            for edge in story_world.get("edges") or []
            if isinstance(edge, dict)
            and element_id in (edge.get("from"), edge.get("to"))
            and (other_element_id is None or other_element_id in (edge.get("from"), edge.get("to")))
        ]
        return sorted(matches, key=lambda edge: str(edge.get("id", "")))[: max(0, limit)]

    @staticmethod
    def find_timeline_events(
        story_world: dict[str, Any],
        query: str = "",
        *,
        entity_id: str | None = None,
        limit: int = 12,
    ) -> list[dict[str, Any]]:
        """Find exact structured events, optionally scoped to one involved entity."""

        related_moments: set[str] | None = None
        if entity_id is not None:
            related_moments = {
                str(node["diedMomentId"])
                for node in story_world.get("nodes") or []
                if isinstance(node, dict)
                and node.get("id") == entity_id
                and isinstance(node.get("diedMomentId"), str)
            }
            related_moments.update(
                str(entry["momentId"])
                for entry in story_world.get("presence") or []
                if isinstance(entry, dict)
                and entry.get("elementId") == entity_id
                and isinstance(entry.get("momentId"), str)
            )
            for edge in story_world.get("edges") or []:
                if not isinstance(edge, dict) or entity_id not in (
                    edge.get("from"),
                    edge.get("to"),
                ):
                    continue
                related_moments.update(
                    str(version["momentId"])
                    for version in edge.get("versions") or []
                    if isinstance(version, dict) and isinstance(version.get("momentId"), str)
                )

        folded_query = " ".join(query.casefold().split())
        tokens = {token for token in folded_query.split() if len(token) >= 2}
        scored: list[tuple[int, tuple[Any, ...], dict[str, Any]]] = []
        for index, moment in enumerate(story_world.get("timeline") or []):
            if not isinstance(moment, dict) or not isinstance(moment.get("id"), str):
                continue
            if related_moments is not None and moment["id"] not in related_moments:
                continue
            haystack = " ".join(
                str(moment.get(key) or "") for key in ("title", "date", "note")
            ).casefold()
            phrase_score = 4 if folded_query and folded_query in haystack else 0
            token_score = sum(1 for token in tokens if token in haystack)
            if folded_query and not phrase_score and not token_score:
                continue
            time, position = moment.get("time"), moment.get("position")
            chronological = (
                0 if type(time) is int else 1,
                time if type(time) is int else index,
                position if type(position) is int else index,
                moment["id"],
            )
            scored.append((phrase_score + token_score, chronological, deepcopy(moment)))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [moment for _score, _order, moment in scored[: max(0, limit)]]

    @staticmethod
    def get_world_state(
        story_world: dict[str, Any], moment_id: str, *, phase: str = "at"
    ) -> dict[str, Any]:
        """Project the canonical temporal world through the shared domain resolver."""

        projectors = {"before": state_before, "at": state_at, "after": state_after}
        if phase not in projectors:
            raise ValueError("Unsupported world-state phase.")
        return projectors[phase](story_world, moment_id)

    @staticmethod
    def search_manuscript(
        manuscript: dict[str, Any],
        query: str,
        *,
        chapter_ids: Sequence[str] = (),
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        """Search manuscript prose/notes without mixing in world-model chunks."""

        allowed = set(chapter_ids)
        chapters = [
            deepcopy(chapter)
            for chapter in manuscript.get("chapters") or []
            if isinstance(chapter, dict) and (not allowed or chapter.get("id") in allowed)
        ]
        chunks = [
            chunk
            for chunk in build_knowledge({"chapters": chapters}, {})
            if chunk.kind in {"chapter", "chapter-note"}
        ]
        return [chunk.public() for chunk in retrieve(chunks, query, max(0, limit), fallback=False)]


__all__ = ["StoryWorldQueries"]
