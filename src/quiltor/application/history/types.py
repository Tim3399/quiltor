"""Values required by the read-only version-history boundary."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class HistoryContext(Protocol):
    """Structural world context accepted by history adapters.

    The backup and history slices may share one runtime value without either
    application slice importing the other's port or concrete data class.
    """

    # Read-only, so the frozen WorldBackupContext dataclass satisfies it.
    @property
    def root(self) -> Path: ...

    @property
    def database(self) -> Path: ...

    @property
    def manuscripts(self) -> Path: ...

    @property
    def profiles(self) -> Path: ...

    @property
    def title(self) -> str: ...


__all__ = ["HistoryContext"]
