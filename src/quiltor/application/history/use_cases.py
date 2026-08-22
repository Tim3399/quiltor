"""Context-owned reads over a world's local version history."""

from __future__ import annotations

from typing import Any, Callable

from quiltor.application.history.ports import HistoryReader
from quiltor.application.history.types import HistoryContext


class HistoryUseCases:
    def __init__(self, history: HistoryReader, sanitize_filename: Callable[[str], str]) -> None:
        self._history = history
        self._sanitize_filename = sanitize_filename

    def entries(self, context: HistoryContext) -> list[dict[str, str]]:
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


__all__ = ["HistoryUseCases"]
