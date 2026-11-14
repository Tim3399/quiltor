"""Support for the local-AI conformance suite (T-179): a server under test and the real bridge.

The suite (`test_local_ai_conformance.py`) asks one question of a server: does it speak the
local-ai-contract (chat completions, the error envelope, the health route)? A server under test
is a base URL and what kind of server it is; the suite does not care how it got started.

Two kinds exist:
- "bridge": Quiltor's own MLX bridge. The suite starts the real `Handler` from `bridge.py` on a
  free port with fakes in `STATE`, so no MLX is needed and it runs on every platform.
- "llama": a running llama-server, named by `QUILTOR_CONFORMANCE_LLAMA_URL`. Nothing is
  downloaded or started here; without the variable the suite skips with a reason. CI starts the
  server and sets the variable.

When `QUILTOR_CONFORMANCE_ARTIFACT` names a file, every recorded case appends one JSON line with
its status and the raw answer, so the real answers of a pinned server can be kept as fixtures.
"""

from __future__ import annotations

import importlib.util
import json
import os
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any

LLAMA_URL_VARIABLE = "QUILTOR_CONFORMANCE_LLAMA_URL"
ARTIFACT_VARIABLE = "QUILTOR_CONFORMANCE_ARTIFACT"
REQUEST_TIMEOUT_SECONDS = 60

BRIDGE_PATH = (
    Path(__file__).resolve().parents[2] / "src/quiltor/resources/sidecars/inference/mlx/bridge.py"
)

_artifact_lock = threading.Lock()


@dataclass(frozen=True)
class Answer:
    """What a server said: the status and the raw text, parsed only on request."""

    status: int
    raw: str
    headers: dict[str, str] = field(default_factory=dict)

    def json(self) -> Any:
        return json.loads(self.raw)


@dataclass(frozen=True)
class ServerUnderTest:
    """A server the suite talks to: its base URL, its kind, and the key it expects, if any."""

    kind: str
    base_url: str
    api_key: str | None = None
    # The file recorded cases are appended to; None writes nothing.
    artifact: str | None = None

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> Answer:
        # Bytes go out as they are: that is how a case sends a body that is no JSON at all.
        data = (
            body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode()
        )
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if self.api_key:
            request.add_header("Authorization", f"Bearer {self.api_key}")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return Answer(
                    response.status, response.read().decode(), dict(response.headers.items())
                )
        except urllib.error.HTTPError as error:
            with error:
                return Answer(error.code, error.read().decode(), dict(error.headers.items()))

    def record(self, case: str, method: str, path: str, answer: Answer) -> None:
        """Append one line for this case to the artifact file, when there is one."""
        if not self.artifact:
            return
        line = json.dumps(
            {
                "case": case,
                "kind": self.kind,
                "method": method,
                "path": path,
                "status": answer.status,
                "raw": answer.raw,
            },
            ensure_ascii=False,
        )
        with _artifact_lock, open(self.artifact, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def llama_server_from_env() -> ServerUnderTest | None:
    """The server named by `QUILTOR_CONFORMANCE_LLAMA_URL`, or None when it is not set."""
    url = os.environ.get(LLAMA_URL_VARIABLE, "").strip().rstrip("/")
    if not url:
        return None
    return ServerUnderTest(
        kind="llama",
        base_url=url,
        api_key=os.environ.get("QUILTOR_CONFORMANCE_LLAMA_KEY") or None,
        artifact=os.environ.get(ARTIFACT_VARIABLE) or None,
    )


# --- The real bridge, with fakes where MLX would be ---------------------------------------------


def load_bridge() -> Any:
    """`bridge.py` loaded as a module of its own; it touches mlx only inside `load_model`."""
    spec = importlib.util.spec_from_file_location("conformance_bridge_under_test", BRIDGE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeTokenizer:
    """One token per word, so a prompt's length is something a test can choose."""

    def apply_chat_template(self, messages: list[dict[str, Any]], **_k: Any) -> str:
        return " ".join(str(message.get("content", "")) for message in messages)

    def encode(self, text: str) -> list[int]:
        return list(range(len(text.split())))


def fake_state(bridge: Any, *, script_tokens: int = 5, fail_with: str | None = None) -> dict:
    """What `STATE` holds once a model is loaded, with a scripted generation.

    The fake produces `script_tokens` tokens and then the schema is complete (reason "stop").
    A request allowing fewer tokens is cut off at `max_tokens` (reason "length"), which is the
    behaviour C17 asks of a server. `fail_with` makes generation raise, for the 500 case.
    """

    class Matcher:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            self.seen = 0

        @staticmethod
        def grammar_from_json_schema(_schema: Any) -> str:
            return "grammar"

        @staticmethod
        def validate_grammar(_grammar: Any) -> None:
            return None

        def is_stopped(self) -> bool:
            self.seen += 1
            return self.seen >= script_tokens

    def stream_generate(*_a: Any, max_tokens: int = 900, **_k: Any):
        if fail_with is not None:
            raise RuntimeError(fail_with)
        for _ in range(min(script_tokens, max_tokens)):
            yield SimpleNamespace(text="x")

    bridge.GRAMMAR_CACHE.clear()
    return {
        "ready": True,
        "error": None,
        "model": object(),
        "tokenizer": FakeTokenizer(),
        "ll_tokenizer": SimpleNamespace(vocab_size=4),
        "LLMatcher": Matcher,
        "stream_generate": stream_generate,
        "make_sampler": lambda **_k: None,
        "allocate_token_bitmask": lambda *_a: None,
    }


def start_bridge(bridge: Any) -> tuple[ThreadingHTTPServer, str]:
    """The bridge's real `Handler` on a free local port. The caller stops it."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"
