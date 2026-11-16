import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from quiltor.infrastructure.inference import engine as engine_module
from quiltor.infrastructure.inference import select
from quiltor.infrastructure.inference.runtimes import llamacpp, mlx


class RuntimeLaunchContractTests(unittest.TestCase):
    def setUp(self):
        # The tests lay models out under <tmp>/models; a QUILTOR_MODELS_DIR in the
        # developer's environment would send the runtimes to a different folder.
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("QUILTOR_MODELS_DIR", None)

    def test_llamacpp_starts_with_the_shared_8192_token_context(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            binary = base / "runtime" / llamacpp.binary_name()
            model = base / "models" / "model.gguf"
            binary.parent.mkdir(parents=True)
            model.parent.mkdir(parents=True)
            binary.touch()
            model.touch()
            with patch(
                "quiltor.infrastructure.inference.runtimes.llamacpp.spawn_logged",
                return_value=(object(), base / "log"),
            ) as spawn:
                result = llamacpp.start(base, base / "data", "http://127.0.0.1:8123", None, None)
        self.assertIsNotNone(result)
        argv = spawn.call_args.args[0]
        self.assertEqual(argv[argv.index("-c") + 1], "8192")
        self.assertIn("--jinja", argv)

    def test_mlx_starts_with_the_shared_8192_token_context(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            python = base / "runtime" / "mlx-venv" / "bin" / "python3"
            bridge = base / "sidecars" / "inference" / "mlx" / "bridge.py"
            model = base / "models" / "mlx" / "model"
            python.parent.mkdir(parents=True)
            bridge.parent.mkdir(parents=True)
            model.mkdir(parents=True)
            python.touch()
            bridge.touch()
            (model / "config.json").write_text(json.dumps({"model_type": "qwen3"}))
            with (
                patch(
                    "quiltor.infrastructure.inference.runtimes.mlx.resources.sidecar_asset",
                    return_value=bridge,
                ),
                patch(
                    "quiltor.infrastructure.inference.runtimes.mlx.spawn_logged",
                    return_value=(object(), base / "log"),
                ) as spawn,
            ):
                result = mlx.start(base, base / "data", "http://127.0.0.1:8124", None, None)
        self.assertIsNotNone(result)
        argv = spawn.call_args.args[0]
        self.assertEqual(argv[argv.index("--max-prompt-tokens") + 1], "8192")


class _AllAvailable:
    def is_available(self, _feature):
        return True


class WhoStartsTheSidecarTests(unittest.TestCase):
    """F-58-10: only a sidecar Quiltor starts itself needs a key, and that one always gets it."""

    def setUp(self):
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for name in (
            "QUILTOR_AI_URL",
            "QUILTOR_AI_KEY",
            "QUILTOR_AI_KEY_FILE",
            "QUILTOR_AI_RUNTIME",
        ):
            os.environ.pop(name, None)
        # The runtimes themselves are replaced, not select.start_runtime: its own decision is
        # what these tests are about.
        self.launched: list[str | None] = []

        def start(_base, _data, _url, _binary, _model, key=None):
            self.launched.append(key)
            return None

        for runtime in (llamacpp, mlx):
            patcher = patch.object(runtime, "start", side_effect=start)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _engine(self):
        return engine_module.LocalInferenceEngine(Path("."), Path("."), cast(Any, _AllAvailable()))

    def test_a_url_without_a_key_names_a_running_runtime_and_starts_none(self):
        os.environ["QUILTOR_AI_URL"] = "http://127.0.0.1:11435"
        engine = self._engine()
        self.assertFalse(engine.endpoint.external)
        self.assertEqual(self.launched, [], "a runtime that already runs must not be started again")
        self.assertIsNone(engine.process)
        self.assertIsNone(select.start_runtime(Path("."), Path("."), engine.url, "k"))

    def test_without_a_url_the_runtime_is_started_with_a_fresh_key(self):
        self._engine()
        self._engine()
        self.assertGreaterEqual(len(self.launched), 2)
        first, second = self.launched[0], self.launched[-1]
        self.assertTrue(first and len(first) >= 32, "the sidecar Quiltor starts gets a key")
        self.assertNotEqual(first, second, "every start has its own key")

    def test_an_external_endpoint_starts_nothing(self):
        os.environ["QUILTOR_AI_URL"] = "https://api.example.com"
        os.environ["QUILTOR_AI_KEY"] = "provider-key"
        engine = self._engine()
        self.assertTrue(engine.endpoint.external)
        self.assertEqual(self.launched, [])


if __name__ == "__main__":
    unittest.main()
