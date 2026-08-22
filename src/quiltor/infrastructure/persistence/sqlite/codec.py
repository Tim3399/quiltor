"""Lossless JSON extension-field encoding shared by SQLite aggregates."""

from __future__ import annotations

import json
from typing import Any


def encode_extra(source: dict[str, Any], known: set[str]) -> str:
    return json.dumps(
        {key: value for key, value in source.items() if key not in known},
        ensure_ascii=False,
    )


def decode_extra(value: str) -> dict[str, Any]:
    try:
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except ValueError:
        return {}


__all__ = ["decode_extra", "encode_extra"]
