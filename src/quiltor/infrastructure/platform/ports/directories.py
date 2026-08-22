"""Filesystem locations supplied by a Quiltor host.

Product code must not infer these paths from an operating system.  A desktop
host, a Store container and a server may run on the same OS while having very
different writable locations.  Hosts therefore pass around this small value
object instead of a generic ``home`` directory.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class AppDirectories:
    """The six classes of writable application files.

    ``data`` is durable user content. ``config`` is small user configuration.
    ``cache`` may be deleted at any time. ``models`` contains large,
    re-downloadable model weights. ``logs`` is diagnostic output and ``temp``
    is process-scoped scratch space.  Keeping the fields distinct prevents a
    future mobile/container host from having to reverse-engineer one overloaded
    directory.
    """

    data: Path
    config: Path
    cache: Path
    models: Path
    logs: Path
    temp: Path

    def ensure(self) -> "AppDirectories":
        for directory in (
            self.data,
            self.config,
            self.cache,
            self.models,
            self.logs,
            self.temp,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        return self


__all__ = ["AppDirectories"]
