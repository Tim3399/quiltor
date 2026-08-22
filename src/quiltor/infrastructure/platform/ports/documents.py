"""User-authorised document access.

Native mobile/store hosts can implement these operations with persistent URI
permissions or security-scoped bookmarks; ordinary desktop/server hosts use
paths.  Feature code need not know which representation granted access.
"""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO, Protocol, runtime_checkable


@runtime_checkable
class DocumentAccess(Protocol):
    def open_read(self, reference: str | Path) -> BinaryIO: ...

    def write_bytes(self, reference: str | Path, payload: bytes) -> None: ...

    def reveal(self, reference: str | Path) -> None: ...


__all__ = ["DocumentAccess"]
