# pyright: strict
"""Pure structured story-world queries shared by read-tool transports."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any

from quiltor.domain.json_values import JsonObject, as_array, as_object
from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.domain.story_world.world_state import state_after, state_at, state_before


def _objects(value: object) -> list[JsonObject]:
    """The objects of a decoded JSON list; a missing list is empty, other items are skipped."""

    return [entry for item in as_array(value) or [] if (entry := as_object(item)) is not None]


class StoryWorldQueries:
    @staticmethod
    def get_entity(story_world: Mapping[str, object], element_id: str) -> JsonObject | None:
        """Return one entity by exact canonical id, never by a guessed text match."""

        return next(
            (
                deepcopy(node)
                for node in _objects(story_world.get("nodes"))
                if node.get("id") == element_id
            ),
            None,
        )

    @staticmethod
    def get_relationships(
        story_world: Mapping[str, object],
        element_id: str,
        *,
        other_element_id: str | None = None,
        limit: int = 12,
    ) -> list[JsonObject]:
        """Read a deterministic, bounded set of edges touching an exact entity id."""

        matches = [
            deepcopy(edge)
            for edge in _objects(story_world.get("edges"))
            if element_id in (edge.get("from"), edge.get("to"))
            and (other_element_id is None or other_element_id in (edge.get("from"), edge.get("to")))
        ]
        return sorted(matches, key=lambda edge: str(edge.get("id", "")))[: max(0, limit)]

    @staticmethod
    def find_timeline_events(
        story_world: Mapping[str, object],
        query: str = "",
        *,
        entity_id: str | None = None,
        limit: int = 12,
    ) -> list[JsonObject]:
        """Find exact structured events, optionally scoped to one involved entity."""

        related_moments: set[str] | None = None
        if entity_id is not None:
            related_moments = {
                died
                for node in _objects(story_world.get("nodes"))
                if node.get("id") == entity_id and isinstance(died := node.get("diedMomentId"), str)
            }
            related_moments.update(
                moment
                for entry in _objects(story_world.get("presence"))
                if entry.get("elementId") == entity_id
                and isinstance(moment := entry.get("momentId"), str)
            )
            for edge in _objects(story_world.get("edges")):
                if entity_id not in (edge.get("from"), edge.get("to")):
                    continue
                related_moments.update(
                    moment
                    for version in _objects(edge.get("versions"))
                    if isinstance(moment := version.get("momentId"), str)
                )

        folded_query = " ".join(query.casefold().split())
        tokens = {token for token in folded_query.split() if len(token) >= 2}
        scored: list[tuple[int, tuple[int, int, int, str], JsonObject]] = []
        for index, item in enumerate(as_array(story_world.get("timeline")) or []):
            moment = as_object(item)
            if moment is None:
                continue
            moment_id = moment.get("id")
            if not isinstance(moment_id, str):
                continue
            if related_moments is not None and moment_id not in related_moments:
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
                moment_id,
            )
            scored.append((phrase_score + token_score, chronological, deepcopy(moment)))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [moment for _score, _order, moment in scored[: max(0, limit)]]

    @staticmethod
    def get_world_state(
        story_world: Mapping[str, object], moment_id: str, *, phase: str = "at"
    ) -> dict[str, Any]:
        """Project the canonical temporal world through the shared domain resolver.

        `dict[str, Any]` is the domain's `WorldState`; see T-19 P3.
        """

        projectors = {"before": state_before, "at": state_at, "after": state_after}
        if phase not in projectors:
            raise ValueError("Unsupported world-state phase.")
        return projectors[phase](story_world, moment_id)

    @staticmethod
    def search_manuscript(
        manuscript: Mapping[str, object],
        query: str,
        *,
        chapter_ids: Sequence[str] = (),
        limit: int = 8,
    ) -> list[JsonObject]:
        """Search manuscript prose/notes without mixing in world-model chunks."""

        allowed = set(chapter_ids)
        chapters = [
            deepcopy(chapter)
            for chapter in _objects(manuscript.get("chapters"))
            if not allowed or chapter.get("id") in allowed
        ]
        chunks = [
            chunk
            for chunk in build_knowledge(
                {"chapters": chapters},
                {},
                [str(chapter.get("id")) for chapter in chapters],
            )
            if chunk.kind in {"chapter", "chapter-note"}
        ]
        return [chunk.public() for chunk in retrieve(chunks, query, max(0, limit), fallback=False)]


__all__ = ["StoryWorldQueries"]
