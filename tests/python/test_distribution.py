"""Distribution contracts that can be verified without a store or certificate."""

import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
PYINSTALLER_ROOT = REPO_ROOT / "distribution" / "desktop" / "pyinstaller"
TOOLING_ROOT = REPO_ROOT / "distribution" / "tooling"
sys.path.insert(0, str(PYINSTALLER_ROOT))
sys.path.insert(0, str(TOOLING_ROOT))

import bundle  # noqa: E402
import artifact_profile  # noqa: E402
import container_contract  # noqa: E402
import profile_contract  # noqa: E402
from quiltor import resources  # noqa: E402


class ProfileSetTests(unittest.TestCase):
    def setUp(self):
        self.profiles = {profile["id"]: profile for profile in profile_contract.validate_all()}

    def test_every_supported_and_planned_target_has_one_profile(self):
        self.assertTrue(profile_contract.EXPECTED_PROFILES.issubset(self.profiles))

    def test_only_real_builds_advertise_entrypoints_or_outputs(self):
        for profile in self.profiles.values():
            with self.subTest(profile=profile["id"]):
                if profile["build"]["status"] == "supported":
                    self.assertIsNotNone(profile["build"]["entrypoint"])
                    self.assertIsNotNone(profile["build"]["outputPattern"])
                else:
                    self.assertIsNone(profile["build"]["entrypoint"])
                    self.assertIsNone(profile["build"]["smokeEntrypoint"])
                    self.assertIsNone(profile["build"]["outputPattern"])

    def test_supported_direct_targets_own_native_lifecycle_smokes(self):
        direct = {
            profile["id"]: profile
            for profile in self.profiles.values()
            if profile["target"]["distribution"] == "direct"
        }
        self.assertEqual(
            {
                profile_id
                for profile_id, profile in direct.items()
                if profile["build"]["status"] == "supported"
            },
            {"macos-direct", "windows-direct"},
        )
        for profile_id in ("macos-direct", "windows-direct"):
            entrypoint = direct[profile_id]["build"]["smokeEntrypoint"]
            self.assertIsNotNone(entrypoint)
            self.assertTrue((REPO_ROOT / entrypoint).is_file())
        self.assertIsNone(direct["linux-direct"]["build"]["smokeEntrypoint"])

    def test_supported_direct_profile_cannot_drop_its_smoke_contract(self):
        profile = json.loads(json.dumps(self.profiles["macos-direct"]))
        profile["build"]["smokeEntrypoint"] = None
        with self.assertRaisesRegex(profile_contract.ProfileError, "native smokeEntrypoint"):
            profile_contract.validate_profile(profile)

    def test_store_and_mobile_targets_are_explicit_scaffolds(self):
        for profile_id in (
            "linux-direct",
            "macos-app-store",
            "windows-store",
            "ios-app-store",
            "android-play",
        ):
            with self.subTest(profile=profile_id):
                self.assertEqual(self.profiles[profile_id]["build"]["status"], "scaffold")

    def test_linux_direct_is_visible_but_cannot_be_built_or_published(self):
        profile = self.profiles["linux-direct"]
        self.assertEqual(
            profile["target"],
            {
                "host": "desktop",
                "platform": "linux",
                "distribution": "direct",
                "architectures": ["x86_64", "arm64"],
            },
        )
        self.assertEqual(profile["build"]["status"], "scaffold")
        self.assertIsNone(profile["build"]["entrypoint"])
        self.assertIsNone(profile["build"]["outputPattern"])
        self.assertEqual(profile["publication"]["status"], "scaffold")
        self.assertTrue((REPO_ROOT / "distribution/desktop/linux/direct/README.md").is_file())

    def test_python_package_uses_the_release_channel_that_really_publishes_it(self):
        profile = self.profiles["python-package"]
        self.assertEqual(profile["updates"]["provider"], "github-release")
        self.assertEqual(profile["publication"]["channel"], "github-release")
        self.assertEqual(profile["security"]["signing"], "release-manifest")

    def test_mobile_never_claims_subprocess_or_code_download_support(self):
        for profile_id in ("macos-app-store", "ios-app-store", "android-play"):
            capabilities = self.profiles[profile_id]["capabilities"]
            self.assertFalse(capabilities["externalProcess"])
            self.assertFalse(capabilities["codeDownload"])

    def test_every_store_target_owns_a_localised_listing_root(self):
        owners = {}
        for profile in self.profiles.values():
            listing = profile["publication"]["storeListing"]
            if listing is not None:
                self.assertTrue((REPO_ROOT / listing / "README.md").is_file())
                self.assertNotIn(listing, owners)
                owners[listing] = profile["id"]
        self.assertEqual(
            self.profiles["macos-app-store"]["publication"]["storeListing"],
            "distribution/store-listings/apple/macos",
        )
        self.assertEqual(
            self.profiles["ios-app-store"]["publication"]["storeListing"],
            "distribution/store-listings/apple/ios",
        )

    def test_all_version_sources_are_aligned(self):
        self.assertEqual(
            profile_contract.validate_version_alignment(),
            (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip(),
        )

    def test_publication_destination_and_release_stream_are_separate_axes(self):
        publication_destinations = {
            profile["publication"]["channel"] for profile in self.profiles.values()
        }
        release_channels = {profile["release"]["channel"] for profile in self.profiles.values()}
        self.assertTrue(publication_destinations.isdisjoint(release_channels))
        self.assertEqual(self.profiles["android-play"]["publication"]["channel"], "google-play")
        self.assertEqual(
            self.profiles["android-play"]["release"],
            {"channel": "play-internal", "rolloutTrack": "internal"},
        )


class EmbeddedProfileTests(unittest.TestCase):
    def test_runtime_contract_uses_the_platform_port_vocabulary(self):
        contract = profile_contract.runtime_contract(self._profile("macos-direct"))
        self.assertEqual(
            set(contract),
            {
                "schemaVersion",
                "id",
                "host",
                "platform",
                "architecture",
                "distribution",
                "releaseChannel",
                "updateProvider",
                "constraints",
            },
        )
        self.assertEqual(contract["id"], "macos-direct")
        self.assertTrue(contract["constraints"]["allowsSelfUpdate"])
        self.assertTrue(contract["constraints"]["allowsBackgroundExecution"])
        self.assertFalse(contract["constraints"]["sandboxed"])

    def test_a_store_contract_carries_its_real_restrictions(self):
        contract = profile_contract.runtime_contract(self._profile("ios-app-store"))
        self.assertTrue(contract["constraints"]["sandboxed"])
        self.assertFalse(contract["constraints"]["allowsCodeDownload"])
        self.assertFalse(contract["constraints"]["allowsExternalProcess"])
        self.assertFalse(contract["constraints"]["allowsArbitraryFileAccess"])

    def test_requested_architecture_must_be_declared_by_the_profile(self):
        with self.assertRaises(profile_contract.ProfileError):
            profile_contract.runtime_contract(self._profile("macos-direct"), "x86_64")

    def test_materialised_contract_is_stable_json_with_the_runtime_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "quiltor-build-profile.json"
            written = profile_contract.materialize_profile("windows-direct", target)
            self.assertEqual(written.name, "quiltor-build-profile.json")
            contract = json.loads(written.read_text(encoding="utf-8"))
            self.assertEqual(contract["id"], "windows-direct")
            self.assertEqual(contract["releaseChannel"], "stable")
            self.assertTrue(contract["constraints"]["allowsBackgroundExecution"])

    def test_web_image_and_python_archives_pin_target_profiles_not_source(self):
        dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
        dockerignore = (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8")
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        requirements = (REPO_ROOT / "distribution/web/self-hosted/requirements.lock").read_text(
            encoding="utf-8"
        )
        self.assertIn("materialize web-self-hosted", dockerfile)
        self.assertIn("p['id']=='web-self-hosted'", dockerfile)
        self.assertIn("distribution/web/self-hosted/requirements.lock", dockerfile)
        self.assertIn("pyjwt==2.13.0", requirements)
        self.assertIn("import jwt, cryptography", dockerfile)
        self.assertIn(
            "src/quiltor/infrastructure/platform/quiltor-build-profile.json", dockerignore
        )
        self.assertIn("distribution/tooling/hatch_build.py", pyproject)
        self.assertIn("exclude =", pyproject)
        self.assertIn('"PyJWT[crypto]>=2.13,<3"', pyproject)

    def test_python_artifact_verifier_rejects_the_source_profile(self):
        source = json.loads(
            (
                REPO_ROOT / "src/quiltor/infrastructure/platform/quiltor-build-profile.json"
            ).read_text(encoding="utf-8")
        )
        with tempfile.TemporaryDirectory() as directory:
            wheel = Path(directory) / "quiltor-1-py3-none-any.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr(artifact_profile.EMBEDDED_SUFFIX, json.dumps(source))
            with self.assertRaisesRegex(profile_contract.ProfileError, "does not embed"):
                artifact_profile.verify_archive(wheel)

    def test_python_artifact_without_the_runtime_mcp_contract_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            wheel = Path(directory) / "quiltor-1-py3-none-any.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr(
                    artifact_profile.EMBEDDED_SUFFIX,
                    json.dumps(artifact_profile.expected_document("python-package")),
                )
            with self.assertRaisesRegex(profile_contract.ProfileError, "MCP contract"):
                artifact_profile.verify_archive(wheel)

    def test_backup_image_build_uses_the_shared_manifest_contract_from_root_context(self):
        dockerfile = (REPO_ROOT / "services/backup-server/Dockerfile").read_text(encoding="utf-8")
        compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("COPY src/quiltor/application/backup_manifest.py", dockerfile)
        backup_section = compose.split("  backup:", 1)[1].split("  caddy:", 1)[0]
        self.assertIn("context: .", backup_section)
        self.assertIn("dockerfile: services/backup-server/Dockerfile", backup_section)

    def test_backup_server_imports_from_the_flat_container_layout(self):
        """The image copies server.py to /app/server.py, two levels shallower than the
        checkout every other test imports it from -- so a path assumption that only
        breaks inside the container would otherwise ship green. A real temporary
        directory cannot be that shallow, hence compiling under the container filename:
        __file__ is what the ancestor walk reads, and /app/server.py has two parents on
        both platforms. The package next to it stands in for the Dockerfile's COPY.
        """
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "app"
            (app / "quiltor" / "application").mkdir(parents=True)
            shutil.copy(
                REPO_ROOT / "src/quiltor/application/backup_manifest.py",
                app / "quiltor/application/backup_manifest.py",
            )
            probe = (
                "import pathlib, sys; "
                "source = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'); "
                "namespace = {'__file__': '/app/server.py', '__name__': 'probe'}; "
                "exec(compile(source, '/app/server.py', 'exec'), namespace); "
                "print(namespace['validate_manifest'].__module__)"
            )
            environment = {
                key: value
                for key, value in os.environ.items()
                if not key.startswith("QUILTOR_") and key != "PYTHONPATH"
            }
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    probe,
                    str(REPO_ROOT / "services/backup-server/server.py"),
                ],
                cwd=app,
                env=environment,
                capture_output=True,
                text=True,
                timeout=60,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        # The validator came from the copied package, not from a source tree the
        # container does not have.
        self.assertEqual(result.stdout.strip(), "quiltor.application.backup_manifest")

    def test_oci_base_and_legal_payload_contracts_are_fail_closed(self):
        container_contract.validate_sources()
        app = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
        backup = (REPO_ROOT / "services/backup-server/Dockerfile").read_text(encoding="utf-8")
        for document in ("LICENSE", "THIRD-PARTY-NOTICES.md"):
            with self.subTest(document=document):
                self.assertIn(document, app)
                self.assertIn(document, backup)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = (
                "distribution/containers/base-images.json",
                "distribution/containers/browser-payloads.json",
                "distribution/dependency-locks.json",
                "distribution/toolchains.json",
                "distribution/python-build-bootstrap.in",
                "distribution/python-build-bootstrap.lock",
                "distribution/native-build-tools.in",
                "distribution/desktop/macos/direct/requirements.lock",
                "distribution/desktop/windows/direct/requirements.lock",
                "distribution/web/self-hosted/requirements.in",
                "distribution/web/self-hosted/requirements.lock",
                "pyproject.toml",
                "services/backup-server/artifact-contract.json",
                "services/backup-server/Dockerfile",
                "Dockerfile",
            )
            for relative in paths:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((REPO_ROOT / relative).read_bytes())
            backup_path = root / "services/backup-server/Dockerfile"
            backup_source = backup_path.read_text(encoding="utf-8")
            backup_path.write_text(
                re.sub(r"@sha256:[0-9a-f]{64}", "@sha256:" + "0" * 64, backup_source),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "Backup Dockerfile base"):
                container_contract.validate_sources(root)
            backup_path.write_text(backup_source, encoding="utf-8")

            app_path = root / "Dockerfile"
            app_source = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")

            def assert_app_mutation_rejected(old, new, error, expected_count=1):
                self.assertEqual(app_source.count(old), expected_count)
                app_path.write_text(app_source.replace(old, new), encoding="utf-8")
                try:
                    with self.assertRaisesRegex(ValueError, error):
                        container_contract.validate_sources(root)
                finally:
                    app_path.write_text(app_source, encoding="utf-8")

            assert_app_mutation_rejected(
                "process.versions.node !== t.node",
                "false",
                "effective Node runtime",
            )
            assert_app_mutation_rejected(
                "node node_modules/playwright/cli.js install --only-shell chromium",
                "node node_modules/playwright/cli.js install chromium",
                "install only the headless Chromium shell",
            )
            assert_app_mutation_rejected(
                "ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright\n",
                "",
                "explicit shared Playwright browser path",
                expected_count=2,
            )
            assert_app_mutation_rejected(
                "python3 /tmp/browser_payload_digest.py check-contract /ms-playwright",
                "python3 /tmp/browser_payload_digest.py digest /ms-playwright",
                "committed cryptographic lock",
            )
            assert_app_mutation_rejected(
                "COPY --from=playwright-browser",
                "COPY --from=runtime-node",
                "committed cryptographic lock",
            )
            unused_browsers = {
                "ffmpeg-*": 1,
                "firefox-*": 2,
                "webkit-*": 2,
                "chromium-[0-9]*": 2,
            }
            for unused_browser, expected_count in unused_browsers.items():
                with self.subTest(unused_browser=unused_browser):
                    assert_app_mutation_rejected(
                        unused_browser,
                        "removed-browser-payload-rejection",
                        f"unused browser payload {re.escape(unused_browser)}",
                        expected_count=expected_count,
                    )

    @staticmethod
    def _profile(profile_id):
        return profile_contract.load_profile(profile_id)


