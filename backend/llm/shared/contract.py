from __future__ import annotations

import json
import urllib.error
import urllib.request
import time
from typing import Any


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


def json_schema_format(schema: dict[str, Any], name: str = "quiltor_reply") -> dict[str, Any]:
    """Build the response_format that forces JSON-schema-constrained decoding.

    The schema must be nested under json_schema.schema -- a flatter
    top-level "schema" key is silently ignored by llama.cpp (and by every
    other OpenAI-compatible server), which disables constrained decoding
    without raising any error. This is the one shape every runtime backend
    (llama.cpp, MLX, a remote endpoint via QUILTOR_AI_URL) must honour.
    """
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def invoke_chat(url: str, payload: dict[str, Any], timeout: int = 180, include_metadata: bool = False) -> dict[str, Any]:
    """POST an OpenAI-compatible /v1/chat/completions request and return the parsed JSON content.

    This is the one HTTP contract every local runtime backend must speak;
    nothing here is specific to llama.cpp.
    """
    request = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read())
        choice = result["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Das lokale Modell ist nicht erreichbar.") from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError("Das lokale Modell hat keine gültige strukturierte Antwort geliefert.") from exc
    try:
        parsed = json.loads(content)
        if include_metadata:
            usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
            parsed["_runtime"] = {"finishReason": finish_reason or "unknown", "promptTokens": usage.get("prompt_tokens"), "completionTokens": usage.get("completion_tokens"), "totalTokens": usage.get("total_tokens"), "durationMs": round((time.monotonic() - started) * 1000)}
        return parsed
    except ValueError as exc:
        if finish_reason == "length":
            raise IncompleteResponse(content, finish_reason) from exc
        raise RuntimeError("Das lokale Modell hat keine gültige strukturierte Antwort geliefert.") from exc


def check_health(url: str, timeout: float = 0.7) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def count_tokens(url: str, text: str, timeout: float = 10) -> int:
    """Return the exact token count for text using the runtime's own tokenizer.

    The model runs on the same machine we do, so an estimate (chars-per-token
    heuristics etc.) buys nothing -- the real tokenizer is one local HTTP call
    away. Every runtime backend (llama.cpp, the MLX bridge) implements
    POST /tokenize -> {"tokens": [...]} alongside /v1/chat/completions and
    /health for exactly this reason.
    """
    request = urllib.request.Request(f"{url}/tokenize", data=json.dumps({"content": text}).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read())
        return len(result["tokens"])
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Das lokale Modell ist nicht erreichbar.") from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError("Das lokale Modell hat keine gültige Token-Antwort geliefert.") from exc
