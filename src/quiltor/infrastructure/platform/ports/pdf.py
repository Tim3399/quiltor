"""PDF rendering capability supplied by a host."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class PdfRenderer(Protocol):
    def __call__(self, url: str, timeout: int = 90) -> bytes:
        """Render ``url`` to PDF bytes or raise a user-facing error."""


__all__ = ["PdfRenderer"]
