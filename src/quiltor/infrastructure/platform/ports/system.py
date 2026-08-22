"""Low-level operating-system primitives used by concrete host adapters."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from quiltor.infrastructure.platform.ports.directories import AppDirectories


@runtime_checkable
class SystemAdapter(Protocol):
    TRAY_SUPPORTS_BACKGROUND_THREAD: bool

    def app_directories(self) -> AppDirectories: ...

    def reveal_in_file_manager(self, path: Path) -> None: ...

    def spawn_flags(self) -> int: ...

    def bind_child_lifetime(self, process: object) -> None: ...

    def executable_name(self, stem: str) -> str: ...

    def strip_quarantine(self, path: Path) -> None: ...

    def is_apple_silicon(self) -> bool: ...

    def in_os_app_package(self) -> bool: ...

    def os_name(self) -> str: ...

    def machine_arch(self) -> str: ...


__all__ = ["SystemAdapter"]
