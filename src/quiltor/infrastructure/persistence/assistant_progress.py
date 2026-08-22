"""Durable, tenant-scoped assistant batch progress."""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

PROGRESS_TTL_SECONDS = 300


class SQLiteAssistantProgressStore:
    def __init__(
        self,
        path: Path,
        *,
        clock: Callable[[], float] = time.time,
        ttl_seconds: int = PROGRESS_TTL_SECONDS,
    ) -> None:
        self.path = path
        self._clock = clock
        self._ttl = ttl_seconds
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS assistant_progress (
                  owner_sub TEXT NOT NULL,
                  world_id TEXT NOT NULL,
                  progress_id TEXT NOT NULL,
                  total INTEGER NOT NULL,
                  done INTEGER NOT NULL,
                  label_key TEXT,
                  label_params_json TEXT,
                  started_at REAL NOT NULL,
                  updated_at REAL NOT NULL,
                  PRIMARY KEY(owner_sub, world_id, progress_id)
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _scope(owner_sub: str, world_id: str, progress_id: str) -> None:
        if not owner_sub or not world_id or not progress_id or len(progress_id) > 64:
            raise ValueError("Invalid assistant progress scope.")

    def _prune(self, connection: sqlite3.Connection, now: float) -> None:
        connection.execute(
            "DELETE FROM assistant_progress WHERE updated_at < ?", (now - self._ttl,)
        )

    def start(self, owner_sub: str, world_id: str, progress_id: str, total: int) -> None:
        self._scope(owner_sub, world_id, progress_id)
        now = self._clock()
        with self._connection() as connection:
            self._prune(connection, now)
            connection.execute(
                """
                INSERT INTO assistant_progress(
                  owner_sub, world_id, progress_id, total, done,
                  label_key, label_params_json, started_at, updated_at
                ) VALUES(?,?,?,?,0,NULL,NULL,?,?)
                ON CONFLICT(owner_sub, world_id, progress_id) DO UPDATE SET
                  total=excluded.total, done=0, label_key=NULL,
                  label_params_json=NULL, started_at=excluded.started_at,
                  updated_at=excluded.updated_at
                """,
                (owner_sub, world_id, progress_id, max(0, total), now, now),
            )

    def update(
        self,
        owner_sub: str,
        world_id: str,
        progress_id: str,
        done: int,
        label_key: str,
        label_params: dict[str, Any],
    ) -> None:
        self._scope(owner_sub, world_id, progress_id)
        now = self._clock()
        encoded = json.dumps(label_params, ensure_ascii=False, separators=(",", ":"))
        with self._connection() as connection:
            self._prune(connection, now)
            connection.execute(
                """
                UPDATE assistant_progress
                SET done=?, label_key=?, label_params_json=?, updated_at=?
                WHERE owner_sub=? AND world_id=? AND progress_id=?
                """,
                (done, label_key, encoded, now, owner_sub, world_id, progress_id),
            )

    def finish(self, owner_sub: str, world_id: str, progress_id: str) -> None:
        self._scope(owner_sub, world_id, progress_id)
        with self._connection() as connection:
            connection.execute(
                """
                UPDATE assistant_progress SET updated_at=?
                WHERE owner_sub=? AND world_id=? AND progress_id=?
                """,
                (self._clock(), owner_sub, world_id, progress_id),
            )

    def read(self, owner_sub: str, world_id: str, progress_id: str) -> dict[str, Any] | None:
        self._scope(owner_sub, world_id, progress_id)
        now = self._clock()
        with self._connection() as connection:
            self._prune(connection, now)
            row = connection.execute(
                """
                SELECT * FROM assistant_progress
                WHERE owner_sub=? AND world_id=? AND progress_id=?
                """,
                (owner_sub, world_id, progress_id),
            ).fetchone()
        if row is None:
            return None
        params = json.loads(row["label_params_json"]) if row["label_params_json"] else None
        return {
            "total": row["total"],
            "done": row["done"],
            "labelKey": row["label_key"],
            "labelParams": params,
            "startedAt": row["started_at"],
            "updatedAt": row["updated_at"],
        }


__all__ = ["PROGRESS_TTL_SECONDS", "SQLiteAssistantProgressStore"]
