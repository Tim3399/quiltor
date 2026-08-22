"""Small, shared observation helper for application use-case boundaries."""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from quiltor.application.observability import Metrics, StructuredLogger


class UseCaseObserver:
    """Record bounded use-case outcomes without identifiers or filesystem paths."""

    def __init__(self, logger: StructuredLogger, metrics: Metrics) -> None:
        self._logger = logger
        self._metrics = metrics

    @contextmanager
    def observe(self, component: str, operation: str) -> Iterator[None]:
        started = time.monotonic()
        try:
            yield
        except Exception as exc:
            error_type = type(exc).__name__
            self._metrics.increment(
                "application_operations_total",
                component=component,
                operation=operation,
                outcome="failure",
                error_type=error_type,
            )
            self._logger.event(
                "warning",
                f"{component}.operation_failed",
                operation=operation,
                error_type=error_type,
            )
            raise
        else:
            self._metrics.increment(
                "application_operations_total",
                component=component,
                operation=operation,
                outcome="success",
            )
        finally:
            self._metrics.observe(
                "application_operation_duration_seconds",
                time.monotonic() - started,
                component=component,
                operation=operation,
            )


__all__ = ["UseCaseObserver"]
