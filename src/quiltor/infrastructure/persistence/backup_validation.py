"""Validate the complete logical document set loaded from a staged backup."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.application.document_wire_v1 import encode_document_v1
from quiltor.domain.manuscript import story_time_anchor_issue
from quiltor.infrastructure.persistence.sqlite import manuscript, story_world, storyboards


def validate_backup_documents(database: Path) -> dict[str, dict[str, Any]]:
    documents = {
        "manuscript": manuscript.load(database),
        "figures": story_world.load(database),
        "storyboards": storyboards.load(database),
    }
    validated = {
        kind: encode_document_v1(kind, payload)["payload"] for kind, payload in documents.items()
    }
    issue = story_time_anchor_issue(validated["manuscript"], validated["figures"])
    if issue is not None:
        raise ValueError(f"Invalid chapter story-time anchor: {issue.reason}")
    return validated


__all__ = ["validate_backup_documents"]
