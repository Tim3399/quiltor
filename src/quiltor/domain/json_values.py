# pyright: strict
"""Narrowing of decoded JSON values, the one place in domain and application that casts.

Data that crossed a JSON boundary arrives as `object`. `isinstance(value, dict)` narrows it
only to `dict[Unknown, Unknown]`, which strict type checking rejects, and the usual way out
-- `cast` or `Any` -- turns the check off for everything downstream.

`as_object` and `as_array` do the check and the narrowing together. The `cast` below is safe
because it follows the runtime test: JSON object keys are strings, so an object whose keys
are not all `str` is refused here rather than trusted. Nested values stay `object` and are
narrowed in turn where they are read.

Rule: no `cast` anywhere else in `quiltor.domain` or `quiltor.application`. Needing one means
a value should go through `as_object` or `as_array` instead.
"""

from __future__ import annotations

from typing import cast

type JsonObject = dict[str, object]


def as_object(value: object) -> JsonObject | None:
    """The value itself as a `JsonObject`, or None if it is not a dict with only str keys."""

    if not isinstance(value, dict):
        return None
    entries = cast("dict[object, object]", value)
    if not all(isinstance(key, str) for key in entries):
        return None
    return cast("JsonObject", value)


def as_array(value: object) -> list[object] | None:
    """The value itself as a list of unnarrowed items, or None if it is not a list."""

    if not isinstance(value, list):
        return None
    return cast("list[object]", value)


__all__ = ["JsonObject", "as_array", "as_object"]
