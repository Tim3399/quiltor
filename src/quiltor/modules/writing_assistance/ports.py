"""Persistence and installation capabilities required by writing assistance."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class WritingAssistanceRepository(Protocol):
    def version(self) -> str | None: ...

    def coverage(self) -> str | None:
        """ "core" (built-in starter set) or "full" (upstream import); None
        when nothing is installed."""
        ...

    def lookup(self, language: str, mode: str, query: str) -> list[dict]: ...


@runtime_checkable
class WritingAssistanceInstaller(Protocol):
    def install(self) -> dict: ...


__all__ = ["WritingAssistanceInstaller", "WritingAssistanceRepository"]
