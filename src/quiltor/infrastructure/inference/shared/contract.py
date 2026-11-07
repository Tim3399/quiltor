from __future__ import annotations

import copy
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from quiltor.modules.assistant.ports import (
    IncompleteInferenceResponse,
    InferenceTimeoutError,
    InferenceUnavailableError,
    InferenceValidationError,
)

DEFAULT_CHAT_TIMEOUT_SECONDS = 600
# An external provider's error body is cut to this much: enough for its message, not enough to
# carry a pasted request back into a log line (T-58 P5).
EXTERNAL_ERROR_DETAIL_CHARS = 300


class InferenceHTTPError(RuntimeError):
    """An HTTP error from the model server, with the status kept for callers that branch on it."""

    def __init__(self, message: str, status: int, detail: str) -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


def _error_detail(exc: urllib.error.HTTPError, api_key: str | None) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace").strip()
    except Exception:  # noqa: BLE001 - an unreadable error body is replaced by the reason
        body = ""
    if not api_key:
        return body[:1000] if body else str(exc.reason)
    # A provider may echo the request -- headers included -- in its error body. The key is
    # replaced before the text goes anywhere, and the body is cut short (T-58 P5).
    return (body or str(exc.reason)).replace(api_key, "***")[:EXTERNAL_ERROR_DETAIL_CHARS]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


# A request carrying `Authorization` must never follow a redirect: urllib would resend the
# header to wherever the Location points, and the sidecar key (or, from P5, the endpoint's) would
# leave for a host nobody chose (F-58-3). Without a redirect handler a 3xx arrives as HTTPError.
_NO_REDIRECT_OPENER = urllib.request.build_opener(_NoRedirect)


def open_without_redirects(request: urllib.request.Request, timeout: float):
    """Open `request` without following any redirect; a 3xx raises RuntimeError.

    The message names the status only: neither the headers nor the key appear in it.
    """

    try:
        return _NO_REDIRECT_OPENER.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        if 300 <= exc.code < 400:
            exc.close()
            raise RuntimeError(
                f"The local model answered with a redirect (HTTP {exc.code}); it is not followed."
            ) from None
        raise


def _authorized_open(request: urllib.request.Request, timeout: float, api_key: str | None):
    if not api_key:
        return urllib.request.urlopen(request, timeout=timeout)
    request.add_header("Authorization", f"Bearer {api_key}")
    return open_without_redirects(request, timeout)


def chat_timeout_seconds() -> int:
    """Return the configured inference timeout."""

    raw = os.environ.get(
        "QUILTOR_AI_TIMEOUT",
        str(DEFAULT_CHAT_TIMEOUT_SECONDS),
    )

    try:
        return max(30, int(raw))
    except ValueError:
        return DEFAULT_CHAT_TIMEOUT_SECONDS


def json_schema_format(
    schema: dict[str, Any],
    name: str = "quiltor_reply",
) -> dict[str, Any]:
    """Build the response_format that forces JSON-schema-constrained decoding.

    The schema must be nested under json_schema.schema -- a flatter
    top-level "schema" key is silently ignored by llama.cpp (and by every
    other OpenAI-compatible server), which disables constrained decoding
    without raising any error. This is the one shape every runtime backend
    (llama.cpp, MLX, a remote endpoint via QUILTOR_AI_URL) must honour.
    """

    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": schema,
        },
    }


def invoke_chat(
    url: str,
    payload: dict[str, Any],
    timeout: int | float | None = None,
    include_metadata: bool = False,
    api_key: str | None = None,
) -> dict[str, Any]:
    """POST an OpenAI-compatible /v1/chat/completions request.

    Chat inference uses a deliberately generous timeout because large prompts
    can spend several minutes in prompt evaluation on CPU-only machines.
    """

    effective_timeout = timeout if timeout is not None else chat_timeout_seconds()

    request = urllib.request.Request(
        f"{url}/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )

    started = time.monotonic()

    try:
        with _authorized_open(request, effective_timeout, api_key) as response:
            result = json.loads(response.read())

        choice = result["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")

    except urllib.error.HTTPError as exc:
        # HTTPError inherits from URLError, so handle it first.
        detail = _error_detail(exc, api_key)
        raise InferenceHTTPError(
            f"The local model responded with HTTP {exc.code}: {detail}", exc.code, detail
        ) from exc

    except TimeoutError as exc:
        raise InferenceTimeoutError(effective_timeout) from exc

    except urllib.error.URLError as exc:
        # urllib may wrap the actual socket timeout inside URLError.reason.
        if isinstance(exc.reason, TimeoutError):
            raise InferenceTimeoutError(effective_timeout) from exc

        raise InferenceUnavailableError(f"The local model is unreachable: {exc.reason}") from exc

    except (KeyError, ValueError, TypeError) as exc:
        raise InferenceValidationError(
            "The local model did not return a valid structured response."
        ) from exc

    try:
        parsed = json.loads(content)

        if include_metadata:
            usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}

            parsed["_runtime"] = {
                "finishReason": finish_reason or "unknown",
                "promptTokens": usage.get("prompt_tokens"),
                "completionTokens": usage.get("completion_tokens"),
                "totalTokens": usage.get("total_tokens"),
                "durationMs": round((time.monotonic() - started) * 1000),
            }

        return parsed

    except ValueError as exc:
        if finish_reason == "length":
            raise IncompleteInferenceResponse(
                content,
                finish_reason,
            ) from exc

        raise InferenceValidationError(
            "The local model did not return a valid structured response."
        ) from exc


