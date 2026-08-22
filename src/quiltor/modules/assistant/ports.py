"""Infrastructure capabilities consumed by the assistant product module."""

from __future__ import annotations

from typing import Any, Callable, Protocol, runtime_checkable


class IdempotencyConflict(RuntimeError):
    """One idempotency key was reused for a different logical request."""


class IncompleteInferenceResponse(RuntimeError):
    def __init__(self, raw_content: str, finish_reason: str):
        super().__init__("Das lokale Modell hat die Antwort nicht rechtzeitig fertiggestellt.")
        self.raw_content = raw_content
        self.finish_reason = finish_reason


class InferenceTimeoutError(RuntimeError):
    def __init__(self, timeout_seconds: float):
        self.timeout_seconds = timeout_seconds
        super().__init__(
            "Das lokale Modell hat die Anfrage nicht innerhalb von "
            f"{timeout_seconds:g} Sekunden abgeschlossen."
        )


class InferenceUnavailableError(RuntimeError):
    pass


@runtime_checkable
class InferenceEngine(Protocol):
    @property
    def identity(self) -> str: ...

    def reload(self) -> None: ...

    def status(self) -> dict[str, Any]: ...

    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]: ...

    def count_tokens(self, text: str) -> int: ...

    def close(self) -> None: ...


@runtime_checkable
class AssistantInstallation(Protocol):
    """Install/status boundary for the optional local inference runtime."""

    def ensure_installed(self) -> None: ...

    def is_configured(self) -> bool: ...

    def read_state(self) -> dict[str, Any]: ...

    def start_async(self) -> bool: ...

    def install_selected(self, runtime: str = "auto") -> str:
        """Install a selected local runtime synchronously and return its name."""

        ...


@runtime_checkable
class AssistantJobStore(Protocol):
    def submit(self, **kwargs: Any) -> tuple[dict[str, Any], bool]: ...

    def get(self, job_id: str, owner_sub: str, world_id: str) -> dict[str, Any] | None: ...

    def request_for(self, job_id: str) -> dict[str, Any]: ...

    def claim_next(self) -> dict[str, Any] | None: ...

    def cancel_requested(self, job_id: str) -> bool: ...

    def cancel(self, job_id: str, owner_sub: str, world_id: str) -> dict[str, Any] | None: ...

    def finish_success(
        self, job_id: str, result: dict[str, Any], interaction_id: str
    ) -> dict[str, Any] | None: ...

    def finish_failure(
        self,
        job_id: str,
        error: str,
        error_type: str,
        http_status: int,
        interaction_id: str = "",
    ) -> dict[str, Any] | None: ...

    def recover_interrupted(self) -> None: ...


@runtime_checkable
class AssistantInteractionLogger(Protocol):
    def record(
        self,
        question: str,
        response: dict[str, Any] | None = None,
        *,
        error: str = "",
        owner_sub: str,
        world_id: str,
    ) -> str: ...


@runtime_checkable
class AssistantWorldAccess(Protocol):
    def exists(self, owner_sub: str, world_id: str) -> bool: ...


@runtime_checkable
class AssistantProgressStore(Protocol):
    def start(self, owner_sub: str, world_id: str, progress_id: str, total: int) -> None: ...

    def update(
        self,
        owner_sub: str,
        world_id: str,
        progress_id: str,
        done: int,
        label_key: str,
        label_params: dict[str, Any],
    ) -> None: ...

    def finish(self, owner_sub: str, world_id: str, progress_id: str) -> None: ...

    def read(self, owner_sub: str, world_id: str, progress_id: str) -> dict[str, Any] | None: ...


@runtime_checkable
class TokenCountCache(Protocol):
    def count(self, identity: str, text: str, counter: Callable[[str], int]) -> int: ...

    def stats(self) -> dict[str, int]: ...


JobStoreFactory = Callable[[], AssistantJobStore]

__all__ = [
    "AssistantInstallation",
    "AssistantInteractionLogger",
    "AssistantJobStore",
    "AssistantProgressStore",
    "AssistantWorldAccess",
    "IdempotencyConflict",
    "IncompleteInferenceResponse",
    "InferenceEngine",
    "InferenceTimeoutError",
    "InferenceUnavailableError",
    "JobStoreFactory",
    "TokenCountCache",
]
