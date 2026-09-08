"""Explicit PDF capability for hosts that ship no rendering engine."""

from __future__ import annotations

from quiltor.application.errors import PdfExportUnavailable


MESSAGE = (
    "PDF export is unavailable in this Python installation. "
    "Use the desktop app or the self-hosted container image."
)


def render(url: str, timeout: int = 90) -> bytes:
    del url, timeout
    raise PdfExportUnavailable(MESSAGE)


__all__ = ["MESSAGE", "render"]
