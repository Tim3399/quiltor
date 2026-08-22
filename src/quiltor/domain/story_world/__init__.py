"""Story-world validation, knowledge, entity resolution and chronology."""

from quiltor.domain.story_world.entity_resolution import (
    ENTITY_ALIAS_NORMALIZATION_V1,
    ResolutionCandidate,
    ResolutionResult,
    ResolutionStatus,
    edit_budget,
    name_distance,
    normalize_entity_name,
    resolve_entity,
)

__all__ = [
    "ENTITY_ALIAS_NORMALIZATION_V1",
    "ResolutionCandidate",
    "ResolutionResult",
    "ResolutionStatus",
    "edit_budget",
    "name_distance",
    "normalize_entity_name",
    "resolve_entity",
]
