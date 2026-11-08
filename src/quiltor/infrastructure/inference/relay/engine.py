"""The inference engine for a job computed in the user's browser (T-61).

It looks like any other engine to the assistant pipeline: `invoke` takes the finished
OpenAI-style request and returns the parsed JSON reply. Underneath it hands the request
to the browser as a ticket and waits for the model's text. The browser never sees more
than the request, and the server never takes more than the text: prompt, schema checks
and tool calls stay here (D-37).

One engine serves one job. Its token estimate is calibrated from what the browser
reports, so it lives and dies with the job, together with its own token cache.
"""

from __future__ import annotations

import json
import math
import time
from collections.abc import Callable
from typing import Any

from quiltor.infrastructure.inference.relay.tickets import (
    ANSWER_SECONDS,
    JOB_SECONDS,
    RelayAnswerTimeout,
    RelayCancelled,
    RelayDeliveryTimeout,
    RelayFull,
    RelayTicketStore,
)
from quiltor.infrastructure.inference.shared.contract import json_object_fallback
from quiltor.modules.assistant.engines import CLIENT_ERROR_CODES
from quiltor.modules.assistant.ports import (
    IncompleteInferenceResponse,
    InferenceContextTooLargeError,
    InferenceTimeoutError,
    InferenceUnavailableError,
    InferenceValidationError,
)

#: The window every client engine reports in v1 (A-4 §2.3): the prompt pipeline is built
#: for it, and WebLLM is configured to it.
CLIENT_CONTEXT_TOKENS = 8192
#: Starting point for the estimate: characters per token, cautious for German and JSON.
CHARS_PER_TOKEN = 3
CALIBRATION_MIN = 0.5
CALIBRATION_MAX = 2.0
SAFETY_MARGIN = 1.1
#: How much a new measurement moves the calibration (exponential smoothing).
SMOOTHING = 0.5


def _prompt_text(payload: dict[str, Any]) -> str:
    parts = []
    for message in payload.get("messages") or []:
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            parts.append(message["content"])
    return "\n".join(parts)


class RelayInferenceEngine:
    """Hand each model call of one job to the browser bound to it, and wait."""

    def __init__(
        self,
        tickets: RelayTicketStore,
        job_id: str,
        engine: dict[str, Any],
        *,
        clock: Callable[[], float] = time.monotonic,
        job_seconds: float = JOB_SECONDS,
    ) -> None:
        self._tickets = tickets
        self._job_id = job_id
        self._engine = dict(engine)
        self._clock = clock
        self._job_deadline = clock() + job_seconds
        self._job_seconds = job_seconds
        self._calibration = 1.0
        # Set by close(): a closed engine opens no further ticket (F-61-12). The pipeline
        # may call invoke again between two model calls after the job was cancelled.
        self._closed = False

    @property
    def identity(self) -> str:
        return f"relay:{self._job_id}"

    def reload(self) -> None:
        """Nothing to load: the model lives in the browser."""

    def status(self) -> dict[str, Any]:
        return {
            "available": True,
            "mode": "client",
            "engine": self._engine.get("kind"),
            "contextTokens": CLIENT_CONTEXT_TOKENS,
        }

    def close(self) -> None:
        """Release a waiting call (it raises at once) and forget the job's tickets.

        Every later call ends at once as cancelled, so nothing waits for a browser that
        can no longer pick a ticket up."""
        self._closed = True
        self._tickets.cancel(self._job_id)
        self._tickets.release_job(self._job_id)

    @property
    def calibration(self) -> float:
        return self._calibration

    def _estimate(self, text: str) -> int:
        return math.ceil(len(text) / CHARS_PER_TOKEN)

    def count_tokens(self, text: str) -> int:
        return math.ceil(self._estimate(text) * self._calibration * SAFETY_MARGIN)

    def _calibrate(self, payload: dict[str, Any], usage: Any) -> None:
        if not isinstance(usage, dict):
            return
        reported = usage.get("promptTokens")
        estimated = self._estimate(_prompt_text(payload))
        if not isinstance(reported, int) or isinstance(reported, bool):
            return
        if reported <= 0 or estimated <= 0:
            return
        measured = reported / estimated
        blended = self._calibration * (1 - SMOOTHING) + measured * SMOOTHING
        # A browser that reports nonsense only moves its own budget, and only so far.
        self._calibration = min(CALIBRATION_MAX, max(CALIBRATION_MIN, blended))

    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._closed:
            raise InferenceUnavailableError("cancelled")
        if self._clock() >= self._job_deadline:
            raise InferenceTimeoutError(self._job_seconds)
        request = payload if self._engine.get("grammar") else json_object_fallback(payload)
        answer_seconds = ANSWER_SECONDS.get(str(self._engine.get("kind")), ANSWER_SECONDS["cloud"])
        started = self._clock()
        try:
            ticket = self._tickets.issue(
                self._job_id, request, engine=self._engine, answer_seconds=answer_seconds
            )
            answer = self._tickets.wait_answer(ticket)
        except RelayCancelled as exc:
            raise InferenceUnavailableError("cancelled") from exc
        except (RelayFull, RelayDeliveryTimeout) as exc:
            raise InferenceUnavailableError("client_unavailable") from exc
        except RelayAnswerTimeout as exc:
            raise InferenceTimeoutError(exc.seconds) from exc

        error = answer.get("error")
        if isinstance(error, dict):
            code = error.get("code")
            if code == "context_too_large":
                raise InferenceContextTooLargeError("The browser's model window is too small.")
            if code == "cancelled":
                raise InferenceUnavailableError("cancelled")
            message = str(code) if code in CLIENT_ERROR_CODES else "client_error"
            detail = error.get("detail")
            # The relay route trimmed and cleaned it; it reaches only the job's owner.
            raise InferenceUnavailableError(
                f"{message}: {detail}" if isinstance(detail, str) and detail else message
            )

        output = answer.get("output")
        if not isinstance(output, dict) or not isinstance(output.get("content"), str):
            raise InferenceValidationError("The browser returned no model output.")
        content = output["content"]
        finish_reason = output.get("finishReason")
        usage = output.get("usage")
        self._calibrate(request, usage)
        try:
            parsed = json.loads(content)
        except RecursionError as exc:
            raise InferenceValidationError(
                "The browser returned nesting too deep to read."
            ) from exc
        except ValueError as exc:
            if finish_reason == "length":
                raise IncompleteInferenceResponse(content, "length") from exc
            raise InferenceValidationError(
                "The browser did not return a valid structured response."
            ) from exc
        if not isinstance(parsed, dict):
            raise InferenceValidationError("The browser did not return a JSON object.")
        usage = usage if isinstance(usage, dict) else {}
        parsed["_runtime"] = {
            "engine": self._engine.get("kind"),
            "seq": ticket.seq,
            "finishReason": finish_reason or "unknown",
            "durationMs": round((self._clock() - started) * 1000),
            "promptTokens": usage.get("promptTokens"),
            "completionTokens": usage.get("completionTokens"),
        }
        return parsed


__all__ = ["CLIENT_CONTEXT_TOKENS", "RelayInferenceEngine"]
