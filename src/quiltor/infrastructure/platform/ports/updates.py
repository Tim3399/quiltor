"""Application update capability supplied by a distribution channel."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class UpdateStatus:
    supported: bool
    available: bool = False
    version: str = ""
    release_notes_url: str = ""


@runtime_checkable
class UpdateProvider(Protocol):
    def check(self) -> UpdateStatus: ...

    def install(self) -> None: ...


__all__ = ["UpdateProvider", "UpdateStatus"]
