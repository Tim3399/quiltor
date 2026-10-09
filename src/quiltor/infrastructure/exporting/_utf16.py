"""Pure UTF-16 offset primitives shared by manuscript exporters."""

from __future__ import annotations


def _utf16_len(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _utf16_boundary(encoded: bytes, offset: int) -> bool:
    if offset <= 0 or offset >= len(encoded) // 2:
        return True
    previous = int.from_bytes(encoded[(offset - 1) * 2 : offset * 2], "little")
    current = int.from_bytes(encoded[offset * 2 : (offset + 1) * 2], "little")
    return not (0xD800 <= previous <= 0xDBFF and 0xDC00 <= current <= 0xDFFF)


def _python_indexes(value: str, wanted: set[int]) -> dict[int, int]:
    result = {}
    offset = 0
    for index, character in enumerate(value):
        if offset in wanted:
            result[offset] = index
        offset += 2 if ord(character) > 0xFFFF else 1
    if offset in wanted:
        result[offset] = len(value)
    return result
