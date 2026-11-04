"""Dependency-free structured logging, diagnostics and metrics adapters."""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
import threading
import time
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, TextIO

from quiltor.infrastructure.observability import schema


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
            **getattr(record, "structured_fields", {}),
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


_OWNED_HANDLER = "_quiltor_structured_handler"
_LOG_FILE_MAX_BYTES = 10 * 1024 * 1024
_LOG_FILE_BACKUPS = 5


def _filtered(name: str, fields: Mapping[str, Any]) -> dict[str, Any]:
    """Only the fields EVENTS allows for `name`, each through its FIELD_RULES rule."""
    allowed = schema.EVENTS[name]
    kept: dict[str, Any] = {}
    dropped: list[str] = []
    for key, value in fields.items():
        if key not in allowed:
            dropped.append(key)
            continue
        if value is None:
            continue
        checked = schema.FIELD_RULES[key](value)
        kept[key] = schema.INVALID if checked is None else checked
    if dropped:
        kept["dropped_fields"] = sorted(dropped)
    return kept


class StdlibStructuredLogger:
    """JSON lines on the process-wide `quiltor` logger.

    Constructing one configures that logger: its level, and the handlers this class
    owns are replaced, so a second application in the same process is not left
    writing through the first one's stream. Handlers someone else attached -- a test
    capturing the log -- stay.
    """

    def __init__(
        self,
        name: str = "quiltor",
        stream: TextIO | None = None,
        *,
        level: str = "INFO",
        file: str | os.PathLike[str] | None = None,
    ) -> None:
        self._logger = logging.getLogger(name)
        self._logger.setLevel(getattr(logging, level.upper()))
        self._logger.propagate = False
        for handler in list(self._logger.handlers):
            if getattr(handler, _OWNED_HANDLER, False):
                self._logger.removeHandler(handler)
                handler.close()  # a StreamHandler leaves its stream open
        handlers: list[logging.Handler] = [logging.StreamHandler(stream or sys.stderr)]
        if file:
            handlers.append(
                logging.handlers.RotatingFileHandler(
                    file,
                    maxBytes=_LOG_FILE_MAX_BYTES,
                    backupCount=_LOG_FILE_BACKUPS,
                    encoding="utf-8",
                )
            )
        for handler in handlers:
            setattr(handler, _OWNED_HANDLER, True)
            handler.setFormatter(_JsonFormatter())
            self._logger.addHandler(handler)

    def event(self, level: str, name: str, **fields: Any) -> None:
        numeric = getattr(logging, level.upper(), logging.INFO)
        if not self._logger.isEnabledFor(numeric):
            return
        request = schema.current_request.get()
        if request is not None and "request_id" not in fields:
            fields = {"request_id": request.request_id, **fields}
        if name in schema.EVENTS:
            fields = _filtered(name, fields)
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
