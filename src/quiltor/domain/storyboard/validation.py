"""Public Storyboard validation entry point.

The plural alias matches the revisioned document kind while the longer name
states explicitly what the predicate validates.
"""

from __future__ import annotations

from typing import Any

from quiltor.domain.storyboard.model import valid_storyboard_document


def valid_storyboards(value: Any) -> bool:
    return valid_storyboard_document(value)


__all__ = ["valid_storyboard_document", "valid_storyboards"]
