"""Owning SQLite connection helpers with durable local settings."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import config


def connect(path: Path | None = None, *, must_exist: bool = False) -> sqlite3.Connection:
    """Open a database connection whose lifetime is owned by the caller.

    `must_exist` refuses to make the file: sqlite3 otherwise creates an empty database where
    there is none, which is how a world that was being removed came back as an orphan.
    """

    database = config.DB if path is None else path
    if must_exist:
        uri = f"{Path(database).resolve().as_uri()}?mode=rw"
        conn = sqlite3.connect(uri, timeout=15, uri=True)
    else:
        conn = sqlite3.connect(database, timeout=15)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = FULL")
    except BaseException:
        conn.close()
        raise
    return conn


@contextmanager
def connection(
    path: Path | None = None, *, must_exist: bool = False
) -> Iterator[sqlite3.Connection]:
    """Provide a transaction and always release its underlying file handle."""

    conn = connect(path, must_exist=must_exist)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


__all__ = ["connect", "connection"]
