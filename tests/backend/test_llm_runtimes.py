import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.llm.runtimes import llamacpp, mlx


class RuntimeLaunchContractTests(unittest.TestCase):
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
                "backend.llm.runtimes.llamacpp.spawn_logged", return_value=(object(), base / "log")
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
            bridge = base / "scripts" / "llm-runtime" / "mlx_bridge.py"
            model = base / "models" / "mlx" / "model"
            python.parent.mkdir(parents=True)
            bridge.parent.mkdir(parents=True)
            model.mkdir(parents=True)
            python.touch()
            bridge.touch()
            (model / "config.json").write_text(json.dumps({"model_type": "qwen3"}))
            with patch(
                "backend.llm.runtimes.mlx.spawn_logged", return_value=(object(), base / "log")
            ) as spawn:
                result = mlx.start(base, base / "data", "http://127.0.0.1:8124", None, None)
        self.assertIsNotNone(result)
        argv = spawn.call_args.args[0]
        self.assertEqual(argv[argv.index("--max-prompt-tokens") + 1], "8192")


if __name__ == "__main__":
    unittest.main()
