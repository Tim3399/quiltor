"""Child-process lifecycle supplied by the current host."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import IO, Any, Protocol, Sequence, runtime_checkable


@runtime_checkable
class ProcessSupervisor(Protocol):
    def spawn(
        self,
        argv: Sequence[str],
        *,
        cwd: Path | None = None,
        stdout: int | IO[Any] | None = None,
        stderr: int | IO[Any] | None = None,
        text: bool = False,
    ) -> subprocess.Popen: ...

    def remove_download_quarantine(self, path: Path) -> None: ...


__all__ = ["ProcessSupervisor"]
