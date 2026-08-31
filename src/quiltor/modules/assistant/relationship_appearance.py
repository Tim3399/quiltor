"""Compatibility helpers for relationship appearance in assistant contracts.

The original ``style`` field mixed a visual line pattern, semantic meaning and
colour.  Assistant and MCP outputs use the split v2 fields, while persisted v1
state and older callers can still supply ``style`` during the migration.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

LINE_STYLES = ("solid", "dashed", "dotted")
RELATIONSHIP_KINDS = ("general", "kinship")
EDGE_COLORS = ("auto", "ink", "gold", "rose", "moss", "blue")
LEGACY_STYLES = ("solid", "dashed", "blood", "gold")

_DEFAULT_APPEARANCE: dict[str, str] = {
    "lineStyle": "solid",
    "relationshipKind": "general",
    "color": "auto",
}


def normalize_relationship_appearance(
    value: Mapping[str, Any], *, defaults: bool = False
) -> dict[str, str] | None:
    """Return modern appearance fields or ``None`` for an invalid supplied value.

    Modern fields override their legacy-derived counterpart.  A supplied legacy
    style is interpreted as the complete old presentation, which keeps v1 calls
    deterministic instead of combining old and new meanings accidentally.
    """

    legacy = value.get("style")
    if "style" in value and legacy not in LEGACY_STYLES:
        return None
    if "lineStyle" in value and value.get("lineStyle") not in LINE_STYLES:
        return None
    if (
        "relationshipKind" in value
        and value.get("relationshipKind") not in RELATIONSHIP_KINDS
    ):
        return None
    if "color" in value and value.get("color") not in EDGE_COLORS:
        return None

    result: dict[str, str] = dict(_DEFAULT_APPEARANCE) if defaults else {}
    if legacy in LEGACY_STYLES:
        result.update(
            {
                "lineStyle": "dashed" if legacy == "dashed" else "solid",
                "relationshipKind": "kinship" if legacy == "blood" else "general",
                "color": "gold" if legacy == "gold" else "auto",
            }
        )
    for key in ("lineStyle", "relationshipKind", "color"):
        if key in value:
            result[key] = str(value[key])
    return result


def apply_relationship_appearance(
    current: Mapping[str, str], value: Mapping[str, Any]
) -> dict[str, str] | None:
    """Apply one modern or legacy state layer to a resolved modern appearance."""

    patch = normalize_relationship_appearance(value)
    if patch is None:
        return None
    return {**current, **patch}


def relationship_appearance_at(value: Mapping[str, Any]) -> dict[str, str] | None:
    """Resolve a base relationship or standalone state to all modern fields."""

    return normalize_relationship_appearance(value, defaults=True)


def legacy_domain_style(value: Mapping[str, Any]) -> str:
    """Project a modern appearance onto the v1 domain resolver's compatibility axis.

    The resolver uses this only for endpoint and duplicate resolution.  Its
    canonical appearance is replaced with the lossless modern fields afterwards.
    """

    appearance = relationship_appearance_at(value) or _DEFAULT_APPEARANCE
    if appearance["relationshipKind"] == "kinship":
        return "blood"
    if appearance["color"] == "gold":
        return "gold"
    if appearance["lineStyle"] == "dashed":
        return "dashed"
    return "solid"


__all__ = [
    "EDGE_COLORS",
    "LEGACY_STYLES",
    "LINE_STYLES",
    "RELATIONSHIP_KINDS",
    "apply_relationship_appearance",
    "legacy_domain_style",
    "normalize_relationship_appearance",
    "relationship_appearance_at",
]
