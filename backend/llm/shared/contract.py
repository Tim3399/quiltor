from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any


DEFAULT_CHAT_TIMEOUT_SECONDS = 600


class IncompleteResponse(RuntimeError):
    """The model's reply was cut off by max_tokens mid-JSON, not malformed.

    Distinct from the generic parse-failure RuntimeError so callers can retry
    with a larger budget instead of giving up immediately -- retrying can't
    help a genuinely malformed response, only a truncated one.
    """

    def __init__(self, raw_content: str, finish_reason: str):
        super().__init__("Das lokale Modell hat die Antwort nicht rechtzeitig fertiggestellt.")
        self.raw_content = raw_content
        self.finish_reason = finish_reason


class RuntimeTimeoutError(RuntimeError):
    """The runtime was reachable, but inference did not finish in time."""

    def __init__(self, timeout_seconds: float):
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"Das lokale Modell hat die Anfrage nicht innerhalb von "
            f"{timeout_seconds:g} Sekunden abgeschlossen."
        )


class RuntimeUnavailableError(RuntimeError):
    """The runtime could not be reached."""


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
        with urllib.request.urlopen(
            request,
            timeout=effective_timeout,
        ) as response:
            result = json.loads(response.read())

        choice = result["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")

    except urllib.error.HTTPError as exc:
        # HTTPError inherits from URLError, so handle it first.
        try:
            body = (
                exc.read()
                .decode(
                    "utf-8",
                    errors="replace",
                )
                .strip()
            )
        except Exception:
            body = ""

        detail = body[:1000] if body else str(exc.reason)

        raise RuntimeError(
            f"Das lokale Modell hat mit HTTP {exc.code} geantwortet: {detail}"
        ) from exc

    except TimeoutError as exc:
        raise RuntimeTimeoutError(effective_timeout) from exc

    except urllib.error.URLError as exc:
        # urllib may wrap the actual socket timeout inside URLError.reason.
        if isinstance(exc.reason, TimeoutError):
            raise RuntimeTimeoutError(effective_timeout) from exc

        raise RuntimeUnavailableError(
            f"Das lokale Modell ist nicht erreichbar: {exc.reason}"
        ) from exc

    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError(
            "Das lokale Modell hat keine gültige strukturierte Antwort geliefert."
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
            raise IncompleteResponse(
                content,
                finish_reason,
            ) from exc

        raise RuntimeError(
            "Das lokale Modell hat keine gültige strukturierte Antwort geliefert."
        ) from exc


def check_health(url: str, timeout: float = 0.7) -> bool:
    try:
        with urllib.request.urlopen(
            f"{url}/health",
            timeout=timeout,
        ) as response:
            return response.status == 200
    except Exception:
        return False


def count_tokens(
    url: str,
    text: str,
    timeout: float = 10,
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
        with urllib.request.urlopen(
            request,
            timeout=timeout,
        ) as response:
            result = json.loads(response.read())

        return len(result["tokens"])

    except urllib.error.HTTPError as exc:
        try:
            body = (
                exc.read()
                .decode(
                    "utf-8",
                    errors="replace",
                )
                .strip()
            )
        except Exception:
            body = ""

        detail = body[:1000] if body else str(exc.reason)

        raise RuntimeError(
            f"Der lokale Modell-Tokenizer hat mit HTTP {exc.code} geantwortet: {detail}"
        ) from exc

    except TimeoutError as exc:
        raise RuntimeTimeoutError(timeout) from exc

    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise RuntimeTimeoutError(timeout) from exc

        raise RuntimeUnavailableError(
            f"Das lokale Modell ist nicht erreichbar: {exc.reason}"
        ) from exc

    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError("Das lokale Modell hat keine gültige Token-Antwort geliefert.") from exc
