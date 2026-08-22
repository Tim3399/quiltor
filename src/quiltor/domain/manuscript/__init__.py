"""Runtime-independent manuscript semantics shared across application boundaries."""

from .text_offsets import utf16_length, utf16_offsets_to_indices, utf16_span

__all__ = ["utf16_length", "utf16_offsets_to_indices", "utf16_span"]
