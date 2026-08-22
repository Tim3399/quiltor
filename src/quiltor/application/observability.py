"""Small observability contracts shared by hosts and use cases."""

from __future__ import annotations

from typing import Any, Mapping, Protocol, runtime_checkable


@runtime_checkable
class StructuredLogger(Protocol):
    def event(self, level: str, name: str, **fields: Any) -> None: ...


@runtime_checkable
class Diagnostics(Protocol):
    def snapshot(self) -> Mapping[str, Any]: ...


@runtime_checkable
class Metrics(Protocol):
    def increment(self, name: str, value: int = 1, **labels: str) -> None: ...
    def observe(self, name: str, value: float, **labels: str) -> None: ...
    def snapshot(self) -> Mapping[str, Any]: ...


__all__ = ["Diagnostics", "Metrics", "StructuredLogger"]
