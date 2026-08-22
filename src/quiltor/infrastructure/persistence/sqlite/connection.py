"""Owning SQLite connection helpers with durable local settings."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from quiltor.infrastructure.persistence.sqlite import config


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a database connection whose lifetime is owned by the caller."""

    database = config.DB if path is None else path
    conn = sqlite3.connect(database, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    return conn


@contextmanager
def connection(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Provide a transaction and always release its underlying file handle."""

    conn = connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


__all__ = ["connect", "connection"]
