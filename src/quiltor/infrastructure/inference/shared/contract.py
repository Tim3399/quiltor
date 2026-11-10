from __future__ import annotations

import copy
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from quiltor.modules.assistant.ports import (
    IncompleteInferenceResponse,
    InferenceContextTooLargeError,
    InferenceTimeoutError,
    InferenceUnavailableError,
    InferenceValidationError,
)

DEFAULT_CHAT_TIMEOUT_SECONDS = 600
# An external provider's error body is cut to this much: enough for its message, not enough to
# carry a pasted request back into a log line (T-58 P5).
EXTERNAL_ERROR_DETAIL_CHARS = 300


# How much of an error body is read at all, and how long a field taken from it may be.
ERROR_BODY_READ_BYTES = 64 * 1024
ERROR_FIELD_CHARS = 100


class InferenceHTTPError(RuntimeError):
    """An HTTP error from the model server, with the status kept for callers that branch on it.

    `error_type`, `error_code`, `param` and `upstream_code` are the error as local-ai-contract
    3.3 normalises it (see `normalise_error`); all of them are None when the server sent no
    envelope. `detail` stays the raw, redacted and cut text.
    """

    def __init__(
        self,
        message: str,
        status: int,
        detail: str,
        *,
        error_type: str | None = None,
        error_code: str | None = None,
        param: str | None = None,
        upstream_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail
        self.error_type = error_type
        self.error_code = error_code
        self.param = param
        self.upstream_code = upstream_code


@dataclass(frozen=True)
class NormalisedError:
    """An error response in the contract's own terms (local-ai-contract 3.1 and 3.3)."""

    status: int
    code: str | None
    error_type: str | None
    param: str | None
    # What the server itself called it, when that is not the contract's name (N1, N2, N8, N15).
    upstream_code: str | None


# N2 and N15: classes servers name themselves, and the contract code each one means.
_UPSTREAM_CODES = {
    "exceed_context_size_error": "context_too_large",
    "context_length_exceeded": "context_too_large",
    "not_supported_error": "unsupported_parameter",
    "unavailable_error": "unavailable",
}


def _field(value: Any) -> str | None:
    """A short string from an error body, or None: nothing else is let through."""
    if isinstance(value, str) and value:
        return value[:ERROR_FIELD_CHARS]
    return None


def _type_for_status(status: int) -> str:
    if status == 429:
        return "rate_limit_error"
    if status == 503:
        return "service_unavailable_error"
    if status >= 500:
        return "api_error"
    return "invalid_request_error"


def normalise_error(status: int, body: str | bytes | dict[str, Any] | None) -> NormalisedError:
    """Read an error body into the contract's envelope (3.1), whichever server wrote it.

    - N1, N8: an integer `code` is no code; it becomes `upstream_code`, `code` stays None.
    - N2, N15: a server's own class (llama `exceed_context_size_error`, OpenAI
      `context_length_exceeded`) maps to the contract code, the server's name goes to
      `upstream_code`.
    - N12: a missing `param` or `code` is None, never an error.
    - N20: anything that is not an envelope (a bare string, no JSON) has no code and no param;
      its type comes from the status.

    Only short strings are taken from the body, so what a server echoes cannot travel on.
    """
    document: Any = body
    if isinstance(body, (str, bytes)):
        try:
            document = json.loads(body)
        except ValueError:
            document = None
    error = document.get("error") if isinstance(document, dict) else None
    if not isinstance(error, dict):
        return NormalisedError(status, None, _type_for_status(status), None, None)

    raw_code = error.get("code")
    error_type = _field(error.get("type"))
    code = _field(raw_code)
    upstream_code = None
    if isinstance(raw_code, int) and not isinstance(raw_code, bool):
        upstream_code = str(raw_code)
    for named in (error_type, code):
        if named in _UPSTREAM_CODES:
            code, upstream_code = _UPSTREAM_CODES[named], named
            break
    return NormalisedError(
        status,
        code,
        error_type or _type_for_status(status),
        _field(error.get("param")),
        upstream_code,
    )


def _error_body(exc: urllib.error.HTTPError, api_key: str | None) -> tuple[str, str]:
    """The error body with the key replaced, and the cut version kept as `detail`.

    The key is replaced before the text is parsed or kept anywhere: a provider may echo the
    request, headers included, in its error body (T-58 P5).
    """
    try:
        body = exc.read(ERROR_BODY_READ_BYTES).decode("utf-8", errors="replace").strip()
    except Exception:  # noqa: BLE001 - an unreadable error body is replaced by the reason
        body = ""
    if not api_key:
        return body, body[:1000] if body else str(exc.reason)
    redacted = (body or str(exc.reason)).replace(api_key, "***")
    return redacted, redacted[:EXTERNAL_ERROR_DETAIL_CHARS]


def _http_error(exc: urllib.error.HTTPError, api_key: str | None, what: str) -> RuntimeError:
    """The exception a server's error response becomes: a context error, or an HTTP error."""
    body, detail = _error_body(exc, api_key)
    error = normalise_error(exc.code, body)
    message = f"{what} responded with HTTP {exc.code}: {detail}"
    if error.code == "context_too_large" and exc.code == 400:
        return InferenceContextTooLargeError(message)
    return InferenceHTTPError(
        message,
        exc.code,
        detail,
        error_type=error.error_type,
        error_code=error.code,
        param=error.param,
        upstream_code=error.upstream_code,
    )


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


def _usage_is_complete(usage: Any) -> bool:
    if not isinstance(usage, dict):
        return False
    return all(
        isinstance(usage.get(name), int) and not isinstance(usage.get(name), bool)
        for name in ("prompt_tokens", "completion_tokens", "total_tokens")
    )


def _read_choice(result: Any, *, require_usage: bool) -> tuple[str, str]:
    """The one choice of a chat response, checked as local-ai-contract section 4 asks.

    Returns its content and finish_reason. A response that breaks the contract is an
    `InferenceValidationError`:

    - an `error` object in a 200 answer (N9) is an `InferenceHTTPError` instead: the server
      failed after it had answered;
    - not exactly one choice (C36);
    - a `refusal` or an empty content (C19);
    - a finish_reason that is neither "stop" nor "length" (C18);
    - no `usage`, when the caller asks for it (C37: only the local path, where the server is
      ours to hold to the contract; an external provider may leave it out).
    """
    if not isinstance(result, dict):
        raise ValueError("response is not an object")
    if result.get("error") is not None:
        error = normalise_error(502, result)
        raise InferenceHTTPError(
            "The local model answered with an error inside a successful response.",
            502,
            "error inside HTTP 200",
            error_type=error.error_type,
            error_code=error.code,
            param=error.param,
            upstream_code=error.upstream_code,
        )
    invalid = InferenceValidationError(
        "The local model did not return a valid structured response."
    )
    choices = result["choices"]
    if not isinstance(choices, list) or len(choices) != 1:
        raise invalid
    if require_usage and not _usage_is_complete(result.get("usage")):
        raise invalid
    choice = choices[0]
    message = choice["message"]
    content = message["content"]
    finish_reason = choice.get("finish_reason")
    if message.get("refusal") or not isinstance(content, str) or not content.strip():
        raise invalid
    if finish_reason not in {"stop", "length"}:
        raise invalid
    return content, finish_reason


def invoke_chat(
    url: str,
    payload: dict[str, Any],
    timeout: int | float | None = None,
    include_metadata: bool = False,
    api_key: str | None = None,
    require_usage: bool = False,
) -> dict[str, Any]:
    """POST an OpenAI-compatible /v1/chat/completions request.

    Chat inference uses a deliberately generous timeout because large prompts
    can spend several minutes in prompt evaluation on CPU-only machines.

    The answer is held to the contract (see `_read_choice`). `finish_reason: length` is always
    an `IncompleteInferenceResponse`, even when the cut-off content happens to parse: the
    server stopped, so a shorter list or a missing field would pass as complete. The caller
    may grow the output limit and ask again.
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

        content, finish_reason = _read_choice(result, require_usage=require_usage)

    except urllib.error.HTTPError as exc:
        # HTTPError inherits from URLError, so handle it first.
        raise _http_error(exc, api_key, "The local model") from exc

    except TimeoutError as exc:
        raise InferenceTimeoutError(effective_timeout) from exc

    except urllib.error.URLError as exc:
        # urllib may wrap the actual socket timeout inside URLError.reason.
        if isinstance(exc.reason, TimeoutError):
            raise InferenceTimeoutError(effective_timeout) from exc

        raise InferenceUnavailableError(f"The local model is unreachable: {exc.reason}") from exc

    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise InferenceValidationError(
            "The local model did not return a valid structured response."
        ) from exc

    if finish_reason == "length":
        raise IncompleteInferenceResponse(content, finish_reason)

    try:
        parsed = json.loads(content)

        if include_metadata:
            usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}

            parsed["_runtime"] = {
                "finishReason": finish_reason,
                "promptTokens": usage.get("prompt_tokens"),
                "completionTokens": usage.get("completion_tokens"),
                "totalTokens": usage.get("total_tokens"),
                "durationMs": round((time.monotonic() - started) * 1000),
            }

        return parsed

    except (ValueError, TypeError) as exc:
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
    """Whether a provider refused `response_format: json_schema` itself.

    A provider that sends the error envelope says which parameter it means: only a refusal that
    names `response_format` counts, whatever else the message mentions. A provider without one
    (N20: OpenRouter's 404, a bare string) is read by the markers in its text, as before. This
    never lets a refusal through that the markers alone would have turned away.
    """
    if not isinstance(exc, InferenceHTTPError):
        return False
    if exc.status not in _JSON_SCHEMA_REFUSAL_STATUSES:
        return False
    if exc.param is not None:
        return exc.param.startswith("response_format")
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
        raise _http_error(exc, api_key, "The local model tokenizer") from exc

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
