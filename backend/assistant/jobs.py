"""Persistent, idempotent execution queue for expensive assistant requests.

`AssistantRuntime.complete()` stays synchronous and owns one logical model task:
retrieval, planning, constrained generation, repair, and proposal building. This
module adds the durable execution boundary around that task.

The queue provides four guarantees that the HTTP/UI layer cannot provide on its
own:

* a client-generated idempotency key makes retries of the same logical request
  safe;
* only one assistant inference is allowed to run at a time for this Quiltor data
  directory;
* queued/running work survives a browser reload and is recovered after a server
  restart;
* terminal results are persisted long enough for a reconnecting client to read
  them without resending the prompt.

The queue database is process infrastructure and therefore lives beside, not
inside, the per-world SQLite files. Manuscript/figure state and interaction
history remain world-owned data.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from backend.core import storage
from backend.llm.shared.contract import RuntimeTimeoutError, RuntimeUnavailableError

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
JOB_RETENTION_DAYS = 7

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assistant_jobs (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,
  world_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  progress_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  result_json TEXT,
  error TEXT NOT NULL DEFAULT '',
  error_type TEXT NOT NULL DEFAULT '',
  http_status INTEGER NOT NULL DEFAULT 0,
  interaction_id TEXT NOT NULL DEFAULT '',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(owner_sub, world_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS assistant_jobs_queue
  ON assistant_jobs(status, created_at, id);
CREATE INDEX IF NOT EXISTS assistant_jobs_finished
  ON assistant_jobs(finished_at);

PRAGMA user_version = 1;
"""


class IdempotencyConflict(RuntimeError):
    """One idempotency key was reused for a different logical request."""


