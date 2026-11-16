"""Native process lifecycle adapter."""

from __future__ import annotations

import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import IO, Any

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
        env: Mapping[str, str] | None = None,
    ) -> subprocess.Popen:
        process = subprocess.Popen(
            list(argv),
            cwd=cwd,
            stdout=stdout,
            stderr=stderr,
            text=text,
            env=dict(env) if env is not None else None,
            creationflags=system.spawn_flags(),
        )
        system.bind_child_lifetime(process)
        return process

    def remove_download_quarantine(self, path: Path) -> None:
        system.strip_quarantine(path)


__all__ = ["NativeProcessSupervisor"]
