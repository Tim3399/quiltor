"""Path-based document adapter for desktop, CLI and server hosts."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from quiltor.infrastructure.platform import system


class LocalDocumentAccess:
    def open_read(self, reference: str | Path):
        return Path(reference).open("rb")

    def write_bytes(self, reference: str | Path, payload: bytes) -> None:
        target = Path(reference)
        target.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def reveal(self, reference: str | Path) -> None:
        system.reveal_in_file_manager(Path(reference))


__all__ = ["LocalDocumentAccess"]
