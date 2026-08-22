"""Update-provider adapters."""

from __future__ import annotations

from quiltor.infrastructure.platform.ports import UpdateStatus


class NoUpdateProvider:
    """Used when updates are owned by a store/package manager."""

    def check(self) -> UpdateStatus:
        return UpdateStatus(supported=False)

    def install(self) -> None:
        raise PermissionError("This distribution manages updates outside Quiltor.")


__all__ = ["NoUpdateProvider"]
