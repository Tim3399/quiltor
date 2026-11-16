"""The MLX bridge's finish_reason, without a real MLX install.

The bridge only touches mlx_lm / llguidance through STATE, so the tests fill STATE with
fakes and never import either package.
"""

from __future__ import annotations

import importlib.util
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from quiltor.infrastructure.inference.shared.contract import invoke_chat
from quiltor.modules.assistant.ports import IncompleteInferenceResponse

BRIDGE_PATH = (
    Path(__file__).resolve().parents[2] / "src/quiltor/resources/sidecars/inference/mlx/bridge.py"
)
_spec = importlib.util.spec_from_file_location("mlx_bridge_under_test", BRIDGE_PATH)
assert _spec is not None and _spec.loader is not None
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)

PAYLOAD = {
    "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 3,
    "response_format": {"json_schema": {"schema": {"type": "object"}}},
}


class FakeMatcher:
    @staticmethod
    def grammar_from_json_schema(_schema: Any) -> str:
        return "grammar"

    @staticmethod
    def validate_grammar(_grammar: Any) -> None:
        return None


class FakeTokenizer:
    def apply_chat_template(self, *_a: Any, **_k: Any) -> str:
        return "prompt"

    def encode(self, _text: str) -> list[int]:
        return [1, 2]


def _run(responses: list[SimpleNamespace], *, matcher_stops_at: int | None = None) -> dict:
    """Run the bridge over scripted mlx-lm responses and return its completion."""

    class Matcher(FakeMatcher):
        def __init__(self, *_a: Any, **_k: Any) -> None:
            self.seen = 0

        def is_stopped(self) -> bool:
            self.seen += 1
            return matcher_stops_at is not None and self.seen >= matcher_stops_at

    def stream_generate(*_a: Any, **_k: Any):
        yield from responses

    bridge.GRAMMAR_CACHE.clear()
    state = {
        "model": object(),
        "tokenizer": FakeTokenizer(),
        "ll_tokenizer": SimpleNamespace(vocab_size=4),
        "LLMatcher": Matcher,
        "stream_generate": stream_generate,
        "make_sampler": lambda **_k: None,
        "allocate_token_bitmask": lambda *_a: None,
    }
    with patch.dict(bridge.STATE, state):
        return bridge.run_completion(dict(PAYLOAD))


def _tokens(count: int, last_finish: str | None = None) -> list[SimpleNamespace]:
    return [
        SimpleNamespace(text="x", finish_reason=last_finish if i == count - 1 else None)
        for i in range(count)
    ]


def _finish(result: dict) -> str:
    return result["choices"][0]["finish_reason"]


class BridgeFinishReasonTests(unittest.TestCase):
    def test_max_tokens_cutoff_reports_length(self):
        self.assertEqual(_finish(_run(_tokens(3, "length"))), "length")

    def test_max_tokens_cutoff_reports_length_without_a_finish_reason_field(self):
        plain = [SimpleNamespace(text="x") for _ in range(3)]
        self.assertEqual(_finish(_run(plain)), "length")

    def test_stopped_matcher_reports_stop(self):
        # The schema finished on the last allowed token: still "stop", not "length".
        self.assertEqual(_finish(_run(_tokens(3, "length"), matcher_stops_at=3)), "stop")
        self.assertEqual(_finish(_run(_tokens(3), matcher_stops_at=2)), "stop")

    def test_model_eos_under_the_limit_reports_stop(self):
        self.assertEqual(_finish(_run(_tokens(2, "stop"))), "stop")
        self.assertEqual(_finish(_run(_tokens(2))), "stop")


class BridgeLengthTriggersRetryTests(unittest.TestCase):
    def test_a_length_response_raises_incomplete_so_the_caller_can_grow_max_tokens(self):
        truncated = _run(_tokens(3, "length"))
        truncated["choices"][0]["message"]["content"] = '{"message": "ab'
        response = io.BytesIO(json.dumps(truncated).encode())
        with (
            patch(
                "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
                return_value=_Ctx(response),
            ),
            self.assertRaises(IncompleteInferenceResponse),
        ):
            invoke_chat("http://mock", {"messages": []})


class _Ctx:
    def __init__(self, body: io.BytesIO) -> None:
        self.body = body

    def __enter__(self) -> io.BytesIO:
        return self.body

    def __exit__(self, *_a: Any) -> None:
        return None