InteractionLogger = Callable[..., str]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request_hash(intent: dict[str, Any]) -> str:
    canonical = json.dumps(
        intent,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def classify_assistant_error(exc: Exception) -> str:
    """Turn backend exceptions into stable frontend error codes."""

    if isinstance(exc, RuntimeTimeoutError):
        return "timeout"
    if isinstance(exc, RuntimeUnavailableError):
        return "runtime_unavailable"

    message = str(exc)
    if "Kontextfenster" in message:
        return "context_too_large"
    if "nicht installiert" in message:
        return "runtime_unavailable"
    if "nicht rechtzeitig" in message:
        return "response_truncated"
    if "strukturiert" in message or "gültig" in message:
        return "validation_error"
    return "assistant_error"


def assistant_error_status(exc: Exception) -> int:
    if isinstance(exc, RuntimeTimeoutError):
        return 504
    if isinstance(exc, RuntimeUnavailableError):
        return 503
    return 503


class AssistantJobStore:
    """SQLite persistence and atomic state transitions for assistant jobs."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as conn:
            conn.executescript(SCHEMA)
        self.prune()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = FULL")
        return conn

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    @staticmethod
    def _public(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        result = None
        if row["result_json"]:
            try:
                result = json.loads(row["result_json"])
            except ValueError:
                result = None
        return {
            "id": row["id"],
            "status": row["status"],
            "progressId": row["progress_id"] or None,
            "result": result,
            "error": row["error"],
            "errorType": row["error_type"],
            "httpStatus": row["http_status"] or None,
            "interactionId": row["interaction_id"] or None,
            "cancelRequested": bool(row["cancel_requested"]),
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "finishedAt": row["finished_at"],
        }

    def submit(
        self,
        *,
        owner_sub: str,
        world_id: str,
        idempotency_key: str,
        intent: dict[str, Any],
        execution: dict[str, Any],
        progress_id: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Create or reuse one job atomically.

        The key represents one *user action*, not the prompt text. A fresh key
        therefore always creates a fresh job, even when the question happens to
        equal another in-flight question. Retries reuse the original key and get
        the original job back.
        """

        key = idempotency_key.strip()
        if not key or len(key) > 200:
            raise ValueError("Idempotency-Key must contain between 1 and 200 characters.")

        digest = _request_hash(intent)
        request_json = json.dumps(execution, ensure_ascii=False, separators=(",", ":"))

        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                """
                SELECT * FROM assistant_jobs
                WHERE owner_sub=? AND world_id=? AND idempotency_key=?
                """,
                (owner_sub, world_id, key),
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != digest:
                    raise IdempotencyConflict(
                        "Dieser Idempotency-Key wurde bereits für eine andere Anfrage verwendet."
                    )
                conn.commit()
                public = self._public(existing)
                assert public is not None
                return public, False

            job_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO assistant_jobs(
                  id, owner_sub, world_id, idempotency_key, request_hash,
                  request_json, progress_id, status, created_at
                ) VALUES(?,?,?,?,?,?,?,'queued',?)
                """,
                (
                    job_id,
                    owner_sub,
                    world_id,
                    key,
                    digest,
                    request_json,
                    progress_id or "",
                    _now(),
                ),
            )
            row = conn.execute("SELECT * FROM assistant_jobs WHERE id=?", (job_id,)).fetchone()
            conn.commit()
            public = self._public(row)
            assert public is not None
            return public, True

    def get(self, job_id: str, owner_sub: str, world_id: str) -> dict[str, Any] | None:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT * FROM assistant_jobs WHERE id=? AND owner_sub=? AND world_id=?",
                (job_id, owner_sub, world_id),
            ).fetchone()
        return self._public(row)

    def request_for(self, job_id: str) -> dict[str, Any]:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT request_json FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
        if row is None:
            raise KeyError(job_id)
        value = json.loads(row["request_json"])
        if not isinstance(value, dict):
            raise ValueError(f"Assistant job {job_id} has an invalid request payload.")
        return value

    def claim_next(self) -> dict[str, Any] | None:
        """Atomically claim one queued job when no job is currently running."""

        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            running = conn.execute(
                "SELECT id FROM assistant_jobs WHERE status='running' LIMIT 1"
            ).fetchone()
            if running is not None:
                conn.rollback()
                return None

            row = conn.execute(
                """
                SELECT * FROM assistant_jobs
                WHERE status='queued'
                ORDER BY created_at, id
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                conn.rollback()
                return None

            conn.execute(
                "UPDATE assistant_jobs SET status='running', started_at=? WHERE id=?",
                (_now(), row["id"]),
            )
            claimed = conn.execute(
                "SELECT * FROM assistant_jobs WHERE id=?",
                (row["id"],),
            ).fetchone()
            conn.commit()
            return self._public(claimed)

    def cancel_requested(self, job_id: str) -> bool:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT cancel_requested FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
        return bool(row and row["cancel_requested"])

    def cancel(self, job_id: str, owner_sub: str, world_id: str) -> dict[str, Any] | None:
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM assistant_jobs WHERE id=? AND owner_sub=? AND world_id=?",
                (job_id, owner_sub, world_id),
            ).fetchone()
            if row is None:
                conn.rollback()
                return None

            if row["status"] == "queued":
                conn.execute(
                    """
                    UPDATE assistant_jobs
                    SET status='cancelled', cancel_requested=1, finished_at=?, request_json='{}'
                    WHERE id=?
                    """,
                    (_now(), job_id),
                )
            elif row["status"] == "running":
                # AssistantRuntime has no cooperative cancellation hook yet. The
                # current inference must therefore finish before another job can
                # start; its result is discarded at the terminal transition.
                conn.execute(
                    "UPDATE assistant_jobs SET cancel_requested=1 WHERE id=?",
                    (job_id,),
                )

            updated = conn.execute(
                "SELECT * FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            conn.commit()
            return self._public(updated)

    def finish_success(
        self,
        job_id: str,
        result: dict[str, Any],
        interaction_id: str,
    ) -> dict[str, Any] | None:
        """Commit success unless cancellation won the race at the boundary."""

        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT cancel_requested FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if row is None:
                conn.rollback()
                return None
            if row["cancel_requested"]:
                conn.execute(
                    """
                    UPDATE assistant_jobs
                    SET status='cancelled', result_json=NULL, error='', error_type='',
                        http_status=0, finished_at=?, request_json='{}'
                    WHERE id=?
                    """,
                    (_now(), job_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE assistant_jobs
                    SET status='completed', result_json=?, error='', error_type='',
                        http_status=0, interaction_id=?, finished_at=?, request_json='{}'
                    WHERE id=?
                    """,
                    (
                        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                        interaction_id,
                        _now(),
                        job_id,
                    ),
                )
            updated = conn.execute(
                "SELECT * FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            conn.commit()
            return self._public(updated)

    def finish_failure(
        self,
        job_id: str,
        error: str,
        error_type: str,
        http_status: int,
        interaction_id: str = "",
    ) -> dict[str, Any] | None:
        """Commit failure unless cancellation won the race at the boundary."""

        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT cancel_requested FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if row is None:
                conn.rollback()
                return None
            if row["cancel_requested"]:
                conn.execute(
                    """
                    UPDATE assistant_jobs
                    SET status='cancelled', result_json=NULL, error='', error_type='',
                        http_status=0, finished_at=?, request_json='{}'
                    WHERE id=?
                    """,
                    (_now(), job_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE assistant_jobs
                    SET status='failed', result_json=NULL, error=?, error_type=?,
                        http_status=?, interaction_id=?, finished_at=?, request_json='{}'
                    WHERE id=?
                    """,
                    (error, error_type, http_status, interaction_id, _now(), job_id),
                )
            updated = conn.execute(
                "SELECT * FROM assistant_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            conn.commit()
            return self._public(updated)

    def recover_interrupted(self) -> None:
        """Recover rows left `running` by a previous process.

        Model inference has no side effects. Replaying an interrupted inference is
        therefore safe; an interaction is only written after complete() returns.
        """

        now = _now()
        with self._connection() as conn:
            conn.execute(
                """
                UPDATE assistant_jobs
                SET status='cancelled', finished_at=?, request_json='{}'
                WHERE status='running' AND cancel_requested=1
                """,
                (now,),
            )
            conn.execute(
                """
                UPDATE assistant_jobs
                SET status='queued', started_at=NULL
                WHERE status='running' AND cancel_requested=0
                """
            )

    def prune(self) -> None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=JOB_RETENTION_DAYS)).isoformat()
        with self._connection() as conn:
            conn.execute(
                """
                DELETE FROM assistant_jobs
                WHERE status IN ('completed','failed','cancelled')
                  AND finished_at IS NOT NULL
                  AND finished_at < ?
                """,
                (cutoff,),
            )


class AssistantJobRunner:
    """One durable worker around one `AssistantRuntime` instance."""

    def __init__(
        self,
        assistant,
        data: Path,
        *,
        interaction_logger: InteractionLogger | None = None,
    ):
        self.assistant = assistant
        self.data = data
        self.interaction_logger = interaction_logger
        self._store: AssistantJobStore | None = None
        self._store_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._start_lock = threading.Lock()
        self._thread: threading.Thread | None = None

    @property
    def store(self) -> AssistantJobStore:
        # Delayed until first use so importing server.py for route/unit tests does
        # not create a persistent database as a side effect.
        if self._store is None:
            with self._store_lock:
                if self._store is None:
                    self._store = AssistantJobStore(self.data / "assistant-jobs.sqlite3")
        return self._store

    def start(self) -> None:
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self.store.recover_interrupted()
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="quiltor-assistant-jobs",
                daemon=True,
            )
            self._thread.start()

    def close(self, timeout: float = 2.0) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)

    def submit(self, **kwargs) -> tuple[dict[str, Any], bool]:
        self.start()
        result = self.store.submit(**kwargs)
        self._wake.set()
        return result

    def get(self, job_id: str, owner_sub: str, world_id: str) -> dict[str, Any] | None:
        self.start()
        return self.store.get(job_id, owner_sub, world_id)

    def cancel(self, job_id: str, owner_sub: str, world_id: str) -> dict[str, Any] | None:
        self.start()
        result = self.store.cancel(job_id, owner_sub, world_id)
        self._wake.set()
        return result

    def wait(
        self,
        job_id: str,
        owner_sub: str,
        world_id: str,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Compatibility helper for the old synchronous `/api/assistant/chat`."""

        self.start()
        deadline = time.monotonic() + timeout if timeout is not None else None
        while True:
            job = self.store.get(job_id, owner_sub, world_id)
            if job is None:
                raise KeyError(job_id)
            if job["status"] in TERMINAL_STATUSES:
                return job
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Assistant job {job_id} did not finish before the wait timeout."
                )
            time.sleep(0.25)

    def _run(self) -> None:
        while not self._stop.is_set():
            job = self.store.claim_next()
            if job is None:
                self._wake.wait(timeout=0.5)
                self._wake.clear()
                continue
            try:
                self._execute(job)
            except Exception as exc:
                # One broken persistence/logging path must fail one job, not kill
                # the only worker thread and leave the queue stuck forever.
                try:
                    self.store.finish_failure(
                        str(job["id"]),
                        str(exc),
                        classify_assistant_error(exc),
                        assistant_error_status(exc),
                    )
                except Exception:
                    pass
                print(
                    f"  ! {datetime.now():%H:%M:%S}  assistant worker error — "
                    f"{type(exc).__name__}: {exc}",
                    flush=True,
                )
            self._wake.set()

    def _execute(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        payload = self.store.request_for(job_id)
        question = str(payload.get("question") or "")
        world_id = str(payload.get("worldId") or "")
        db_path = self.data / "worlds" / f"{world_id}.sqlite3"

        try:
            # A world can be deleted while work is queued. Never let the audit
            # logger recreate a deleted SQLite file merely because an old job
            # finally reached the worker.
            if not db_path.exists():
                raise FileNotFoundError("Die Welt für diesen Assistant-Job existiert nicht mehr.")

            self.assistant.reload()
            result = self.assistant.complete(
                question,
                payload.get("manuscript") or {},
                payload.get("figures") or {},
                payload.get("history") or [],
                payload.get("chapterIds") or [],
                bool(payload.get("runBatches")),
                payload.get("progressId") or None,
                str(payload.get("language") or "de"),
            )

            if self.store.cancel_requested(job_id):
                self.store.finish_success(job_id, {}, "")
                return
            if not db_path.exists():
                raise FileNotFoundError("Die Welt für diesen Assistant-Job existiert nicht mehr.")

            logger = self.interaction_logger or storage.log_assistant_interaction
            interaction_id = logger(question, result, db_path=db_path)
            response = {
                "ok": True,
                "interactionId": interaction_id,
                **result,
            }
            terminal = self.store.finish_success(job_id, response, interaction_id)
            if terminal and terminal["status"] == "completed":
                print(
                    f"  · {datetime.now():%H:%M:%S}  "
                    f"AI job {job_id} / request {interaction_id} — "
                    f"{len(result.get('sources', []))} sources, "
                    f"{len(result.get('proposals', []))} proposals",
                    flush=True,
                )
        except Exception as exc:
            interaction_id = ""
            if not self.store.cancel_requested(job_id) and question and db_path.exists():
                try:
                    logger = self.interaction_logger or storage.log_assistant_interaction
                    interaction_id = logger(question, error=str(exc), db_path=db_path)
                except Exception as log_exc:
                    print(
                        f"  ! {datetime.now():%H:%M:%S}  "
                        "Could not persist failed assistant interaction — "
                        f"{type(log_exc).__name__}: {log_exc}",
                        flush=True,
                    )
            terminal = self.store.finish_failure(
                job_id,
                str(exc),
                classify_assistant_error(exc),
                assistant_error_status(exc),
                interaction_id,
            )
            if terminal and terminal["status"] == "failed":
                print(
                    f"  ! {datetime.now():%H:%M:%S}  "
                    f"AI job {job_id} failed — {type(exc).__name__}: {exc}",
                    flush=True,
                )
