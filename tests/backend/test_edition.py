"""The distribution split (backend/edition/) and the places that branch on it.
A Store build cannot be exercised end to end without a sandboxed bundle, so
these pin the decisions it depends on instead: which runtime gets selected, what
the installer refuses to do, and where llama-server is looked up.
"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import edition
from backend.edition import contract, direct, mas, msstore
from backend.language import grammar
from backend.language.grammar import contract as grammar_contract
from backend.llm import installer, select
from backend.llm.runtimes import bundled_runtime_dir, llamacpp


class EditionDetectionTests(unittest.TestCase):
    def test_defaults_to_direct_without_any_signal(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("backend.system.in_os_app_package", return_value=False):
                self.assertEqual(edition.edition(), edition.DIRECT)
                self.assertFalse(edition.is_store_build())

    def test_an_os_app_container_on_macos_means_the_mac_app_store(self):
        """Which store an app container implies follows from the platform.

        This used to set APP_SANDBOX_CONTAINER_ID and let the real
        in_os_app_package() read it, which passes on a Mac and fails everywhere
        else -- backend.system selects the Linux implementation on the CI
        runner, and that one answers False whatever the environment says. The
        env var is macOS's signal and is pinned where it lives, in
        test_system.py; what belongs here is only the mapping from "in a
        container" to an edition."""
        with patch.dict("os.environ", {}, clear=True):
            with patch("backend.system.in_os_app_package", return_value=True):
                with patch("backend.system.os_name", return_value="macos"):
                    self.assertEqual(edition.edition(), edition.MAS)
                    self.assertTrue(edition.is_store_build())

    def test_an_os_app_container_on_windows_means_the_microsoft_store(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("backend.system.in_os_app_package", return_value=True):
                with patch("backend.system.os_name", return_value="windows"):
                    self.assertEqual(edition.edition(), edition.MSSTORE)
                    self.assertTrue(edition.is_store_build())

    def test_explicit_override_wins_over_autodetection(self):
        with patch.dict(
            "os.environ", {"APP_SANDBOX_CONTAINER_ID": "x", "QUILTOR_EDITION": "direct"}, clear=True
        ):
            self.assertEqual(edition.edition(), edition.DIRECT)

    def test_unknown_edition_fails_loudly(self):
        with patch.dict("os.environ", {"QUILTOR_EDITION": "appstore"}, clear=True):
            with self.assertRaises(SystemExit):
                edition.edition()


class EditionPolicyTests(unittest.TestCase):
    """The policy answers are what capabilities actually consult, so pin them
    per edition rather than leaving them to be re-derived at each call site."""

    def test_direct_distribution_is_unrestricted(self):
        self.assertTrue(direct.allows_code_download)
        self.assertTrue(direct.allows_external_process)
        self.assertFalse(direct.sandboxed)

    def test_the_mac_app_store_forbids_both_downloading_and_launching_code(self):
        """Guideline 2.5.2 and the App Sandbox respectively -- two separate
        rulebooks that happen to land on the same build."""
        self.assertFalse(mas.allows_code_download)
        self.assertFalse(mas.allows_external_process)
        self.assertTrue(mas.sandboxed)

    def test_the_microsoft_store_still_allows_launching_installed_apps(self):
        """An MSIX desktop-bridge package is not sandboxed the way a Store macOS
        app is, so PDF export via an installed browser keeps working there."""
        self.assertFalse(msstore.allows_code_download)
        self.assertTrue(msstore.allows_external_process)
        self.assertFalse(msstore.sandboxed)

    def test_every_edition_satisfies_the_policy_contract(self):
        for policy in (direct, mas, msstore):
            with self.subTest(edition=policy.name):
                self.assertIsInstance(policy, contract.EditionPolicy)
                self.assertIn(policy.name, edition.EDITIONS)


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
            self.assertEqual(
                llamacpp.resolve_binary(base), base / "runtime" / llamacpp.binary_name()
            )

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

    def test_a_store_build_with_no_bundled_runtime_refuses_rather_than_downloads(self):
        """The bundled-runtime check above answers "is one shipped?", not "am I
        allowed to download?" -- so a Store build that simply forgot to bundle
        the binary would otherwise sail past it into a 2.5.2 violation. The
        guarantee has to come from the rule, not from the packaging being right.
        """
        with tempfile.TemporaryDirectory() as folder:
            with patch("backend.llm.installer.RUNTIME_DIR", Path(folder) / "runtime"):
                with patch("backend.llm.installer.bundled_runtime_dir", return_value=None):
                    with patch("backend.llm.installer.allows_code_download", return_value=False):
                        with patch("backend.llm.installer.latest_release_asset") as fetch:
                            with self.assertRaises(SystemExit) as caught:
                                installer.install_runtime()
        fetch.assert_not_called()
        self.assertIn("2.5.2", str(caught.exception))


class GrammarBackendSelectionTests(unittest.TestCase):
    """LanguageTool downloads a JAR and launches the system JVM -- a 2.5.2
    violation and a sandbox violation respectively. Neither was gated at all
    before backend/language/grammar/ became a capability package."""

    def _backend(self, *, code_download: bool, external_process: bool):
        with patch("backend.edition.allows_code_download", return_value=code_download):
            with patch("backend.edition.allows_external_process", return_value=external_process):
                return grammar.backend_for(Path("/nonexistent"))

    def test_a_direct_build_gets_languagetool(self):
        chosen = self._backend(code_download=True, external_process=True)
        self.assertIsInstance(chosen, grammar.LanguageToolManager)

    def test_a_mac_app_store_build_gets_no_grammar_backend(self):
        chosen = self._backend(code_download=False, external_process=False)
        self.assertIsInstance(chosen, grammar.UnavailableGrammar)

    def test_the_microsoft_store_build_also_gets_none(self):
        """Its sandbox would tolerate launching java, but downloading the JAR is
        still executable-code download, so one failing policy is enough."""
        chosen = self._backend(code_download=False, external_process=True)
        self.assertIsInstance(chosen, grammar.UnavailableGrammar)

    def test_the_unavailable_backend_reports_itself_unsupported_instead_of_raising(self):
        """status() feeds /api/language/status, which must keep answering -- the
        frontend needs the reason to hide the section."""
        chosen = self._backend(code_download=False, external_process=False)
        status = chosen.status()
        self.assertFalse(status["supported"])
        self.assertFalse(status["available"])
        self.assertTrue(status["unsupportedReason"])

    def test_both_backends_report_the_same_status_keys(self):
        """The frontend has one GrammarStatus shape; a missing key there would
        be an undefined at runtime rather than a type error."""
        unavailable = grammar.UnavailableGrammar(Path("/nonexistent")).status()
        with tempfile.TemporaryDirectory() as folder:
            real = grammar.LanguageToolManager(Path(folder)).status()
        self.assertEqual(set(unavailable), set(real))

    def test_the_unavailable_backend_refuses_installing_and_checking(self):
        chosen = grammar.UnavailableGrammar(Path("/nonexistent"))
        with self.assertRaises(PermissionError):
            chosen.install()
        with self.assertRaises(PermissionError):
            chosen.check("de-DE", "Ein Satz.", [])
        chosen.close()  # must tolerate never having started

    def test_both_backends_satisfy_the_grammar_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            for chosen in (
                grammar.LanguageToolManager(Path(folder)),
                grammar.UnavailableGrammar(Path(folder)),
            ):
                with self.subTest(backend=type(chosen).__name__):
                    self.assertIsInstance(chosen, grammar_contract.GrammarBackend)


if __name__ == "__main__":
    unittest.main()
