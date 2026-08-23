"""Retrieval, structure, and validation of story-world knowledge."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any

from quiltor.domain.story_world.entity_resolution import resolve_entity
from quiltor.domain.story_world.integrity import validate_world
from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.domain.story_world.resolve_before_create import (
    EnsureDecision,
    build_resolution_context,
)
from quiltor.domain.story_world.resolve_before_create import (
    ensure_alias as decide_alias,
)
from quiltor.domain.story_world.resolve_before_create import (
    ensure_element as decide_element,
)
from quiltor.domain.story_world.resolve_before_create import (
    ensure_presence as decide_presence,
)
from quiltor.domain.story_world.resolve_before_create import (
    ensure_relationship as decide_relationship,
)
from quiltor.domain.story_world.resolve_before_create import (
    ensure_timeline_moment as decide_timeline_moment,
)


def _public_decision(decision: EnsureDecision) -> dict[str, Any]:
    """Serialize a receipt without turning it into reusable server authority."""

    proof = decision.proof
    return {
        "operation": decision.operation,
        "outcome": decision.outcome,
        "operationSatisfied": decision.operation_satisfied,
        "resolvedId": decision.resolved_id,
        "canonical": deepcopy(decision.canonical),
        "proof": {
            "checked": proof.checked,
            "status": proof.status,
            "mention": proof.mention,
            "candidateIds": list(proof.candidate_ids),
            "worldRevision": proof.world_revision,
        },
    }


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
    def ensure_element(
        story_world: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        world_revision: int,
        staged_elements: Sequence[Mapping[str, Any]] = (),
        context_ids: Sequence[str] = (),
        vocabulary: Sequence[str] = (),
    ) -> dict[str, Any]:
        context = build_resolution_context(
            story_world,
            world_revision,
            staged_elements=staged_elements,
        )
        return _public_decision(
            decide_element(
                context,
                candidate,
                context_ids=context_ids,
                vocabulary=vocabulary,
            )
        )

    @staticmethod
    def ensure_relationship(
        story_world: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        world_revision: int,
        staged_elements: Sequence[Mapping[str, Any]] = (),
        staged_relationships: Sequence[Mapping[str, Any]] = (),
        context_ids: Sequence[str] = (),
        vocabulary: Sequence[str] = (),
    ) -> dict[str, Any]:
        context = build_resolution_context(
            story_world,
            world_revision,
            staged_elements=staged_elements,
            staged_relationships=staged_relationships,
        )
        return _public_decision(
            decide_relationship(
                context,
                candidate,
                context_ids=context_ids,
                vocabulary=vocabulary,
            )
        )

    @staticmethod
    def ensure_timeline_moment(
        story_world: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        world_revision: int,
        staged_moments: Sequence[Mapping[str, Any]] = (),
    ) -> dict[str, Any]:
        context = build_resolution_context(
            story_world,
            world_revision,
            staged_moments=staged_moments,
        )
        return _public_decision(decide_timeline_moment(context, candidate))

    @staticmethod
    def ensure_presence(
        story_world: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        world_revision: int,
        staged_elements: Sequence[Mapping[str, Any]] = (),
        staged_moments: Sequence[Mapping[str, Any]] = (),
        staged_presence: Sequence[Mapping[str, Any]] = (),
        context_ids: Sequence[str] = (),
        vocabulary: Sequence[str] = (),
    ) -> dict[str, Any]:
        context = build_resolution_context(
            story_world,
            world_revision,
            staged_elements=staged_elements,
            staged_moments=staged_moments,
            staged_presence=staged_presence,
        )
        return _public_decision(
            decide_presence(
                context,
                candidate,
                context_ids=context_ids,
                vocabulary=vocabulary,
            )
        )

    @staticmethod
    def ensure_alias(
        story_world: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        world_revision: int,
        staged_elements: Sequence[Mapping[str, Any]] = (),
        context_ids: Sequence[str] = (),
        vocabulary: Sequence[str] = (),
    ) -> dict[str, Any]:
        context = build_resolution_context(
            story_world,
            world_revision,
            staged_elements=staged_elements,
        )
        return _public_decision(
            decide_alias(
                context,
                candidate,
                context_ids=context_ids,
                vocabulary=vocabulary,
            )
        )

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
