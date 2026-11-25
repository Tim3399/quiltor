"""The local llama-server gets DRY sampling against endless lists (T-367)."""

from __future__ import annotations

import unittest
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from quiltor.infrastructure.inference import engine as engine_module


class _Available:
    def is_available(self, _feature: object) -> bool:
        return True


class LoopGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        env = patch.dict("os.environ", {})
        env.start()
        self.addCleanup(env.stop)
        for name in ("QUILTOR_AI_URL", "QUILTOR_AI_KEY", "QUILTOR_AI_KEY_FILE"):
            engine_module.os.environ.pop(name, None)

    def _engine(self, log_name: str = "llama-server.log") -> engine_module.LocalInferenceEngine:
        with patch.object(engine_module.select, "start_runtime", return_value=None):
            engine = engine_module.LocalInferenceEngine(
                Path("."), Path("."), cast(Any, _Available())
            )
        engine.log_path = Path(log_name)
        return engine

    def _sent(
        self, engine: engine_module.LocalInferenceEngine, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with patch.object(engine_module, "invoke_chat", return_value={}) as chat:
            engine.invoke(payload)
        return chat.call_args.args[1]

    def test_a_local_llama_request_carries_dry_sampling(self):
        sent = self._sent(self._engine(), {"messages": [], "max_tokens": 900})
        for key, value in engine_module.LLAMA_LOOP_GUARD.items():
            self.assertEqual(sent[key], value)
        self.assertEqual(sent["max_tokens"], 900)

    def test_the_request_wins_over_the_default(self):
        sent = self._sent(self._engine(), {"messages": [], "dry_multiplier": 0.0})
        self.assertEqual(sent["dry_multiplier"], 0.0)

    def test_the_caller_payload_is_not_changed(self):
        payload: dict[str, Any] = {"messages": []}
        self._sent(self._engine(), payload)
        self.assertEqual(payload, {"messages": []})

    def test_the_mlx_bridge_gets_nothing_extra(self):
        sent = self._sent(self._engine("mlx-server.log"), {"messages": []})
        self.assertEqual(sent, {"messages": []})

    def test_an_external_provider_gets_nothing_extra(self):
        engine_module.os.environ["QUILTOR_AI_URL"] = "https://api.example.com"
        engine_module.os.environ["QUILTOR_AI_KEY"] = "provider-key"
        engine = self._engine()
        self.assertTrue(engine.endpoint.external)
        self.assertNotIn("dry_multiplier", self._sent(engine, {"messages": []}))


if __name__ == "__main__":
    unittest.main()
