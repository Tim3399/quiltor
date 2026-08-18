"""What a grammar backend has to provide.

There are two, and which one is used is an edition decision rather than a user
preference -- see this package's __init__.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class GrammarBackend(Protocol):
    def status(self) -> dict:
        """Serialised straight to the frontend by /api/language/status. Must
        always answer, including when the backend cannot do anything: the UI
        decides what to show from this, so an exception here would take the
        whole status route down with it."""

    def install(self) -> dict:
        """Set the backend up, or raise explaining why that is not possible."""

    def check(self, language: str, text: str, custom_words: list[str]) -> dict:
        """Proofread `text`, or raise."""

    def close(self) -> None:
        """Release anything held. Must tolerate being called when nothing was
        ever started."""
