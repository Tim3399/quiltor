"""Durable assistant-job orchestration over injected persistence and logging ports."""

from __future__ import annotations

import threading
import time
from typing import Any

from quiltor.application.observability import Metrics, StructuredLogger
from quiltor.modules.assistant.ports import (
    AssistantInteractionLogger,
    AssistantJobStore,
    AssistantWorldAccess,
    IdempotencyConflict,
    InferenceTimeoutError,
    InferenceUnavailableError,
    JobStoreFactory,
)

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


def classify_assistant_error(exc: Exception) -> str:
    if isinstance(exc, InferenceTimeoutError):
        return "timeout"
    if isinstance(exc, InferenceUnavailableError):
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
    if isinstance(exc, InferenceTimeoutError):
        return 504
    if isinstance(exc, InferenceUnavailableError):
        return 503
    return 503


class AssistantJobRunner:
    """Single worker around an assistant runtime; every adapter is injected."""

    def __init__(
        self,
        assistant: Any,
        *,
        store_factory: JobStoreFactory,
        interaction_logger: AssistantInteractionLogger,
        world_access: AssistantWorldAccess,
        structured_logger: StructuredLogger,
        metrics: Metrics,
    ) -> None:
        self.assistant = assistant
        self._store_factory = store_factory
        self.interaction_logger = interaction_logger
        self.world_access = world_access
        self.structured_logger = structured_logger
        self.metrics = metrics
        self._store: AssistantJobStore | None = None
        self._store_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._start_lock = threading.Lock()
        self._thread: threading.Thread | None = None

    @property
    def store(self) -> AssistantJobStore:
        if self._store is None:
            with self._store_lock:
                if self._store is None:
                    self._store = self._store_factory()
        return self._store

    def start(self) -> None:
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self.store.recover_interrupted()
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run, name="quiltor-assistant-jobs", daemon=True
            )
            self._thread.start()

    def close(self, timeout: float = 2.0) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)

    def submit(self, **kwargs: Any) -> tuple[dict[str, Any], bool]:
        self.start()
        result = self.store.submit(**kwargs)
        if result[1]:
            self.metrics.increment("assistant_jobs_submitted")
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
                try:
                    self.store.finish_failure(
                        str(job["id"]),
                        str(exc),
                        classify_assistant_error(exc),
                        assistant_error_status(exc),
                    )
                except Exception:
                    pass
                self.metrics.increment("assistant_jobs_failed", error=type(exc).__name__)
                self.structured_logger.event(
                    "error",
                    "assistant.worker_failed",
                    job_id=str(job["id"]),
                    error_type=type(exc).__name__,
                )
            self._wake.set()

    def _execute(self, job: dict[str, Any]) -> None:
        started = time.monotonic()
        job_id = str(job["id"])
        payload = self.store.request_for(job_id)
        question = str(payload.get("question") or "")
        owner_sub = str(job.get("_ownerSub") or "")
        world_id = str(job.get("_worldId") or payload.get("worldId") or "")
        try:
            if not self.world_access.exists(owner_sub, world_id):
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
                owner_sub=owner_sub,
                world_id=world_id,
            )
            if self.store.cancel_requested(job_id):
                self.store.finish_success(job_id, {}, "")
                return
            if not self.world_access.exists(owner_sub, world_id):
                raise FileNotFoundError("Die Welt für diesen Assistant-Job existiert nicht mehr.")
            interaction_id = self.interaction_logger.record(
                question,
                result,
                owner_sub=owner_sub,
                world_id=world_id,
            )
            response = {"ok": True, "interactionId": interaction_id, **result}
            terminal = self.store.finish_success(job_id, response, interaction_id)
            if terminal and terminal["status"] == "completed":
                self.metrics.increment("assistant_jobs_completed")
                self.metrics.observe("assistant_job_duration_seconds", time.monotonic() - started)
                self.structured_logger.event(
                    "info",
                    "assistant.job_completed",
                    job_id=job_id,
                    interaction_id=interaction_id,
                    sources=len(result.get("sources", [])),
                    proposals=len(result.get("proposals", [])),
                )
        except Exception as exc:
            interaction_id = ""
            if (
                not self.store.cancel_requested(job_id)
                and question
                and self.world_access.exists(owner_sub, world_id)
            ):
                try:
                    interaction_id = self.interaction_logger.record(
                        question,
                        error=str(exc),
                        owner_sub=owner_sub,
                        world_id=world_id,
                    )
                except Exception as log_exc:
                    self.structured_logger.event(
                        "error",
                        "assistant.interaction_log_failed",
                        job_id=job_id,
                        error_type=type(log_exc).__name__,
                    )
            terminal = self.store.finish_failure(
                job_id,
                str(exc),
                classify_assistant_error(exc),
                assistant_error_status(exc),
                interaction_id,
            )
            if terminal and terminal["status"] == "failed":
                self.metrics.increment("assistant_jobs_failed", error=type(exc).__name__)
                self.structured_logger.event(
                    "error",
                    "assistant.job_failed",
                    job_id=job_id,
                    error_type=type(exc).__name__,
                )


__all__ = [
    "AssistantJobRunner",
    "IdempotencyConflict",
    "assistant_error_status",
    "classify_assistant_error",
]
