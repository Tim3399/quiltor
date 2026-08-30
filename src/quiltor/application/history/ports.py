"""Read-only version-history capability required by history use cases."""

from __future__ import annotations

from typing import Any, Protocol

from quiltor.application.history.types import HistoryContext


class HistoryReader(Protocol):
    def history(self, context: HistoryContext, limit: int = 40) -> list[dict[str, str]]: ...

    def diff(
        self,
        context: HistoryContext,
        ref: str,
        text_only: bool = True,
        word_diff: bool = True,
    ) -> dict[str, Any]: ...

    def chapter_version(
        self,
        context: HistoryContext,
        ref: str,
        chapter_index: int,
        filename: str,
    ) -> dict[str, Any]: ...

    def chapter_comparison(
        self,
        context: HistoryContext,
        ref: str,
        chapter_id: str,
    ) -> dict[str, Any]: ...


__all__ = ["HistoryReader"]
