"""Bounded in-memory token-count cache adapter."""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from collections.abc import Callable


class BoundedTokenCountCache:
    def __init__(self, max_bytes: int = 4 * 1024 * 1024) -> None:
        self.max_bytes = max_bytes
        self._bytes = 0
        self._values: OrderedDict[str, tuple[int, int]] = OrderedDict()
        self._identity = ""
        self._hits = 0
        self._misses = 0
        self._lock = threading.Lock()

    def count(self, identity: str, text: str, counter: Callable[[str], int]) -> int:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        with self._lock:
            if identity != self._identity:
                self._values.clear()
                self._bytes = 0
                self._identity = identity
                self._hits = 0
                self._misses = 0
            if digest in self._values:
                self._hits += 1
                value = self._values.pop(digest)
                self._values[digest] = value
                return value[0]
        tokens = counter(text)
        size = len(text.encode("utf-8")) + 96
        with self._lock:
            existing = self._values.pop(digest, None)
            if existing is not None:
                self._bytes -= existing[1]
            self._misses += 1
            self._values[digest] = (tokens, size)
            self._bytes += size
            while self._bytes > self.max_bytes and self._values:
                _, (_, removed) = self._values.popitem(last=False)
                self._bytes -= removed
        return tokens

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {
                "hits": self._hits,
                "misses": self._misses,
                "entries": len(self._values),
                "bytes": self._bytes,
            }


__all__ = ["BoundedTokenCountCache"]
