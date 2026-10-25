"""Narrow an optional result in a test, failing the way assertIsNotNone would.

Store lookups return `T | None`; a test that expects the record to exist reads it
straight away. `present(...)` states that expectation once and gives the checker `T`.
"""

from __future__ import annotations


def present[T](value: T | None) -> T:
    if value is None:
        raise AssertionError("expected a value, got None")
    return value
