"""Dependency-free structured logging, diagnostics and metrics adapters."""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Mapping, TextIO


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
            **getattr(record, "structured_fields", {}),
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


class StdlibStructuredLogger:
    def __init__(self, name: str = "quiltor", stream: TextIO | None = None) -> None:
        self._logger = logging.getLogger(name)
        self._logger.setLevel(logging.INFO)
        self._logger.propagate = False
        if not self._logger.handlers:
            handler = logging.StreamHandler(stream or sys.stderr)
            handler.setFormatter(_JsonFormatter())
            self._logger.addHandler(handler)

    def event(self, level: str, name: str, **fields: Any) -> None:
        numeric = getattr(logging, level.upper(), logging.INFO)
        self._logger.log(numeric, name, extra={"structured_fields": fields})


@dataclass(slots=True)
class RuntimeDiagnostics:
    values: Mapping[str, Any] = field(default_factory=dict)

    def snapshot(self) -> Mapping[str, Any]:
        return dict(self.values)


class InMemoryMetrics:
    """Thread-safe local metrics; a host may export snapshots when appropriate."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: defaultdict[tuple[str, tuple[tuple[str, str], ...]], int] = defaultdict(int)
        # Aggregate in place: request latency volume must not turn diagnostics
        # into an unbounded process-lifetime sample buffer.
        self._observations: dict[
            tuple[str, tuple[tuple[str, str], ...]],
            tuple[int, float, float, float],
        ] = {}

    @staticmethod
    def _key(name: str, labels: Mapping[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
        return name, tuple(sorted(labels.items()))

    def increment(self, name: str, value: int = 1, **labels: str) -> None:
        with self._lock:
            self._counters[self._key(name, labels)] += value

    def observe(self, name: str, value: float, **labels: str) -> None:
        observed = float(value)
        key = self._key(name, labels)
        with self._lock:
            prior = self._observations.get(key)
            if prior is None:
                self._observations[key] = (1, observed, observed, observed)
            else:
                count, total, minimum, maximum = prior
                self._observations[key] = (
                    count + 1,
                    total + observed,
                    min(minimum, observed),
                    max(maximum, observed),
                )

    def snapshot(self) -> Mapping[str, Any]:
        with self._lock:
            counters = [
                {
                    "name": name,
                    "labels": dict(labels),
                    "value": value,
                }
                for (name, labels), value in sorted(self._counters.items())
            ]
            observations = []
            for (name, labels), aggregate in sorted(self._observations.items()):
                count, total, minimum, maximum = aggregate
                observations.append(
                    {
                        "name": name,
                        "labels": dict(labels),
                        "count": count,
                        "sum": total,
                        "minimum": minimum,
                        "maximum": maximum,
                    }
                )
            return {
                "counters": counters,
                "observations": observations,
            }
