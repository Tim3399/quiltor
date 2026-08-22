"""Native process lifecycle adapter."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import IO, Any, Sequence

from quiltor.infrastructure.platform import system


class NativeProcessSupervisor:
    def spawn(
        self,
        argv: Sequence[str],
        *,
        cwd: Path | None = None,
        stdout: int | IO[Any] | None = None,
        stderr: int | IO[Any] | None = None,
        text: bool = False,
    ) -> subprocess.Popen:
        process = subprocess.Popen(
            list(argv),
            cwd=cwd,
            stdout=stdout,
            stderr=stderr,
            text=text,
            creationflags=system.spawn_flags(),
        )
        system.bind_child_lifetime(process)
        return process

    def remove_download_quarantine(self, path: Path) -> None:
        system.strip_quarantine(path)


__all__ = ["NativeProcessSupervisor"]
