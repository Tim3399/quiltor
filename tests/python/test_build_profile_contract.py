"""Build-profile constraints and the capabilities that consume them."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.modules.writing_assistance import grammar
from quiltor.modules.writing_assistance.grammar import contract as grammar_contract
from quiltor.application.capabilities import (
    Feature,
    FeatureAvailability,
    StaticCapabilitySource,
)
from quiltor.infrastructure.commerce import FreeLocalEntitlementProvider
from quiltor.infrastructure.writing_assistance import (
    LanguageToolManager,
    build_writing_assistance,
)
from quiltor.infrastructure.inference import installer, select
from quiltor.infrastructure.inference.runtimes import bundled_runtime_dir, llamacpp
from quiltor.infrastructure.platform import capabilities
from quiltor.infrastructure.platform.runtime_target import DistributionChannel, parse_profile


def profile_document(distribution: str, *, sandboxed: bool, code: bool, process: bool):
    return {
        "schemaVersion": 1,
        "id": f"test-{distribution}",
        "host": "desktop",
        "platform": "macos" if distribution == "app-store" else "windows",
        "architecture": "arm64",
        "distribution": distribution,
        "releaseChannel": "stable",
        "updateProvider": distribution,
        "constraints": {
            "sandboxed": sandboxed,
            "allowsCodeDownload": code,
            "allowsExternalProcess": process,
            "allowsSelfUpdate": distribution == "direct",
            "allowsArbitraryFileAccess": not sandboxed,
            "allowsBackgroundExecution": True,
        },
    }


class BuildProfileCapabilityTests(unittest.TestCase):
    def test_profiles_keep_machine_identity_separate_from_distribution(self):
        direct = parse_profile(profile_document("direct", sandboxed=False, code=True, process=True))
        store = parse_profile(
            profile_document("app-store", sandboxed=True, code=False, process=False)
        )
        self.assertEqual(direct.distribution, DistributionChannel.DIRECT)
        self.assertEqual(store.distribution, DistributionChannel.APP_STORE)
        self.assertNotEqual(direct.constraints, store.constraints)

    def test_capabilities_read_the_selected_profile_constraints(self):
        profile = parse_profile(
            profile_document("microsoft-store", sandboxed=False, code=False, process=True)
        )
        with patch(
            "quiltor.infrastructure.platform.capabilities.constraints",
            return_value=profile.constraints,
        ):
            self.assertFalse(capabilities.allows_code_download())
            self.assertTrue(capabilities.allows_external_process())
            self.assertFalse(capabilities.is_sandboxed())


class StoreBuildRuntimeChoiceTests(unittest.TestCase):
    def test_store_build_never_auto_selects_mlx(self):
        """Even on Apple Silicon, where MLX is otherwise preferred: installing it
        builds a venv and pip-installs into it, which guideline 2.5.2 forbids."""
        with patch(
            "quiltor.infrastructure.inference.installer.is_apple_silicon", return_value=True
        ):
            with patch(
                "quiltor.infrastructure.inference.installer.is_store_distribution",
                return_value=True,
            ):
                self.assertEqual(installer.resolve_runtime("auto"), "llamacpp")
            with patch(
                "quiltor.infrastructure.inference.installer.is_store_distribution",
                return_value=False,
            ):
                self.assertEqual(installer.resolve_runtime("auto"), "mlx")

    def test_store_build_does_not_probe_for_mlx_at_startup(self):
        with patch("quiltor.infrastructure.inference.select.is_apple_silicon", return_value=True):
            with patch(
                "quiltor.infrastructure.inference.select.is_store_distribution", return_value=True
            ):
                self.assertEqual(select._preference_order(), (llamacpp,))

    def test_store_build_refuses_to_install_the_mlx_runtime(self):
        with patch(
            "quiltor.infrastructure.inference.installer.is_store_distribution", return_value=True
        ):
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
            with patch(
                "quiltor.infrastructure.inference.runtimes.llamacpp.bundled_runtime_dir",
                return_value=bundle,
            ):
                self.assertEqual(llamacpp.resolve_binary(base), bundle / llamacpp.binary_name())

    def test_installer_skips_the_download_when_the_runtime_ships_with_the_app(self):
        """The whole point of the bundled path: guideline 2.5.2 forbids downloading
        executable code, so this must not reach the network at all."""
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder)
            (bundle / llamacpp.binary_name()).touch()
            with patch(
                "quiltor.infrastructure.inference.installer.bundled_runtime_dir",
                return_value=bundle,
            ):
                with patch(
                    "quiltor.infrastructure.inference.installer.latest_release_asset"
                ) as fetch:
                    installer.install_runtime()
        fetch.assert_not_called()

    def test_a_store_build_with_no_bundled_runtime_refuses_rather_than_downloads(self):
        """The bundled-runtime check above answers "is one shipped?", not "am I
        allowed to download?" -- so a Store build that simply forgot to bundle
        the binary would otherwise sail past it into a 2.5.2 violation. The
        guarantee has to come from the rule, not from the packaging being right.
        """
        with tempfile.TemporaryDirectory() as folder:
            paths = installer.InstallerPaths.from_home(Path(folder))
            with patch(
                "quiltor.infrastructure.inference.installer.bundled_runtime_dir", return_value=None
            ):
                with patch(
                    "quiltor.infrastructure.inference.installer.capabilities.allows_code_download",
                    return_value=False,
                ):
                    with patch(
                        "quiltor.infrastructure.inference.installer.latest_release_asset"
                    ) as fetch:
                        with self.assertRaises(SystemExit) as caught:
                            installer.install_runtime(paths=paths)
        fetch.assert_not_called()
        self.assertIn("2.5.2", str(caught.exception))


class GrammarBackendSelectionTests(unittest.TestCase):
    """LanguageTool downloads a JAR and launches the system JVM -- a 2.5.2
    violation and a sandbox violation respectively. Neither was gated at all
    before src/quiltor/modules/writing_assistance/grammar/ became a capability package."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp.cleanup()

    def _backend(self, *, code_download: bool, external_process: bool):
        allowed = code_download and external_process
        feature = Feature.WRITING_ASSISTANCE_GRAMMAR
        capabilities = FeatureAvailability(
            host=StaticCapabilitySource(),
            platform=StaticCapabilitySource(),
            distribution=StaticCapabilitySource({feature: allowed}),
            entitlements=FreeLocalEntitlementProvider(),
        )
        return build_writing_assistance(Path(self.temp.name), capabilities).grammar

    def test_a_direct_build_gets_languagetool(self):
        chosen = self._backend(code_download=True, external_process=True)
        self.assertIsInstance(chosen, LanguageToolManager)

    def test_a_mac_app_store_build_gets_no_grammar_backend(self):
        chosen = self._backend(code_download=False, external_process=False)
        self.assertIsInstance(chosen, grammar.UnavailableGrammar)

    def test_the_microsoft_store_build_also_gets_none(self):
        """Its sandbox would tolerate launching java, but downloading the JAR is
        still executable-code download, so one failing policy is enough."""
        chosen = self._backend(code_download=False, external_process=True)
        self.assertIsInstance(chosen, grammar.UnavailableGrammar)

    def test_the_unavailable_backend_reports_itself_unsupported_instead_of_raising(self):
        """status() feeds /api/writing-assistance/status, which must keep answering -- the
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
            real = LanguageToolManager(Path(folder)).status()
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
                LanguageToolManager(Path(folder)),
                grammar.UnavailableGrammar(Path(folder)),
            ):
                with self.subTest(backend=type(chosen).__name__):
                    self.assertIsInstance(chosen, grammar_contract.GrammarBackend)


if __name__ == "__main__":
    unittest.main()