class AppleBundleTests(unittest.TestCase):
    def test_the_marketing_version_comes_from_VERSION(self):
        self.assertEqual(
            bundle.version(), (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        )

    def test_build_number_defaults_locally_and_rejects_malformed_ci_input(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(bundle.build_number(), "0")
        with patch.dict(os.environ, {"QUILTOR_BUILD_NUMBER": "1.2.3.4"}, clear=True):
            with self.assertRaises(SystemExit):
                bundle.build_number()

    def test_info_plist_has_upload_metadata_and_serialises(self):
        with patch.dict(os.environ, {"QUILTOR_BUILD_NUMBER": "7"}, clear=True):
            values = bundle.info_plist()
        for key in (
            "CFBundleShortVersionString",
            "CFBundleVersion",
            "LSApplicationCategoryType",
            "ITSAppUsesNonExemptEncryption",
        ):
            self.assertIn(key, values)
        restored = plistlib.loads(plistlib.dumps(values))
        self.assertEqual(restored["CFBundleVersion"], "7")
        self.assertEqual(sorted(restored["CFBundleLocalizations"]), ["de", "en"])

    def test_direct_and_store_entitlements_cannot_be_swapped(self):
        direct = plistlib.loads(
            (REPO_ROOT / "distribution/desktop/macos/direct/entitlements.plist").read_bytes()
        )
        store = plistlib.loads(
            (REPO_ROOT / "distribution/desktop/macos/app-store/entitlements.plist").read_bytes()
        )
        self.assertNotIn("com.apple.security.app-sandbox", direct)
        self.assertIs(store["com.apple.security.app-sandbox"], True)


class DesktopBuildContractTests(unittest.TestCase):
    def test_target_must_be_explicit_when_pyinstaller_runs(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(SystemExit, "QUILTOR_BUILD_PROFILE_ID"):
                bundle.build_profile_id()

    def test_a_scaffold_cannot_be_selected_as_a_build(self):
        with patch.dict(os.environ, {"QUILTOR_BUILD_PROFILE_ID": "macos-app-store"}, clear=True):
            with self.assertRaisesRegex(SystemExit, "scaffold"):
                bundle.build_profile_id()

    def test_direct_build_embeds_profile_version_client_and_runtime_icon(self):
        files = bundle.data_files("macos-direct")
        destinations = [destination for _, destination in files]
        self.assertIn("quiltor/resources/web", destinations)
        self.assertIn("quiltor", destinations)
        self.assertIn("quiltor/infrastructure/platform", destinations)
        self.assertIn("quiltor/resources/icons", destinations)
        self.assertIn("quiltor/resources/sidecars/inference/mlx", destinations)
        embedded = [
            Path(source)
            for source, destination in files
            if destination == "quiltor/infrastructure/platform"
        ]
        self.assertEqual(embedded[0].name, "quiltor-build-profile.json")

    def test_direct_desktop_bundles_embed_legal_documents(self):
        for profile_id in ("macos-direct", "windows-direct"):
            with self.subTest(profile=profile_id):
                files = bundle.data_files(profile_id)
                legal_sources = {
                    Path(source).name
                    for source, destination in files
                    if destination == "quiltor/resources/legal"
                }
                self.assertEqual(legal_sources, {"LICENSE", "THIRD-PARTY-NOTICES.md"})

    def test_frozen_resource_layout_matches_runtime_resolver(self):
        with tempfile.TemporaryDirectory() as folder:
            package_root = Path(folder) / "quiltor"
            (package_root / "resources/web").mkdir(parents=True)
            sidecar = package_root / "resources/sidecars/pdf/render-book-pdf.mjs"
            sidecar.parent.mkdir(parents=True)
            sidecar.write_text("// renderer", encoding="utf-8")
            (package_root / "resources/icons").mkdir(parents=True)
            (package_root / "resources/legal").mkdir(parents=True)
            (package_root / "VERSION").write_text("3.3.1\n", encoding="utf-8")
            (package_root / "resources/legal/LICENSE").write_text("license", encoding="utf-8")
            (package_root / "resources/legal/THIRD-PARTY-NOTICES.md").write_text(
                "notices", encoding="utf-8"
            )

            with patch.object(resources, "PACKAGE_ROOT", package_root):
                self.assertEqual(resources.web_assets(), package_root / "resources/web")
                self.assertEqual(resources.sidecars(), package_root / "resources/sidecars")
                self.assertEqual(resources.sidecar_asset("pdf/render-book-pdf.mjs"), sidecar)
                self.assertEqual(resources.icons(), package_root / "resources/icons")
                self.assertEqual(resources.version_file(), package_root / "VERSION")
                self.assertEqual(resources.license_file(), package_root / "resources/legal/LICENSE")
                self.assertEqual(
                    resources.third_party_notices(),
                    package_root / "resources/legal/THIRD-PARTY-NOTICES.md",
                )

    def test_legal_resource_resolver_rejects_unknown_or_missing_documents(self):
        with tempfile.TemporaryDirectory() as folder:
            package_root = Path(folder) / "quiltor"
            package_root.mkdir()
            with (
                patch.object(resources, "PACKAGE_ROOT", package_root),
                patch.object(resources, "_SOURCE_ROOT", Path(folder) / "missing"),
            ):
                with self.assertRaisesRegex(ValueError, "Unsupported legal document"):
                    resources.legal_document("../../secret")
                with self.assertRaisesRegex(RuntimeError, "LICENSE"):
                    resources.license_file()

    def test_direct_build_bundles_no_inference_runtime(self):
        self.assertEqual(bundle.bundled_binaries("macos-direct"), [])

    def test_a_store_build_without_a_bundled_runtime_fails_loudly(self):
        with patch.object(bundle, "REPO_ROOT", Path("/nonexistent")):
            with self.assertRaises(SystemExit) as caught:
                bundle.bundled_binaries("macos-app-store")
        self.assertIn("runtime", str(caught.exception))

    def test_spec_consumes_profile_driven_bundle_data(self):
        spec = (PYINSTALLER_ROOT / "quiltor.spec").read_text(encoding="utf-8")
        self.assertIn("bundle.build_profile_id()", spec)
        self.assertIn("bundle.data_files(PROFILE_ID)", spec)
        self.assertIn("bundle.bundled_binaries(PROFILE_ID)", spec)
        self.assertIn('"src" / "quiltor" / "hosts" / "desktop" / "app.py"', spec)
        self.assertNotIn("QUILTOR_EDITION", spec)

    def test_direct_scripts_pin_their_profiles_and_verify_signatures(self):
        mac = (REPO_ROOT / "distribution/desktop/macos/direct/build.sh").read_text(encoding="utf-8")
        windows = (REPO_ROOT / "distribution/desktop/windows/direct/build.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn('PROFILE="macos-direct"', mac)
        self.assertIn("codesign --verify", mac)
        self.assertIn('$Profile = "windows-direct"', windows)
        self.assertIn("signtool", windows.casefold())
        self.assertIn("verify /pa /v", windows)

    def test_native_smokes_cover_real_upgrade_health_and_platform_uninstall(self):
        mac = (REPO_ROOT / "distribution/desktop/macos/direct/smoke-install.sh").read_text(
            encoding="utf-8"
        )
        windows = (REPO_ROOT / "distribution/desktop/windows/direct/smoke-install.ps1").read_text(
            encoding="utf-8"
        )
        inno = (REPO_ROOT / "distribution/desktop/windows/direct/quiltor.iss").read_text(
            encoding="utf-8"
        )
        windows_build = (REPO_ROOT / "distribution/desktop/windows/direct/build.ps1").read_text(
            encoding="utf-8"
        )
        for evidence in (
            "previous_release.py",
            "BOOTSTRAP",
            "hdiutil attach",
            "ditto --rsrc --extattr",
            "stapler validate",
            "spctl --assess",
            "/api/version",
            "QUILTOR_DATA_DIR",
            "lsregister",
            "PREVIOUS_EXPECTED_VERSION",
        ):
            with self.subTest(platform="macos", evidence=evidence):
                self.assertIn(evidence, mac)
        for evidence in (
            "previous_release.py",
            "BOOTSTRAP",
            "Get-AuthenticodeSignature",
            "/VERYSILENT",
            "/api/version",
            "QUILTOR_DATA_DIR",
            "${AppId}_is1",
            "PreviousExpectedVersion",
            "Invoke-NativeUninstall",
        ):
            with self.subTest(platform="windows", evidence=evidence):
                self.assertIn(evidence, windows)
        self.assertNotIn('DisplayName -eq "Quiltor"', windows)
        self.assertNotIn("-dump | grep -Fq", mac)
        self.assertNotIn('if [[ -x "$LSREGISTER" ]]', mac)
        self.assertIn('"$LSREGISTER" -f "$INSTALLED_APP"', mac)
        self.assertIn('"$LSREGISTER" -dump > "$WORK/launchservices-registered.txt"', mac)
        self.assertIn('"$LSREGISTER" -u "$INSTALLED_APP"', mac)
        self.assertIn('"$LSREGISTER" -dump > "$WORK/launchservices-unregistered.txt"', mac)
        self.assertIn("--metadata-output", mac)
        self.assertIn("--metadata-output", windows)
        app_id = "{6E9F2A3E-6B4B-4C0E-9F44-2B7A6E9C4B5D}"
        self.assertIn(f'$AppId = "{app_id}"', windows)
        self.assertIn("Assert-PreviousOrder $PreviousExpectedVersion", windows)
        self.assertIn('#define MyAppId "{{6E9F2A3E-6B4B-4C0E-9F44-2B7A6E9C4B5D}"', inno)
        self.assertIn("AppId={#MyAppId}", inno)
        self.assertIn("UninstallDisplayName={#MyAppName}", inno)
        self.assertIn("LicenseFile={#LicensePath}", inno)
        self.assertIn("/DLicensePath=$RepoRoot\\LICENSE", windows_build)
        self.assertIn("/DThirdPartyNoticesPath=$RepoRoot\\THIRD-PARTY-NOTICES.md", windows_build)
        self.assertIn('DestName: "LICENSE"', inno)
        self.assertIn('DestName: "THIRD-PARTY-NOTICES.md"', inno)


if __name__ == "__main__":
    unittest.main()
