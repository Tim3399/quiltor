"""Canonical figure-profile fields and legacy compatibility helpers."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Any


LEGACY_PROFILE_FIELDS: tuple[tuple[str, str], ...] = (
    ("alter", "Alter"),
    ("rolle", "Rolle in der Geschichte"),
    ("aussehen", "Aussehen"),
    ("herkunft", "Herkunft & Vorgeschichte"),
    ("stimme", "Stimme & Sprechweise"),
)


def legacy_profile_field_id(owner_id: str, key: str) -> str:
    return f"profile-field:{owner_id}:legacy:{key}"


def legacy_extra_field_id(owner_id: str, position: int) -> str:
    return f"profile-field:{owner_id}:extra:{position}"


def normalize_profile(profile: Mapping[str, Any] | None, owner_id: str) -> dict[str, Any]:
    """Return a detached notes-first profile while accepting every pre-v10 shape.

    A present ``fields`` collection is authoritative. Otherwise the five old
    fixed values and ``extra`` rows are projected into the same canonical list.
    Invalid legacy values are deliberately retained so contract validation can
    still reject them instead of silently repairing untrusted input.
    """

    source = profile or {}
    legacy_keys = {key for key, _ in LEGACY_PROFILE_FIELDS}
    canonical = {
        key: deepcopy(value)
        for key, value in source.items()
        if key not in {"fields", "extra", *legacy_keys}
    }

    if "fields" in source:
        canonical["fields"] = deepcopy(source["fields"])
        canonical.update(
            {
                key: deepcopy(source[key])
                for key in legacy_keys
                if key in source and not isinstance(source[key], str)
            }
        )
        if "extra" in source:
            extras = source["extra"]
            extras_are_valid = isinstance(extras, list) and all(
                isinstance(field, Mapping)
                and isinstance(field.get("k"), str)
                and isinstance(field.get("v"), str)
                for field in extras
            )
            if not extras_are_valid:
                canonical["extra"] = deepcopy(extras)
        return canonical

    projected: list[dict[str, Any]] = []
    invalid_legacy: dict[str, Any] = {}
    for key, label in LEGACY_PROFILE_FIELDS:
        if key not in source:
            continue
        value = source[key]
        if not isinstance(value, str):
            invalid_legacy[key] = deepcopy(value)
        elif value:
            projected.append(
                {
                    "id": legacy_profile_field_id(owner_id, key),
                    "key": label,
                    "value": value,
                }
            )

    if "extra" in source:
        extras = source["extra"]
        if not isinstance(extras, list):
            canonical["extra"] = deepcopy(extras)
        else:
            for position, field in enumerate(extras):
                if not isinstance(field, Mapping):
                    canonical["extra"] = deepcopy(extras)
                    break
                key = field.get("k")
                value = field.get("v")
                if not isinstance(key, str) or not isinstance(value, str):
                    canonical["extra"] = deepcopy(extras)
                    break
                projected.append(
                    {
                        **deepcopy(dict(field)),
                        "id": legacy_extra_field_id(owner_id, position),
                        "key": key,
                        "value": value,
                    }
                )
                projected[-1].pop("k", None)
                projected[-1].pop("v", None)

    canonical.update(invalid_legacy)
    canonical["fields"] = projected
    return canonical


__all__ = [
    "LEGACY_PROFILE_FIELDS",
    "legacy_extra_field_id",
    "legacy_profile_field_id",
    "normalize_profile",
]
