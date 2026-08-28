"""Versioning and the immutable build-to-publish release hand-off."""

import contextlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLING = REPO_ROOT / "distribution" / "tooling"
sys.path.insert(0, str(TOOLING))

import dependency_lock_contract  # noqa: E402
import previous_release  # noqa: E402
import regenerate_dependency_locks  # noqa: E402
import release_manifest  # noqa: E402
import release_preflight  # noqa: E402
import set_version  # noqa: E402
import workflow_contract  # noqa: E402

BUILD_WORKFLOW = REPO_ROOT / ".github/workflows/release.yml"
PUBLISH_WORKFLOW = REPO_ROOT / ".github/workflows/release-publish.yml"
TEST_WORKFLOW = REPO_ROOT / ".github/workflows/test.yml"


class VersionArithmeticTests(unittest.TestCase):
    def test_bump_words_move_and_reset_the_right_fields(self):
        self.assertEqual(set_version.next_version("2.14.1", "major"), "3.0.0")
        self.assertEqual(set_version.next_version("2.14.1", "minor"), "2.15.0")
        self.assertEqual(set_version.next_version("2.14.1", "patch"), "2.14.2")

    def test_versions_compare_numerically(self):
        self.assertLess(set_version.parse_version("2.9.0"), set_version.parse_version("2.10.0"))

    def test_non_semantic_versions_are_rejected(self):
        for invalid in ("v2.15.0", "2.15", "2.15.0-rc1", "latest", ""):
            with self.subTest(value=invalid):
                with self.assertRaises(ValueError):
                    set_version.next_version("2.14.1", invalid)


