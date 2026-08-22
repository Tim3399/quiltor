"""External authentication hand-off supplied by a UI host."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class AuthSession(Protocol):
    def open(self, authorization_url: str) -> None:
        """Open a system-owned authentication session for ``authorization_url``."""


__all__ = ["AuthSession"]
