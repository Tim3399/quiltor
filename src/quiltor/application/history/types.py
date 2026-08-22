"""Values required by the read-only version-history boundary."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class HistoryContext(Protocol):
    """Structural world context accepted by history adapters.

    The backup and history slices may share one runtime value without either
    application slice importing the other's port or concrete data class.
    """

    root: Path
    database: Path
    manuscripts: Path
    profiles: Path
    title: str


__all__ = ["HistoryContext"]
