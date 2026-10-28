"""Export a real assistant request for the browser-inference test page (T-54, D-T-54-2).

    PYTHONPATH=src py -3.12 tools/evaluation/browser-inference/export_prompt.py

Runs the product's own completion pipeline (`quiltor.modules.assistant.completion`) on the
synthetic evaluation world from `tools/evaluation/assistant/seed_synthetic_world.py` and stops
at the first request the server would send to `/v1/chat/completions`. Nothing in the prompt is
rebuilt here: a stub runtime only records that payload and aborts.

Two variants are written to `prompt.json`:

- `base`: the request alone, about 4k prompt tokens.
- `long`: the same request with a conversation history in front, about 6k prompt tokens. It
  exists for measurement 2 (does an 8192-token window work), because a prompt over 4096 tokens
  only fits when the larger window is in effect.

Token counts come from the Qwen3 tokenizer of the local llama.cpp model (`llama-tokenize` with
`models/Qwen3-4B-Q4_K_M.gguf`) when it is present; otherwise the file says they are estimates.
The page reports the exact count WebLLM's own tokenizer used (`usage.prompt_tokens`).
"""

from __future__ import annotations

import importlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, cast

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "tools" / "evaluation" / "assistant"))

# Loaded by name from the path above: the seed script is not part of any package.
_seed: Any = importlib.import_module("seed_synthetic_world")
EDGES, MANUSCRIPT, NODES, TIMELINE = _seed.EDGES, _seed.MANUSCRIPT, _seed.NODES, _seed.TIMELINE

from quiltor.application.story_world.read_tools import read_tool_catalog  # noqa: E402
from quiltor.modules.assistant.completion import complete_request  # noqa: E402

# Chapters tc01-tc08 of the synthetic world, forced into the context the way the editor does
# when the author asks about selected chapters. The long filler chapter stays out.
CHAPTER_IDS = ["tc01", "tc02", "tc03", "tc04", "tc05", "tc06", "tc07", "tc08"]
QUESTION = "Wie entwickelt sich Corvins Loyalität gegenüber Iven über diese Kapitel?"
GGUF_NAME = "Qwen3-4B-Q4_K_M.gguf"
# A worktree under `.claude/worktrees/` has no `models/` or `runtime/`; use the main checkout's.
LOCAL = next(
    (root for root in (REPO, *REPO.parents) if (root / "models" / GGUF_NAME).exists()), REPO
)
MODEL_GGUF = LOCAL / "models" / GGUF_NAME
TOKENIZER = LOCAL / "runtime" / "llama-tokenize.exe"
# Only used inside the pipeline to pick chunks; the exported counts use the real tokenizer.
CHARS_PER_TOKEN = 3.5


class Captured(Exception):
    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__("captured")
        self.payload = payload


class _Inference:
    def count_tokens(self, text: str) -> int:
        return int(len(text) / CHARS_PER_TOKEN) + 1


class _TokenCache:
    def count(self, identity: str, text: str, counter: Any) -> int:
        return counter(text)

    def stats(self) -> dict[str, int]:
        return {}


class _ReadTools:
    def catalog(self) -> tuple[dict[str, Any], ...]:
        return tuple(read_tool_catalog())

    def execute_many(self, calls: list[dict[str, Any]], **_: Any) -> Any:
        raise AssertionError("the export stops before any tool runs")


class _Runtime:
    url = "export"
    debug_enabled = False

    def __init__(self) -> None:
        self.inference = _Inference()
        self.token_cache = _TokenCache()
        self.read_tools = _ReadTools()
        self._invocation_metrics: list[dict[str, Any]] = []

    def _invoke_with_growth(self, payload: dict[str, Any], prompt_tokens: int) -> dict[str, Any]:
        raise Captured(payload)

    def _plan(self, question: str, context: list[Any]) -> dict[str, Any]:
        return {"goal": question, "steps": [], "searchQueries": [], "requiredKinds": []}

    def _forced_proposal(self, *_: Any) -> None:
        return None

    def _run_batches(self, *_: Any, **__: Any) -> dict[str, Any]:
        raise AssertionError("the export never runs batches")


def capture(history: list[dict[str, Any]] | None) -> dict[str, Any]:
    figures = {"nodes": NODES, "edges": EDGES, "timeline": TIMELINE}
    try:
        complete_request(
            # A recording stub, not a full runtime: only what the pipeline touches before the
            # first model call exists.
            cast(Any, _Runtime()),
            QUESTION,
            MANUSCRIPT,
            figures,
            history=history,
            chapter_ids=CHAPTER_IDS,
            world_revision=1,
        )
    except Captured as captured:
        return captured.payload
    raise RuntimeError("the pipeline answered without asking the model")


def exact_tokens(payload: dict[str, Any]) -> int | None:
    """Count the message contents with Qwen3's tokenizer (chat template tokens excluded)."""

    if not (TOKENIZER.exists() and MODEL_GGUF.exists()):
        return None
    text = "".join(str(message["content"]) for message in payload["messages"])
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as file:
        file.write(text)
    result = subprocess.run(
        [str(TOKENIZER), "-m", str(MODEL_GGUF), "-f", file.name, "--show-count", "--log-disable"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    Path(file.name).unlink()
    match = re.search(r"Total number of tokens:\s*(\d+)", result.stdout + result.stderr)
    return int(match.group(1)) if match else None


def history() -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    # Earlier summaries of each chapter push the prompt well past 4096 tokens while staying
    # inside the product's own history budget (RUNTIME_CONFIG.history_tokens).
    summaries = [
        (f"Was geschieht in „{chapter['title']}“ für Mara?", f"{chapter['body']} {chapter['note']}")
        for chapter in MANUSCRIPT["chapters"]
        if chapter["id"] in CHAPTER_IDS
    ]
    for question, answer in summaries:
        turns.append({"role": "user", "content": question})
        turns.append({"role": "assistant", "content": answer})
    return turns


def main() -> None:
    variants: dict[str, Any] = {}
    for name, past in (("base", None), ("long", history())):
        payload = capture(past)
        tokens = exact_tokens(payload)
        variants[name] = {
            "promptTokens": tokens,
            "promptTokensSource": "llama-tokenize Qwen3-4B" if tokens else "unknown",
            "request": {
                "messages": payload["messages"],
                "temperature": payload["temperature"],
                "max_tokens": payload["max_tokens"],
                "response_format": payload["response_format"],
            },
        }
        print(f"{name}: {tokens} prompt tokens, {len(payload['messages'])} messages")
    document = {
        "world": "Quiltor AI Testwelt (tools/evaluation/assistant/seed_synthetic_world.py)",
        "chapters": CHAPTER_IDS,
        "question": QUESTION,
        "variants": variants,
    }
    text = json.dumps(document, ensure_ascii=False, indent=2)
    out = HERE / "prompt.json"
    out.write_text(text + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out.relative_to(REPO)}")
    # The same data as a classic script: a page opened from file:// may not fetch prompt.json.
    script = HERE / "prompt.js"
    script.write_text(
        "// Generated by export_prompt.py from prompt.json; do not edit.\n"
        f"window.QUILTOR_PROMPT = {text};\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {script.relative_to(REPO)}")


if __name__ == "__main__":
    main()
