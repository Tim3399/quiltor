"""Thread-safe, process-local implementation of one-shot render tokens."""

from __future__ import annotations

import secrets
import threading
import time
from collections.abc import Callable

MAX_RENDER_TOKENS = 512


class InMemoryRenderTokenStore:
    def __init__(
        self,
        ttl_seconds: int = 90,
        *,
        capacity: int = MAX_RENDER_TOKENS,
        clock: Callable[[], float] = time.time,
        token_factory: Callable[[int], str] = secrets.token_urlsafe,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._capacity = capacity
        self._clock = clock
        self._token_factory = token_factory
        self._lock = threading.Lock()
        self._tokens: dict[str, tuple[str, float]] = {}

    @property
    def ttl_seconds(self) -> int:
        return self._ttl_seconds

    def issue(self, subject: str) -> str:
        if not subject or len(subject) > 255:
            raise ValueError("Invalid render-token subject.")
        token = self._token_factory(24)
        now = self._clock()
        with self._lock:
            for key in [key for key, (_, expires) in self._tokens.items() if expires < now]:
                self._tokens.pop(key, None)
            if len(self._tokens) >= self._capacity:
                raise RuntimeError("Render-token capacity has been reached.")
            self._tokens[token] = (subject, now + self._ttl_seconds)
        return token

    def redeem(self, token: str) -> str | None:
        with self._lock:
            entry = self._tokens.pop(token, None)
        if entry and entry[1] > self._clock():
            return entry[0]
        return None

    def clear(self) -> None:
        with self._lock:
            self._tokens.clear()

    def expire(self, token: str) -> None:
        """Expire an issued token (used by deterministic adapter tests)."""
        with self._lock:
            entry = self._tokens.get(token)
            if entry is not None:
                self._tokens[token] = (entry[0], self._clock() - 1)


__all__ = ["InMemoryRenderTokenStore", "MAX_RENDER_TOKENS"]
