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
from quiltor.domain.story_world.integrity import (
    presence_consistency_issues,
    validate_world,
)
from quiltor.domain.story_world.resolve_before_create import (
    EnsureDecision,
    EnsureOperation,
    EnsureOutcome,
    ResolutionProof,
    ResolutionProofStatus,
    StaleResolutionProof,
    WorldResolutionContext,
    build_resolution_context,
    ensure_alias,
    ensure_element,
    ensure_presence,
    ensure_relationship,
    ensure_timeline_moment,
    require_current_world_revision,
)

__all__ = [
    "ENTITY_ALIAS_NORMALIZATION_V1",
    "EnsureDecision",
    "EnsureOperation",
    "EnsureOutcome",
    "ResolutionCandidate",
    "ResolutionProof",
    "ResolutionProofStatus",
    "ResolutionResult",
    "ResolutionStatus",
    "StaleResolutionProof",
    "WorldResolutionContext",
    "build_resolution_context",
    "edit_budget",
    "ensure_alias",
    "ensure_element",
    "ensure_presence",
    "ensure_relationship",
    "ensure_timeline_moment",
    "name_distance",
    "normalize_entity_name",
    "presence_consistency_issues",
    "require_current_world_revision",
    "resolve_entity",
    "validate_world",
]
