"""Runtime-independent manuscript semantics shared across application boundaries."""

from quiltor.domain.text_offsets import utf16_length, utf16_offsets_to_indices, utf16_span

from .story_time import (
    MAX_STORY_TIME_ID_LENGTH,
    StoryTimeAnchorIssue,
    story_time_anchor_issue,
    valid_story_time_reference,
)
from .tree import (
    ManuscriptTreeError,
    breadcrumb_for_chapter,
    delete_folder,
    descendants,
    flat_structure,
    flatten_tree,
    move_item,
    normalize_positions,
    structure_or_flat,
    validate_tree,
)

__all__ = [
    "MAX_STORY_TIME_ID_LENGTH",
    "ManuscriptTreeError",
    "StoryTimeAnchorIssue",
    "breadcrumb_for_chapter",
    "delete_folder",
    "descendants",
    "flat_structure",
    "flatten_tree",
    "move_item",
    "normalize_positions",
    "story_time_anchor_issue",
    "structure_or_flat",
    "utf16_length",
    "utf16_offsets_to_indices",
    "utf16_span",
    "valid_story_time_reference",
    "validate_tree",
]