def check_health(url: str, timeout: float = 0.7) -> bool:
    try:
        with urllib.request.urlopen(
            f"{url}/health",
            timeout=timeout,
        ) as response:
            return response.status == 200
    except Exception:  # noqa: BLE001 - any probe failure means "not ready"
        return False


def check_models(url: str, api_key: str, timeout: float = 5) -> bool:
    """Health of an external OpenAI-compatible endpoint: GET /v1/models with the key.

    Such providers have no /health. The call never follows a redirect, so the key cannot be
    carried to another host (F-58-3).
    """
    request = urllib.request.Request(f"{url}/v1/models")
    request.add_header("Authorization", f"Bearer {api_key}")
    try:
        with open_without_redirects(request, timeout) as response:
            return response.status == 200
    except Exception:  # noqa: BLE001 - any probe failure means "not ready"
        return False


def estimate_tokens(text: str) -> int:
    """An external provider has no /tokenize: about three characters per token (T-58 F1).

    Deliberately on the high side for German prose, so the context budget errs towards room.
    """
    return -(-len(text) // 3)


# Markers in a provider's 4xx body that say it refused `response_format: json_schema` itself,
# rather than the request as a whole. OpenAI names the parameter ("param": "response_format",
# "'response_format' of type 'json_schema' is not supported"); OpenRouter answers 404 "No
# endpoints found that can handle the requested parameters" when no provider for the model
# supports structured outputs. Anything else is a real error and is not retried.
_JSON_SCHEMA_REFUSAL_STATUSES = frozenset({400, 404, 422})
_JSON_SCHEMA_REFUSAL_MARKERS = (
    "response_format",
    "json_schema",
    "structured output",
    "requested parameters",
)


def refuses_json_schema(exc: BaseException) -> bool:
    if not isinstance(exc, InferenceHTTPError):
        return False
    if exc.status not in _JSON_SCHEMA_REFUSAL_STATUSES:
        return False
    detail = exc.detail.lower()
    return any(marker in detail for marker in _JSON_SCHEMA_REFUSAL_MARKERS)


def json_object_fallback(payload: dict[str, Any]) -> dict[str, Any]:
    """The same request for a provider without strict json_schema: json_object plus the schema
    in the system prompt (T-58 P5).

    The model is then only asked, not forced, to follow the schema; the server-side check of
    the reply stays the guard. A payload without a json_schema format is returned unchanged.
    """
    response_format = payload.get("response_format") or {}
    schema = (response_format.get("json_schema") or {}).get("schema")
    if response_format.get("type") != "json_schema" or schema is None:
        return payload
    fallback = copy.deepcopy(payload)
    fallback["response_format"] = {"type": "json_object"}
    instruction = (
        "Reply with one JSON object only, no prose around it. It must validate against this "
        "JSON schema:\n" + json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    )
    messages = fallback.setdefault("messages", [])
    if messages and messages[0].get("role") == "system":
        messages[0]["content"] = f"{messages[0].get('content', '')}\n\n{instruction}"
    else:
        messages.insert(0, {"role": "system", "content": instruction})
    return fallback


def count_tokens(
    url: str,
    text: str,
    timeout: float = 10,
    api_key: str | None = None,
) -> int:
    """Return the exact token count using the runtime's own tokenizer.

    Tokenization deliberately keeps its short timeout: unlike inference,
    this operation should never need several minutes.
    """

    request = urllib.request.Request(
        f"{url}/tokenize",
        data=json.dumps({"content": text}).encode(),
        headers={"Content-Type": "application/json"},
    )

    try:
        with _authorized_open(request, timeout, api_key) as response:
            result = json.loads(response.read())

        return len(result["tokens"])

    except urllib.error.HTTPError as exc:
        detail = _error_detail(exc, api_key)
        raise InferenceHTTPError(
            f"The local model tokenizer responded with HTTP {exc.code}: {detail}", exc.code, detail
        ) from exc

    except TimeoutError as exc:
        raise InferenceTimeoutError(timeout) from exc

    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise InferenceTimeoutError(timeout) from exc

        raise InferenceUnavailableError(f"The local model is unreachable: {exc.reason}") from exc

    except (KeyError, ValueError, TypeError) as exc:
        raise InferenceValidationError(
            "The local model did not return a valid token response."
        ) from exc
