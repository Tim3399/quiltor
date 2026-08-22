"""Explicit PDF capability for hosts that ship no rendering engine."""

from __future__ import annotations

from quiltor.application.errors import PdfExportUnavailable


MESSAGE = (
    "Der PDF-Export ist in dieser Python-Installation nicht enthalten. "
    "Nutze die Desktop-App oder das selbst gehostete Container-Image."
)


def render(url: str, timeout: int = 90) -> bytes:
    del url, timeout
    raise PdfExportUnavailable(MESSAGE)


__all__ = ["MESSAGE", "render"]