class PreviousNativeReleaseTests(unittest.TestCase):
    @staticmethod
    def _release(version, *, draft=False, prerelease=False, asset=True, kind="macos-dmg"):
        name = previous_release.canonical_name(kind, previous_release.semantic_version(version))
        return {
            "tag_name": f"v{version}",
            "draft": draft,
            "prerelease": prerelease,
            "assets": [
                {
                    "name": name if asset else "unrelated.zip",
                    "url": "https://api.github.com/repos/example/quiltor/releases/assets/1",
                }
            ],
        }

    def test_lookup_chooses_latest_earlier_stable_canonical_artifact(self):
        releases = [
            self._release("3.3.0", prerelease=True),
            self._release("3.2.9"),
            self._release("3.2.8", draft=True),
            self._release("3.1.0"),
        ]
        selected = previous_release.select_previous(releases, "3.3.1", "macos-dmg")
        self.assertIsNotNone(selected)
        self.assertEqual(selected.tag, "v3.2.9")
        self.assertEqual(selected.version, "3.2.9")

    def test_lookup_reports_bootstrap_only_when_no_stable_history_exists(self):
        releases = [
            self._release("3.2.0", prerelease=True),
            self._release("3.1.0", draft=True),
        ]
        self.assertIsNone(previous_release.select_previous(releases, "3.3.1", "macos-dmg"))

    def test_lookup_skips_portable_only_releases_for_the_latest_native_predecessor(self):
        releases = [
            self._release("3.2.9", asset=False),
            self._release("3.2.8", asset=False),
            self._release("3.1.0"),
        ]
        selected = previous_release.select_previous(releases, "3.3.1", "macos-dmg")
        self.assertIsNotNone(selected)
        self.assertEqual(selected.tag, "v3.1.0")
        self.assertEqual(selected.version, "3.1.0")

    def test_first_native_target_release_bootstraps_after_portable_only_history(self):
        releases = [
            self._release("3.2.9", asset=False),
            self._release("3.1.0", asset=False),
        ]
        self.assertIsNone(previous_release.select_previous(releases, "3.3.1", "macos-dmg"))

    def test_duplicate_canonical_assets_in_the_native_predecessor_fail_closed(self):
        release = self._release("3.2.9")
        release["assets"].append(
            {
                "name": "Quiltor-3.2.9.dmg",
                "url": "https://api.github.com/repos/example/quiltor/releases/assets/2",
            }
        )
        with self.assertRaisesRegex(
            previous_release.PreviousReleaseError, "exactly one downloadable"
        ):
            previous_release.select_previous([release], "3.3.1", "macos-dmg")

    def test_predecessor_tag_without_one_published_release_is_not_bootstrap(self):
        with self.assertRaisesRegex(
            previous_release.PreviousReleaseError, "exactly one published release"
        ):
            previous_release.select_previous(
                [self._release("3.2.8")],
                "3.3.1",
                "macos-dmg",
                ["v3.2.9", "v3.2.8"],
            )

    def test_equal_or_higher_stable_release_or_tag_blocks_an_old_version(self):
        with self.assertRaisesRegex(previous_release.PreviousReleaseError, "must be newer"):
            previous_release.require_monotonic_version("3.3.1", [self._release("3.3.1")], [])
        with self.assertRaisesRegex(previous_release.PreviousReleaseError, "must be newer"):
            previous_release.require_monotonic_version("3.3.1", [], ["v3.4.0"])
        with self.assertRaisesRegex(previous_release.PreviousReleaseError, "must be newer"):
            previous_release.select_previous([], "3.3.1", "macos-dmg", ["v3.4.0"])

    def test_latest_guard_allows_own_tag_but_rejects_a_newer_concurrent_release(self):
        self.assertEqual(
            previous_release.require_not_older_version("3.3.1", [], ["v3.3.1"]),
            (3, 3, 1),
        )
        with self.assertRaisesRegex(previous_release.PreviousReleaseError, "older"):
            previous_release.require_not_older_version("3.3.1", [self._release("3.4.0")], [])

    def test_selected_version_is_written_as_machine_readable_metadata(self):
        selected = previous_release.select_previous(
            [self._release("3.2.9", kind="windows-installer")],
            "3.3.1",
            "windows-installer",
        )
        self.assertIsNotNone(selected)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "previous.json"
            previous_release.write_metadata(selected, "windows-installer", output)
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                {
                    "schemaVersion": 1,
                    "tag": "v3.2.9",
                    "version": "3.2.9",
                    "kind": "windows-installer",
                    "asset": "Quiltor-Setup-3.2.9.exe",
                },
            )

    def test_cli_bootstrap_exit_is_reserved_for_absent_stable_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            arguments = [
                "--kind",
                "macos-dmg",
                "--current-version",
                "3.3.1",
                "--repository",
                "example/quiltor",
                "--output",
                str(root / "previous.dmg"),
                "--metadata-output",
                str(root / "previous.json"),
            ]
            with (
                patch.dict("os.environ", {"GH_TOKEN": "token"}, clear=True),
                patch.object(previous_release, "fetch_releases", return_value=[]),
                patch.object(previous_release, "fetch_tags", return_value=[]),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(previous_release.main(arguments), previous_release.BOOTSTRAP_EXIT)
            self.assertFalse((root / "previous.json").exists())

    def test_cli_bootstraps_when_stable_history_has_no_target_artifact(self):
        releases = [self._release("3.2.9", asset=False)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.dict("os.environ", {"GH_TOKEN": "token"}, clear=True),
                patch.object(previous_release, "fetch_releases", return_value=releases),
                patch.object(previous_release, "fetch_tags", return_value=[]),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                status = previous_release.main(
                    [
                        "--kind",
                        "macos-dmg",
                        "--current-version",
                        "3.3.1",
                        "--repository",
                        "example/quiltor",
                        "--output",
                        str(root / "previous.dmg"),
                        "--metadata-output",
                        str(root / "previous.json"),
                    ]
                )
            self.assertEqual(status, previous_release.BOOTSTRAP_EXIT)
            self.assertFalse((root / "previous.json").exists())

    def test_windows_and_macos_names_are_concrete_and_versioned(self):
        version = (3, 3, 1)
        self.assertEqual(previous_release.canonical_name("macos-dmg", version), "Quiltor-3.3.1.dmg")
        self.assertEqual(
            previous_release.canonical_name("windows-installer", version),
            "Quiltor-Setup-3.3.1.exe",
        )

    def test_download_refuses_an_asset_url_outside_the_selected_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(previous_release.PreviousReleaseError, "this repository"):
                previous_release.download_asset(
                    "example/quiltor",
                    {"url": "https://api.github.com/repos/attacker/quiltor/releases/assets/1"},
                    "secret",
                    Path(directory) / "previous.dmg",
                )


class VersionRepoTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("git") is None:
            raise unittest.SkipTest("git is not available")

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo, True)
        for name in (
            set_version.VERSION_FILE,
            set_version.PACKAGE_JSON,
            set_version.PACKAGE_LOCK,
            set_version.CARGO_TOML,
            set_version.CARGO_LOCK,
        ):
            shutil.copy(REPO_ROOT / name, self.repo / name)
        self._git("init", "-q", ".")
        self._git("add", "-A")
        self._git(
            "-c",
            "user.email=t@example.com",
            "-c",
            "user.name=t",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "initial",
        )

    def _git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, check=True, capture_output=True, text=True
        ).stdout

    def versions(self):
        package = json.loads((self.repo / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((self.repo / "package-lock.json").read_text(encoding="utf-8"))
        cargo = (self.repo / "Cargo.toml").read_text(encoding="utf-8")
        cargo_lock = (self.repo / "Cargo.lock").read_text(encoding="utf-8")
        cargo_workspace = cargo.split("[workspace.package]", 1)[1]
        cargo_version = cargo_workspace.split('version = "', 1)[1].split('"', 1)[0]
        return {
            "VERSION": (self.repo / "VERSION").read_text(encoding="utf-8").strip(),
            "package": package["version"],
            "lock": lock["version"],
            "lock-root": lock["packages"][""]["version"],
            "cargo": cargo_version,
            "cargo-lock-core": cargo_lock.split('name = "quiltor-core"', 1)[1]
            .split('version = "', 1)[1]
            .split('"', 1)[0],
            "cargo-lock-ffi": cargo_lock.split('name = "quiltor-ffi"', 1)[1]
            .split('version = "', 1)[1]
            .split('"', 1)[0],
        }

    def run_bump(self, request, preflight_error=None):
        with patch.object(set_version, "REPO_ROOT", self.repo):
            with patch.object(set_version, "run_preflight") as preflight:
                preflight.side_effect = preflight_error
                with contextlib.redirect_stdout(io.StringIO()):
                    with contextlib.redirect_stderr(io.StringIO()):
                        status = set_version.main([request])
        self.preflight = preflight
        return status


class ApplyVersionTests(VersionRepoTestCase):
    def test_every_package_ecosystem_moves_together(self):
        target = set_version.next_version(set_version.current_version(self.repo), "minor")
        written = set_version.apply_version(target, self.repo)
        self.assertEqual(set(self.versions().values()), {target})
        self.assertEqual(
            written,
            ["VERSION", "package.json", "package-lock.json", "Cargo.toml", "Cargo.lock"],
        )

    def test_cargo_change_is_only_the_workspace_version(self):
        target = set_version.next_version(set_version.current_version(self.repo), "major")
        set_version.apply_version(target, self.repo)
        changed = self._git("diff", "--", "Cargo.toml")
        self.assertIn(f'+version = "{target}"', changed)
        self.assertEqual(sum(line.startswith("+version =") for line in changed.splitlines()), 1)

    def test_failure_or_dirty_tree_writes_nothing(self):
        before = self.versions()
        (self.repo / "note.txt").write_text("dirty", encoding="utf-8")
        self.assertEqual(self.run_bump("minor"), 1)
        self.assertEqual(self.versions(), before)

    def test_preflight_failure_writes_nothing(self):
        before = self.versions()
        error = release_preflight.PreflightError("cargo test failed")
        self.assertEqual(self.run_bump("minor", error), 1)
        self.assertEqual(self.versions(), before)

    def test_invalid_last_target_is_detected_before_any_file_is_replaced(self):
        cargo_lock = self.repo / "Cargo.lock"
        cargo_lock.write_bytes(
            cargo_lock.read_bytes().replace(b'name = "quiltor-ffi"', b'name = "x"')
        )
        before = {name: (self.repo / name).read_bytes() for name in set_version.TARGET_FILES}
        with self.assertRaisesRegex(ValueError, "quiltor-ffi"):
            set_version.apply_version("99.0.0", self.repo)
        self.assertEqual(
            {name: (self.repo / name).read_bytes() for name in set_version.TARGET_FILES},
            before,
        )
        self.assertEqual(list(self.repo.glob(".*.set-version-*.tmp")), [])

    def test_replace_failure_rolls_the_whole_transaction_back(self):
        before = {name: (self.repo / name).read_bytes() for name in set_version.TARGET_FILES}
        real_replace = set_version._replace
        calls = 0

        def fail_third_replace(source, destination):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise OSError("simulated replace failure")
            real_replace(source, destination)

        with patch.object(set_version, "_replace", side_effect=fail_third_replace):
            with self.assertRaisesRegex(OSError, "simulated replace failure"):
                set_version.apply_version("99.0.0", self.repo)
        self.assertEqual(
            {name: (self.repo / name).read_bytes() for name in set_version.TARGET_FILES},
            before,
        )
        self.assertEqual(list(self.repo.glob(".*.set-version-*.tmp")), [])


class PreflightContractTests(unittest.TestCase):
    def test_temporary_data_cleanup_retries_a_transient_windows_file_lock(self):
        directory = Path("locked-release-data")
        with (
            patch.object(
                release_preflight.shutil,
                "rmtree",
                side_effect=[PermissionError(32, "in use"), None],
            ) as remove,
            patch.object(release_preflight.time, "sleep") as sleep,
        ):
            release_preflight._remove_temporary_data(directory)

        self.assertEqual(remove.call_count, 2)
        sleep.assert_called_once_with(0.1)

    def test_windows_server_cleanup_terminates_the_entire_process_tree(self):
        server = MagicMock(pid=48123)
        server.poll.return_value = None
        taskkill_result = subprocess.CompletedProcess([], 0)
        with (
            patch.object(release_preflight.os, "name", "nt"),
            patch.object(
                release_preflight.subprocess, "run", return_value=taskkill_result
            ) as taskkill,
        ):
            release_preflight._stop_server(server)

        taskkill.assert_called_once_with(
            ["taskkill.exe", "/PID", "48123", "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        server.wait.assert_called_once_with(timeout=10)
        server.terminate.assert_not_called()

    def test_missing_rust_has_a_clear_release_error(self):
        with patch.object(release_preflight.shutil, "which", return_value=None):
            with self.assertRaisesRegex(release_preflight.PreflightError, "Rust/Cargo"):
                release_preflight._cargo_executable()

    def test_missing_docker_fails_closed_before_a_version_change(self):
        with patch.object(release_preflight.shutil, "which", return_value=None):
            with self.assertRaisesRegex(release_preflight.PreflightError, "Docker"):
                release_preflight._docker_executable()

    def test_packaging_tool_versions_fail_closed_before_a_version_change(self):
        expected = release_preflight.PINNED_PYTHON_BUILD_TOOLS
        with patch.object(release_preflight.metadata, "version", return_value="0.0.0"):
            with self.assertRaisesRegex(
                release_preflight.PreflightError, f"build=={expected['build']}"
            ):
                release_preflight._require_pinned_python_build_tools()

    def test_runtime_toolchain_versions_fail_closed_before_a_version_change(self):
        with patch.object(release_preflight.platform, "python_version", return_value="0.0.0"):
            with self.assertRaisesRegex(release_preflight.PreflightError, "Python 3.11.9"):
                release_preflight._require_pinned_runtime_toolchains("cargo")
        with patch.object(
            release_preflight.metadata,
            "version",
            side_effect=release_preflight.metadata.PackageNotFoundError("build"),
        ):
            with self.assertRaisesRegex(release_preflight.PreflightError, "not installed"):
                release_preflight._require_pinned_python_build_tools()

    def test_preflight_contains_distribution_and_all_rust_gates(self):
        calls = []
        server = MagicMock()
        server.poll.return_value = None
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            (repo / "VERSION").write_text("3.3.1\n", encoding="utf-8")
            with contextlib.ExitStack() as stack:
                stack.enter_context(
                    patch.object(release_preflight, "_npm_executable", return_value="npm")
                )
                stack.enter_context(
                    patch.object(release_preflight, "_cargo_executable", return_value="cargo")
                )
                stack.enter_context(
                    patch.object(release_preflight, "_docker_executable", return_value="docker")
                )
                pinned_tools = stack.enter_context(
                    patch.object(release_preflight, "_require_pinned_python_build_tools")
                )
                runtime_tools = stack.enter_context(
                    patch.object(release_preflight, "_require_pinned_runtime_toolchains")
                )
                stack.enter_context(
                    patch.object(
                        release_preflight,
                        "_built_wheel",
                        return_value=Path("quiltor-3.3.1-py3-none-any.whl"),
                    )
                )
                stack.enter_context(
                    patch.object(
                        release_preflight,
                        "_run",
                        side_effect=lambda *args: calls.append(args),
                    )
                )
                stack.enter_context(
                    patch.object(release_preflight, "_free_loopback_port", return_value=48123)
                )
                stack.enter_context(
                    patch.object(release_preflight.subprocess, "Popen", return_value=server)
                )
                stack.enter_context(patch.object(release_preflight, "_wait_for_server"))
                stack.enter_context(patch.object(release_preflight, "_stop_server"))
                cleanup = stack.enter_context(
                    patch.object(release_preflight, "_remove_preflight_images")
                )
                release_preflight.run_preflight(repo)
        commands = [call[1] for call in calls]
        distribution_check = [
            sys.executable,
            "distribution/tooling/profile_contract.py",
            "check-release",
        ]
        self.assertIn(["npm", "run", "check:contracts"], commands)
        self.assertIn(
            [sys.executable, "distribution/tooling/workflow_contract.py", "check"], commands
        )
        self.assertIn(
            [sys.executable, "distribution/tooling/container_contract.py", "check"], commands
        )
        self.assertIn(
            [sys.executable, "distribution/tooling/dependency_lock_contract.py", "check"],
            commands,
        )
        self.assertIn(distribution_check, commands)
        self.assertIn(
            [
                sys.executable,
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests/python",
                "-t",
                "tests/python",
                "-v",
            ],
            commands,
        )
        self.assertIn(["cargo", "--locked", "fmt", "--check"], commands)
        self.assertIn(
            [
                "cargo",
                "--locked",
                "clippy",
                "--workspace",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ],
            commands,
        )
        self.assertIn(["cargo", "--locked", "test", "--workspace", "--all-targets"], commands)
        self.assertTrue(
            all(command[1] == "--locked" for command in commands if command[0] == "cargo")
        )
        self.assertIn(["npm", "run", "test"], commands)
        self.assertIn(["npm", "run", "build"], commands)
        self.assertIn(["npm", "run", "check:format"], commands)
        self.assertIn(["git", "diff", "--exit-code", "--", "dist"], commands)
        self.assertEqual(commands.count(["npm", "run", "test:e2e"]), 1)
        labels = [call[0] for call in calls]
        for label in (
            "Build Python wheel and source distribution",
            "Verify packaged Python runtime contracts",
            "Create isolated Python wheel smoke environment",
            "Install isolated Python wheel without checkout imports",
            "Smoke installed Python wheel resources and unavailable PDF fallback",
            "Install isolated wheel browser PDF extra",
            "Smoke installed wheel browser PDF selector",
            "Build self-hosted app container",
            "Verify self-hosted image runtime contract",
            "Verify self-hosted Chromium-only PDF runtime",
            "Build backup-service container",
            "Verify backup-service container payload and user",
        ):
            with self.subTest(label=label):
                self.assertIn(label, labels)
        package_build = commands[labels.index("Build Python wheel and source distribution")]
        self.assertEqual(package_build[:4], [sys.executable, "-m", "build", "--no-isolation"])
        profile_verification = commands[labels.index("Verify packaged Python runtime contracts")]
        self.assertIn("distribution/tooling/artifact_profile.py", profile_verification)
        fallback_smoke = commands[
            labels.index("Smoke installed Python wheel resources and unavailable PDF fallback")
        ]
        self.assertIn("python_package_renderer", " ".join(fallback_smoke))
        self.assertIn("unavailable.render", " ".join(fallback_smoke))
        extra_install = commands[labels.index("Install isolated wheel browser PDF extra")]
        self.assertIn("--only-binary=:all:", extra_install)
        self.assertIn("quiltor[browser-pdf] @ file:", " ".join(extra_install))
        selector_smoke = commands[labels.index("Smoke installed wheel browser PDF selector")]
        self.assertIn("metadata.version('playwright') == '1.61.0'", " ".join(selector_smoke))
        self.assertIn("system_browser.render", " ".join(selector_smoke))
        wheel_smoke_call = calls[labels.index("Smoke installed wheel browser PDF selector")]
        self.assertNotIn("PYTHONPATH", wheel_smoke_call[3])
        container_commands = [
            commands[labels.index(label)]
            for label in (
                "Build self-hosted app container",
                "Verify self-hosted image runtime contract",
                "Verify self-hosted Chromium-only PDF runtime",
                "Build backup-service container",
                "Verify backup-service container payload and user",
            )
        ]
        self.assertTrue(all(command[0] == "docker" for command in container_commands))
        chromium_smoke = commands[labels.index("Verify self-hosted Chromium-only PDF runtime")]
        chromium_script = " ".join(chromium_smoke)
        self.assertIn("chromium.launch({headless:true})", chromium_script)
        self.assertIn("page.pdf()", chromium_script)
        self.assertIn("ffmpeg", chromium_script)
        self.assertIn("unused browser payload", chromium_script)
        backup_build = commands[labels.index("Build backup-service container")]
        self.assertEqual(backup_build[-1], ".")
        self.assertIn("services/backup-server/Dockerfile", backup_build)
        backup_verify = commands[labels.index("Verify backup-service container payload and user")]
        backup_verify_script = " ".join(backup_verify)
        self.assertIn("quiltor.application.backup_manifest", backup_verify_script)
        self.assertIn("compile(p.read_text", backup_verify_script)
        self.assertNotIn("py_compile", backup_verify_script)
        cleanup.assert_called_once()
        runtime_tools.assert_called_once_with("cargo")
        pinned_tools.assert_called_once_with()


class ReleaseManifestTests(unittest.TestCase):
    MARKERS = {
        "macos_direct": "distribution/release-targets/macos-direct.enabled",
        "windows_direct": "distribution/release-targets/windows-direct.enabled",
    }

    @staticmethod
    def _images(app: str = "1", backup: str = "2") -> dict[str, str]:
        return {
            "web-self-hosted": "ghcr.io/example/quiltor@sha256:" + app * 64,
            "backup-service": "ghcr.io/example/quiltor-backup@sha256:" + backup * 64,
        }

    @classmethod
    def _target_root(cls, root: Path, *enabled: str) -> Path:
        repo_root = root / "repo"
        for target in enabled:
            marker = repo_root / cls.MARKERS[target]
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.touch()
        return repo_root

    @staticmethod
    def _artifacts(
        root: Path,
        version: str = "3.3.1",
        repo_root: Path = REPO_ROOT,
    ) -> list[Path]:
        root.mkdir(parents=True, exist_ok=True)
        artifacts = []
        for name, profile in release_manifest.expected_artifacts(version, repo_root):
            artifact = root / name
            artifact.write_bytes((profile + ":" + name).encode("utf-8"))
            artifacts.append(artifact)
        return artifacts

    @staticmethod
    def _attest_signatures(manifest: dict[str, object], artifact_root: Path) -> None:
        for specification in manifest["signatures"]:
            artifact = artifact_root / specification["artifact"]
            release_manifest.attest_signature(
                artifact,
                version=manifest["version"],
                source_revision=manifest["sourceRevision"],
                profile=specification["profile"],
                verified=True,
                notarized=specification["requiresNotarization"],
                output=artifact_root / specification["record"],
            )

    def test_manifest_tracks_each_marker_combination_canonically(self):
        cases = (
            (
                (),
                {"macos_direct": False, "windows_direct": False},
                ["python-package", "web-self-hosted"],
                [
                    "quiltor-3.3.1-py3-none-any.whl",
                    "quiltor-3.3.1.tar.gz",
                ],
                set(),
            ),
            (
                ("macos_direct",),
                {"macos_direct": True, "windows_direct": False},
                ["macos-direct", "python-package", "web-self-hosted"],
                [
                    "Quiltor-3.3.1.dmg",
                    "quiltor-3.3.1-py3-none-any.whl",
                    "quiltor-3.3.1.tar.gz",
                ],
                {"developer-id"},
            ),
            (
                ("windows_direct",),
                {"macos_direct": False, "windows_direct": True},
                ["python-package", "web-self-hosted", "windows-direct"],
                [
                    "Quiltor-Setup-3.3.1.exe",
                    "quiltor-3.3.1-py3-none-any.whl",
                    "quiltor-3.3.1.tar.gz",
                ],
                {"authenticode"},
            ),
            (
                ("macos_direct", "windows_direct"),
                {"macos_direct": True, "windows_direct": True},
                ["macos-direct", "python-package", "web-self-hosted", "windows-direct"],
                [
                    "Quiltor-3.3.1.dmg",
                    "Quiltor-Setup-3.3.1.exe",
                    "quiltor-3.3.1-py3-none-any.whl",
                    "quiltor-3.3.1.tar.gz",
                ],
                {"developer-id", "authenticode"},
            ),
        )
        for enabled, targets, profiles, names, schemes in cases:
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                repo_root = self._target_root(root, *enabled)
                artifact_root = root / "artifacts"
                manifest = release_manifest.create(
                    "3.3.1",
                    "a" * 40,
                    self._images(),
                    self._artifacts(artifact_root, repo_root=repo_root),
                    repo_root,
                )
                self.assertEqual(release_manifest.native_targets(repo_root), targets)
                self.assertEqual(manifest["profiles"], profiles)
                self.assertEqual([item["name"] for item in manifest["artifacts"]], names)
                self.assertEqual({item["scheme"] for item in manifest["signatures"]}, schemes)
                self.assertEqual(manifest["schemaVersion"], 6)
                self.assertEqual(manifest["sourceRevision"], "a" * 40)
                self.assertTrue(all(len(item["sha256"]) == 64 for item in manifest["artifacts"]))
                self.assertEqual(manifest["images"], release_manifest.image_records(self._images()))
                self.assertEqual(
                    [record["artifactContract"]["path"] for record in manifest["images"]],
                    [
                        "distribution/profiles/web-self-hosted.json",
                        "services/backup-server/artifact-contract.json",
                    ],
                )
                self.assertTrue(
                    all(
                        re.fullmatch(r"[0-9a-f]{64}", record["artifactContract"]["sha256"])
                        for record in manifest["images"]
                    )
                )
                self.assertEqual(manifest["dependencyLocks"], dependency_lock_contract.records())
                self.assertTrue(
                    all(len(item["sha256"]) == 64 for item in manifest["dependencyLocks"])
                )
                self._attest_signatures(manifest, artifact_root)
                manifest_path = artifact_root / "release-manifest.json"
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                self.assertEqual(
                    release_manifest.verify(manifest_path, artifact_root, "a" * 40, repo_root),
                    manifest,
                )

    def test_targets_cli_reports_exact_boolean_outputs(self):
        cases = (
            ((), "macos_direct=false\nwindows_direct=false\n"),
            (("macos_direct",), "macos_direct=true\nwindows_direct=false\n"),
            (("windows_direct",), "macos_direct=false\nwindows_direct=true\n"),
            (
                ("macos_direct", "windows_direct"),
                "macos_direct=true\nwindows_direct=true\n",
            ),
        )
        for enabled, expected in cases:
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as directory:
                repo_root = self._target_root(Path(directory), *enabled)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    status = release_manifest.main(["targets"], repo_root=repo_root)
                self.assertEqual(status, 0)
                self.assertEqual(output.getvalue(), expected)

    def test_enabled_native_target_requires_its_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo_root = self._target_root(root, "macos_direct")
            artifacts = self._artifacts(root / "artifacts", repo_root=repo_root)
            artifacts = [artifact for artifact in artifacts if artifact.suffix != ".dmg"]
            with self.assertRaisesRegex(
                release_manifest.ManifestError, "missing Quiltor-3.3.1.dmg"
            ):
                release_manifest.create("3.3.1", "a" * 40, self._images(), artifacts, repo_root)

    def test_files_cli_lists_only_canonical_artifacts_and_signature_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo_root = self._target_root(root, "macos_direct", "windows_direct")
            artifact_root = root / "artifacts"
            manifest = release_manifest.create(
                "3.3.1",
                "a" * 40,
                self._images(),
                self._artifacts(artifact_root, repo_root=repo_root),
                repo_root,
            )
            manifest_path = artifact_root / "release-manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status = release_manifest.main(
                    ["files", "--manifest", str(manifest_path)], repo_root=repo_root
                )
            self.assertEqual(status, 0)
            self.assertEqual(
                output.getvalue().splitlines(),
                [
                    "Quiltor-3.3.1.dmg",
                    "Quiltor-Setup-3.3.1.exe",
                    "quiltor-3.3.1-py3-none-any.whl",
                    "quiltor-3.3.1.tar.gz",
                    "Quiltor-3.3.1.dmg.signature.json",
                    "Quiltor-Setup-3.3.1.exe.signature.json",
                ],
            )

    def test_verification_rejects_a_missing_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = release_manifest.create(
                "3.3.1",
                "a" * 40,
                self._images(),
                self._artifacts(root),
            )
            (root / "quiltor-3.3.1.tar.gz").unlink()
            path = root / "release-manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(release_manifest.ManifestError, "missing"):
                release_manifest.verify(path, root)

    def test_manifest_creation_rejects_noncanonical_package_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts = self._artifacts(root)
            artifacts[-1].rename(root / "quiltor-3.3.1-source.tar.gz")
            artifacts[-1] = root / "quiltor-3.3.1-source.tar.gz"
            with self.assertRaisesRegex(release_manifest.ManifestError, "canonical"):
                release_manifest.create(
                    "3.3.1",
                    "a" * 40,
                    self._images(),
                    artifacts,
                )

    def test_mac_attestation_requires_native_verification_and_notarization(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "Quiltor-3.3.1.dmg"
            artifact.write_bytes(b"signed bytes")
            kwargs = {
                "version": "3.3.1",
                "source_revision": "a" * 40,
                "profile": "macos-direct",
                "output": Path(directory) / "record.json",
            }
            with self.assertRaisesRegex(release_manifest.ManifestError, "verification"):
                release_manifest.attest_signature(
                    artifact, verified=False, notarized=True, **kwargs
                )
            with self.assertRaisesRegex(release_manifest.ManifestError, "notarized"):
                release_manifest.attest_signature(
                    artifact, verified=True, notarized=False, **kwargs
                )

    def test_enabled_native_signature_record_remains_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo_root = self._target_root(root, "macos_direct")
            artifact_root = root / "artifacts"
            manifest = release_manifest.create(
                "3.3.1",
                "a" * 40,
                self._images(),
                self._artifacts(artifact_root, repo_root=repo_root),
                repo_root,
            )
            self._attest_signatures(manifest, artifact_root)
            manifest_path = artifact_root / "release-manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            record_path = artifact_root / manifest["signatures"][0]["record"]
            record = json.loads(record_path.read_text(encoding="utf-8"))
            record["verified"] = False
            record_path.write_text(json.dumps(record), encoding="utf-8")
            with self.assertRaisesRegex(release_manifest.ManifestError, "signature status"):
                release_manifest.verify(manifest_path, artifact_root, repo_root=repo_root)

    def test_publish_verification_rejects_tampering_after_signature_attestation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo_root = self._target_root(root, "macos_direct", "windows_direct")
            artifact_root = root / "artifacts"
            version = "3.3.1"
            revision = "a" * 40
            artifacts = self._artifacts(artifact_root, version, repo_root)
            manifest = release_manifest.create(
                version,
                revision,
                self._images(),
                artifacts,
                repo_root,
            )
            self._attest_signatures(manifest, artifact_root)
            manifest_path = artifact_root / "release-manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            release_manifest.verify(manifest_path, artifact_root, revision, repo_root)
            (artifact_root / f"quiltor-{version}.tar.gz").write_bytes(b"tampered")
            with self.assertRaisesRegex(release_manifest.ManifestError, "digest"):
                release_manifest.verify(manifest_path, artifact_root, revision, repo_root)

    def test_wheel_digest_is_verified_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = release_manifest.create(
                "3.3.1",
                "a" * 40,
                self._images(),
                self._artifacts(root),
            )
            manifest_path = root / "release-manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            (root / "quiltor-3.3.1-py3-none-any.whl").write_bytes(b"tampered")
            with self.assertRaisesRegex(release_manifest.ManifestError, "digest"):
                release_manifest.verify(manifest_path, root)

    def test_manifest_rejects_mutable_oci_version_tags(self):
        with self.assertRaisesRegex(release_manifest.ManifestError, "digest reference"):
            release_manifest.create(
                "3.3.1",
                "a" * 40,
                {
                    "web-self-hosted": "ghcr.io/example/quiltor:3.3.1",
                    "backup-service": "ghcr.io/example/quiltor-backup:3.3.1",
                },
                [],
            )

    def test_manifest_rejects_unnamed_or_misbound_oci_images(self):
        with self.assertRaisesRegex(release_manifest.ManifestError, "named"):
            release_manifest.create("3.3.1", "a" * 40, self._images().values(), [])
        swapped = self._images()
        swapped["web-self-hosted"], swapped["backup-service"] = (
            swapped["backup-service"],
            swapped["web-self-hosted"],
        )
        with self.assertRaisesRegex(release_manifest.ManifestError, "repository"):
            release_manifest.create("3.3.1", "a" * 40, swapped, [])

    def test_loaded_manifest_rejects_role_contract_or_digest_retargeting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = release_manifest.create(
                "3.3.1", "a" * 40, self._images(), self._artifacts(root)
            )
            manifest_path = root / "release-manifest.json"
            for field, value, error in (
                ("role", "application", "role"),
                (
                    "artifactContract",
                    {"path": "another-service.json", "sha256": "0" * 64},
                    "artifact contract",
                ),
                ("digest", "sha256:" + "f" * 64, "digest"),
            ):
                tampered = json.loads(json.dumps(manifest))
                tampered["images"][1][field] = value
                manifest_path.write_text(json.dumps(tampered), encoding="utf-8")
                with self.subTest(field=field):
                    with self.assertRaisesRegex(release_manifest.ManifestError, error):
                        release_manifest.load(manifest_path)

    def test_second_build_cannot_retarget_the_first_runs_image_digests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts = self._artifacts(root)
            first = release_manifest.create("3.3.1", "a" * 40, self._images("1", "2"), artifacts)
            second = release_manifest.create("3.3.1", "a" * 40, self._images("3", "4"), artifacts)
            self.assertNotEqual(first["images"], second["images"])
            manifest_path = root / "first-run-manifest.json"
            manifest_path.write_text(json.dumps(first), encoding="utf-8")
            self.assertEqual(
                release_manifest.load(manifest_path)["images"],
                release_manifest.image_records(self._images("1", "2")),
            )


class WorkflowBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = BUILD_WORKFLOW.read_text(encoding="utf-8")
        cls.publish = PUBLISH_WORKFLOW.read_text(encoding="utf-8")

    def test_build_produces_artifacts_but_never_publishes_a_release(self):
        self.assertIn("release_manifest.py create", self.build)
        self.assertIn("actions/upload-artifact", self.build)
        self.assertNotIn("gh release create", self.build)
        self.assertNotIn(":latest", self.build)
        self.assertEqual(
            self.build.count("build-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_SHA}"),
            2,
        )
        self.assertNotIn(
            'echo "tag=$REPOSITORY:${{ needs.version-check.outputs.version }}"',
            self.build,
        )

    def test_every_artifact_build_waits_for_the_same_workflow_release_gate(self):
        self.assertIn("release-gate:", self.build)
        self.assertIn("distribution/tooling/release_preflight.py", self.build)
        self.assertNotIn("set_version.py", self.build)
        self.assertGreaterEqual(
            self.build.count("needs: [version-check, release-gate]"),
            5,
        )
        self.assertIn("npx playwright install --with-deps chromium", self.build)

    def test_normal_ci_runs_the_browser_suite_instead_of_deferring_it_to_release(self):
        test_workflow = TEST_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("push:\n    branches: [main]", test_workflow)
        self.assertIn("pull_request:", test_workflow)
        for required_job in ("backend:", "portable-core:", "frontend:", "browser-e2e:"):
            self.assertIn(required_job, test_workflow)
        for required_gate in (
            "python -m unittest discover -s tests/python -t tests/python -v",
            "cargo --locked clippy --workspace --all-targets -- -D warnings",
            "cargo --locked test --workspace --all-targets",
            "run: npx vitest run",
            "run: npm run build",
            "run: npm run test:e2e",
        ):
            self.assertIn(required_gate, test_workflow)
        self.assertIn("browser-e2e:", test_workflow)
        self.assertIn("needs: frontend", test_workflow)
        self.assertNotIn("continue-on-error", test_workflow)

    def test_no_release_job_can_start_before_exact_main_is_proven(self):
        context = self.build.index("release-context:")
        release_gate = self.build.index("release-gate:")
        version_check = self.build.index("version-check:")
        self.assertLess(context, release_gate)
        self.assertLess(context, version_check)
        self.assertIn('[ "$GITHUB_REF" = "refs/heads/main" ]', self.build)
        self.assertIn("git rev-parse refs/remotes/origin/main", self.build)
        self.assertIn('[ "$GITHUB_SHA" = "$MAIN_SHA" ]', self.build)
        self.assertIn(
            "release-gate:\n    name: Portable release gate\n    needs: release-context",
            self.build,
        )
        self.assertIn("version-check:\n    needs: release-context", self.build)
        self.assertEqual(self.build.count("packages: write"), 2)

    def test_oci_handoff_uses_build_digests_not_re_resolved_version_tags(self):
        self.assertEqual(self.build.count("steps.build.outputs.digest"), 2)
        self.assertEqual(self.build.count('echo "value=$REPOSITORY@$DIGEST"'), 2)
        self.assertIn('--web-image "${{ needs.web-image.outputs.image }}"', self.build)
        self.assertIn('--backup-image "${{ needs.backup-image.outputs.image }}"', self.build)
        self.assertIn("${IMAGE%@sha256:*}", self.publish)
        self.assertIn("IFS=$'\\t' read -r NAME ROLE IMAGE DIGEST", self.publish)
        promotion = self.publish[
            self.publish.index("docker buildx imagetools create") : self.publish.index(
                "          done < <(python distribution/tooling/release_manifest.py images"
            )
        ]
        self.assertIn('-t "$REPOSITORY:$VERSION"', promotion)
        self.assertIn('-t "$REPOSITORY:latest"', promotion)
        self.assertEqual(promotion.count("docker buildx imagetools create"), 1)
        self.assertNotIn("${IMAGE%:*}:latest", self.publish)

    def test_every_ci_and_preflight_cargo_gate_is_lockfile_closed(self):
        test_workflow = TEST_WORKFLOW.read_text(encoding="utf-8")
        lock = workflow_contract.action_lock()
        for workflow in (self.build, test_workflow):
            with self.subTest(workflow=workflow[:30]):
                self.assertNotIn("dtolnay/rust-toolchain@stable", workflow)
                self.assertIn(f"dtolnay/rust-toolchain@{lock['dtolnay/rust-toolchain']}", workflow)
                self.assertIn('toolchain: "1.98.0"', workflow)
        cargo_steps = []
        for workflow_path in (REPO_ROOT / ".github/workflows").glob("*.y*ml"):
            for line in workflow_path.read_text(encoding="utf-8").splitlines():
                if re.search(r"\brun:\s*cargo\b", line):
                    cargo_steps.append((workflow_path.name, line.strip()))
        self.assertTrue(cargo_steps)
        for workflow_name, command in cargo_steps:
            with self.subTest(workflow=workflow_name, command=command):
                self.assertIn("cargo --locked ", command)
        workflow_contract.validate_cargo(workflow_contract._workflow_sources())

    def test_every_action_and_runtime_toolchain_is_immutably_locked(self):
        workflow_contract.validate_repository()
        locked = workflow_contract.action_lock()
        for workflow_path in (REPO_ROOT / ".github/workflows").glob("*.y*ml"):
            source = workflow_path.read_text(encoding="utf-8")
            for action, revision in workflow_contract.ACTION_USE.findall(source):
                with self.subTest(workflow=workflow_path.name, action=action):
                    self.assertEqual(revision, locked[action])
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "mutable"):
            workflow_contract.validate_actions(
                {Path("unsafe.yml"): "steps:\n  - uses: actions/checkout@v4\n"},
                {"actions/checkout": locked["actions/checkout"]},
            )

    def test_native_release_target_guards_fail_closed(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_native_release_targets(sources)

        mutations = (
            (
                "unguarded macOS job",
                BUILD_WORKFLOW,
                "if: needs.version-check.outputs.macos_direct == 'true'",
                "if: true",
                "macos-direct is not guarded",
            ),
            (
                "non-boolean Windows fallback",
                BUILD_WORKFLOW,
                "needs.version-check.outputs.windows_direct == 'false'",
                "needs.version-check.outputs.windows_direct != 'true'",
                "does not fail closed",
            ),
            (
                "fixed publisher assets",
                PUBLISH_WORKFLOW,
                "release_manifest.py files",
                "release_manifest.py fixed-files",
                "derive assets from the verified manifest",
            ),
        )
        for name, path, original, replacement, error in mutations:
            with self.subTest(name=name):
                mutated = dict(sources)
                mutated[path] = mutated[path].replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_native_release_targets(mutated)

    def test_release_packaging_toolchain_is_concretely_pinned(self):
        pins = {
            "build": "1.5.0",
            "editables": "0.5",
            "hatchling": "1.31.0",
            "pyinstaller": "6.22.0",
            "ruff": "0.16.4",
        }
        self.assertEqual(
            release_preflight.PINNED_PYTHON_BUILD_TOOLS,
            {
                "build": pins["build"],
                "editables": pins["editables"],
                "hatchling": pins["hatchling"],
                "ruff": pins["ruff"],
            },
        )
        for package in ("build", "editables", "hatchling", "ruff"):
            with self.subTest(package=package):
                self.assertIn(f'"{package}=={pins[package]}"', self.build)
        for path in (
            REPO_ROOT / "distribution/desktop/macos/direct/requirements.lock",
            REPO_ROOT / "distribution/desktop/windows/direct/requirements.lock",
        ):
            with self.subTest(lock=path):
                self.assertIn(
                    f"pyinstaller=={pins['pyinstaller']}", path.read_text(encoding="utf-8")
                )
        self.assertNotIn(" build hatchling", self.build)
        self.assertNotRegex(self.build, r"pip install[^\n]*\s+pyinstaller(?:\s|$)")
        self.assertGreaterEqual(self.build.count("--require-hashes"), 4)
        self.assertNotIn('-e ".[desktop]"', self.build)
        self.assertNotIn("pip install --no-deps --no-build-isolation -e .", self.build)
        self.assertIn("python -m build --no-isolation --outdir pkg-dist", self.build)
        self.assertGreaterEqual(self.build.count("--no-build-isolation"), 3)
        toolchains = workflow_contract.toolchain_lock()
        release_toolchains = toolchains["releaseToolchains"]
        self.assertEqual(
            release_toolchains,
            {
                "node": "22.23.2",
                "npm": "10.9.8",
                "python": "3.11.9",
                "rust": "1.98.0",
            },
        )
        self.assertEqual(toolchains["dependencyLockGenerator"], {"uv": "0.12.5"})
        self.assertEqual(
            toolchains["nativePackagingTools"],
            {
                "innoSetup": {
                    "version": "6.7.1",
                    "downloadUrl": "https://github.com/jrsoftware/issrc/releases/download/is-6_7_1/innosetup-6.7.1.exe",
                    "sha256": "4d11e8050b6185e0d49bd9e8cc661a7a59f44959a621d31d11033124c4e8a7b0",
                }
            },
        )
        self.assertEqual(
            toolchains["hostedRunners"],
            {
                "linuxX64": "ubuntu-24.04",
                "macosArm64": "macos-15",
                "windowsX64": "windows-2025",
            },
        )
        self.assertEqual(
            toolchains["artifactRuntimes"],
            {
                "pythonPackage": {"playwright": "1.61.0"},
                "webOci": {"playwright": "1.61.1"},
            },
        )
        self.assertEqual(
            (REPO_ROOT / ".node-version").read_text(encoding="utf-8").strip(),
            release_toolchains["node"],
        )

    def test_native_installer_checksum_and_runner_labels_fail_closed(self):
        contract = workflow_contract.toolchain_lock()
        sources = workflow_contract._workflow_sources()

        without_checksum = dict(sources)
        without_checksum[BUILD_WORKFLOW] = without_checksum[BUILD_WORKFLOW].replace(
            "Get-FileHash -LiteralPath $installer -Algorithm SHA256",
            "Write-Output $installer",
        )
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError,
            "locked Inno Setup step",
        ):
            workflow_contract.validate_toolchains(without_checksum, contract)

        mutable_runner = dict(sources)
        mutable_runner[TEST_WORKFLOW] = mutable_runner[TEST_WORKFLOW].replace(
            "runs-on: ubuntu-24.04",
            "runs-on: ubuntu-latest",
            1,
        )
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError,
            "workflow runners",
        ):
            workflow_contract.validate_toolchains(mutable_runner, contract)

    def test_dependency_locks_declare_reproducible_target_environments(self):
        records = dependency_lock_contract.records()
        self.assertEqual(
            {record["pythonEnvironment"]["role"] for record in records},
            {"release-build", "target-runtime"},
        )
        web = next(record for record in records if record["name"] == "web-self-hosted-runtime")
        self.assertEqual(web["pythonEnvironment"]["version"], "3.12.3")
        self.assertEqual(web["pythonPlatform"], "x86_64-manylinux_2_39")
        contract = json.loads(
            (REPO_ROOT / "distribution/dependency-locks.json").read_text(encoding="utf-8")
        )
        command = regenerate_dependency_locks.command_for(
            "uv",
            web,
            contract["generator"],
            Path("generated.lock"),
        )
        for argument in (
            "--generate-hashes",
            "--no-annotate",
            "--no-header",
            "--no-sources",
            "--exclude-newer",
            "--python-version",
            "--python-platform",
        ):
            self.assertIn(argument, command)

    def test_web_image_uses_digest_bound_bases_and_only_headless_chromium(self):
        contract = json.loads(
            (REPO_ROOT / "distribution/containers/base-images.json").read_text(encoding="utf-8")
        )
        reference = contract["webRuntime"]["reference"]
        node_reference = contract["nodeBuild"]["reference"]
        self.assertEqual(
            reference,
            "ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517",
        )
        self.assertIn(".webRuntime.reference", self.build)
        self.assertEqual(
            node_reference,
            "node:22.23.2-bookworm-slim@sha256:"
            "d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436",
        )
        self.assertIn(".nodeBuild.reference", self.build)
        self.assertIn(
            "WEB_RUNTIME_BASE_IMAGE=${{ steps.image.outputs.runtime_base_image }}",
            self.build,
        )
        self.assertIn("NODE_BASE_IMAGE=${{ steps.image.outputs.node_base_image }}", self.build)
        dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertNotIn("mcr.microsoft.com/playwright", dockerfile)
        self.assertIn("install --only-shell chromium", dockerfile)
        self.assertIn("browser_payload_digest.py check-contract", dockerfile)
        self.assertIn("distribution/containers/browser-payloads.json", dockerfile)
        self.assertIn("ffmpeg-*", dockerfile)
        self.assertIn("chromium.launch({headless:true})", dockerfile)
        self.assertEqual(
            dockerfile.count("platform.python_version() == '3.12.3'"),
            1,
        )

    def test_publish_consumes_a_successful_build_without_rebuilding(self):
        self.assertIn('workflows: ["Release Build"]', self.publish)
        self.assertIn("release_manifest.py verify", self.publish)
        self.assertIn("gh run download", self.publish)
        self.assertNotIn("npm run build", self.publish)
        self.assertNotIn("pyinstaller", self.publish.casefold())

    def test_manual_publish_authenticates_workflow_branch_revision_and_success(self):
        for evidence in (
            'actions/workflows/release.yml" --jq .id',
            "RUN_WORKFLOW_ID",
            'RUN_NAME" = "Release Build"',
            'RUN_PATH" = ".github/workflows/release.yml"',
            'HEAD_BRANCH" = main',
            'CONCLUSION" = success',
            'commits/main" --jq .sha',
            '[ "$SHA" = "$MAIN_SHA" ]',
        ):
            with self.subTest(evidence=evidence):
                self.assertIn(evidence, self.publish)
        self.assertNotIn("compare/$SHA...main", self.publish)

    def test_build_and_publish_both_reject_non_monotonic_release_versions(self):
        for workflow in (self.build, self.publish):
            with self.subTest(workflow=workflow[:30]):
                self.assertIn("previous_release.py", workflow)
                self.assertIn("--check-monotonic", workflow)
                self.assertIn("--current-version", workflow)
        self.assertLess(
            self.build.index("--check-monotonic"),
            self.build.index("  python-package:"),
        )
        self.assertLess(
            self.publish.index("--check-monotonic"),
            self.publish.index("gh release create"),
        )
        self.assertGreaterEqual(self.publish.count("--check-not-older"), 2)
        self.assertLess(
            self.publish.rindex("--check-not-older"),
            self.publish.index('gh release edit "v$VERSION" --draft=false --latest'),
        )
        self.assertGreaterEqual(
            self.publish.count('commits/main" --jq .sha'),
            3,
        )

    def test_workflows_invoke_shell_scripts_through_bash_not_file_mode(self):
        self.assertIn(
            "bash distribution/desktop/macos/direct/build.sh",
            self.build,
        )
        self.assertIn(
            "bash distribution/desktop/macos/direct/smoke-install.sh",
            self.build,
        )
        for workflow in (REPO_ROOT / ".github/workflows").glob("*.y*ml"):
            for line_number, line in enumerate(
                workflow.read_text(encoding="utf-8").splitlines(), start=1
            ):
                command = line.strip()
                if re.search(r"\.sh(?:\s|\\|$|[\"'])", command) and not command.startswith("#"):
                    with self.subTest(workflow=workflow.name, line=line_number):
                        command = command.removeprefix("- run: ")
                        self.assertTrue(
                            command.startswith("bash "),
                            f"{workflow.name}:{line_number} executes a shell script without bash",
                        )

    def test_every_npm_python_entrypoint_is_windows_portable(self):
        scripts = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
        python_entrypoints = {
            name: command for name, command in scripts.items() if "python" in command.casefold()
        }
        self.assertTrue(python_entrypoints)
        for name, command in python_entrypoints.items():
            with self.subTest(script=name):
                self.assertNotIn("python3", command.casefold())

    def test_direct_build_paths_and_signing_configuration_are_current(self):
        self.assertIn("distribution/desktop/macos/direct/build.sh", self.build)
        self.assertIn("distribution/desktop/windows/direct/build.ps1", self.build)
        self.assertIn("secrets.APPLE_CERTIFICATE_P12", self.build)
        self.assertIn("secrets.WINDOWS_CERTIFICATE_P12", self.build)
        self.assertGreaterEqual(self.build.count('QUILTOR_REQUIRE_SIGNING: "1"'), 2)
        self.assertNotIn("unsigned macOS build", self.build)
        self.assertNotIn("unsigned Windows build", self.build)
        self.assertIn("attest-signature", self.build)

    def test_native_lifecycle_smokes_gate_uploads_after_signature_verification(self):
        mac_job = self.build[
            self.build.index("  macos-direct:") : self.build.index("  windows-direct:")
        ]
        windows_job = self.build[
            self.build.index("  windows-direct:") : self.build.index("  release-manifest:")
        ]
        self.assertLess(mac_job.index("Verify and attest"), mac_job.index("smoke-install.sh"))
        self.assertLess(mac_job.index("smoke-install.sh"), mac_job.index("actions/upload-artifact"))
        self.assertLess(
            windows_job.index("Attest the verified"), windows_job.index("smoke-install.ps1")
        )
        self.assertLess(
            windows_job.index("smoke-install.ps1"),
            windows_job.index("actions/upload-artifact"),
        )
        self.assertEqual(self.build.count("Smoke native install, upgrade, launch and uninstall"), 2)
        self.assertGreaterEqual(self.build.count("GH_TOKEN: ${{ github.token }}"), 2)
        for profile_id in ("macos-direct", "windows-direct"):
            profile = json.loads(
                (REPO_ROOT / f"distribution/profiles/{profile_id}.json").read_text(encoding="utf-8")
            )
            self.assertIn(profile["build"]["smokeEntrypoint"], self.build)

    def test_publish_checks_every_file_before_creating_a_draft(self):
        verify = self.publish.index("release_manifest.py verify")
        create = self.publish.index("gh release create")
        self.assertLess(verify, create)
        self.assertIn("--draft", self.publish)
        self.assertIn("Verify manifest, revision and every expected artifact", self.publish)

    def test_manifest_is_created_from_concrete_downloaded_package_artifacts(self):
        self.assertIn("actions/download-artifact@", self.build)
        self.assertIn(
            "quiltor-${{ needs.version-check.outputs.version }}-py3-none-any.whl",
            self.build,
        )
        self.assertIn("quiltor-${{ needs.version-check.outputs.version }}.tar.gz", self.build)
        self.assertNotIn('--artifact "release-assets/*.whl"', self.build)
        self.assertNotIn('--artifact "release-assets/*.tar.gz"', self.build)
        self.assertNotIn("release-assets/*", self.publish)
        create = self.build.index("release_manifest.py create")
        verify = self.build.index("release_manifest.py verify", create)
        upload = self.build.index("name: release-manifest", verify)
        self.assertLess(create, verify)
        self.assertLess(verify, upload)


class ThirdPartyNoticeContractTests(unittest.TestCase):
    def test_notice_lists_the_complete_production_client_dependency_closure(self):
        notices = (REPO_ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        notice_rows = {
            tuple(cell.strip().strip("`") for cell in line.strip().strip("|").split("|"))
            for line in notices.splitlines()
            if line.lstrip().startswith("| `")
        }
        lock = json.loads((REPO_ROOT / "package-lock.json").read_text(encoding="utf-8"))
        packages = lock["packages"]
        pending = list(packages[""]["dependencies"])
        seen = set()
        while pending:
            name = pending.pop()
            if name in seen:
                continue
            seen.add(name)
            package = packages[f"node_modules/{name}"]
            pending.extend(package.get("dependencies", {}))
            row = (name, package["version"], package["license"])
            with self.subTest(package=name):
                self.assertIn(row, notice_rows)

    def test_client_and_playwright_notices_match_the_lockfile_metadata(self):
        notices = (REPO_ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        lock = json.loads((REPO_ROOT / "package-lock.json").read_text(encoding="utf-8"))
        packages = lock["packages"]
        expected = {
            "node_modules/@codemirror/state": ("6.7.1", "MIT"),
            "node_modules/@codemirror/view": ("6.43.8", "MIT"),
            "node_modules/@playwright/test": ("1.61.1", "Apache-2.0"),
            "node_modules/playwright": ("1.61.1", "Apache-2.0"),
            "node_modules/playwright-core": ("1.61.1", "Apache-2.0"),
        }
        for package, (version, license_name) in expected.items():
            with self.subTest(package=package):
                self.assertEqual(packages[package]["version"], version)
                self.assertEqual(packages[package]["license"], license_name)
                self.assertIn(version, notices)
                self.assertIn(license_name, notices)

    def test_python_runtime_notices_cover_every_pinned_oci_dependency(self):
        notices = (REPO_ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        requirements = (REPO_ROOT / "distribution/web/self-hosted/requirements.lock").read_text(
            encoding="utf-8"
        )
        expected = {
            "pyjwt": ("2.13.0", "MIT License"),
            "cryptography": ("50.0.0", "Apache License 2.0"),
            "cffi": ("2.1.1", "MIT-0"),
            "pycparser": ("3.0", "3-Clause BSD License"),
        }
        for package, (version, license_name) in expected.items():
            with self.subTest(package=package):
                self.assertIn(f"{package}=={version}", requirements)
                self.assertIn(version, notices)
                self.assertIn(license_name, notices)

    def test_notices_cover_every_hash_locked_python_package(self):
        notices = (REPO_ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        notice_rows = {
            tuple(cell.strip().strip("`") for cell in line.strip().strip("|").split("|"))
            for line in notices.splitlines()
            if line.lstrip().startswith("| `")
        }
        package_versions = {(row[0].casefold(), row[1]) for row in notice_rows}
        for record in dependency_lock_contract.records():
            lock = (REPO_ROOT / record["path"]).read_text(encoding="utf-8")
            for name, version in re.findall(
                r"^([A-Za-z0-9_.-]+)(?:\[[^]]+\])?==([^\s\\]+)",
                lock,
                re.MULTILINE,
            ):
                with self.subTest(lock=record["name"], package=name):
                    self.assertIn((name.casefold().replace("_", "-"), version), package_versions)


if __name__ == "__main__":
    unittest.main()
