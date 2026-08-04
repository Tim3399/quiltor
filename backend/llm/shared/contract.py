from __future__ import annotations

import json
import urllib.error
import urllib.request
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


class ContextOverflowError(RuntimeError):
    """The prompt itself exceeded the model's context window.

    The runtime rejects such a request with HTTP 400 (llama.cpp:
    ``exceed_context_size_error``) *before* generating anything -- a different
    failure from an unreachable server, and one the caller can only fix by
    sending less context, never by retrying the same payload. Kept distinct
    from the generic "not reachable" RuntimeError so the caller reports an
    honest, actionable message instead of pretending the model is down.
    """

    def __init__(self, prompt_tokens: int | None, context_tokens: int | None):
        super().__init__("Der Kontext ist zu groß für das lokale Modell.")
        self.prompt_tokens = prompt_tokens
        self.context_tokens = context_tokens


def json_schema_format(schema: dict[str, Any], name: str = "quiltor_reply") -> dict[str, Any]:
    """Build the response_format that forces JSON-schema-constrained decoding.

    The schema must be nested under json_schema.schema -- a flatter
    top-level "schema" key is silently ignored by llama.cpp (and by every
    other OpenAI-compatible server), which disables constrained decoding
    without raising any error. This is the one shape every runtime backend
    (llama.cpp, MLX, a remote endpoint via QUILTOR_AI_URL) must honour.
    """
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def _read_error_body(exc: urllib.error.HTTPError) -> Any:
    """Best-effort parse of an HTTP error body as JSON; the raw text otherwise.

    llama.cpp's OpenAI facade returns a structured JSON error (type + token
    counts) on a context overflow, but a bare string on other failures -- read
    defensively so a malformed body never masks the original HTTP error.
    """
    try:
        return json.loads(exc.read())
    except Exception:
        return {}


def invoke_chat(url: str, payload: dict[str, Any], timeout: int = 180) -> dict[str, Any]:
    """POST an OpenAI-compatible /v1/chat/completions request and return the parsed JSON content.

    This is the one HTTP contract every local runtime backend must speak;
    nothing here is specific to llama.cpp.
    """
    request = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read())
        choice = result["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")
    except urllib.error.HTTPError as exc:
        # HTTPError is a URLError subclass, so it must be handled first -- otherwise
        # a "prompt too big" 400 masquerades as "model not reachable" and hides the
        # only fixable cause. llama.cpp reports the context overflow as HTTP 400 with
        # type "exceed_context_size_error" and the exact token counts.
        detail = _read_error_body(exc)
        if exc.code == 400 and "exceed_context_size" in json.dumps(detail):
            error = detail.get("error", {}) if isinstance(detail, dict) else {}
            raise ContextOverflowError(error.get("n_prompt_tokens"), error.get("n_ctx")) from exc
        raise RuntimeError("Das lokale Modell hat die Anfrage abgelehnt.") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Das lokale Modell ist nicht erreichbar.") from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError("Das lokale Modell hat keine gültige strukturierte Antwort geliefert.") from exc
    try:
        return json.loads(content)
    except ValueError as exc:
        if finish_reason == "length":
            raise IncompleteResponse(content, finish_reason) from exc
        raise RuntimeError("Das lokale Modell hat keine gültige strukturierte Antwort geliefert.") from exc


def embed(url: str, texts: list[str], timeout: float = 60) -> list[list[float]]:
    """Return one embedding vector per input text via the OpenAI-compatible
    /v1/embeddings endpoint. Results are reordered by the response's `index` so the
    output aligns positionally with `texts` regardless of server batching order.
    Raises RuntimeError on any transport or shape failure -- callers treat that as
    "embeddings unavailable, fall back to lexical retrieval"."""
    request = urllib.request.Request(f"{url}/v1/embeddings", data=json.dumps({"model": "local", "input": texts}).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read())
        ordered = sorted(result["data"], key=lambda item: item.get("index", 0))
        return [item["embedding"] for item in ordered]
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Der Embedding-Dienst ist nicht erreichbar.") from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError("Der Embedding-Dienst hat keine gültige Antwort geliefert.") from exc


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
