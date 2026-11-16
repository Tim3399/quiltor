"""Context-owned reads over a world's local version history."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from quiltor.application.history.ports import HistoryReader
from quiltor.application.history.types import HistoryContext


class HistoryUseCases:
    def __init__(self, history: HistoryReader, sanitize_filename: Callable[[str], str]) -> None:
        self._history = history
        self._sanitize_filename = sanitize_filename

    def entries(self, context: HistoryContext) -> list[dict[str, Any]]:
        return self._history.history(context)

    def diff(
        self,
        context: HistoryContext,
        ref: str,
        *,
        all_files: bool,
        mode: str,
    ) -> dict[str, Any]:
        return self._history.diff(
            context,
            ref,
            text_only=not all_files,
            word_diff=mode == "word",
        )

    def chapter_text(
        self,
        context: HistoryContext,
        ref: str,
        chapter_index: int,
        title: str,
    ) -> dict[str, Any]:
        return self._history.chapter_version(
            context,
            ref,
            chapter_index,
            self._sanitize_filename(title),
        )

    def chapter_comparison(
        self,
        context: HistoryContext,
        ref: str,
        chapter_id: str,
    ) -> dict[str, Any]:
        return self._history.chapter_comparison(context, ref, chapter_id)

    def chapter_timeline(
        self,
        context: HistoryContext,
        chapter_id: str,
        *,
        limit: int,
        before: str,
    ) -> dict[str, Any]:
        return self._history.chapter_timeline(context, chapter_id, limit, before)


__all__ = ["HistoryUseCases"]
