"""The Developer ID vs. Mac App Store split (backend/edition.py) and the three
places that branch on it. The Store build cannot be exercised end to end without
a sandboxed bundle, so these pin the decisions it depends on instead: which
runtime gets selected, what the installer refuses to do, and where llama-server
is looked up.
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import edition
from backend.llm import installer, select
from backend.llm.runtimes import bundled_runtime_dir, llamacpp


class EditionDetectionTests(unittest.TestCase):
    def test_defaults_to_devid_without_any_signal(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(edition.edition(), edition.DEVID)
            self.assertFalse(edition.is_store_build())

    def test_app_sandbox_container_id_means_store(self):
        """macOS sets this in every sandboxed process, and the sandbox is mandatory
        for Store apps -- so one build behaves correctly in both contexts."""
        with patch.dict("os.environ", {"APP_SANDBOX_CONTAINER_ID": "app.quiltor.desktop"}, clear=True):
            self.assertTrue(edition.is_store_build())

    def test_explicit_override_wins_over_autodetection(self):
        with patch.dict("os.environ", {"APP_SANDBOX_CONTAINER_ID": "x", "QUILTOR_EDITION": "devid"}, clear=True):
            self.assertEqual(edition.edition(), edition.DEVID)

    def test_unknown_edition_fails_loudly(self):
        with patch.dict("os.environ", {"QUILTOR_EDITION": "appstore"}, clear=True):
            with self.assertRaises(SystemExit):
                edition.edition()


class StoreBuildRuntimeChoiceTests(unittest.TestCase):
    def test_store_build_never_auto_selects_mlx(self):
        """Even on Apple Silicon, where MLX is otherwise preferred: installing it
        builds a venv and pip-installs into it, which guideline 2.5.2 forbids."""
        with patch("backend.llm.installer.is_apple_silicon", return_value=True):
            with patch("backend.llm.installer.is_store_build", return_value=True):
                self.assertEqual(installer.resolve_runtime("auto"), "llamacpp")
            with patch("backend.llm.installer.is_store_build", return_value=False):
                self.assertEqual(installer.resolve_runtime("auto"), "mlx")

    def test_store_build_does_not_probe_for_mlx_at_startup(self):
        with patch("backend.llm.select.is_apple_silicon", return_value=True):
            with patch("backend.llm.select.is_store_build", return_value=True):
                self.assertEqual(select._preference_order(), (llamacpp,))

    def test_store_build_refuses_to_install_the_mlx_runtime(self):
        with patch("backend.llm.installer.is_store_build", return_value=True):
            with self.assertRaises(SystemExit) as caught:
                installer.install_mlx_runtime()
        self.assertIn("2.5.2", str(caught.exception))


class BundledRuntimeTests(unittest.TestCase):
    def test_source_checkout_has_no_bundled_runtime(self):
        self.assertIsNone(bundled_runtime_dir())

    def test_binary_resolves_to_the_download_directory_by_default(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            self.assertEqual(llamacpp.resolve_binary(base), base / "runtime" / llamacpp.binary_name())

    def test_a_bundled_runtime_wins_over_a_downloaded_one(self):
        """A build shipping its own signed runtime must never fall back to a stale
        copy sitting next to it in the data directory."""
        with tempfile.TemporaryDirectory() as folder:
            base, bundle = Path(folder) / "home", Path(folder) / "bundle"
            for root in (base / "runtime", bundle):
                root.mkdir(parents=True)
                (root / llamacpp.binary_name()).touch()
            with patch("backend.llm.runtimes.llamacpp.bundled_runtime_dir", return_value=bundle):
                self.assertEqual(llamacpp.resolve_binary(base), bundle / llamacpp.binary_name())

    def test_installer_skips_the_download_when_the_runtime_ships_with_the_app(self):
        """The whole point of the bundled path: guideline 2.5.2 forbids downloading
        executable code, so this must not reach the network at all."""
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder)
            (bundle / llamacpp.binary_name()).touch()
            with patch("backend.llm.installer.bundled_runtime_dir", return_value=bundle):
                with patch("backend.llm.installer.latest_release_asset") as fetch:
                    installer.install_runtime()
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
