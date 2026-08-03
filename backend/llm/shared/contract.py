from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def json_schema_format(schema: dict[str, Any], name: str = "quiltor_reply") -> dict[str, Any]:
    """Build the response_format that forces JSON-schema-constrained decoding.

    The schema must be nested under json_schema.schema -- a flatter
    top-level "schema" key is silently ignored by llama.cpp (and by every
    other OpenAI-compatible server), which disables constrained decoding
    without raising any error. This is the one shape every runtime backend
    (llama.cpp, MLX, a remote endpoint via QUILTOR_AI_URL) must honour.
    """
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def invoke_chat(url: str, payload: dict[str, Any], timeout: int = 180) -> dict[str, Any]:
    """POST an OpenAI-compatible /v1/chat/completions request and return the parsed JSON content.

    This is the one HTTP contract every local runtime backend must speak;
    nothing here is specific to llama.cpp.
    """
    request = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read())
        content = result["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Das lokale Modell ist nicht erreichbar.") from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError("Das lokale Modell hat keine gültige strukturierte Antwort geliefert.") from exc
    return parsed


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
