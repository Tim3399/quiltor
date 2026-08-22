#!/usr/bin/env python3
"""
MLX bridge server for Quiltor's local assistant on Apple Silicon.

Loads an MLX model and speaks the small OpenAI-compatible slice of HTTP that
src/quiltor/infrastructure/inference/shared/contract.py sends: GET /health, POST /v1/chat/completions
with response_format-constrained JSON output, and POST /tokenize (mirrors
llama.cpp server's own /tokenize endpoint, {"content": str} ->
{"tokens": [...]}) so callers can get an exact token count from this model's
real tokenizer instead of estimating. This is not a general-purpose
inference server -- only the surface Quiltor actually uses is implemented;
anything else gets a 400.

Runs inside runtime/mlx-venv, a dedicated virtualenv created by
src/quiltor/infrastructure/inference/installer.py (server.py offers this interactively on first
launch, or run `python3 -m quiltor.infrastructure.inference.installer --runtime mlx` directly).
It is spawned as a subprocess by
src/quiltor/infrastructure/inference/runtimes/mlx.py, the same way llama-server is spawned by
src/quiltor/infrastructure/inference/runtimes/llamacpp.py -- src/quiltor/modules/assistant.py never imports
mlx/mlx_lm/llguidance directly, so a Windows/Linux install of Quiltor never
needs them.

Usage:
    python3 src/quiltor/resources/sidecars/inference/mlx/bridge.py --model /path/to/mlx/model/dir --port 11435
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

STATE: dict[str, Any] = {
    "ready": False,
    "error": None,
    "model": None,
    "tokenizer": None,
    "ll_tokenizer": None,
}
GENERATION_LOCK = threading.Lock()
GRAMMAR_CACHE: dict[str, Any] = {}
MAX_PROMPT_TOKENS = 7000


def _resolve_apply_bitmask() -> Any:
    # Resolved once, at model-load time, not per token: SchemaProcessor is
    # invoked on every generated token, and re-resolving which bitmask
    # applier to use on every single call would mean a repeated
    # sys.modules lookup thousands of times per reply for no benefit --
    # this process only ever runs inside the MLX venv where these
    # packages are guaranteed present.
    try:
        from llguidance.mlx import apply_token_bitmask as metal_apply
    except Exception:
        metal_apply = None

    def apply(logits: Any, bitmask: Any) -> Any:
        if metal_apply is not None:
            try:
                return metal_apply(logits, bitmask)
            except Exception:
                pass
        # Falls back to the pure-numpy path if the Metal kernel module is
        # ever unavailable or incompatible with the installed MLX build --
        # slower, but correct, and it keeps the assistant working instead
        # of hard-failing on an internal implementation detail. This path
        # is exceptional, so its imports stay lazy here.
        import mlx.core as mx
        import numpy as np

        masked = np.array(logits, copy=True)
        masked[np.array(bitmask) == 0] = -np.inf
        return mx.array(masked)

    return apply


def load_model(model_dir: str) -> None:
    try:
        import llguidance.hf
        from llguidance import LLMatcher, LLTokenizer
        from llguidance.numpy import allocate_token_bitmask, fill_next_token_bitmask
        from mlx_lm import load, stream_generate
        from mlx_lm.sample_utils import make_sampler

        model, tokenizer = load(model_dir)
        ll_tokenizer = llguidance.hf.from_tokenizer(
            tokenizer._tokenizer, slices=LLTokenizer.json_slices()
        )
        STATE.update(
            model=model,
            tokenizer=tokenizer,
            ll_tokenizer=ll_tokenizer,
            LLMatcher=LLMatcher,
            stream_generate=stream_generate,
            make_sampler=make_sampler,
            allocate_token_bitmask=allocate_token_bitmask,
            fill_next_token_bitmask=fill_next_token_bitmask,
            apply_bitmask=_resolve_apply_bitmask(),
            ready=True,
        )
        print(f"MLX bridge: model loaded from {model_dir}", flush=True)
    except Exception as exc:  # noqa: BLE001 -- report every failure mode to the log, never crash silently
        STATE["error"] = str(exc)
        print(f"MLX bridge: failed to load model: {exc}", flush=True)


class SchemaProcessor:
    def __init__(self, matcher: Any, vocab_size: int, prompt_len: int):
        self.matcher = matcher
        self.prompt_len = prompt_len
        self.consumed = prompt_len
        self.bitmask = STATE["allocate_token_bitmask"](1, vocab_size)

    def __call__(self, tokens: Any, logits: Any) -> Any:
        n = tokens.size
        if n > self.consumed:
            for token_id in tokens[self.consumed : n].tolist():
                if not self.matcher.consume_token(token_id):
                    raise RuntimeError(self.matcher.get_error())
            self.consumed = n
        STATE["fill_next_token_bitmask"](self.matcher, self.bitmask)
        return STATE["apply_bitmask"](logits, self.bitmask)


def get_grammar(schema: dict[str, Any]) -> Any:
    matcher_cls = STATE["LLMatcher"]
    key = hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()
    if key not in GRAMMAR_CACHE:
        grammar = matcher_cls.grammar_from_json_schema(schema)
        error = matcher_cls.validate_grammar(grammar)
        if error:
            raise ValueError(f"invalid schema: {error}")
        GRAMMAR_CACHE[key] = grammar
    return GRAMMAR_CACHE[key]


def run_completion(payload: dict[str, Any]) -> dict[str, Any]:
    LLMatcher, stream_generate, make_sampler = (
        STATE["LLMatcher"],
        STATE["stream_generate"],
        STATE["make_sampler"],
    )
    model, tokenizer, ll_tokenizer = STATE["model"], STATE["tokenizer"], STATE["ll_tokenizer"]
    messages = payload.get("messages") or []
    temperature = float(payload.get("temperature", 0.2))
    max_tokens = int(payload.get("max_tokens", 900))
    response_format = payload.get("response_format") or {}
    schema = (response_format.get("json_schema") or {}).get("schema")
    if not isinstance(schema, dict):
        raise ValueError("response_format.json_schema.schema is required")

    grammar = get_grammar(schema)
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    prompt_len = len(tokenizer.encode(prompt))
    if prompt_len > MAX_PROMPT_TOKENS:
        raise ValueError(f"prompt too long: {prompt_len} tokens (limit {MAX_PROMPT_TOKENS})")

    matcher = LLMatcher(ll_tokenizer, grammar, log_level=0)
    processor = SchemaProcessor(matcher, ll_tokenizer.vocab_size, prompt_len)
    sampler = make_sampler(temp=temperature)

    with GENERATION_LOCK:
        text = ""
        completion_tokens = 0
        for response in stream_generate(
            model,
            tokenizer,
            prompt,
            max_tokens=max_tokens,
            sampler=sampler,
            logits_processors=[processor],
        ):
            text += response.text
            completion_tokens += 1
            if matcher.is_stopped():
                break

    return {
        "choices": [
            {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}
        ],
        "usage": {
            "prompt_tokens": prompt_len,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_len + completion_tokens,
        },
        "model": "mlx-bridge",
        "object": "chat.completion",
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 -- match BaseHTTPRequestHandler's signature
        print(f"MLX bridge: {self.address_string()} - {format % args}", flush=True)

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            if STATE["ready"]:
                self._send_json(200, {"status": "ok"})
            else:
                self._send_json(503, {"status": "loading", "error": STATE["error"]})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path not in {"/v1/chat/completions", "/tokenize"}:
            self._send_json(404, {"error": "not found"})
            return
        if not STATE["ready"]:
            self._send_json(503, {"error": "model not loaded yet"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length))
            if self.path == "/tokenize":
                tokens = STATE["tokenizer"].encode(str(payload.get("content", "")))
                self._send_json(200, {"tokens": list(tokens)})
                return
            result = run_completion(payload)
            self._send_json(200, result)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001 -- surface every failure as a 500, never let the handler crash the server
            print(f"MLX bridge: request failed: {exc}", flush=True)
            self._send_json(500, {"error": str(exc)})


def main() -> None:
    global MAX_PROMPT_TOKENS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="path to an MLX model directory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--max-prompt-tokens", type=int, default=MAX_PROMPT_TOKENS)
    args = parser.parse_args()

    MAX_PROMPT_TOKENS = args.max_prompt_tokens

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    threading.Thread(target=load_model, args=(args.model,), daemon=True).start()
    print(
        f"MLX bridge: listening on http://{args.host}:{args.port} (model loading in background)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if stream and stream.encoding and stream.encoding.lower() != "utf-8":
            stream.reconfigure(encoding="utf-8")
    main()
