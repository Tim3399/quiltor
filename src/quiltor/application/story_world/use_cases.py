"""Retrieval, structure, and validation of story-world knowledge."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from quiltor.domain.story_world.entity_resolution import resolve_entity
from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.modules.assistant.audit import validate_world


class StoryWorldUseCases:
    @staticmethod
    def knowledge_chunk_count(manuscript: dict[str, Any], story_world: dict[str, Any]) -> int:
        return len(build_knowledge(manuscript, story_world))

    @staticmethod
    def search(
        manuscript: dict[str, Any],
        story_world: dict[str, Any],
        query: str,
        limit: int = 14,
    ) -> list[dict[str, Any]]:
        return [
            chunk.public()
            for chunk in retrieve(build_knowledge(manuscript, story_world), query, limit)
        ]

    @staticmethod
    def resolve_entity(
        story_world: dict[str, Any],
        mention: str,
        *,
        entity_type: str | None = None,
        context_ids: Sequence[str] = (),
        vocabulary: Sequence[str] = (),
    ) -> dict[str, Any]:
        """Expose the shared resolver as a transport-neutral application operation."""

        result = resolve_entity(
            story_world,
            mention,
            entity_type=entity_type,
            context_ids=context_ids,
            vocabulary=vocabulary,
        )
        return {
            "status": result.status,
            "mention": result.mention,
            "resolvedId": result.resolved_id,
            "candidates": [
                {
                    "elementId": candidate.element_id,
                    "score": candidate.score,
                    "reasons": list(candidate.reasons),
                }
                for candidate in result.candidates
            ],
        }

    @staticmethod
    def structure(story_world: dict[str, Any]) -> dict[str, Any]:
        return {
            "nodes": story_world.get("nodes", []),
            "edges": story_world.get("edges", []),
            "timeline": story_world.get("timeline", []),
            "presence": story_world.get("presence", []),
        }

    @staticmethod
    def validate(story_world: dict[str, Any]) -> dict[str, Any]:
        return validate_world(story_world)


__all__ = ["StoryWorldUseCases"]
