import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from quiltor.infrastructure.inference import installer
from quiltor.infrastructure.inference.engine import LocalInferenceEngine
from quiltor.infrastructure.inference.model_store import ModelsDirError, model_store
from quiltor.infrastructure.inference.runtimes import llamacpp, mlx

ENV = "QUILTOR_MODELS_DIR"


@contextlib.contextmanager
def _env(value):
    saved = os.environ.get(ENV)
    if value is None:
        os.environ.pop(ENV, None)
    else:
        os.environ[ENV] = value
    try:
        yield
    finally:
        if saved is None:
            os.environ.pop(ENV, None)
        else:
            os.environ[ENV] = saved


def _fake_download(artifact, target, label, on_progress=None):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("weights")


class _Capabilities:
    def is_available(self, _feature):
        return True

    def evaluate(self, _feature):
        return type("Availability", (), {"available": True, "reasons": ()})()


class ModelsDirTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.home = self.root / "home"
        self.models = self.root / "shared-models"
        self.home.mkdir()
        self.models.mkdir()

    def _llama_start(self):
        binary = self.home / "runtime" / llamacpp.binary_name()
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.touch()
        with patch(
            "quiltor.infrastructure.inference.runtimes.llamacpp.spawn_logged",
            return_value=(object(), self.home / "log"),
        ) as spawn:
            result = llamacpp.start(
                self.home, self.home / "data", "http://127.0.0.1:8123", None, None
            )
        return result, spawn

    def test_llamacpp_finds_the_gguf_under_the_gguf_subfolder_of_the_root(self):
        (self.models / "gguf").mkdir()
        gguf = self.models / "gguf" / "x.gguf"
        gguf.touch()
        with _env(str(self.models)):
            result, spawn = self._llama_start()
        self.assertIsNotNone(result)
        argv = spawn.call_args.args[0]
        self.assertEqual(Path(argv[argv.index("-m") + 1]), gguf)

    def test_mlx_finds_the_model_under_the_mlx_subfolder_of_the_root(self):
        model = self.models / "mlx" / "m"
        model.mkdir(parents=True)
        (model / "config.json").write_text(json.dumps({"model_type": "qwen3"}))
        python = self.home / "runtime" / "mlx-venv" / "bin" / "python3"
        python.parent.mkdir(parents=True)
        python.touch()
        bridge = self.home / "bridge.py"
        bridge.touch()
        with (
            _env(str(self.models)),
            patch(
                "quiltor.infrastructure.inference.runtimes.mlx.resources.sidecar_asset",
                return_value=bridge,
            ),
            patch(
                "quiltor.infrastructure.inference.runtimes.mlx.spawn_logged",
                return_value=(object(), self.home / "log"),
            ) as spawn,
        ):
            result = mlx.start(self.home, self.home / "data", "http://127.0.0.1:8123", None, None)
        self.assertIsNotNone(result)
        argv = spawn.call_args.args[0]
        self.assertEqual(Path(argv[argv.index("--model") + 1]), model)

    def test_a_gguf_in_home_models_is_ignored_while_the_variable_is_set(self):
        (self.home / "models").mkdir()
        (self.home / "models" / "old.gguf").touch()
        with _env(str(self.models)):
            result, _ = self._llama_start()
        self.assertIsNone(result)

    def test_the_installer_writes_the_gguf_into_the_gguf_subfolder(self):
        with (
            _env(str(self.models)),
            patch.object(installer, "_model_artifacts", return_value={"x.gguf": object()}),
            patch.object(installer, "download", _fake_download),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            installer.install_model("o/r", "x.gguf", paths=installer.installer_paths(self.home))
        self.assertEqual((self.models / "gguf" / "x.gguf").read_text(), "weights")
        self.assertFalse((self.home / "models").exists())

    def test_the_installer_writes_the_mlx_model_into_the_mlx_subfolder(self):
        with (
            _env(str(self.models)),
            patch.object(installer, "_model_artifacts", return_value={"config.json": object()}),
            patch.object(installer, "download", _fake_download),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            installer.install_mlx_model("o/mm", paths=installer.installer_paths(self.home))
        self.assertTrue((self.models / "mlx" / "mm" / "config.json").is_file())
        self.assertFalse((self.home / "models").exists())

    def test_the_runtime_stays_under_home_while_the_variable_is_set(self):
        with _env(str(self.models)):
            paths = installer.installer_paths(self.home)
        self.assertEqual(paths.runtime, self.home / "runtime")
        self.assertEqual(paths.mlx_venv, self.home / "runtime" / "mlx-venv")

    def test_without_the_variable_the_paths_are_the_historical_ones(self):
        with _env(None):
            paths = installer.installer_paths(self.home)
            store = model_store(self.home)
        self.assertEqual(paths.models, self.home / "models")
        self.assertEqual(paths.mlx_models, self.home / "models" / "mlx")
        self.assertEqual((store.gguf, store.mlx), (paths.models, paths.mlx_models))

    def test_an_empty_or_blank_value_counts_as_not_set(self):
        for value in ("", "   "):
            with self.subTest(value=value), _env(value):
                self.assertEqual(installer.installer_paths(self.home).models, self.home / "models")

    def test_a_missing_folder_is_reported_with_its_path_and_not_created(self):
        missing = self.root / "F" / "ai" / "models"
        with _env(str(missing)), self.assertRaises(ModelsDirError) as caught:
            installer.installer_paths(self.home)
        self.assertIn(str(missing), str(caught.exception))
        self.assertIn(ENV, str(caught.exception))
        self.assertFalse(missing.exists())

    def test_a_missing_folder_surfaces_as_a_status_reason_not_a_traceback(self):
        missing = self.root / "gone"
        with _env(str(missing)), patch("sys.stderr", io.StringIO()):
            engine = LocalInferenceEngine(
                self.home,
                self.home / "data",
                cast(Any, _Capabilities()),
            )
            with patch("quiltor.infrastructure.inference.engine.check_health", return_value=False):
                status = engine.status()
        self.assertFalse(status["available"])
        self.assertIn(str(missing), status["reason"])

    def test_a_missing_folder_reads_as_not_configured_and_ensure_installed_says_why(self):
        missing = self.root / "gone"
        out = io.StringIO()
        with _env(str(missing)), contextlib.redirect_stdout(out):
            self.assertFalse(installer.is_configured(self.home))
            installer.ensure_installed(self.home)
        self.assertIn(str(missing), out.getvalue())


if __name__ == "__main__":
    unittest.main()
