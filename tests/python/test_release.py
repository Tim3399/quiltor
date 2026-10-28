"""Versioning and the immutable build-to-publish release hand-off."""

import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, ClassVar, cast
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLING = REPO_ROOT / "distribution" / "tooling"
sys.path.insert(0, str(TOOLING))

import dependency_lock_contract  # noqa: E402
import path_filter  # noqa: E402
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
        assert selected is not None
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
        assert selected is not None
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
        assert selected is not None
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
    def test_browser_preflight_overrides_inherited_ai_endpoint(self):
        server = MagicMock()
        server.poll.return_value = 0
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(
                release_preflight.os.environ,
                {"QUILTOR_AI_URL": "http://model.example:11435"},
            ),
            patch.object(
                release_preflight, "mkdtemp", return_value=str(Path(directory) / "browser-data")
            ),
            patch.object(release_preflight, "_free_loopback_port", return_value=48123),
            patch.object(release_preflight.subprocess, "Popen", return_value=server) as popen,
            patch.object(release_preflight, "_wait_for_server"),
            patch.object(release_preflight, "_run"),
        ):
            release_preflight._run_browser_suite(Path(directory), python="python", npm="npm")

        environment = popen.call_args.kwargs["env"]
        self.assertEqual(environment["QUILTOR_AI_URL"], "http://127.0.0.1:1")
        self.assertEqual(environment["QUILTOR_DATA_DIR"], str(Path(directory) / "browser-data"))

    def test_browser_failure_and_cleanup_failure_keep_both_causes(self):
        browser_error = release_preflight.PreflightError("browser gate failed")
        cleanup_error = release_preflight.PreflightError("temporary data stayed locked")
        server = MagicMock()
        server.poll.return_value = 0
        with (
            patch.object(release_preflight, "mkdtemp", return_value="browser-data"),
            patch.object(release_preflight, "_free_loopback_port", return_value=48123),
            patch.object(release_preflight.subprocess, "Popen", return_value=server),
            patch.object(release_preflight, "_wait_for_server"),
            patch.object(release_preflight, "_run", side_effect=browser_error),
            patch.object(
                release_preflight, "_remove_temporary_data", side_effect=cleanup_error
            ) as cleanup,
            self.assertRaisesRegex(
                release_preflight.PreflightError,
                "browser gate failed.*Cleanup also failed: temporary data stayed locked",
            ),
        ):
            release_preflight._run_browser_suite(Path("repo"), python="python", npm="npm")

        cleanup.assert_called_once_with(Path("browser-data"))

    def test_browser_failure_keeps_both_cleanup_failures_in_order(self):
        browser_error = release_preflight.PreflightError("browser gate failed")
        stop_error = release_preflight.PreflightError("server tree stayed alive")
        data_error = release_preflight.PreflightError("temporary data stayed locked")
        server = MagicMock()
        cleanup_order = []

        def fail_stop(value):
            cleanup_order.append(("stop", value))
            raise stop_error

        def fail_data(value):
            cleanup_order.append(("data", value))
            raise data_error

        with (
            patch.object(release_preflight, "mkdtemp", return_value="browser-data"),
            patch.object(release_preflight, "_free_loopback_port", return_value=48123),
            patch.object(release_preflight.subprocess, "Popen", return_value=server),
            patch.object(release_preflight, "_wait_for_server"),
            patch.object(release_preflight, "_run", side_effect=browser_error),
            patch.object(release_preflight, "_stop_server", side_effect=fail_stop) as stop,
            patch.object(
                release_preflight, "_remove_temporary_data", side_effect=fail_data
            ) as cleanup,
            self.assertRaisesRegex(
                release_preflight.PreflightError,
                (
                    "browser gate failed.*Cleanup also failed: server tree stayed alive; "
                    "temporary data stayed locked"
                ),
            ) as raised,
        ):
            release_preflight._run_browser_suite(Path("repo"), python="python", npm="npm")

        self.assertIs(raised.exception.__cause__, browser_error)
        stop.assert_called_once_with(server)
        cleanup.assert_called_once_with(Path("browser-data"))
        self.assertEqual(
            cleanup_order,
            [("stop", server), ("data", Path("browser-data"))],
        )

    def test_browser_failure_survives_successful_cleanup(self):
        browser_error = release_preflight.PreflightError("browser gate failed")
        server = MagicMock()
        server.poll.return_value = 0
        with (
            patch.object(release_preflight, "mkdtemp", return_value="browser-data"),
            patch.object(release_preflight, "_free_loopback_port", return_value=48123),
            patch.object(release_preflight.subprocess, "Popen", return_value=server),
            patch.object(release_preflight, "_wait_for_server"),
            patch.object(release_preflight, "_run", side_effect=browser_error),
            patch.object(release_preflight, "_remove_temporary_data") as cleanup,
            self.assertRaises(release_preflight.PreflightError) as raised,
        ):
            release_preflight._run_browser_suite(Path("repo"), python="python", npm="npm")

        self.assertIs(raised.exception, browser_error)
        cleanup.assert_called_once_with(Path("browser-data"))

    def test_successful_browser_gate_still_fails_on_cleanup_error(self):
        cleanup_error = release_preflight.PreflightError("temporary data stayed locked")
        server = MagicMock()
        server.poll.return_value = 0
        with (
            patch.object(release_preflight, "mkdtemp", return_value="browser-data"),
            patch.object(release_preflight, "_free_loopback_port", return_value=48123),
            patch.object(release_preflight.subprocess, "Popen", return_value=server),
            patch.object(release_preflight, "_wait_for_server"),
            patch.object(release_preflight, "_run"),
            patch.object(
                release_preflight, "_remove_temporary_data", side_effect=cleanup_error
            ) as cleanup,
            self.assertRaises(release_preflight.PreflightError) as raised,
        ):
            release_preflight._run_browser_suite(Path("repo"), python="python", npm="npm")

        self.assertIs(raised.exception, cleanup_error)
        cleanup.assert_called_once_with(Path("browser-data"))

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
            with self.assertRaisesRegex(release_preflight.PreflightError, "Python 3.12.10"):
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
    MARKERS: ClassVar[dict[str, str]] = {
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
    def _attest_signatures(manifest: dict[str, Any], artifact_root: Path) -> None:
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
                manifest: dict[str, Any] = release_manifest.create(
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
            manifest: dict[str, Any] = release_manifest.create(
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
            manifest: dict[str, Any] = release_manifest.create(
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
            manifest: dict[str, Any] = release_manifest.create(
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
            manifest: dict[str, Any] = release_manifest.create(
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
            manifest: dict[str, Any] = release_manifest.create(
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
            # Deliberately the wrong shape: values without their image names.
            release_manifest.create("3.3.1", "a" * 40, cast(Any, self._images().values()), [])
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
            manifest: dict[str, Any] = release_manifest.create(
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


def _github_number(value):
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text == "":
        return 0.0
    try:
        return float(text)
    except ValueError:
        return float("nan")


def _github_equal(left, right):
    """GitHub expression equality: same type compares directly, otherwise both become numbers."""
    if type(left) is type(right) and left is not None:
        if isinstance(left, str):
            return left.casefold() == right.casefold()
        return left == right
    if left is None and right is None:
        return True
    return _github_number(left) == _github_number(right)


def _github_truthy(value):
    if value is None or value is False or value == "":
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value == value and value != 0
    return True


def evaluate_github_expression(expression, context):
    """Evaluate the subset of GitHub expressions the plan job uses: ==, !=, &&, ||, (), format."""
    tokens = re.findall(r"'[^']*'|==|!=|&&|\|\||[(),]|[A-Za-z_][A-Za-z0-9_.]*", expression)
    position = 0

    def peek():
        return tokens[position] if position < len(tokens) else None

    def take(expected=None):
        nonlocal position
        token = tokens[position]
        if expected is not None and token != expected:
            raise ValueError(f"expected {expected}, found {token}")
        position += 1
        return token

    def primary():
        token = take()
        if token == "(":
            value = disjunction()
            take(")")
            return value
        if token.startswith("'"):
            return token[1:-1]
        if token in ("true", "false"):
            return token == "true"
        if token == "null":
            return None
        if token == "format":
            take("(")
            template = primary()
            arguments = []
            while peek() == ",":
                take(",")
                arguments.append(comparison())
            take(")")
            for index, argument in enumerate(arguments):
                text = (
                    ""
                    if argument is None
                    else str(argument).lower()
                    if isinstance(argument, bool)
                    else str(argument)
                )
                template = template.replace("{" + str(index) + "}", text)
            return template
        return context.get(token)

    def comparison():
        left = primary()
        while peek() in ("==", "!="):
            operator = take()
            equal = _github_equal(left, primary())
            left = equal if operator == "==" else not equal
        return left

    def conjunction():
        left = comparison()
        while peek() == "&&":
            take()
            right = comparison()
            left = right if _github_truthy(left) else left
        return left

    def disjunction():
        left = conjunction()
        while peek() == "||":
            take()
            right = conjunction()
            left = left if _github_truthy(left) else right
        return left

    value = disjunction()
    if position != len(tokens):
        raise ValueError(f"unparsed tail: {tokens[position:]}")
    return value


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
        self.assertIn("bash tools/dev/playwright-linux.sh", self.build)

    def test_linux_playwright_install_is_bounded_and_fails_after_one_mirror_switch(self):
        sources = workflow_contract._workflow_sources()
        script = (REPO_ROOT / "tools/dev/playwright-linux.sh").read_text(encoding="utf-8")
        workflow_contract.validate_linux_playwright_install(sources, script)

        script_mutations = (
            ("no abort after the second attempt", "    exit 1\n  fi\nfi\n", "  fi\nfi\n"),
            (
                "swallowed failure",
                'install_deps "$SECOND_LIMIT"; then',
                'install_deps "$SECOND_LIMIT" || true; then',
            ),
            ("no wall-clock limit", 'timeout --kill-after=15 "$1" ', ""),
            (
                "no apt timeout",
                "'Acquire::http::Timeout \"30\";'",
                "'Acquire::Queue-Mode \"host\";'",
            ),
            (
                "a third attempt",
                "\nnpx playwright install chromium",
                '\ninstall_deps "$SECOND_LIMIT"\nnpx playwright install chromium',
            ),
        )
        for name, original, replacement in script_mutations:
            with self.subTest(name=name):
                self.assertIn(original, script)
                with self.assertRaisesRegex(
                    workflow_contract.WorkflowContractError, "playwright-linux.sh"
                ):
                    workflow_contract.validate_linux_playwright_install(
                        sources, script.replace(original, replacement, 1)
                    )

        # Back to --with-deps on a Linux job, and on the Linux leg of a matrix.
        for path, original in (
            (TEST_WORKFLOW, "run: bash tools/dev/playwright-linux.sh"),
            (
                TEST_WORKFLOW.parent / "visual-baselines-bootstrap.yml",
                "if: runner.os == 'Linux'\n        run: bash tools/dev/playwright-linux.sh",
            ),
        ):
            with self.subTest(path=path.name):
                mutated = dict(sources)
                self.assertIn(original, mutated[path])
                mutated[path] = mutated[path].replace(
                    original,
                    original.replace(
                        "bash tools/dev/playwright-linux.sh",
                        "npx playwright install --with-deps chromium",
                    ),
                    1,
                )
                with self.assertRaisesRegex(
                    workflow_contract.WorkflowContractError, "without a time limit"
                ):
                    workflow_contract.validate_linux_playwright_install(mutated, script)

    def test_normal_ci_runs_the_browser_suite_instead_of_deferring_it_to_release(self):
        test_workflow = TEST_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("push:\n    branches: [main]", test_workflow)
        self.assertIn("pull_request:", test_workflow)
        for required_job in (
            "backend:",
            "portable-core:",
            "frontend:",
            "browser-e2e-shards:",
            "browser-e2e:",
        ):
            self.assertIn(required_job, test_workflow)
        for required_gate in (
            "python -m unittest discover -s tests/python -t tests/python -v",
            "cargo --locked clippy --workspace --all-targets -- -D warnings",
            "cargo --locked test --workspace --all-targets",
            "run: npx vitest run",
            "run: npm run check",
            "run: npx tsc -b && npx vite build",
            "node tools/dev/test-shards.mjs select --os linux --slots 4",
            'npx playwright test --test-list "$lists/product.txt"',
            "npx playwright test --config playwright.design.config.ts",
            "PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_FULLY_PARALLEL=1",
            "PLAYWRIGHT_WORKERS=2 PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/reports/design.json",
        ):
            self.assertIn(required_gate, test_workflow)
        workflow_contract.validate_browser_e2e_sharding(workflow_contract._workflow_sources())
        self.assertEqual(
            (REPO_ROOT / "distribution/tooling/release_preflight.py")
            .read_text(encoding="utf-8")
            .count('[npm, "run", "test:e2e"]'),
            1,
        )
        self.assertNotIn("continue-on-error", test_workflow)

    def test_browser_shard_topology_and_aggregator_fail_closed(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_browser_e2e_sharding(sources)

        mutations = (
            (
                "a slot fewer",
                "slot: [1, 2, 3, 4]",
                "slot: [1, 2, 3]",
                "exactly four browser matrix slots",
            ),
            (
                "assignment for another slot count",
                "--slots 4 --slot",
                "--slots 3 --slot",
                "missing fail-closed shard evidence",
            ),
            (
                "back to cutting by count",
                '--test-list "$lists/product.txt"',
                '--shard="$SLOT/4"',
                "duration-assigned part of both suites",
            ),
            (
                "fail-fast matrix",
                "fail-fast: false",
                "fail-fast: true",
                "missing fail-closed shard evidence",
            ),
            (
                "discarded product status",
                "product_status=$?",
                "product_status=0",
                "missing fail-closed shard evidence",
            ),
            (
                "failed selection ignored",
                'if [ "$select_status" -ne 0 ] || [ "$product_status"',
                'if [ "$product_status"',
                "missing fail-closed shard evidence",
            ),
            (
                "durations dropped on success",
                "if: ${{ !cancelled() }}",
                "if: failure()",
                "missing fail-closed shard evidence",
            ),
            # T-33 held the Linux slots unconditional. T-37 allows exactly one condition, the
            # path filter's browser group; every other one is still red.
            (
                "Linux slots skipped on a reduced matrix",
                "    if: needs.plan.outputs.run_browser == 'true'\n    runs-on: ubuntu-24.04\n",
                "    if: needs.plan.outputs.full_matrix == 'true'\n    runs-on: ubuntu-24.04\n",
                "may only drop out through the path filter's browser group",
            ),
            (
                "Linux slots skipped on the matrix plan as well",
                "    if: needs.plan.outputs.run_browser == 'true'\n    runs-on: ubuntu-24.04\n",
                "    if: needs.plan.outputs.run_browser == 'true' && "
                "needs.plan.outputs.full_matrix != 'true'\n    runs-on: ubuntu-24.04\n",
                "may only drop out through the path filter's browser group",
            ),
            (
                "Linux slots on another group",
                "    if: needs.plan.outputs.run_browser == 'true'\n    runs-on: ubuntu-24.04\n",
                "    if: needs.plan.outputs.run_client == 'true'\n    runs-on: ubuntu-24.04\n",
                "may only drop out through the path filter's browser group",
            ),
            (
                "Linux slots unconditional again but read the plan",
                "    if: needs.plan.outputs.run_browser == 'true'\n    runs-on: ubuntu-24.04\n",
                "    runs-on: ubuntu-24.04\n",
                "may only drop out through the path filter's browser group",
            ),
            (
                "non-stable aggregator dependency",
                "      - browser-e2e-shards\n",
                "",
                "aggregator is missing fail-closed evidence",
            ),
        )
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                mutated = dict(sources)
                mutated[TEST_WORKFLOW] = mutated[TEST_WORKFLOW].replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_browser_e2e_sharding(mutated)

    def test_full_cross_platform_matrix_is_complete_and_fail_closed(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_cross_platform_browser_sharding(sources)

        mutations = (
            (
                "final Windows slot repeats the seventh",
                "slot: 8\n            slots: 8",
                "slot: 7\n            slots: 8",
                "one entry per slot",
            ),
            (
                "macOS back to two slots",
                "label: macos-15 / slot 3 of 3\n            slot: 3\n            slots: 3",
                "label: macos-15 / slot 3 of 3\n            slot: 3\n            slots: 2",
                "one entry per slot",
            ),
            (
                "reused diagnostics name",
                "diagnostics: windows-2025-8-of-8",
                "diagnostics: windows-2025-7-of-8",
                "one entry per slot",
            ),
            (
                "back to cutting by count",
                '--test-list "$lists/design.txt"',
                '--shard="$SLOT/$SLOTS"',
                "duration-assigned tests",
            ),
            (
                "Windows without the test cap",
                'shape=(--max-tests 100 --offset "1=186000")',
                'shape=(--offset "1=186000")',
                "missing shard evidence",
            ),
            (
                "unguarded full matrix",
                "    if: needs.plan.outputs.full_matrix == 'true' && "
                "needs.plan.outputs.run_browser == 'true'\n    runs-on: ${{ matrix.os }}",
                "    runs-on: ${{ matrix.os }}",
                "missing shard evidence",
            ),
            (
                "discarded design status",
                "design_status=$?\n",
                "design_status=0\n",
                "missing shard evidence",
            ),
            (
                "missing test-level sharding",
                "PLAYWRIGHT_FULLY_PARALLEL=1 PLAYWRIGHT_JSON_OUTPUT_FILE",
                "PLAYWRIGHT_JSON_OUTPUT_FILE",
                "missing shard evidence",
            ),
        )
        # The Linux slots share several of these lines; mutate only the cross-platform job.
        head, marker, job = sources[TEST_WORKFLOW].partition("\n  cross-platform-browser:")
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                self.assertIn(original, job)
                mutated = dict(sources)
                mutated[TEST_WORKFLOW] = head + marker + job.replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_cross_platform_browser_sharding(mutated)

    def test_matrix_decision_truth_table(self):
        plan = workflow_contract._job_body(TEST_WORKFLOW.read_text(encoding="utf-8"), "plan")
        decision = re.search(r"FULL_MATRIX: \$\{\{ (.+) \}\}", plan)
        self.assertIsNotNone(decision, "the plan job has no FULL_MATRIX expression")
        assert decision is not None
        expression = decision.group(1)
        cases = (
            ("push to main", "push", "refs/heads/main", None, True),
            ("workflow_call without input", "push", "refs/heads/main", None, True),
            (
                "workflow_call from a branch without input",
                "workflow_dispatch",
                "refs/heads/x",
                None,
                True,
            ),
            (
                "workflow_call with true from a pull request",
                "pull_request",
                "refs/pull/1/merge",
                True,
                True,
            ),
            ("workflow_dispatch with the default", "workflow_dispatch", "refs/heads/x", True, True),
            ("workflow_dispatch with false", "workflow_dispatch", "refs/heads/x", False, False),
            ("pull request", "pull_request", "refs/pull/1/merge", None, False),
            (
                "workflow_call with false from a pull request",
                "pull_request",
                "refs/pull/1/merge",
                False,
                False,
            ),
        )
        for name, event, ref, full_matrix, expected in cases:
            with self.subTest(name=name):
                context = {
                    "github.event_name": event,
                    "github.ref": ref,
                    "inputs.full_matrix": full_matrix,
                }
                self.assertIs(
                    _github_truthy(evaluate_github_expression(expression, context)), expected
                )
        # The reason for format(): GitHub coerces a missing input to equal false.
        self.assertTrue(evaluate_github_expression("inputs.full_matrix == false", {}))

    def test_push_to_main_always_runs_the_full_matrix(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_full_matrix_switch(sources)

        mutations = (
            (
                "main push no longer forces the full matrix",
                "(github.event_name == 'push' && github.ref == 'refs/heads/main') || ",
                "",
                "plan job is missing its matrix decision",
            ),
            (
                "workflow_call input is not boolean",
                'reduce only on purpose"\n        type: boolean',
                'reduce only on purpose"\n        type: string',
                "workflow_call must declare the boolean input full_matrix",
            ),
            (
                "workflow_call reduces by default",
                'reduce only on purpose"\n        type: boolean\n        default: true',
                'reduce only on purpose"\n        type: boolean\n        default: false',
                "workflow_call must declare the boolean input full_matrix, default true",
            ),
            (
                "a missing input counts as false",
                "format('{0}', inputs.full_matrix) != 'false'",
                "inputs.full_matrix != false",
                "plan job is missing its matrix decision",
            ),
            (
                "workflow_dispatch input removed",
                "  workflow_dispatch:\n    inputs:\n      full_matrix:",
                "  workflow_dispatch:\n    inputs:\n      everything:",
                "workflow_dispatch must declare the boolean input full_matrix",
            ),
            (
                "a matrix job reads the event itself",
                "    if: needs.plan.outputs.full_matrix != 'true' && "
                "needs.plan.outputs.run_browser == 'true'",
                "    if: github.event_name == 'pull_request'",
                "reads github.event_name",
            ),
            (
                "plan job checks out the repository",
                "    steps:\n      - id: decide",
                "    steps:\n      - uses: actions/checkout@v7\n      - id: decide",
                "may use actions only for the path filter",
            ),
            (
                "plan job checks out unconditionally",
                "      - name: Check out the path filter\n"
                "        if: steps.decide.outputs.full_matrix != 'true' && "
                "github.event_name == 'pull_request'\n",
                "      - name: Check out the path filter\n",
                "may use actions only for the path filter",
            ),
            (
                "plan job adds a third action",
                "      - id: filter\n",
                "      - name: Extra\n"
                "        if: steps.decide.outputs.full_matrix != 'true' && "
                "github.event_name == 'pull_request'\n"
                "        uses: actions/setup-node@v7\n"
                "      - id: filter\n",
                "only checkout and setup-python",
            ),
            (
                "plan job gains a write permission",
                "      contents: read # the sparse checkout",
                "      pull-requests: write\n      contents: read # the sparse checkout",
                "repository contents and nothing else",
            ),
        )
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                mutated = dict(sources)
                self.assertIn(original, mutated[TEST_WORKFLOW])
                mutated[TEST_WORKFLOW] = mutated[TEST_WORKFLOW].replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_full_matrix_switch(mutated)

    def test_frontend_job_runs_the_check_gates_once(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_frontend_gates_once(sources)

        mutations = (
            (
                "build gates run a second time",
                "run: npx tsc -b && npx vite build",
                "run: npm run build",
                "build step must be the build script",
            ),
            (
                "type check dropped from the build step",
                "run: npx tsc -b && npx vite build",
                "run: npx vite build",
                "build step must be the build script",
            ),
            (
                "check no longer runs",
                "run: npm run check\n",
                "run: npm run lint:biome\n",
                "must run npm run check",
            ),
        )
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                mutated = dict(sources)
                self.assertIn(original, mutated[TEST_WORKFLOW])
                mutated[TEST_WORKFLOW] = mutated[TEST_WORKFLOW].replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_frontend_gates_once(mutated)

    def test_check_links_come_from_the_chain_or_the_parallel_runner(self):
        chain = "npm run check:contracts && npm run lint:biome"
        self.assertEqual(workflow_contract._check_links(chain), {"check:contracts", "lint:biome"})
        runner_links = workflow_contract._check_links(workflow_contract.CHECK_RUNNER)
        for gate in ("check:contracts", "check:i18n", "check:platform", "lint:typos"):
            with self.subTest(gate=gate):
                self.assertIn(gate, runner_links)
        self.assertNotIn("build", runner_links)

    def test_test_workflow_caches_npm_only(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_test_caches(sources)
        install = "      - name: Install Chromium\n"
        mutations = (
            (
                "pip cache",
                '          python-version: "3.12.10"\n',
                '          python-version: "3.12.10"\n          cache: pip\n',
                "caches npm only; found cache: pip",
            ),
            (
                "browser cache",
                install,
                "      - uses: actions/cache/restore@0000000000000000000000000000000000000000\n"
                + install,
                "may not use actions/cache",
            ),
        )
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                self.assertIn(original, sources[TEST_WORKFLOW])
                mutated = dict(sources)
                mutated[TEST_WORKFLOW] = mutated[TEST_WORKFLOW].replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_test_caches(mutated)

    def test_type_check_extras_follow_pyproject(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_type_check_extras(sources)
        mutated = dict(sources)
        self.assertIn("Pillow>=10", sources[TEST_WORKFLOW])
        mutated[TEST_WORKFLOW] = sources[TEST_WORKFLOW].replace("Pillow>=10", "Pillow>=9", 1)
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError, "differ from pyproject"
        ):
            workflow_contract.validate_type_check_extras(mutated)

        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn("pystray>=0.19", pyproject)
        with tempfile.TemporaryDirectory() as directory:
            drifted = Path(directory) / "pyproject.toml"
            drifted.write_text(
                pyproject.replace("pystray>=0.19", "pystray>=0.20", 1), encoding="utf-8"
            )
            with self.assertRaisesRegex(
                workflow_contract.WorkflowContractError, "differ from pyproject"
            ):
                workflow_contract.validate_type_check_extras(sources, drifted)

    def test_browser_worker_defaults_are_bounded_and_overridable(self):
        product = (REPO_ROOT / "playwright.config.ts").read_text(encoding="utf-8")
        design = (REPO_ROOT / "playwright.design.config.ts").read_text(encoding="utf-8")
        resolver = (REPO_ROOT / "tests/playwright/workers.ts").read_text(encoding="utf-8")

        self.assertIn("workers: resolvePlaywrightWorkers(2)", product)
        # Two numbers, both visible and both bounded. The Windows runner twice took longer
        # than thirty seconds to create and open a world -- file locks bite there where Linux
        # merely writes. Locally it stays at thirty, so that a test grown slow is noticed on
        # the desk. The whole expression stays pinned: nobody may write "unbounded" here in
        # future either.
        self.assertIn("timeout: process.env.CI ? 60_000 : 30_000", product)
        self.assertIn("workers: resolvePlaywrightWorkers(4)", design)
        self.assertIn("process.env.PLAYWRIGHT_WORKERS", resolver)
        self.assertIn("Number.isSafeInteger(workers)", resolver)

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
        toolchains: dict[str, Any] = workflow_contract.toolchain_lock()
        release_toolchains = toolchains["releaseToolchains"]
        self.assertEqual(
            release_toolchains,
            {
                "node": "22.23.2",
                "npm": "10.9.8",
                "python": "3.12.10",
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

    def test_matrix_runners_are_resolved_rather_than_read_literally(self):
        """A cross-platform suite is a matrix, and the runner lock has to survive one."""
        matrix_job = (
            "\njobs:\n"
            "  browser:\n"
            "    runs-on: ${{ matrix.os }}\n"
            "    strategy:\n"
            "      matrix:\n"
            "        os: [macos-15, windows-2025]\n"
            "    steps:\n"
            "      - run: true\n"
        )
        sources = {Path("matrix.yml"): matrix_job}
        self.assertEqual(
            workflow_contract.resolved_runners(sources),
            {"macos-15", "windows-2025"},
        )

        loose = matrix_job.replace("os: [macos-15, windows-2025]", "os: [ubuntu-latest]")
        self.assertEqual(
            workflow_contract.resolved_runners({Path("matrix.yml"): loose}),
            {"ubuntu-latest"},
        )

        unreadable = matrix_job.replace("        os: [macos-15, windows-2025]\n", "")
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError,
            "no readable list of runner labels",
        ):
            workflow_contract.resolved_runners({Path("matrix.yml"): unreadable})

    def test_dependency_locks_declare_reproducible_target_environments(self):
        records: list[dict[str, Any]] = dependency_lock_contract.records()
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
                        command = re.sub(r"^(?:- )?run: ", "", command)
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


FULL_JOBS = {
    "backend",
    "portable-core",
    "frontend",
    "workflow-docker-shell-lint",
    "browser-e2e-shards",
    "visual-baseline-reach",
    "cross-platform-native",
    "cross-platform-browser",
}
REDUCED_ALL_JOBS = (FULL_JOBS - {"cross-platform-browser"}) | {"cross-platform-smoke"}


def _expression(line):
    match = re.fullmatch(r"\$\{\{ (.+) \}\}", line.strip())
    assert match is not None, line
    return match.group(1)


def _as_output(value):
    """How GitHub writes an expression's value into an output or env: booleans as text."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return "" if value is None else str(value)


def simulate_test_workflow(workflow, event, ref, full_matrix_input, paths, filter_outputs=None):
    """
    Run test.yml's real expressions for one event: plan, every job condition, the gate.

    Returns the jobs that run, whether the frontend's client steps run, and the browser-e2e
    gate's verdict. `filter_outputs` replaces what the path filter step writes, to model a
    filter that wrote nothing.
    """

    plan = workflow_contract._job_body(workflow, "plan")
    decision = re.search(r"FULL_MATRIX: (\$\{\{ .+ \}\})", plan)
    assert decision is not None
    context = {
        "github.event_name": event,
        "github.ref": ref,
        "inputs.full_matrix": full_matrix_input,
    }
    full = _as_output(
        _github_truthy(evaluate_github_expression(_expression(decision.group(1)), context))
    )
    steps = {"steps.decide.outputs.full_matrix": full, "github.event_name": event}
    filter_step = re.search(
        r"^      - id: filter\n(?:        .*\n)*?        if: (.+)\n", plan, re.M
    )
    assert filter_step is not None, "the plan job has no conditional filter step"
    filter_ran = _github_truthy(evaluate_github_expression(filter_step.group(1), steps))
    if filter_ran:
        if filter_outputs is None:
            chosen, _ = path_filter.plan(path_filter.load_config(), paths)
            filter_outputs = {group: _as_output(run) for group, run in chosen.items()}
        for group, value in filter_outputs.items():
            steps[f"steps.filter.outputs.run_{group}"] = value
    outputs = {"needs.plan.outputs.full_matrix": full}
    for name, line in re.findall(r"^      (run_[a-z0-9_]+): ([^\n]+)$", plan, re.MULTILINE):
        outputs[f"needs.plan.outputs.{name}"] = _as_output(
            evaluate_github_expression(_expression(line), steps)
        )

    results = {"plan": "success"}
    jobs = dict(workflow_contract._job_blocks(workflow))
    pending = [name for name in jobs if name not in ("plan", "browser-e2e")]
    while pending:
        for name in list(pending):
            body = jobs[name]
            needs_line = re.search(r"^    needs: (.+)$", body, re.MULTILINE)
            needs = re.findall(r"[a-z0-9-]+", needs_line.group(1)) if needs_line else []
            if any(need not in results for need in needs):
                continue
            condition = re.search(r"^    if: (.+)$", body, re.MULTILINE)
            runs = all(results[need] == "success" for need in needs) and (
                condition is None
                or _github_truthy(evaluate_github_expression(condition.group(1), outputs))
            )
            results[name] = "success" if runs else "skipped"
            pending.remove(name)
    client_steps = results["frontend"] == "success" and _github_truthy(
        evaluate_github_expression("needs.plan.outputs.run_client == 'true'", outputs)
    )
    return (
        {name for name, result in results.items() if result == "success"} - {"plan"},
        (client_steps),
        gate_verdict(results, outputs),
    )


def gate_verdict(results, outputs):
    """The browser-e2e `require` rule over every filtered job, on the contract's selections."""
    failures = []
    if results.get("plan") != "success":
        failures.append("plan")
    for name, (_, selection) in workflow_contract.FILTERED_JOBS.items():
        selected = _as_output(_github_truthy(evaluate_github_expression(selection, outputs)))
        result = results.get(name, "skipped")
        if result == "success" or (result == "skipped" and selected == "false"):
            continue
        failures.append(name)
    return failures


class PathFilterContractTests(unittest.TestCase):
    """T-37: pull requests run what their paths need; main and release mode run everything."""

    @classmethod
    def setUpClass(cls):
        cls.workflow = TEST_WORKFLOW.read_text(encoding="utf-8")

    def simulate(self, event, ref, full_matrix_input, paths, workflow=None, **options):
        return simulate_test_workflow(
            workflow or self.workflow, event, ref, full_matrix_input, paths, **options
        )

    def test_the_repository_satisfies_the_contract(self):
        workflow_contract.validate_path_filter(workflow_contract._workflow_sources())

    def test_truth_table(self):
        pr = ("pull_request", "refs/pull/7/merge", None)
        cases = (
            # Full mode never reads paths: a documentation-only push to main runs everything.
            (
                "push to main, documentation only",
                ("push", "refs/heads/main", None),
                ["docs/plans/x.md"],
                FULL_JOBS,
                True,
            ),
            (
                "workflow_dispatch with the default",
                ("workflow_dispatch", "refs/heads/x", True),
                ["docs/plans/x.md"],
                FULL_JOBS,
                True,
            ),
            (
                "workflow_call without input",
                ("workflow_dispatch", "refs/heads/x", None),
                ["docs/plans/x.md"],
                FULL_JOBS,
                True,
            ),
            (
                "workflow_call with true from a pull request",
                ("pull_request", "refs/pull/7/merge", True),
                ["docs/plans/x.md"],
                FULL_JOBS,
                True,
            ),
            # Reduced without a pull request: nothing to diff, so every group runs.
            (
                "workflow_dispatch with false",
                ("workflow_dispatch", "refs/heads/x", False),
                ["docs/plans/x.md"],
                REDUCED_ALL_JOBS,
                True,
            ),
            (
                "pull request, documentation only",
                pr,
                ["docs/plans/x.md", "docs/design/notes.md"],
                {"frontend"},
                False,
            ),
            (
                "pull request, Python outside the server",
                pr,
                ["tests/python/test_x.py", "src/quiltor/hosts/cli/main.py"],
                {"backend", "frontend", "cross-platform-native"},
                False,
            ),
            (
                "pull request, server Python",
                pr,
                ["src/quiltor/delivery/http/routes.py"],
                {
                    "backend",
                    "frontend",
                    "cross-platform-native",
                    "browser-e2e-shards",
                    "visual-baseline-reach",
                    "cross-platform-smoke",
                },
                True,
            ),
            (
                "pull request, client",
                pr,
                ["packages/client/src/main.ts"],
                {"frontend", "browser-e2e-shards", "visual-baseline-reach", "cross-platform-smoke"},
                True,
            ),
            (
                "pull request, workflows only",
                pr,
                [".github/workflows/release.yml"],
                {"backend", "frontend", "workflow-docker-shell-lint", "cross-platform-native"},
                False,
            ),
            (
                "pull request, Rust",
                pr,
                ["crates/quiltor-core/src/lib.rs"],
                {
                    "portable-core",
                    "frontend",
                    "workflow-docker-shell-lint",
                    "cross-platform-native",
                },
                False,
            ),
            (
                "pull request, an unknown path",
                pr,
                ["docs/plans/x.md", "newdir/thing.txt"],
                REDUCED_ALL_JOBS,
                True,
            ),
            (
                "pull request, test.yml itself",
                pr,
                [".github/workflows/test.yml"],
                REDUCED_ALL_JOBS,
                True,
            ),
            (
                "pull request, untested screenshot only",
                pr,
                ["docs/screenshots/places.png"],
                set(),
                False,
            ),
        )
        for name, (event, ref, full_matrix_input), paths, jobs, client in cases:
            with self.subTest(name=name):
                running, client_steps, failures = self.simulate(
                    event, ref, full_matrix_input, paths
                )
                self.assertEqual(running, jobs)
                self.assertIs(client_steps, client)
                self.assertEqual(failures, [], "a job the plan chose to skip fails the gate")

    def test_a_filter_that_wrote_nothing_runs_everything(self):
        for outputs in ({}, {"browser": ""}, {"browser": "maybe"}):
            with self.subTest(outputs=outputs):
                running, client, _ = self.simulate(
                    "pull_request", "refs/pull/7/merge", None, [], filter_outputs=outputs
                )
                self.assertEqual(running, REDUCED_ALL_JOBS)
                self.assertTrue(client)

    def test_the_gate_lets_only_a_planned_skip_pass(self):
        outputs = {"needs.plan.outputs.full_matrix": "false"}
        outputs.update(
            {
                f"needs.plan.outputs.run_{group}": "false"
                for group in ("checks", "python", "rust", "client", "lint")
            }
        )
        outputs["needs.plan.outputs.run_browser"] = "true"
        everything_skipped = dict.fromkeys(workflow_contract.FILTERED_JOBS, "skipped")
        everything_skipped["plan"] = "success"
        # The browser group was selected, so its skips are failures; the rest were planned.
        self.assertEqual(
            gate_verdict(everything_skipped, outputs),
            ["browser-e2e-shards", "visual-baseline-reach", "cross-platform-smoke"],
        )
        planned = dict(
            everything_skipped,
            **{
                "browser-e2e-shards": "success",
                "visual-baseline-reach": "success",
                "cross-platform-smoke": "success",
            },
        )
        self.assertEqual(gate_verdict(planned, outputs), [])
        for result in ("failure", "cancelled"):
            with self.subTest(result=result):
                self.assertEqual(gate_verdict(dict(planned, backend=result), outputs), ["backend"])
        # A failed plan leaves no outputs: every skip counts as unplanned.
        self.assertEqual(
            gate_verdict(
                dict.fromkeys(workflow_contract.FILTERED_JOBS, "skipped") | {"plan": "failure"}, {}
            ),
            [
                "plan",
                *[
                    name
                    for name in workflow_contract.FILTERED_JOBS
                    if name != "cross-platform-browser"
                ],
            ],
        )

    def test_mutations_fail_the_contract(self):
        sources = workflow_contract._workflow_sources()
        full_bypass = "steps.decide.outputs.full_matrix == 'true' && 'true' || "
        mutations = (
            (
                "full mode no longer bypasses the browser filter",
                "      run_browser: ${{ " + full_bypass,
                "      run_browser: ${{ ",
                "one run_<group> output per test-paths group",
            ),
            (
                "an unreadable filter falls back to nothing",
                "(steps.filter.outputs.run_browser == 'false' && 'false' || 'true')",
                "(steps.filter.outputs.run_browser == 'true' && 'true' || 'false')",
                "one run_<group> output per test-paths group",
            ),
            (
                "a group without a plan output",
                "      run_lint: ${{ steps.decide.outputs.full_matrix == 'true' && 'true' || "
                "(steps.filter.outputs.run_lint == 'false' && 'false' || 'true') }}\n",
                "",
                "one run_<group> output per test-paths group",
            ),
            (
                "the filter reads paths in full mode",
                "        if: steps.decide.outputs.full_matrix != 'true' && github.event_name == 'pull_request'\n"
                "        run: |",
                "        if: github.event_name == 'pull_request'\n        run: |",
                "must each be guarded",
            ),
            (
                "the filter runs the pull request's own script",
                'python "$base/distribution/tooling/path_filter.py" plan',
                "python distribution/tooling/path_filter.py plan",
                "path filter step is missing",
            ),
            (
                "the filter reads the pull request's own configuration",
                "git show HEAD^1:.github/test-paths.json",
                "cat .github/test-paths.json",
                "path filter step is missing",
            ),
            (
                "the pull request's filter is checked out",
                "          sparse-checkout: |\n            VERSION\n",
                "          sparse-checkout: |\n            VERSION\n"
                "            distribution/tooling/path_filter.py\n",
                "path filter step is missing",
            ),
            (
                "a base without the filter fails the plan",
                '            echo "::warning::the base has no readable path filter, running everything"\n',
                "            exit 1\n",
                "path filter step is missing",
            ),
            (
                "the filter compares only one commit",
                "--merge HEAD --output",
                "--base HEAD^ --head HEAD --output",
                "path filter step is missing",
            ),
            (
                "a job reads the wrong group",
                "    needs: plan\n    if: needs.plan.outputs.run_python == 'true'\n    runs-on: ubuntu-24.04\n",
                "    needs: plan\n    if: needs.plan.outputs.run_checks == 'true'\n    runs-on: ubuntu-24.04\n",
                "test.yml:backend must run on exactly",
            ),
            (
                "a job runs on a second condition",
                "    if: needs.plan.outputs.run_lint == 'true'\n",
                "    if: needs.plan.outputs.run_lint == 'true' && github.ref != 'x'\n",
                "workflow-docker-shell-lint must run on exactly",
            ),
            (
                "a job no longer needs the plan",
                "    needs: plan\n    if: needs.plan.outputs.run_rust == 'true'\n",
                "    if: needs.plan.outputs.run_rust == 'true'\n",
                "portable-core must need the plan job",
            ),
            (
                "the client build runs unfiltered",
                "      - name: Type-check and build\n        if: needs.plan.outputs.run_client == 'true'\n",
                "      - name: Type-check and build\n",
                "'Type-check and build' must run on run_client",
            ),
            (
                "a new job without a group",
                "\n  visual-baseline-reach:\n",
                "\n  extra:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: true\n\n  visual-baseline-reach:\n",
                "jobs without a path-filter group: extra",
            ),
            (
                "the gate accepts any skip",
                '            elif [ "$2" = "skipped" ] && [ "$3" = "false" ]; then\n',
                '            elif [ "$2" = "skipped" ]; then\n',
                "browser-e2e is missing its gate",
            ),
            (
                "the gate reads a selection fail-open",
                "SELECTED_BACKEND: ${{ needs.plan.outputs.run_python != 'false' }}",
                "SELECTED_BACKEND: ${{ needs.plan.outputs.run_python == 'true' }}",
                "browser-e2e does not gate backend",
            ),
            (
                "the gate forgets a job",
                "      - cross-platform-smoke\n    if: always()",
                "    if: always()",
                "must need the plan and every filtered job",
            ),
            (
                "the gate skips with its needs",
                "    if: always()\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Require every selected job",
                "    runs-on: ubuntu-24.04\n    steps:\n      - name: Require every selected job",
                "browser-e2e is missing its gate: if: always()",
            ),
            (
                "the gate tolerates a failed plan",
                '          require plan "$PLAN_RESULT" true\n',
                "",
                "browser-e2e is missing its gate",
            ),
            (
                "frontend removed from the gate's needs",
                "      - frontend\n      - workflow-docker-shell-lint\n",
                "      - workflow-docker-shell-lint\n",
                "browser-e2e must need and gate the frontend job",
            ),
            (
                "a browser job waits for frontend again",
                "    name: Browser on ${{ matrix.label }}\n    needs: plan\n",
                "    name: Browser on ${{ matrix.label }}\n    needs: [plan, frontend]\n",
                "cross-platform-browser must need only the plan job",
            ),
            (
                "paths filtered in the trigger",
                "  pull_request:\n",
                "  pull_request:\n    paths-ignore: ['docs/**']\n",
                "may not filter paths in its triggers",
            ),
        )
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                self.assertIn(original, sources[TEST_WORKFLOW])
                mutated = dict(sources)
                mutated[TEST_WORKFLOW] = sources[TEST_WORKFLOW].replace(original, replacement, 1)
                with self.assertRaisesRegex(
                    workflow_contract.WorkflowContractError, re.escape(error)
                ):
                    workflow_contract.validate_path_filter(mutated)

    def test_browser_without_checks_fails_the_contract(self):
        """T-46: no rule may run a browser job while the filter drops frontend."""
        config = path_filter.load_config()
        rules = tuple(
            path_filter.Rule(rule.name, rule.patterns, rule.groups - {"checks"}, rule.reason)
            if rule.name == "client"
            else rule
            for rule in config.rules
        )
        mutated = path_filter.Config(config.groups, rules, config.untested)
        with (
            patch.object(path_filter, "load_config", return_value=mutated),
            self.assertRaisesRegex(
                workflow_contract.WorkflowContractError, "rule 'client' selects browser without"
            ),
        ):
            workflow_contract.validate_path_filter(workflow_contract._workflow_sources())

    def test_a_red_frontend_fails_the_gate_beside_green_browsers(self):
        """T-46: the browsers no longer wait for frontend; the real gate script still fails."""
        bash = shutil.which("bash")
        if bash is None:
            self.skipTest("bash is not installed")
        aggregator = workflow_contract._job_body(self.workflow, "browser-e2e")
        script = re.search(r"^        run: \|\n((?:          .*\n|\n)*)", aggregator, re.MULTILINE)
        assert script is not None, "browser-e2e has no run block"
        body = "".join(line[10:] + "\n" for line in script.group(1).splitlines())

        def gate(results):
            env = {**os.environ, "PLAN_RESULT": "success"}
            for name in workflow_contract.FILTERED_JOBS:
                job = workflow_contract._env_name(name)
                env[f"RESULT_{job}"] = results.get(name, "success")
                env[f"SELECTED_{job}"] = "true"
            return subprocess.run(
                [bash, "-c", body], env=env, capture_output=True, text=True, check=False
            )

        green = gate({})
        self.assertEqual(green.returncode, 0, green.stdout + green.stderr)
        for result in ("failure", "cancelled", "skipped"):
            with self.subTest(frontend=result):
                red = gate({"frontend": result})
                self.assertEqual(red.returncode, 1, red.stdout + red.stderr)
                self.assertIn("frontend is " + result, red.stdout)
                self.assertIn("browser-e2e-shards: success", red.stdout)

    def test_the_mutated_expressions_change_the_outcome(self):
        """The two expression mutations above are not cosmetic: they change what runs."""
        no_bypass = self.workflow.replace(
            "      run_browser: ${{ steps.decide.outputs.full_matrix == 'true' && 'true' || ",
            "      run_browser: ${{ ",
        ).replace(
            "    if: steps.decide.outputs.full_matrix != 'true' && github.event_name == 'pull_request'\n",
            "    if: true\n",
        )
        running, _, _ = self.simulate(
            "push", "refs/heads/main", None, ["docs/plans/x.md"], workflow=no_bypass
        )
        self.assertNotIn("browser-e2e-shards", running)
        to_nothing = self.workflow.replace(
            "(steps.filter.outputs.run_browser == 'false' && 'false' || 'true')",
            "(steps.filter.outputs.run_browser == 'true' && 'true' || 'false')",
        )
        running, _, _ = self.simulate(
            "pull_request", "refs/pull/7/merge", None, [], workflow=to_nothing, filter_outputs={}
        )
        self.assertNotIn("browser-e2e-shards", running)

    def test_every_lint_input_selects_lint(self):
        """F-37-1: what hadolint, shellcheck and osv-scanner read is derived, not listed."""
        linted = workflow_contract.lint_inputs()
        for path in (
            "Dockerfile",
            "services/backup-server/Dockerfile",
            "distribution/desktop/macos/direct/build.sh",
            "distribution/web/self-hosted/requirements.lock",
            "distribution/dependency-locks.json",
            "package-lock.json",
            "Cargo.lock",
        ):
            self.assertIn(path, linted)
        self.assertNotIn("src/quiltor/__init__.py", linted)
        document = json.loads((REPO_ROOT / ".github/test-paths.json").read_text(encoding="utf-8"))
        rule = next(rule for rule in document["rules"] if rule["name"] == "lint-inputs")
        sources = workflow_contract._workflow_sources()
        for removed in ("distribution/web/self-hosted/requirements.lock", "**/*.sh"):
            with self.subTest(removed=removed):
                broken = json.loads(json.dumps(document))
                next(r for r in broken["rules"] if r is not None and r["name"] == "lint-inputs")[
                    "patterns"
                ] = [pattern for pattern in rule["patterns"] if pattern != removed]
                with (
                    patch.object(
                        workflow_contract.path_filter,
                        "load_config",
                        return_value=path_filter.parse_config(broken),
                    ),
                    self.assertRaisesRegex(
                        workflow_contract.WorkflowContractError,
                        "lint job's tools read must select the lint group",
                    ),
                ):
                    workflow_contract.validate_path_filter(sources)

    def test_a_new_lint_input_is_derived_without_maintenance(self):
        source = workflow_contract.LINT_TOOL.read_text(encoding="utf-8")
        grown = source.replace(
            '    "Cargo.lock",\n', '    "Cargo.lock",\n    "apps/web/server.py",\n', 1
        )
        self.assertNotEqual(grown, source)
        self.assertIn("apps/web/server.py", workflow_contract.lint_inputs(grown))

    def test_the_program_the_lint_job_runs_selects_lint(self):
        """F-37-5: a change to lint-tool.mjs must run the job that executes it."""
        tracked = path_filter.tracked_paths()
        programs = workflow_contract.lint_programs(
            workflow_contract._workflow_sources()[workflow_contract.WORKFLOW_ROOT / "test.yml"],
            (REPO_ROOT / "package.json").read_text(encoding="utf-8"),
            tracked,
        )
        self.assertIn("tools/dev/lint-tool.mjs", programs)
        self.assertNotIn("tools/dev/run-pyright.mjs", programs)
        chosen, _ = path_filter.plan(path_filter.load_config(), ["tools/dev/lint-tool.mjs"])
        self.assertTrue(chosen["lint"])
        # A program the job starts directly counts too, without going through package.json.
        direct = "\njobs:\n  workflow-docker-shell-lint:\n    steps:\n      - run: node tools/dev/x.mjs\n"
        self.assertEqual(
            ["tools/dev/x.mjs"],
            workflow_contract.lint_programs(direct, '{"scripts": {}}', ["tools/dev/x.mjs"]),
        )

    def test_the_program_that_assigns_browser_slots_selects_browser(self):
        """T-38: a change to test-shards.mjs changes which tests every browser slot runs."""
        tracked = path_filter.tracked_paths()
        workflow = workflow_contract._workflow_sources()[
            workflow_contract.WORKFLOW_ROOT / "test.yml"
        ]
        package_json = (REPO_ROOT / "package.json").read_text(encoding="utf-8")
        programs = workflow_contract.browser_programs(workflow, package_json, tracked)
        self.assertIn("tools/dev/test-shards.mjs", programs)
        # A job's comment block sits above the next job, so it belongs to the job before it:
        # the browser program must not leak into the lint job's programs through it.
        self.assertNotIn(
            "tools/dev/test-shards.mjs",
            workflow_contract.lint_programs(workflow, package_json, tracked),
        )
        for path in ("tools/dev/test-shards.mjs", "tests/playwright/durations.json"):
            chosen, _ = path_filter.plan(path_filter.load_config(), [path])
            self.assertTrue(chosen["browser"], path)

    def test_every_contract_a_client_test_reads_selects_client(self):
        """F-37-2: a fixture the TypeScript tests read must run them on the pull request."""
        referenced = workflow_contract.client_test_inputs(path_filter.tracked_paths())
        for path in (
            "contracts/fixtures/application-api/manuscript/wire.v1.json",
            "contracts/fixtures/story-world/world-state.v1.json",
            "contracts/fixtures/timeline-order.tsv",
            "contracts/native-bridge/v1.schema.json",
        ):
            self.assertIn(path, referenced)
        chosen, _ = path_filter.plan(
            path_filter.load_config(),
            ["contracts/fixtures/application-api/manuscript/wire.v1.json"],
        )
        self.assertTrue(chosen["client"])
        document = json.loads((REPO_ROOT / ".github/test-paths.json").read_text(encoding="utf-8"))
        document["rules"] = [
            rule for rule in document["rules"] if rule["name"] != "contracts-read-by-client"
        ]
        with (
            patch.object(
                workflow_contract.path_filter,
                "load_config",
                return_value=path_filter.parse_config(document),
            ),
            self.assertRaisesRegex(
                workflow_contract.WorkflowContractError,
                "client unit test references must select the client group: contracts/",
            ),
        ):
            workflow_contract.validate_path_filter(workflow_contract._workflow_sources())

    def test_coverage_and_reasons_are_part_of_the_contract(self):
        sources = workflow_contract._workflow_sources()
        tracked = path_filter.tracked_paths()
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError, "newdir/x.txt falls in no group"
        ):
            workflow_contract.validate_path_filter(sources, tracked=[*tracked, "newdir/x.txt"])

        document = json.loads((REPO_ROOT / ".github/test-paths.json").read_text(encoding="utf-8"))
        unjustified = json.loads(json.dumps(document))
        del unjustified["untested"][0]["reason"]
        groupless = json.loads(json.dumps(document))
        groupless["rules"].append(
            {"name": "new", "patterns": ["newdir/**"], "groups": [], "reason": "A new directory."}
        )
        for name, broken, error in (
            ("untested entry without a reason", unjustified, "needs a reason"),
            ("pattern without a group", groupless, "selects no group"),
        ):
            with (
                self.subTest(name=name),
                patch.object(
                    path_filter,
                    "load_config",
                    return_value=None,
                    side_effect=lambda *_args, doc=broken: path_filter.parse_config(doc),
                ),
                self.assertRaisesRegex(workflow_contract.WorkflowContractError, error),
            ):
                workflow_contract.validate_path_filter(sources, tracked=tracked)


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
            "pyjwt": ("2.15.0", "MIT License"),
            "cryptography": ("50.0.0", "Apache License 2.0"),
            "cffi": ("2.1.1", "MIT-0"),
            "pycparser": ("3.0", "3-Clause BSD License"),
            "markdown-it-py": ("4.2.0", "MIT License"),
            "mdurl": ("0.1.2", "MIT License"),
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
        lock_records: list[dict[str, Any]] = dependency_lock_contract.records()
        for record in lock_records:
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
