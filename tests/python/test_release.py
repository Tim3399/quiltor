"""Versioning and the immutable build-to-publish release hand-off."""

import contextlib
import functools
import hashlib
import inspect
import io
import json
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from typing import Any, ClassVar, cast
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLING = REPO_ROOT / "distribution" / "tooling"
sys.path.insert(0, str(TOOLING))

import artifact_profile  # noqa: E402
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
WRITING_DATA_WORKFLOW = REPO_ROOT / ".github/workflows/writing-data.yml"


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

    def run_bump(self, request, preflight_error=None, screenshots_error=None):
        with patch.object(set_version, "REPO_ROOT", self.repo):
            with patch.object(set_version, "run_preflight") as preflight:
                with patch.object(set_version, "refresh_readme_screenshots") as screenshots:
                    preflight.side_effect = preflight_error
                    screenshots.side_effect = screenshots_error
                    with contextlib.redirect_stdout(io.StringIO()):
                        with contextlib.redirect_stderr(io.StringIO()):
                            status = set_version.main([request])
        self.preflight = preflight
        self.screenshots = screenshots
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

    def test_screenshots_are_retaken_for_the_new_version_before_any_file_moves(self):
        seen = {}

        def record(repo_root, version):
            seen["version"] = version
            seen["versions"] = self.versions()

        before = self.versions()
        expected = set_version.next_version(set_version.current_version(self.repo), "minor")
        with patch.object(set_version, "REPO_ROOT", self.repo):
            with patch.object(set_version, "run_preflight"):
                with patch.object(
                    set_version, "refresh_readme_screenshots", side_effect=record
                ) as screenshots:
                    with contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(set_version.main(["minor"]), 0)
        screenshots.assert_called_once()
        self.assertEqual(seen["version"], expected)
        self.assertEqual(seen["versions"], before)
        self.assertEqual(set(self.versions().values()), {seen["version"]})

    def test_failed_screenshots_write_no_version(self):
        before = self.versions()
        error = release_preflight.PreflightError("the browser did not start")
        self.assertEqual(self.run_bump("minor", screenshots_error=error), 1)
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
        self.assertIn(["npm", "run", "check:readme-screenshots"], commands)
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
                self.assertEqual(manifest["schemaVersion"], 7)
                self.assertEqual(manifest["dataAssets"], release_manifest.data_asset_records())
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
            self.build.count(
                "needs: [release-plan, release-context, version-check, release-gate, tests]"
            ),
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

    def test_windows_browser_jobs_install_chromium_without_system_dependencies(self):
        sources = workflow_contract._workflow_sources()
        script = (REPO_ROOT / workflow_contract.CHROMIUM_STARTS).read_text("utf-8")
        workflow_contract.validate_windows_playwright_install(sources, script)
        source = sources[TEST_WORKFLOW]
        check_step = (
            "      - name: Check that Chromium starts\n"
            "        if: runner.os == 'Windows'\n"
            "        run: node tools/dev/chromium-starts.mjs\n"
        )
        mutations = (
            (
                "Windows installs the system half",
                "run: npx playwright install chromium\n",
                "run: npx playwright install --with-deps chromium\n",
                "only the browser on Windows",
            ),
            (
                "macOS loses --with-deps",
                "if: runner.os != 'Windows'\n        run: npx playwright install --with-deps",
                "if: runner.os != 'Windows'\n        run: npx playwright install",
                "keep --with-deps for macOS",
            ),
            (
                "one install for every system",
                "        if: runner.os != 'Windows'\n        run: npx playwright install",
                "        run: npx playwright install",
                "one step for Windows",
            ),
            ("check removed", check_step, "", "check that Chromium starts"),
            (
                "check runs on every system",
                check_step,
                check_step.replace("        if: runner.os == 'Windows'\n", ""),
                "check that Chromium starts",
            ),
            (
                "check swallows a failure",
                check_step,
                check_step.replace(".mjs\n", ".mjs || true\n"),
                "check that Chromium starts",
            ),
            (
                "check may fail",
                check_step,
                check_step + "        continue-on-error: true\n",
                "check that Chromium starts",
            ),
        )
        for name, original, replacement, message in mutations:
            with self.subTest(name=name):
                self.assertIn(original, source)
                mutated = dict(sources)
                mutated[TEST_WORKFLOW] = source.replace(original, replacement, 1)
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, message):
                    workflow_contract.validate_windows_playwright_install(mutated, script)

        for evidence in workflow_contract.CHROMIUM_STARTS_EVIDENCE:
            with self.subTest(script=evidence):
                self.assertIn(evidence, script)
                with self.assertRaisesRegex(
                    workflow_contract.WorkflowContractError, "chromium-starts.mjs"
                ):
                    workflow_contract.validate_windows_playwright_install(
                        sources, script.replace(evidence, "", 1)
                    )

    def test_windows_playwright_jobs_widen_the_port_range_before_playwright(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_windows_port_range(sources)
        source = sources[TEST_WORKFLOW]
        step_start = source.index("      - name: Widen the dynamic TCP port range")
        step_end = source.index("      - uses: actions/checkout", step_start)
        step = source[step_start:step_end]

        def check(mutated_source, message):
            mutated = dict(sources)
            mutated[TEST_WORKFLOW] = mutated_source
            with self.assertRaisesRegex(workflow_contract.WorkflowContractError, message):
                workflow_contract.validate_windows_port_range(mutated)

        with self.subTest(name="step removed"):
            check(source.replace(step, "", 1), "without widening")
        with self.subTest(name="step after Playwright"):
            moved = source.replace(step, "", 1)
            at = moved.index("      - name: Install Chromium\n", step_start)
            end = moved.index("\n\n", at) + 2
            check(moved[:end] + step + moved[end:], "without widening")
        with self.subTest(name="failure swallowed"):
            check(
                source.replace(
                    "num=55535\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
                    "num=55535 || true",
                    1,
                ),
                "must fail",
            )

    def test_normal_ci_runs_the_browser_suite_instead_of_deferring_it_to_release(self):
        test_workflow = TEST_WORKFLOW.read_text(encoding="utf-8")
        # T-35: main reaches this workflow only through release.yml's call, never by push.
        self.assertNotIn("\n  push:", test_workflow.partition("\njobs:")[0])
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
            "node tools/dev/test-shards.mjs select --os linux --slots 6",
            'npx playwright test --test-list "$lists/product.txt"',
            "npx playwright test --config playwright.design.config.ts",
            'PLAYWRIGHT_WORKERS="$WORKERS_LINUX_PRODUCT" PLAYWRIGHT_FULLY_PARALLEL=1',
            'PLAYWRIGHT_WORKERS="$WORKERS_LINUX_DESIGN" PLAYWRIGHT_JSON_OUTPUT_FILE=',
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
                "slot: [1, 2, 3, 4, 5, 6]",
                "slot: [1, 2, 3, 4, 5]",
                "exactly six browser matrix slots",
            ),
            (
                "assignment for another slot count",
                "--slots 6 --slot",
                "--slots 5 --slot",
                "missing fail-closed shard evidence",
            ),
            (
                "back to cutting by count",
                '--test-list "$lists/product.txt"',
                '--shard="$SLOT/6"',
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
                "final Windows slot repeats the eighth",
                "slot: 9\n            slots: 9",
                "slot: 8\n            slots: 9",
                "one entry per slot",
            ),
            (
                "macOS back to two slots",
                "label: macos-15 / slot 4 of 4\n            slot: 4\n            slots: 4",
                "label: macos-15 / slot 4 of 4\n            slot: 4\n            slots: 3",
                "one entry per slot",
            ),
            (
                "reused diagnostics name",
                "diagnostics: windows-2025-9-of-9",
                "diagnostics: windows-2025-8-of-9",
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

    def test_worker_counts_come_from_one_setting_per_system(self):
        sources = {TEST_WORKFLOW: TEST_WORKFLOW.read_text(encoding="utf-8")}
        workflow_contract.validate_playwright_worker_settings(sources)
        mutations = (
            ("setting removed", '  WORKERS_MACOS: "2"\n', "", "one workflow-level worker count"),
            ("not a number", 'WORKERS_WINDOWS: "1"', 'WORKERS_WINDOWS: "x"', "positive integer"),
            ("zero", 'WORKERS_LINUX_DESIGN: "2"', 'WORKERS_LINUX_DESIGN: "0"', "positive integer"),
            (
                "literal on Linux",
                'PLAYWRIGHT_WORKERS="$WORKERS_LINUX_PRODUCT"',
                "PLAYWRIGHT_WORKERS=1",
                "not a literal",
            ),
            (
                "literal on the cross-platform slots",
                workflow_contract.CROSS_PLATFORM_WORKERS_BINDING,
                "PLAYWRIGHT_WORKERS: 3",
                "not a literal",
            ),
        )
        for name, original, replacement, error in mutations:
            with self.subTest(name=name):
                self.assertIn(original, sources[TEST_WORKFLOW])
                mutated = {TEST_WORKFLOW: sources[TEST_WORKFLOW].replace(original, replacement, 1)}
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, error):
                    workflow_contract.validate_playwright_worker_settings(mutated)

    def test_every_product_server_writes_the_log_the_suite_reads(self):
        sources = {TEST_WORKFLOW: TEST_WORKFLOW.read_text(encoding="utf-8")}
        workflow_contract.validate_product_server_log(sources)
        for setting in workflow_contract.SERVER_LOG_SETTINGS:
            with self.subTest(removed=setting):
                self.assertEqual(sources[TEST_WORKFLOW].count(setting), 3)
                mutated = {TEST_WORKFLOW: sources[TEST_WORKFLOW].replace(setting, "true", 1)}
                with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "log file"):
                    workflow_contract.validate_product_server_log(mutated)

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
        self.assertIn('git rev-parse "refs/remotes/origin/$GITHUB_REF_NAME"', self.build)
        self.assertIn('[ "$GITHUB_SHA" = "$HEAD_SHA" ]', self.build)
        self.assertIn(
            "release-gate:\n    name: Portable release gate\n"
            "    needs: [release-plan, release-context]",
            self.build,
        )
        self.assertIn("version-check:\n    needs: [release-plan, release-context]", self.build)
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
                "      && needs.version-check.outputs.macos_direct == 'true'\n    runs-on: macos-15",
                "    runs-on: macos-15",
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

    def test_security_events_write_stays_in_the_job(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_security_events_scope(sources)

        codeql = next(path for path in sources if path.name == "codeql.yml")
        self.assertIn("permissions: {}\n", sources[codeql])
        mutated = dict(sources)
        mutated[codeql] = sources[codeql].replace(
            "permissions: {}\n", "permissions:\n  security-events: write\n", 1
        )
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "at workflow level"):
            workflow_contract.validate_security_events_scope(mutated)

    def test_writing_data_publishes_only_on_its_switch(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_writing_data(sources)
        source = sources[WRITING_DATA_WORKFLOW]

        def check(mutated_source, message, path=WRITING_DATA_WORKFLOW):
            mutated = dict(sources)
            mutated[path] = mutated_source
            with self.assertRaisesRegex(workflow_contract.WorkflowContractError, message):
                workflow_contract.validate_writing_data(mutated)

        cases = (
            ("missing", None, "is missing"),
            (
                "push trigger",
                source.replace(
                    "on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:", 1
                ),
                "started by hand",
            ),
            (
                "schedule",
                source.replace(
                    "\nconcurrency:", "  schedule:\n    - cron: '0 3 1 * *'\n\nconcurrency:", 1
                ),
                "started by hand",
            ),
            (
                "switch on by default",
                source.replace("default: false", "default: true", 1),
                "off by default",
            ),
            (
                "switch not boolean",
                source.replace("type: boolean", "type: string", 1),
                "off by default",
            ),
            (
                "write at workflow level",
                source.replace(
                    "permissions:\n  contents: read\n", "permissions:\n  contents: write\n", 1
                ),
                "only contents: read",
            ),
            (
                "secret",
                source.replace("${{ github.token }}", "${{ secrets.RELEASE_TOKEN }}", 1),
                "secrets",
            ),
            (
                "build job publishes",
                source.replace(
                    "    outputs:\n", "    permissions:\n      contents: write\n    outputs:\n", 1
                ),
                "build job may not publish",
            ),
            (
                "publish job without write",
                source.replace("    permissions:\n      contents: write\n", "", 1),
                "only the writing-data publish job",
            ),
            (
                "publish without switch",
                source.replace("    if: inputs.publish\n", "", 1),
                "publish switch",
            ),
            (
                "marked latest",
                source.replace("--latest=false", "--latest", 1),
                "never be marked latest",
            ),
            (
                "bare date tag",
                source.replace('TAG="writing-data-$VERSION"', 'TAG="$VERSION"', 1),
                "writing-data-<YYYY.MM.DD>",
            ),
            (
                "no tag guard",
                source.replace("^writing-data-[0-9]{4}", "^writing-data-.*", 1),
                "writing-data-<YYYY.MM.DD>",
            ),
            (
                "build job runs gh release",
                source.replace(
                    "          ls -l work/release\n",
                    "          ls -l work/release\n          gh release upload x y\n",
                    1,
                ),
                "build job may not publish",
            ),
            (
                "third job writes",
                source
                + "\n  extra:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: write\n    steps:\n      - run: echo extra\n",
                "only the writing-data publish job",
            ),
            (
                "write moved out of the publish job",
                source.replace("    permissions:\n      contents: write\n", "", 1)
                + "\n  extra:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: write\n    steps:\n      - run: echo extra\n",
                "only the writing-data publish job",
            ),
            (
                "second release",
                source + "      - run: gh release create extra\n",
                "exactly one release",
            ),
        )
        for name, mutated_source, message in cases:
            with self.subTest(name=name):
                if mutated_source is None:
                    mutated = {
                        path: text
                        for path, text in sources.items()
                        if path != WRITING_DATA_WORKFLOW
                    }
                    with self.assertRaisesRegex(workflow_contract.WorkflowContractError, message):
                        workflow_contract.validate_writing_data(mutated)
                else:
                    self.assertNotEqual(mutated_source, source, name)
                    check(mutated_source, message)
        with self.subTest(name="another workflow creates a data release"):
            check(
                sources[PUBLISH_WORKFLOW] + "# gh release create writing-data-2026.11.03\n",
                "may not create writing-data releases",
                PUBLISH_WORKFLOW,
            )

    def test_writing_data_tags_are_not_app_versions(self):
        with self.assertRaises(previous_release.PreviousReleaseError):
            previous_release.semantic_version("writing-data-2026.11.03")
        with self.assertRaises(previous_release.PreviousReleaseError):
            previous_release.semantic_version("2026.11.03.1")

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

    def test_rust_toolchain_steps_match_rust_toolchain_toml(self):
        """The release gate once installed 1.98.0 without components and failed at random."""
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_rust_toolchain_steps(sources)
        gate = """          toolchain: "1.98.0"
          components: rustfmt, clippy
      - run: npm ci
      - name: Install the browser and declared Python dependencies"""
        self.assertIn(gate, sources[BUILD_WORKFLOW])
        mutations = {
            "components removed": gate.replace("          components: rustfmt, clippy\n", ""),
            "one component missing": gate.replace("rustfmt, clippy", "rustfmt"),
            "other channel": gate.replace('"1.98.0"', '"1.97.0"'),
        }
        for label, mutated in mutations.items():
            with self.subTest(label):
                broken = dict(sources)
                broken[BUILD_WORKFLOW] = sources[BUILD_WORKFLOW].replace(gate, mutated)
                with self.assertRaisesRegex(
                    workflow_contract.WorkflowContractError,
                    r"release\.yml: rust-toolchain step",
                ):
                    workflow_contract.validate_rust_toolchain_steps(broken)
        workflow_contract.validate_rust_toolchain_steps(
            {BUILD_WORKFLOW: sources[BUILD_WORKFLOW].replace("rustfmt, clippy", "clippy ,rustfmt")}
        )
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "toolchain 1.99.0"):
            workflow_contract.validate_rust_toolchain_steps(
                sources,
                '[toolchain]\nchannel = "1.99.0"\ncomponents = ["clippy", "rustfmt"]\n',
            )

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
    "browser-e2e-oidc",
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
        # Every validation repeats work that depends only on the repository, never on the
        # workflow text the tests mutate: listing the tracked files and reading every client
        # unit test (the glob compilations are cached in path_filter itself, T-96). Caching
        # those two for this class changes no result; each cached list is handed out as a
        # fresh copy (T-40).
        tracked_paths = functools.cache(path_filter.tracked_paths)
        original_client_inputs = workflow_contract.client_test_inputs
        client_inputs = functools.cache(lambda tracked: original_client_inputs(list(tracked)))
        for target, name, replacement in (
            (path_filter, "tracked_paths", lambda *args: list(tracked_paths(*args))),
            (
                workflow_contract,
                "client_test_inputs",
                lambda tracked: list(client_inputs(tuple(tracked))),
            ),
        ):
            patcher = patch.object(target, name, replacement)
            patcher.start()
            cls.addClassCleanup(patcher.stop)

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
                # Sign-in, sessions and autosave also run the OIDC browser suite (D-103).
                "pull request, autosave",
                pr,
                ["packages/client/src/app/workspace/useAutosave.ts"],
                {
                    "frontend",
                    "browser-e2e-shards",
                    "visual-baseline-reach",
                    "cross-platform-smoke",
                    "browser-e2e-oidc",
                },
                True,
            ),
            (
                "pull request, the OIDC browser suite",
                pr,
                ["tests/e2e-oidc/session-ended-autosave.spec.ts"],
                {"frontend", "browser-e2e-oidc"},
                False,
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
                "pull request, a README screenshot only (check:readme-screenshots hashes it)",
                pr,
                ["docs/screenshots/de/places.png"],
                {"backend", "frontend", "cross-platform-native"},
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
                for group in ("checks", "python", "rust", "client", "lint", "oidc")
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
                "a crashed filter fails the plan",
                ' --output "$GITHUB_OUTPUT" || {\n',
                ' --output "$GITHUB_OUTPUT" || exit 1\n              : || {\n',
                "path filter step is missing",
            ),
            (
                "the crash fallback forgets a group",
                "for group in checks python rust client browser lint oidc; do",
                "for group in checks python rust client browser lint; do",
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
                "      - browser-e2e-oidc\n    if: always()",
                "    if: always()",
                "must need the plan and every filtered job",
            ),
            (
                "the gate skips with its needs",
                "    if: always()\n    runs-on: ubuntu-24.04\n    permissions: {}\n",
                "    runs-on: ubuntu-24.04\n    permissions: {}\n",
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
        code, output, _ = run_gate_script(self.workflow, gate_values("true"))
        self.assertEqual(code, 0, output)
        for result in ("failure", "cancelled", "skipped"):
            with self.subTest(frontend=result):
                values = gate_values("true", results={"frontend": result})
                code, output, _ = run_gate_script(self.workflow, values)
                self.assertEqual(code, 1, output)
                self.assertIn("frontend is " + result, output)
                self.assertIn("browser-e2e-shards: success", output)

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

    def test_a_crashed_path_filter_runs_every_group(self):
        """T-48: a filter that dies (here after writing run_browser=false) must leave every
        run_<group> true and the step green, instead of a red plan or fewer tests."""
        groups = path_filter.load_config().groups

        def run(workflow):
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "output"
                output.write_bytes(b"")
                preamble = (
                    "set -e\n"
                    f"export RUNNER_TEMP={shlex.quote(Path(directory).as_posix())}\n"
                    f"export GITHUB_OUTPUT={shlex.quote(output.as_posix())}\n"
                    "git() { return 0; }\n"
                    'python() { echo "run_browser=false" >> "$GITHUB_OUTPUT"; return 1; }\n'
                )
                code, log = run_step_script(
                    workflow, "plan", "Select job groups by changed path", preamble
                )
                written = output.read_text(encoding="utf-8")
            # GITHUB_OUTPUT: the last line for a name wins.
            values = dict(line.split("=", 1) for line in written.splitlines() if "=" in line)
            return code, log, values

        code, log, values = run(self.workflow)
        self.assertEqual(code, 0, log)
        self.assertEqual({f"run_{group}": "true" for group in groups}, values)

        # Without the fallback the same crash fails the step.
        fallback = re.search(r" \|\| \{\n.*?\n            \}\n", self.workflow, re.DOTALL)
        assert fallback is not None
        code, _, _ = run(self.workflow.replace(fallback.group(0), "\n", 1))
        self.assertNotEqual(code, 0)

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
        unjustified["untested"] = [{"patterns": ["newdir/**"]}]
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


# Constructs bash 3.2 lacks. macOS ships 3.2, and these tests run workflow steps under the
# machine's own bash, so a step that needs bash 4 fails there although the Linux runner is fine.
BASH4_ONLY = re.compile(
    r"\b(?:mapfile|readarray|coproc)\b|\b(?:declare|local|typeset) -[a-zA-Z]*[An]"
    r"|\$\{[A-Za-z_][A-Za-z_0-9]*(?:,,?|\^\^?)\}|\|&|&>>|\[\[ -v |\bwait -n\b"
)


def assert_bash32(script, where):
    """Fail on a bash-4-only construct in a script these tests run under the local bash."""

    match = BASH4_ONLY.search(script)
    assert match is None, f"{where} uses {match.group(0)!r}, which bash 3.2 (macOS) lacks"


def run_gate_script(workflow, values):
    """
    Run browser-e2e's real gate script under bash with the given environment.

    Returns (exit code, output, the GITHUB_OUTPUT file's text). On Windows, `bash` can resolve to
    WSL's System32\\bash.exe, which passes no environment on and expands `$1` before the script
    sees it, so the values go in as assignments ahead of the script, and the script on stdin.
    """

    bash = shutil.which("bash")
    if bash is None:
        raise unittest.SkipTest("bash is not installed")
    aggregator = workflow_contract._job_body(workflow, "browser-e2e")
    script = re.search(r"^        run: \|\n((?:          .*\n|\n)*)", aggregator, re.MULTILINE)
    assert script is not None, "browser-e2e has no run block"
    body = "".join(line[10:] + "\n" for line in script.group(1).splitlines())
    assert_bash32(body, "browser-e2e")
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "output"
        output.write_bytes(b"")
        # bash on Windows reads a POSIX path; as_posix() keeps C:/... which Git Bash accepts.
        assignments = {**values, "GITHUB_OUTPUT": output.as_posix()}
        preamble = "".join(f"{key}={shlex.quote(value)}\n" for key, value in assignments.items())
        # Bytes, not text: text mode on Windows would write \r\n, which bash rejects.
        completed = subprocess.run(
            [bash, "-s"], input=(preamble + body).encode(), capture_output=True, check=False
        )
        written = output.read_text(encoding="utf-8")
    return (
        completed.returncode,
        completed.stdout.decode(errors="replace") + completed.stderr.decode(errors="replace"),
        written,
    )


def gate_values(full_matrix, selected=None, results=None):
    """Gate inputs: every job green and selected as the given mode selects it, with overrides."""

    values = {"PLAN_RESULT": "success", "FULL_MATRIX": full_matrix}
    # Full mode selects everything but the smoke test; reduced mode swaps the full
    # cross-platform matrix for it.
    if full_matrix == "true":
        off = set(workflow_contract.REDUCED_ONLY)
    else:
        off = {"cross-platform-browser"}
    for name in workflow_contract.FILTERED_JOBS:
        job = workflow_contract._env_name(name)
        chosen = (selected or {}).get(name, "false" if name in off else "true")
        values[f"SELECTED_{job}"] = chosen
        values[f"RESULT_{job}"] = (results or {}).get(
            name, "success" if chosen == "true" else "skipped"
        )
    return values


class FullMatrixVerdictContractTests(unittest.TestCase):
    """T-35 P2-a: test.yml's verdict is the release's test evidence (C-1, C-2, C-7, C-8, C-13,
    C-18, C-20)."""

    @classmethod
    def setUpClass(cls):
        cls.sources = workflow_contract._workflow_sources()
        cls.workflow = cls.sources[TEST_WORKFLOW]

    def assert_mutation_fails(self, validate, original, replacement, error, count=1):
        self.assertEqual(self.workflow.count(original), count, original)
        mutated = dict(self.sources)
        mutated[TEST_WORKFLOW] = self.workflow.replace(original, replacement)
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, re.escape(error)):
            validate(mutated)

    def test_the_repository_satisfies_every_contract(self):
        for validate in (
            workflow_contract.validate_full_matrix_coverage,
            workflow_contract.validate_full_matrix_verdict,
            workflow_contract.validate_test_triggers,
            workflow_contract.validate_test_concurrency,
            workflow_contract.validate_full_mode_runs_everything,
            workflow_contract.validate_required_step_conditions,
        ):
            with self.subTest(validate=validate.__name__):
                validate(self.sources)
        workflow_contract.validate_no_attempt_dependent_tests()

    def test_the_constants_follow_the_existing_ones(self):
        self.assertEqual(workflow_contract.REDUCED_ONLY, {"cross-platform-smoke"})
        self.assertLessEqual(workflow_contract.REDUCED_ONLY, set(workflow_contract.FILTERED_JOBS))
        self.assertEqual(
            workflow_contract.FULL_MATRIX_EXPANSIONS,
            {"browser-e2e-shards": 6, "cross-platform-native": 2, "cross-platform-browser": 13},
        )

    def test_full_mode_never_starts_more_macos_jobs_than_the_plan_runs(self):
        validate = workflow_contract.validate_full_matrix_coverage
        validate(self.sources)
        with patch.object(workflow_contract, "MACOS_CONCURRENT_LIMIT", 4):
            with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "5 macOS jobs"):
                validate(self.sources)

    def test_c1_coverage_mutations(self):
        validate = workflow_contract.validate_full_matrix_coverage
        for name, original, replacement, error in (
            (
                "verdict from another job",
                "value: ${{ jobs.browser-e2e.outputs.verdict }}",
                "value: ${{ jobs.plan.outputs.verdict }}",
                "must output verdict",
            ),
            (
                "verdict output removed",
                '    outputs:\n      verdict:\n        description: "full-success only when every '
                'job the full matrix requires succeeded"\n        value: ${{ '
                "jobs.browser-e2e.outputs.verdict }}\n",
                "",
                "must output verdict",
            ),
            (
                "a Linux slot dropped",
                "        slot: [1, 2, 3, 4, 5, 6]\n",
                "        slot: [1, 2, 3, 4, 5]\n",
                "browser-e2e-shards expands to 5 jobs",
            ),
            (
                "an include row of the cross-platform matrix dropped",
                "          - os: macos-15\n            system: macos\n"
                "            label: macos-15 / slot 4 of 4\n            slot: 4\n"
                "            slots: 4\n            diagnostics: macos-15-4-of-4\n",
                "",
                "cross-platform-browser expands to 12 jobs",
            ),
            (
                "a matrix the contract cannot count",
                "        slot: [1, 2, 3, 4, 5, 6]\n",
                "        slot: ${{ fromJSON(needs.plan.outputs.slots) }}\n",
                "has a matrix the contract cannot count",
            ),
        ):
            with self.subTest(name=name):
                self.assert_mutation_fails(validate, original, replacement, error)
        # The native matrix: one runner fewer is one expansion fewer.
        native = workflow_contract._job_body(self.workflow, "cross-platform-native")
        self.assertIn("        os: [macos-15, windows-2025]\n", native)
        mutated = dict(self.sources)
        mutated[TEST_WORKFLOW] = self.workflow.replace(
            native, native.replace("os: [macos-15, windows-2025]", "os: [windows-2025]")
        )
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError, "cross-platform-native expands to 1 jobs"
        ):
            validate(mutated)

    def test_c1_an_ungated_job_fails(self):
        mutated = dict(self.sources)
        mutated[TEST_WORKFLOW] = self.workflow.replace(
            "\n  visual-baseline-reach:\n",
            "\n  ghost-job:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: true\n"
            "\n  visual-baseline-reach:\n",
        )
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "found ghost-job"):
            workflow_contract.validate_full_matrix_coverage(mutated)

    def test_c2_verdict_mutations(self):
        validate = workflow_contract.validate_full_matrix_verdict
        for name, original, replacement, error in (
            (
                "the full-mode check removed",
                "          full_mode cross-platform-native "
                '"$SELECTED_CROSS_PLATFORM_NATIVE" true\n',
                "",
                "selected=true for cross-platform-native",
            ),
            (
                "cross-platform-native treated as reduced-only",
                'full_mode cross-platform-native "$SELECTED_CROSS_PLATFORM_NATIVE" true',
                'full_mode cross-platform-native "$SELECTED_CROSS_PLATFORM_NATIVE" false',
                "selected=true for cross-platform-native",
            ),
            (
                "the smoke test allowed in full mode",
                'full_mode cross-platform-smoke "$SELECTED_CROSS_PLATFORM_SMOKE" false',
                'full_mode cross-platform-smoke "$SELECTED_CROSS_PLATFORM_SMOKE" true',
                "selected=false for cross-platform-smoke",
            ),
            (
                "full-success without the full-mode test",
                '          if [ "$FULL_MATRIX" = "true" ]; then\n            verdict=full-success\n',
                "          if true; then\n            verdict=full-success\n",
                "must end with the verdict",
            ),
            (
                "the verdict written before the status test",
                '          if [ "$status" -ne 0 ]; then\n            exit 1\n          fi\n'
                '          if [ "$FULL_MATRIX" = "true" ]; then\n',
                '          if [ "$FULL_MATRIX" = "true" ]; then\n',
                "must end with the verdict",
            ),
            (
                "the plan's decision not read",
                "          FULL_MATRIX: ${{ needs.plan.outputs.full_matrix }}\n",
                "          FULL_MATRIX: 'true'\n",
                "FULL_MATRIX: ${{ needs.plan.outputs.full_matrix }}",
            ),
            (
                "permissions granted",
                "    permissions: {}\n    # The one verdict",
                "    permissions:\n      contents: read\n    # The one verdict",
                "permissions: {}",
            ),
            (
                "the output no longer from the gate step",
                "      verdict: ${{ steps.gate.outputs.verdict }}\n",
                "      verdict: full-success\n",
                "verdict: ${{ steps.gate.outputs.verdict }}",
            ),
        ):
            with self.subTest(name=name):
                self.assert_mutation_fails(validate, original, replacement, error)

    def test_c2_the_real_gate_script(self):
        """Full mode with a deselected job is red; a reduced run with a chosen skip passes."""
        code, output, written = run_gate_script(self.workflow, gate_values("true"))
        self.assertEqual(code, 0, output)
        self.assertEqual(written, "verdict=full-success\n")

        values = gate_values("true", selected={"cross-platform-native": "false"}, results={})
        code, output, written = run_gate_script(self.workflow, values)
        self.assertEqual(code, 1, output)
        self.assertIn("cross-platform-native has selected=false in full mode", output)
        self.assertEqual(written, "", "a red gate must leave the verdict empty")

        values = gate_values("true", selected={"cross-platform-smoke": "true"})
        code, output, written = run_gate_script(self.workflow, values)
        self.assertEqual(code, 1, output)
        self.assertEqual(written, "")

        values = gate_values("false", selected={"portable-core": "false"})
        code, output, written = run_gate_script(self.workflow, values)
        self.assertEqual(code, 0, output)
        self.assertIn("portable-core: skipped, not selected by the plan", output)
        self.assertEqual(written, "verdict=reduced-success\n")

        values = gate_values("true", results={"frontend": "failure"})
        code, output, written = run_gate_script(self.workflow, values)
        self.assertEqual(code, 1, output)
        self.assertEqual(written, "")

        # A plan that failed leaves FULL_MATRIX empty: red, and never full-success.
        values = {**gate_values("true"), "PLAN_RESULT": "failure", "FULL_MATRIX": ""}
        code, output, written = run_gate_script(self.workflow, values)
        self.assertEqual(code, 1, output)
        self.assertEqual(written, "")

    def test_c7_no_push_trigger(self):
        self.assert_mutation_fails(
            workflow_contract.validate_test_triggers,
            "on:\n  pull_request:\n",
            "on:\n  push:\n    branches: [main]\n  pull_request:\n",
            "must run on exactly",
        )
        self.assert_mutation_fails(
            workflow_contract.validate_test_triggers,
            "on:\n  pull_request:\n",
            "on:\n  schedule:\n    - cron: '0 3 * * *'\n  pull_request:\n",
            "must run on exactly",
        )

    def test_c8_concurrency_mutations(self):
        validate = workflow_contract.validate_test_concurrency
        for name, original, replacement in (
            (
                "one group per ref again",
                "  group: ${{ github.event_name == 'pull_request' && format('test-pr-{0}', "
                "github.ref) || format('test-run-{0}', github.run_id) }}\n",
                "  group: test-${{ github.ref }}\n",
            ),
            (
                "every run cancels",
                "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
                "  cancel-in-progress: true\n",
            ),
            (
                "a second, job-level concurrency",
                "    permissions: {}\n    # The one verdict",
                "    permissions: {}\n    concurrency: gate\n    # The one verdict",
            ),
        ):
            with self.subTest(name=name):
                self.assert_mutation_fails(validate, original, replacement, "concurrency")

    def test_c13_a_test_reading_the_attempt_fails(self):
        validate = workflow_contract.validate_no_attempt_dependent_tests
        # Split, so this file itself never reads like a test that reads the attempt.
        name = "_".join(("GITHUB", "RUN", "ATTEMPT"))
        for path, source in (
            ("tests/python/test_flake.py", f'if os.environ.get("{name}") == "1":\n'),
            ("tests/python/test_flake.py", f'attempt = os.getenv("{name}")\n'),
            ("tests/e2e/flake.spec.ts", f"if (process.env.{name} === '1') {{}}\n"),
            ("tests/e2e/flake.spec.ts", f'if (process.env["{name}"]) {{}}\n'),
            ("tests/e2e/run.sh", f'[ "${name}" = 1 ] && exit 1\n'),
            ("tests/e2e/run.ps1", f"if ($env:{name} -eq 1) {{ exit 1 }}\n"),
            ("tests/e2e/flow.yml", "if: " + ".".join(("github", "run_attempt")) + " == 1\n"),
        ):
            with self.subTest(path=path, source=source):
                with self.assertRaisesRegex(
                    workflow_contract.WorkflowContractError, re.escape(path)
                ):
                    validate({path: source})
        # Naming the hand-off tag in a string literal reads nothing.
        validate({"tests/python/test_x.py": '"build-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"\n'})

    def test_c18_full_mode_skips_nothing(self):
        validate = workflow_contract.validate_full_mode_runs_everything
        for name, original, replacement, error in (
            (
                "native core off in full mode",
                "    if: needs.plan.outputs.run_python == 'true' || "
                "needs.plan.outputs.run_rust == 'true'\n",
                "    if: (needs.plan.outputs.run_python == 'true' || "
                "needs.plan.outputs.run_rust == 'true') && needs.plan.outputs.full_matrix != 'true'\n",
                "cross-platform-native is skipped in full mode",
            ),
            (
                "the smoke test on in full mode",
                "    if: needs.plan.outputs.full_matrix != 'true' && "
                "needs.plan.outputs.run_browser == 'true'\n",
                "    if: needs.plan.outputs.run_browser == 'true'\n",
                "cross-platform-smoke runs in full mode",
            ),
            (
                "a plan output that filters in full mode",
                "      run_rust: ${{ steps.decide.outputs.full_matrix == 'true' && 'true' || ",
                "      run_rust: ${{ ",
                "the plan output run_rust must be 'true' in full mode",
            ),
            (
                "a form the check cannot read",
                "    if: needs.plan.outputs.run_lint == 'true'\n",
                "    if: contains(needs.plan.outputs.run_lint, 'true')\n",
                "cannot read",
            ),
            (
                "a name the check does not know",
                "    if: needs.plan.outputs.run_lint == 'true'\n",
                "    if: vars.LINT == 'true'\n",
                "cannot read",
            ),
        ):
            with self.subTest(name=name):
                self.assert_mutation_fails(validate, original, replacement, error)

    def test_c18_the_evaluator(self):
        evaluate = workflow_contract.evaluate_condition
        context = {"a": "true", "b": "false"}
        self.assertTrue(evaluate("a == 'true' && (b == 'true' || a != 'false')", context))
        self.assertFalse(evaluate("${{ a == 'false' || b == 'true' }}", context))
        for broken in ("a", "a == 'true' &&", "(a == 'true'", "a == true", "!a", "c == 'x'"):
            with self.subTest(broken=broken), self.assertRaises(ValueError):
                evaluate(broken, context)

    def test_c20_step_condition_mutations(self):
        validate = workflow_contract.validate_required_step_conditions
        for name, original, replacement, count in (
            (
                "a test step only on push",
                "      - name: Backend suite\n        run: python -m unittest discover -s "
                "tests/python -t tests/python -v\n",
                "      - name: Backend suite\n        if: github.event_name == 'push'\n"
                "        run: python -m unittest discover -s tests/python -t tests/python -v\n",
                1,
            ),
            (
                "a status function on a test step",
                "      - name: Layout audit rule tests\n        if: matrix.slot == 6\n",
                "      - name: Layout audit rule tests\n        if: ${{ !cancelled() }}\n",
                1,
            ),
            (
                "a client step on full_matrix",
                "      - name: Unit tests\n        if: needs.plan.outputs.run_client == 'true'\n",
                "      - name: Unit tests\n        if: needs.plan.outputs.full_matrix != 'true'\n",
                1,
            ),
            (
                "a multi-line condition",
                "        if: runner.os == 'Windows'\n",
                "        if: >-\n          runner.os == 'Windows'\n",
                6,
            ),
        ):
            with self.subTest(name=name):
                self.assert_mutation_fails(
                    validate, original, replacement, "step condition that could skip", count
                )
        # A run_<group> step condition counts only while that output is true in full mode.
        self.assert_mutation_fails(
            validate,
            "      run_client: ${{ steps.decide.outputs.full_matrix == 'true' && 'true' || ",
            "      run_client: ${{ ",
            "if: needs.plan.outputs.run_client == 'true'",
        )


def run_step_script(workflow, job, step_name, preamble, cwd=None):
    """
    Run one step's real `run: |` block under bash, after a preamble of assignments and stub
    functions. Functions shadow commands, so gh, git and python can be stubbed portably.
    Returns (exit code, output).
    """

    bash = shutil.which("bash")
    if bash is None:
        raise unittest.SkipTest("bash is not installed")
    body = workflow_contract._job_body(workflow, job)
    start = body.find(f"      - name: {step_name}\n")
    if start < 0:  # the name is not the step's first key (`- id: x` comes first)
        start = body.rfind("\n      - ", 0, body.index(f"        name: {step_name}\n")) + 1
    end = body.find("\n      - ", start + 1)
    # Keep the newline that ends the step's last line, or the regex below drops that line.
    step = body[start : end + 1 if end >= 0 else len(body)]
    script = re.search(r"^        run: \|\n((?:          .*\n|\n)*)", step, re.MULTILINE)
    assert script is not None, f"{step_name} has no run block"
    text = "".join(line[10:] + "\n" for line in script.group(1).splitlines())
    text = text.replace("${{ github.repository }}", "owner/repo")
    assert_bash32(text, step_name)
    completed = subprocess.run(
        [bash, "-s"], input=(preamble + text).encode(), capture_output=True, check=False, cwd=cwd
    )
    return (
        completed.returncode,
        completed.stdout.decode(errors="replace") + completed.stderr.decode(errors="replace"),
    )


class ReleaseSingleEntryContractTests(unittest.TestCase):
    """T-35 P2-c: release.yml is the single entry, and builds only on full-success."""

    @classmethod
    def setUpClass(cls):
        cls.sources = workflow_contract._workflow_sources()

    def assert_mutation_fails(self, validate, path, original, replacement, error):
        source = self.sources[path]
        self.assertIn(original, source, f"{path.name}: {original!r}")
        mutated = dict(self.sources)
        mutated[path] = source.replace(original, replacement)
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, re.escape(error)):
            validate(mutated)

    def test_the_repository_satisfies_every_contract(self):
        for validate in (
            workflow_contract.validate_release_no_continue_on_error,
            workflow_contract.validate_release_calls_full_matrix,
            workflow_contract.validate_tests_call_permissions,
            workflow_contract.validate_artifact_edges,
            workflow_contract.validate_single_entry,
            workflow_contract.validate_release_concurrency,
            workflow_contract.validate_dry_run_boundary,
            workflow_contract.validate_publish_selection,
            workflow_contract.validate_release_cache_boundary,
            workflow_contract.validate_rerun_rechecks,
            workflow_contract.validate_ci_release_scope,
            workflow_contract.validate_bootstrap_never_on_main,
            workflow_contract.validate_write_jobs_need_tests_and_gate,
            workflow_contract.validate_dry_run_skips_secrets,
        ):
            with self.subTest(validate=validate.__name__):
                validate(self.sources)

    def test_the_write_class_is_detected(self):
        build = self.sources[BUILD_WORKFLOW]
        self.assertEqual(
            workflow_contract.write_jobs(build),
            {"web-image", "backup-image", "macos-direct", "windows-direct", "release-manifest"},
        )

    def test_mutations_fail_their_contract(self):
        w = workflow_contract
        bootstrap = TEST_WORKFLOW.parent / "visual-baselines-bootstrap.yml"
        web_if = (
            "    needs: [release-plan, release-context, version-check, release-gate, tests]\n"
            "    if: >-\n      needs.release-plan.outputs.release == 'true'\n"
            "      && needs.tests.outputs.verdict == 'full-success'\n    runs-on: ubuntu-24.04\n"
            "    permissions:\n      contents: read\n      packages: write\n    outputs:\n"
            "      image: ${{ steps.immutable.outputs.value }}\n    steps:\n"
            "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n"
            "        with:\n          persist-credentials: false\n"
            "      - uses: actions/setup-node"
        )
        cases = (
            # C-3
            (
                "continue-on-error in a release job",
                w.validate_release_no_continue_on_error,
                BUILD_WORKFLOW,
                "    runs-on: macos-15\n",
                "    runs-on: macos-15\n    continue-on-error: true\n",
                "continue-on-error",
            ),
            # C-4
            (
                "a reduced matrix",
                w.validate_release_calls_full_matrix,
                BUILD_WORKFLOW,
                "      full_matrix: true\n",
                "      full_matrix: false\n",
                "full_matrix: true",
            ),
            (
                "tests hang on release-context",
                w.validate_release_calls_full_matrix,
                BUILD_WORKFLOW,
                "    name: Full test matrix\n",
                "    name: Full test matrix\n    needs: release-context\n",
                "may depend on nothing",
            ),
            # C-5
            (
                "secrets handed to the tests",
                w.validate_tests_call_permissions,
                BUILD_WORKFLOW,
                "      full_matrix: true\n    permissions:\n",
                "      full_matrix: true\n    secrets: inherit\n    permissions:\n",
                "no secrets",
            ),
            (
                "tests with write permission",
                w.validate_tests_call_permissions,
                BUILD_WORKFLOW,
                "      full_matrix: true\n    permissions:\n      contents: read\n",
                "      full_matrix: true\n    permissions:\n      contents: write\n",
                "exactly permissions: contents: read",
            ),
            # C-6
            (
                "python-package without tests",
                w.validate_artifact_edges,
                BUILD_WORKFLOW,
                "  python-package:\n    needs: [release-plan, release-context, version-check, "
                "release-gate, tests]\n",
                "  python-package:\n    needs: [release-plan, release-context, version-check, "
                "release-gate]\n",
                "python-package must need tests",
            ),
            (
                "web-image without the verdict",
                w.validate_artifact_edges,
                BUILD_WORKFLOW,
                web_if,
                web_if.replace("      && needs.tests.outputs.verdict == 'full-success'\n", ""),
                "web-image must run only on: needs.tests.outputs.verdict",
            ),
            # C-7
            (
                "a paths filter again",
                w.validate_single_entry,
                BUILD_WORKFLOW,
                "  push:\n    branches: [main]\n",
                '  push:\n    branches: [main]\n    paths: ["VERSION"]\n',
                "every push to main",
            ),
            (
                "the null SHA is no longer a release candidate",
                w.validate_single_entry,
                BUILD_WORKFLOW,
                '            || [ "$BEFORE" = 0000000000000000000000000000000000000000 ] \\\n',
                "",
                "release-plan is missing its decision",
            ),
            # C-8
            (
                "a shared release group again",
                w.validate_release_concurrency,
                BUILD_WORKFLOW,
                "permissions:\n  contents: read\n\njobs:",
                "concurrency:\n  group: release-build\n\npermissions:\n  contents: read\n\njobs:",
                "no concurrency",
            ),
            # C-9
            (
                "a dry run pushes the backup image",
                w.validate_dry_run_boundary,
                BUILD_WORKFLOW,
                "          file: services/backup-server/Dockerfile\n"
                "          push: ${{ needs.release-plan.outputs.dry_run == 'false' }}\n",
                "          file: services/backup-server/Dockerfile\n          push: true\n",
                "backup-image may push only outside a dry run",
            ),
            (
                "a dry run logs in",
                w.validate_dry_run_boundary,
                BUILD_WORKFLOW,
                "# v4\n        if: needs.release-plan.outputs.dry_run == 'false'\n        with:\n"
                "          registry: ghcr.io\n",
                "# v4\n        with:\n          registry: ghcr.io\n",
                "may log in only outside a dry run",
            ),
            (
                "a dry run creates the manifest",
                w.validate_dry_run_boundary,
                BUILD_WORKFLOW,
                "        && needs.release-plan.outputs.dry_run == 'false'\n",
                "",
                "release-manifest must never run in a dry run",
            ),
            (
                "the input read outside release-plan",
                w.validate_dry_run_boundary,
                BUILD_WORKFLOW,
                "          DRY_RUN: ${{ needs.release-plan.outputs.dry_run }}\n        run: |\n"
                '          set -euo pipefail\n          [ "$GITHUB_REF"',
                "          DRY_RUN: ${{ inputs.dry_run }}\n        run: |\n"
                '          set -euo pipefail\n          [ "$GITHUB_REF"',
                "only release-plan may read inputs.dry_run",
            ),
            # C-10
            (
                "publish from any branch",
                w.validate_publish_selection,
                PUBLISH_WORKFLOW,
                " && github.event.workflow_run.head_branch == 'main')",
                ")",
                "select is missing",
            ),
            (
                "publish without select",
                w.validate_publish_selection,
                PUBLISH_WORKFLOW,
                "  publish:\n    needs: select\n",
                "  publish:\n",
                "must need select",
            ),
            (
                "a published release overwritten",
                w.validate_publish_selection,
                PUBLISH_WORKFLOW,
                '            [ "$(gh release view "v$VERSION" --json isDraft --jq .isDraft)" = true ]'
                ' \\\n              || { echo "::error::v$VERSION is already published"; exit 1; }\n',
                "",
                "run check",
            ),
            # C-11
            (
                "npm cache back in a signing job",
                w.validate_release_cache_boundary,
                BUILD_WORKFLOW,
                "          package-manager-cache: false # an artifact job restores no cache",
                "          cache: npm",
                "may not use a cache",
            ),
            (
                "a cache in the publisher",
                w.validate_release_cache_boundary,
                PUBLISH_WORKFLOW,
                '          python-version: "3.12.10"\n',
                '          python-version: "3.12.10"\n          cache: pip\n',
                "may not use a cache",
            ),
            (
                "cache-mode write in the publisher",
                w.validate_release_cache_boundary,
                PUBLISH_WORKFLOW,
                "  select:\n",
                "  select:\n    cache-mode: write\n",
                "may not write caches",
            ),
            (
                "pull_request_target",
                w.validate_release_cache_boundary,
                TEST_WORKFLOW,
                "on:\n  pull_request:\n",
                "on:\n  pull_request_target:\n  pull_request:\n",
                "pull_request_target",
            ),
            # C-12
            (
                "no head comparison",
                w.validate_rerun_rechecks,
                BUILD_WORKFLOW,
                '          [ "$GITHUB_SHA" = "$MAIN_SHA" ] \\\n'
                '            || { echo "::error::main moved to $MAIN_SHA; release revision '
                '$GITHUB_SHA is stale"; exit 1; }\n',
                "",
                "compare the revision with main again",
            ),
            (
                "the rechecks after the downloads",
                w.validate_rerun_rechecks,
                BUILD_WORKFLOW,
                "      - name: Require the current main head again\n",
                "      - name: Check the head\n",
                "must start with",
            ),
            # C-15 (a, b)
            (
                "the reduced preflight a second time",
                w.validate_ci_release_scope,
                BUILD_WORKFLOW,
                "python distribution/tooling/profile_contract.py check-release\n",
                "python distribution/tooling/profile_contract.py check-release\n"
                "          python distribution/tooling/release_preflight.py --ci-release-scope\n",
                "may appear once",
            ),
            (
                "the manifest builds on the gate without the tests",
                w.validate_ci_release_scope,
                BUILD_WORKFLOW,
                "        release-gate,\n        tests,\n",
                "        release-gate,\n",
                "release-manifest builds on release-gate",
            ),
            # C-16
            (
                "the bootstrap runs on main again",
                w.validate_bootstrap_never_on_main,
                bootstrap,
                "  push:\n    branches-ignore: [main]\n",
                "  push:\n",
                "ignore pushes to main",
            ),
            (
                "the guard before the push removed",
                w.validate_bootstrap_never_on_main,
                bootstrap,
                w.BOOTSTRAP_GUARD + "      - name: Check the new images in\n",
                "      - name: Check the new images in\n",
                "right before it pushes",
            ),
            (
                "the guard compares with master",
                w.validate_bootstrap_never_on_main,
                bootstrap,
                '[ "$TARGET_BRANCH" != main ]',
                '[ "$TARGET_BRANCH" != master ]',
                "first step",
            ),
            # C-17
            (
                "write permission at workflow level",
                w.validate_write_jobs_need_tests_and_gate,
                BUILD_WORKFLOW,
                "permissions:\n  contents: read\n\njobs:",
                "permissions:\n  contents: read\n  packages: write\n\njobs:",
                "no write permission at workflow level",
            ),
            (
                "a write job without tests",
                w.validate_write_jobs_need_tests_and_gate,
                BUILD_WORKFLOW,
                web_if,
                web_if.replace("release-gate, tests]", "release-gate]"),
                "web-image writes and must need tests and release-gate",
            ),
            (
                "the manifest bypassed by an or",
                w.validate_write_jobs_need_tests_and_gate,
                BUILD_WORKFLOW,
                "        !cancelled()\n",
                "        github.event_name == 'workflow_dispatch' || !cancelled()\n",
                "release-manifest writes and must run only on",
            ),
            (
                "the gate with id-token",
                w.validate_write_jobs_need_tests_and_gate,
                BUILD_WORKFLOW,
                "    name: Portable release gate\n    needs: [release-plan, release-context]\n",
                "    name: Portable release gate\n    needs: [release-plan, release-context]\n"
                "    permissions:\n      id-token: write\n",
                "tests and release-gate may not write",
            ),
            (
                "the manifest job renamed",
                w.validate_write_jobs_need_tests_and_gate,
                BUILD_WORKFLOW,
                "\n  release-manifest:\n",
                "\n  release-manifests:\n",
                "not recognized: release-manifest",
            ),
            (
                "publish without select",
                w.validate_write_jobs_need_tests_and_gate,
                PUBLISH_WORKFLOW,
                "  publish:\n    needs: select\n",
                "  publish:\n",
                "publish writes and must run only on select",
            ),
            (
                "a registry push in another workflow",
                w.validate_write_jobs_need_tests_and_gate,
                bootstrap,
                '          git push origin "HEAD:$TARGET_BRANCH"\n',
                '          git push origin "HEAD:$TARGET_BRANCH"\n          docker push ghcr.io/x\n',
                "pushes to a registry",
            ),
            # C-19
            (
                "Windows signing in a dry run",
                w.validate_dry_run_skips_secrets,
                BUILD_WORKFLOW,
                "      && needs.release-plan.outputs.dry_run == 'false'\n"
                "      && needs.version-check.outputs.windows_direct == 'true'\n",
                "      && needs.version-check.outputs.windows_direct == 'true'\n",
                "windows-direct reads secrets",
            ),
            (
                "the signing job renamed",
                w.validate_dry_run_skips_secrets,
                BUILD_WORKFLOW,
                "\n  macos-direct:\n",
                "\n  macos-signed:\n",
                "signing jobs missing: macos-direct",
            ),
        )
        for name, validate, path, original, replacement, error in cases:
            with self.subTest(name=name):
                self.assert_mutation_fails(validate, path, original, replacement, error)

    def test_c14_the_documentation_names_the_flow(self):
        workflow_contract.validate_release_docs()
        for name, anchors in workflow_contract.DOC_ANCHORS.items():
            original = (REPO_ROOT / name).read_text(encoding="utf-8")
            for anchor in anchors:
                with self.subTest(doc=name, anchor=anchor):
                    flat = " ".join(original.split())
                    self.assertIn(anchor, flat)
                    # The anchor may wrap across lines in the source, so drop it from the
                    # whitespace-normalised text, which is what the contract reads.
                    with self.assertRaisesRegex(
                        workflow_contract.WorkflowContractError, re.escape(anchor)
                    ):
                        workflow_contract.validate_release_docs(
                            docs={name: flat.replace(anchor, "x")}
                        )

    def test_a_new_secret_job_needs_the_dry_run_guard(self):
        build = self.sources[BUILD_WORKFLOW]
        mutated = dict(self.sources)
        mutated[BUILD_WORKFLOW] = build + (
            "\n  notify:\n    runs-on: ubuntu-24.04\n    steps:\n"
            "      - env:\n          TOKEN: ${{ secrets.FOO }}\n        run: true\n"
        )
        with self.assertRaisesRegex(
            workflow_contract.WorkflowContractError, "notify reads secrets"
        ):
            workflow_contract.validate_dry_run_skips_secrets(mutated)

    def test_release_complete_turns_an_empty_release_red(self):
        build = self.sources[BUILD_WORKFLOW]

        def complete(**values):
            settings = {
                "DRY_RUN": "false",
                "VERDICT": "full-success",
                "MANIFEST": "success",
                "WEB": "success",
                "BACKUP": "success",
                "PACKAGE": "success",
                "MACOS": "skipped",
                "WINDOWS": "skipped",
                **values,
            }
            preamble = "".join(f"{key}={shlex.quote(value)}\n" for key, value in settings.items())
            return run_step_script(
                build, "release-complete", "Require the verdict and every artifact", preamble
            )

        for name, values, expected in (
            ("a release", {}, 0),
            ("a dry run", {"DRY_RUN": "true", "MANIFEST": "skipped"}, 0),
            ("a reduced verdict", {"VERDICT": "reduced-success"}, 1),
            ("no verdict", {"VERDICT": ""}, 1),
            ("a skipped image", {"WEB": "skipped"}, 1),
            ("a release without manifest", {"MANIFEST": "skipped"}, 1),
            ("a dry run with a manifest", {"DRY_RUN": "true"}, 1),
            (
                "a dry run that signed",
                {"DRY_RUN": "true", "MANIFEST": "skipped", "MACOS": "success"},
                1,
            ),
        ):
            with self.subTest(name=name):
                code, output = complete(**values)
                self.assertEqual(code, expected, output)

    def test_a_second_run_cannot_release_a_published_version_again(self):
        """F-35-15: the draft step refuses a published release and a draft on another revision."""
        publish = self.sources[PUBLISH_WORKFLOW]
        build_sha = "a" * 40

        def draft(view, is_draft, tag_sha):
            stubs = (
                f"BUILD_SHA={build_sha}\nGH_TOKEN=x\n"
                f'python() {{ case "$*" in -c*) echo 1.2.3;; *files*) echo pkg.whl;; esac; }}\n'
                f'gh() {{ case "$1 $2" in\n'
                f'  "api "*) echo {build_sha};;\n'
                f'  "release view") case "$*" in *isDraft*) echo {is_draft};; '
                f"*) return {view};; esac;;\n"
                f'  "release "*) echo "gh $*";;\n'
                f"esac; }}\n"
                f"git() {{ echo {tag_sha}; }}\n"
            )
            with tempfile.TemporaryDirectory() as directory:
                (Path(directory) / "release-assets").mkdir()
                (Path(directory) / "release-assets" / "pkg.whl").write_bytes(b"")
                return run_step_script(
                    publish,
                    "publish",
                    "Create a draft release from the verified build",
                    stubs,
                    cwd=directory,
                )

        code, output = draft(view=0, is_draft="false", tag_sha=build_sha)
        self.assertEqual(code, 1, output)
        self.assertIn("v1.2.3 is already published", output)
        code, output = draft(view=0, is_draft="true", tag_sha="b" * 40)
        self.assertEqual(code, 1, output)
        self.assertIn("existing draft points at another revision", output)
        code, output = draft(view=0, is_draft="true", tag_sha=build_sha)
        self.assertEqual(code, 0, output)
        self.assertIn("gh release upload v1.2.3 --clobber", output)
        code, output = draft(view=1, is_draft="false", tag_sha=build_sha)
        self.assertEqual(code, 0, output)
        self.assertIn("gh release create v1.2.3", output)


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


class PreflightCiScopeTests(unittest.TestCase):
    """C-15: the release workflow's preflight skips only what the full test matrix runs."""

    RELEASE_ENVIRONMENT: ClassVar[dict[str, str]] = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_WORKFLOW_REF": "owner/quiltor/.github/workflows/release.yml@refs/tags/v1.0.0",
    }

    def run_scope(self, scope: str, environment: dict[str, str]) -> tuple[list[str], str]:
        ran: list[str] = []
        output = io.StringIO()
        with (
            patch.dict(release_preflight.os.environ, environment, clear=True),
            patch.object(release_preflight, "_npm_executable", return_value="npm"),
            patch.object(release_preflight, "_cargo_executable", return_value="cargo"),
            patch.object(release_preflight, "_docker_executable", return_value="docker"),
            patch.object(release_preflight, "_require_pinned_runtime_toolchains"),
            patch.object(release_preflight, "_require_pinned_python_build_tools"),
            patch.object(
                release_preflight, "_run", side_effect=lambda label, *_args: ran.append(label)
            ),
            patch.object(
                release_preflight,
                "_check_pinned_writing_data",
                side_effect=lambda *_args, **_kwargs: ran.append("<pinned writing data>"),
            ),
            patch.object(
                release_preflight,
                "_run_portable_artifact_builds",
                side_effect=lambda *_args, **_kwargs: ran.append("<artifact builds>"),
            ),
            patch.object(
                release_preflight,
                "_run_browser_suite",
                side_effect=lambda *_args, **_kwargs: ran.append("Playwright browser suite"),
            ),
            contextlib.redirect_stdout(output),
        ):
            release_preflight.run_preflight(REPO_ROOT, scope=scope)
        return ran, output.getvalue()

    def test_full_scope_runs_every_step_and_skips_nothing(self):
        ran, output = self.run_scope("full", {})
        self.assertNotIn("Skipped", output)
        self.assertLessEqual(release_preflight.COVERED_BY_FULL_MATRIX, set(ran))
        self.assertIn("<artifact builds>", ran)

    def test_both_scopes_check_the_pinned_writing_data(self):
        # The pin is the only thing tying a release to the writing data it ships with; a
        # preflight that forgets to call the check releases whatever the manifest says.
        for scope, environment in (("full", {}), ("ci", self.RELEASE_ENVIRONMENT)):
            with self.subTest(scope=scope):
                ran, _ = self.run_scope(scope, environment)
                self.assertEqual(ran.count("<pinned writing data>"), 1)

    def test_ci_scope_skips_exactly_the_covered_steps(self):
        full, _ = self.run_scope("full", {})
        ci, output = self.run_scope("ci", self.RELEASE_ENVIRONMENT)
        covered = release_preflight.COVERED_BY_FULL_MATRIX
        self.assertEqual(ci, [label for label in full if label not in covered])
        skipped = re.findall(
            r"==> Skipped \(covered by the called full test matrix\): (.+)", output
        )
        self.assertEqual(skipped, [label for label in full if label in covered])
        self.assertEqual(set(release_preflight.COVERAGE), covered)

    def test_ci_scope_outside_release_workflow_fails_instead_of_shrinking(self):
        other_workflow = "owner/quiltor/.github/workflows/test.yml@refs/heads/main"
        for name, environment in (
            ("local shell", {}),
            (
                "another workflow",
                {**self.RELEASE_ENVIRONMENT, "GITHUB_WORKFLOW_REF": other_workflow},
            ),
            ("not in actions", {**self.RELEASE_ENVIRONMENT, "GITHUB_ACTIONS": "false"}),
        ):
            with (
                self.subTest(name=name),
                self.assertRaisesRegex(
                    release_preflight.PreflightError, "reserved for release.yml"
                ),
            ):
                self.run_scope("ci", environment)

    def test_unknown_scope_is_refused(self):
        with self.assertRaisesRegex(release_preflight.PreflightError, "Unknown preflight scope"):
            release_preflight.run_preflight(REPO_ROOT, scope="fast")

    def test_flag_selects_the_ci_scope_and_its_absence_the_full_one(self):
        for argv, scope in (([], "full"), (["--ci-release-scope"], "ci")):
            with (
                self.subTest(argv=argv),
                patch.object(release_preflight, "run_preflight") as run,
            ):
                self.assertEqual(release_preflight.main(argv), 0)
                run.assert_called_once_with(scope=scope)

    def test_the_default_scope_is_full(self):
        signature = inspect.signature(release_preflight.run_preflight)
        self.assertEqual(signature.parameters["scope"].default, "full")

    def test_set_version_runs_the_full_preflight(self):
        source = (TOOLING / "set_version.py").read_text(encoding="utf-8")
        calls = re.findall(r"run_preflight\(([^)]*)\)", source)
        self.assertEqual(calls, ["repo_root"])

    def test_every_covered_step_is_run_by_the_matrix(self):
        sources = workflow_contract._workflow_sources()
        workflow_contract.validate_preflight_coverage(sources)
        for label, (_job, lines) in release_preflight.COVERAGE.items():
            for line in lines:
                with self.subTest(label=label, line=line):
                    mutated = dict(sources)
                    pattern = re.compile(r"^.*" + re.escape(line) + r".*\n", re.MULTILINE)
                    self.assertRegex(mutated[TEST_WORKFLOW], pattern)
                    mutated[TEST_WORKFLOW] = pattern.sub("", mutated[TEST_WORKFLOW])
                    with self.assertRaisesRegex(
                        workflow_contract.WorkflowContractError, "skipped in CI|frontend job"
                    ):
                        workflow_contract.validate_preflight_coverage(mutated)

    def test_the_build_line_is_the_one_the_frontend_gate_contract_expects(self):
        sources = dict(workflow_contract._workflow_sources())
        line = "run: npx tsc -b && npx vite build\n"
        self.assertIn(line, sources[TEST_WORKFLOW])
        sources[TEST_WORKFLOW] = sources[TEST_WORKFLOW].replace(line, "run: npx vite build\n")
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "build script"):
            workflow_contract.validate_preflight_coverage(sources)

    def test_a_line_is_not_matched_by_a_longer_command(self):
        sources = dict(workflow_contract._workflow_sources())
        line = "run: npx vitest run\n"
        self.assertIn(line, sources[TEST_WORKFLOW])
        sources[TEST_WORKFLOW] = sources[TEST_WORKFLOW].replace(
            line, "run: npx vitest run--passWithNoTests\n"
        )
        with self.assertRaisesRegex(workflow_contract.WorkflowContractError, "npx vitest run"):
            workflow_contract.validate_preflight_coverage(sources)

    def test_a_label_without_a_required_job_fails(self):
        sources = workflow_contract._workflow_sources()
        for name, coverage, error in (
            (
                "job outside the matrix",
                {"Backend suite": ("ghost", ("run: echo",))},
                "does not require",
            ),
            ("no covering line", {"Backend suite": ("backend", ())}, "names no covering line"),
        ):
            with (
                self.subTest(name=name),
                self.assertRaisesRegex(workflow_contract.WorkflowContractError, error),
            ):
                workflow_contract.validate_preflight_coverage(sources, coverage)

    def test_package_scripts_must_match_what_the_matrix_runs(self):
        sources = workflow_contract._workflow_sources()
        package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        for name, script, value, error in (
            ("unit suite differs", "test", "vitest run --passWithNoTests", "vitest run"),
            ("formatting left out of check", "check", "npm run check:contracts", "check:format"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "tools" / "dev").mkdir(parents=True)
                shutil.copy(REPO_ROOT / "tools/dev/run-check.mjs", root / "tools/dev")
                scripts = {**package["scripts"], script: value}
                (root / "package.json").write_text(
                    json.dumps({**package, "scripts": scripts}), encoding="utf-8"
                )
                with (
                    patch.object(workflow_contract, "REPO_ROOT", root),
                    self.assertRaisesRegex(workflow_contract.WorkflowContractError, error),
                ):
                    workflow_contract.validate_preflight_coverage(sources)


WRITING_DATA_PIN: dict[str, Any] = {
    "version": "2026.11.03",
    "url": (
        "https://github.com/Tim3399/quiltor/releases/download/"
        "writing-data-2026.11.03/writing-2026.11.03.sqlite3.gz"
    ),
    "sha256": "ab" * 32,
    "bytes": 6,
    "content_sha256": "cd" * 32,
    "license": "CC BY-SA 4.0",
}


def _own_repository() -> str:
    match = re.search(
        r'^Homepage = "https://github\.com/([^/"]+/[^/"]+)"$',
        (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    assert match is not None, "pyproject.toml names no GitHub homepage"
    return match.group(1)


def assert_writing_data_pin(data: dict[str, Any] | None) -> None:
    """The offline half of the pinned-data check: a set pin is complete and points home."""

    if data is None:
        return
    missing = {"version", "url", "sha256", "bytes", "content_sha256", "license"} - set(data)
    assert not missing, f"writing data pin is missing {sorted(missing)}"
    prefix = f"https://github.com/{_own_repository()}/releases/download/writing-data-"
    assert str(data["url"]).startswith(prefix), f"writing data url must start with {prefix}"
    for field in ("sha256", "content_sha256"):
        assert re.fullmatch(r"[0-9a-f]{64}", str(data[field])), f"{field} is not 64 hex digits"
    assert isinstance(data["bytes"], int) and data["bytes"] > 0, "bytes must be positive"
    assert isinstance(data["license"], str) and data["license"].strip(), "license is not set"


class WritingDataReleaseContractTests(unittest.TestCase):
    """T-88 D4: the app release refers to the pinned writing data without carrying it."""

    def test_registry_pin_is_none_or_complete(self):
        assert_writing_data_pin(release_manifest.pinned_writing_data())

    def test_pin_contract_refuses_incomplete_or_foreign_pins(self):
        assert_writing_data_pin(WRITING_DATA_PIN)
        foreign = WRITING_DATA_PIN["url"].replace("Tim3399/quiltor", "someone/else")
        cases = {
            "license missing": {k: v for k, v in WRITING_DATA_PIN.items() if k != "license"},
            "license empty": {**WRITING_DATA_PIN, "license": " "},
            "foreign repository": {**WRITING_DATA_PIN, "url": foreign},
            "app release tag": {
                **WRITING_DATA_PIN,
                "url": WRITING_DATA_PIN["url"].replace("writing-data-2026.11.03", "v3.25.0"),
            },
            "short sha256": {**WRITING_DATA_PIN, "sha256": "a" * 63},
        }
        for name, data in cases.items():
            with self.subTest(name=name), self.assertRaises(AssertionError):
                assert_writing_data_pin(data)

    def test_none_pin_gives_no_data_assets(self):
        self.assertEqual(release_manifest.data_asset_records(None), [])

    def _manifest(self, root: Path, data: dict[str, Any] | None) -> Path:
        artifact_root = root / "artifacts"
        manifest: dict[str, Any] = release_manifest.create(
            "3.3.1",
            "a" * 40,
            ReleaseManifestTests._images(),
            ReleaseManifestTests._artifacts(artifact_root),
            data=data,
        )
        ReleaseManifestTests._attest_signatures(manifest, artifact_root)
        path = artifact_root / "release-manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def test_manifest_carries_the_pin_and_verify_refuses_a_wrong_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._manifest(Path(directory), WRITING_DATA_PIN)
            manifest = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["schemaVersion"], 7)
            self.assertEqual(
                manifest["dataAssets"],
                [
                    {
                        "name": "writing-2026.11.03.sqlite3.gz",
                        "url": WRITING_DATA_PIN["url"],
                        "sha256": WRITING_DATA_PIN["sha256"],
                        "bytes": 6,
                    }
                ],
            )
            release_manifest.verify(path, path.parent, "a" * 40, data=WRITING_DATA_PIN)
            manifest["dataAssets"][0]["sha256"] = "ef" * 32
            path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(release_manifest.ManifestError, "canonical"):
                release_manifest.verify(path, path.parent, "a" * 40, data=WRITING_DATA_PIN)

    def test_verify_refuses_a_manifest_built_against_another_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._manifest(Path(directory), WRITING_DATA_PIN)
            with self.assertRaisesRegex(release_manifest.ManifestError, "canonical"):
                release_manifest.verify(path, path.parent, "a" * 40, data=None)

    def test_files_lists_no_data_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._manifest(Path(directory), WRITING_DATA_PIN)
            manifest = json.loads(path.read_text(encoding="utf-8"))
            output = io.StringIO()
            with (
                patch.object(
                    release_manifest, "pinned_writing_data", return_value=WRITING_DATA_PIN
                ),
                contextlib.redirect_stdout(output),
            ):
                status = release_manifest.main(["files", "--manifest", str(path)])
            self.assertEqual(status, 0)
            listed = output.getvalue().splitlines()
            self.assertEqual(
                listed,
                [item["name"] for item in manifest["artifacts"]]
                + [item["record"] for item in manifest["signatures"]],
            )
            self.assertNotIn("writing-2026.11.03.sqlite3.gz", listed)

    def test_registry_pin_is_read_without_importing_the_application(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "registry.py"
            registry.write_text(
                "DATA: Final[DataRelease | None] = " + repr(WRITING_DATA_PIN) + "\n",
                encoding="utf-8",
            )
            self.assertEqual(release_manifest.pinned_writing_data(registry), WRITING_DATA_PIN)
            registry.write_text("DATA = None\n", encoding="utf-8")
            self.assertIsNone(release_manifest.pinned_writing_data(registry))
            registry.write_text("OTHER = None\n", encoding="utf-8")
            with self.assertRaisesRegex(release_manifest.ManifestError, "no DATA pin"):
                release_manifest.pinned_writing_data(registry)


class _FakeResponse:
    def __init__(self, status: int, body: bytes, length: str | None):
        self.status = status
        self.headers = {} if length is None else {"Content-Length": length}
        self._body = io.BytesIO(body)

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class PinnedWritingDataPreflightTests(unittest.TestCase):
    """The preflight check behind the pin: not in COVERAGE, so it runs in every scope."""

    BODY = b"sqlite"

    def pin(self, body: bytes = BODY) -> dict[str, Any]:
        return {
            **WRITING_DATA_PIN,
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
        }

    def run_check(self, data, responses) -> str:
        output = io.StringIO()
        with (
            patch.object(release_preflight.urllib.request, "urlopen", side_effect=responses),
            contextlib.redirect_stdout(output),
        ):
            release_preflight._check_pinned_writing_data(data)
        return output.getvalue()

    def test_no_pin_says_so_and_touches_no_network(self):
        output = self.run_check(None, AssertionError("network used without a pin"))
        self.assertIn("no writing data pinned", output)

    def test_published_asset_with_matching_bytes_passes(self):
        output = self.run_check(
            self.pin(),
            [_FakeResponse(200, b"", str(len(self.BODY))), _FakeResponse(200, self.BODY, None)],
        )
        self.assertIn("sha256 matches", output)

    def test_wrong_length_or_digest_or_status_fails(self):
        cases = {
            "status": [_FakeResponse(404, b"", "6")],
            "length": [_FakeResponse(200, b"", "7")],
            "no length": [_FakeResponse(200, b"", None)],
            "digest": [_FakeResponse(200, b"", "6"), _FakeResponse(200, b"SQLITE", None)],
        }
        for name, responses in cases.items():
            with (
                self.subTest(name=name),
                self.assertRaisesRegex(release_preflight.PreflightError, "Pinned writing data"),
            ):
                self.run_check(self.pin(), responses)

    def test_check_is_not_part_of_the_matrix_coverage(self):
        self.assertNotIn(release_preflight.WRITING_DATA_LABEL, release_preflight.COVERAGE)
        self.assertEqual(len(release_preflight.COVERAGE), 10)


class ReleaseNotesStartTests(unittest.TestCase):
    """F-88-5 point 5: generated app notes start at the previous app tag, never a data tag."""

    @staticmethod
    def _release(tag: str, **extra: Any) -> dict[str, Any]:
        return {"tag_name": tag, "draft": False, "prerelease": False, **extra}

    def test_previous_app_tag_skips_data_releases_and_newer_versions(self):
        releases = [
            self._release("v3.24.0"),
            self._release("writing-data-2026.11.03"),
            self._release("v3.23.1"),
            self._release("v3.26.0", draft=True),
        ]
        self.assertEqual(
            previous_release.notes_start_tag("3.25.0", releases, ["writing-data-2026.11.04"]),
            "v3.24.0",
        )
        self.assertEqual(
            previous_release.notes_start_tag("3.25.0", [self._release("v3.25.0")], ["v3.24.0"]),
            "v3.24.0",
        )
        self.assertIsNone(
            previous_release.notes_start_tag("3.25.0", [self._release("writing-data-2026.11.03")])
        )

    def test_writing_data_tags_never_enter_stable_history(self):
        self.assertEqual(
            previous_release.stable_history_versions(
                [self._release("writing-data-2026.11.03")], ["writing-data-2026.11.03"]
            ),
            set(),
        )

    def test_publisher_passes_the_previous_app_tag_to_generated_notes(self):
        publish = PUBLISH_WORKFLOW.read_text(encoding="utf-8")
        self.assertEqual(publish.count("--generate-notes"), 1)
        self.assertIn("NOTES=(--generate-notes)", publish)
        self.assertIn('[ -z "$START" ] || NOTES+=(--notes-start-tag "$START")', publish)
        self.assertIn('--notes-start-tag --current-version "$VERSION")"', publish)
        self.assertIn('--title "v$VERSION" "${NOTES[@]}" --draft "${ASSETS[@]}"', publish)


EXAMPLE_WORLD_SOURCE = REPO_ROOT / "src/quiltor/resources/example_world"


def _wheel_names() -> dict[str, bytes]:
    """Every member a built wheel holds, as the build would pack it.

    The example world is taken from its directory, not from the allowlist, so a file that
    lands there without an allowlist entry shows up the way it would in a real wheel. Its
    documents carry their real bytes; everything else is empty, which the payload check
    does not read.
    """
    source = REPO_ROOT / "src/quiltor"
    members: dict[str, bytes] = {
        f"quiltor/{name}": b""
        for name in artifact_profile._source_files(source)
        if name.endswith((".py", ".pyi"))
    }
    for name in artifact_profile.FIXED_RESOURCE_SOURCES:
        if not name.startswith("example_world/"):
            members[f"quiltor/resources/{name}"] = b""
    for item in sorted(EXAMPLE_WORLD_SOURCE.iterdir()):
        members[f"quiltor/resources/example_world/{item.name}"] = item.read_bytes()
    for name in artifact_profile._source_files(REPO_ROOT / "dist"):
        members[f"quiltor/resources/web/{name}"] = b""
    for name in artifact_profile._source_files(REPO_ROOT / "distribution/assets/icons"):
        members[f"quiltor/resources/icons/{name}"] = b""
    members["quiltor/VERSION"] = b""
    members["quiltor/infrastructure/platform/quiltor-build-profile.json"] = b""
    for name in ("METADATA", "WHEEL", "entry_points.txt", "licenses/LICENSE", "RECORD"):
        members[f"quiltor-1.dist-info/{name}"] = b""
    return members


def _write_wheel(directory: str, members: dict[str, bytes]) -> Path:
    wheel = Path(directory) / "quiltor-1-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return wheel


class ShippedExampleWorldTests(unittest.TestCase):
    """The package carries the example world: both languages and the map, the base world
    only, and nothing else from tests/world/ (T-214-4).

    `artifact_profile.py pkg-dist` runs these checks on the built wheel and sdist in the
    release workflow; here they run on an archive laid out the same way.
    """

    def test_the_wheel_carries_both_documents_and_the_map(self):
        with tempfile.TemporaryDirectory() as directory:
            wheel = _write_wheel(directory, _wheel_names())
            artifact_profile._verify_wheel_payload(wheel)
            artifact_profile._verify_example_world(wheel, artifact_profile.RESOURCE_PREFIX)

    def test_the_shipped_documents_carry_no_id_of_the_check_part(self):
        # The real files as they are checked in: a ship built with the check part fails here.
        for name in ("de.json", "en.json"):
            with self.subTest(document=name):
                text = (EXAMPLE_WORLD_SOURCE / name).read_text(encoding="utf-8")
                self.assertIsNone(artifact_profile.CHECK_PART_ID.search(text))

    def test_a_check_part_id_in_the_wheel_is_refused(self):
        for leaked in ('"x-cluster-1"', '"item-x-note"', '"chapter:x-long"'):
            with self.subTest(id=leaked), tempfile.TemporaryDirectory() as directory:
                members = _wheel_names()
                document = "quiltor/resources/example_world/de.json"
                members[document] = members[document].replace(b'"nordhafen"', leaked.encode(), 1)
                self.assertIn(leaked.encode(), members[document])
                wheel = _write_wheel(directory, members)
                with self.assertRaisesRegex(artifact_profile.ProfileError, "check part"):
                    artifact_profile._verify_example_world(wheel, artifact_profile.RESOURCE_PREFIX)

    def test_a_test_world_file_in_the_wheel_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            members = _wheel_names()
            members["quiltor/resources/example_world/ids.generated.ts"] = b"export {};"
            wheel = _write_wheel(directory, members)
            with self.assertRaisesRegex(artifact_profile.ProfileError, "allowlist drift"):
                artifact_profile._verify_wheel_payload(wheel)

    def test_a_missing_or_foreign_document_is_refused(self):
        cases = {
            "does not ship": lambda members: members.pop("quiltor/resources/example_world/en.json"),
            "unreadable": lambda members: members.update(
                {"quiltor/resources/example_world/en.json": b"{"}
            ),
            "format": lambda members: members.update(
                {"quiltor/resources/example_world/en.json": b'{"format": "other"}'}
            ),
        }
        for message, change in cases.items():
            with self.subTest(case=message), tempfile.TemporaryDirectory() as directory:
                members = _wheel_names()
                change(members)
                wheel = _write_wheel(directory, members)
                with self.assertRaisesRegex(artifact_profile.ProfileError, message):
                    artifact_profile._verify_example_world(wheel, artifact_profile.RESOURCE_PREFIX)

    def test_the_release_check_runs_the_rule_on_wheel_and_sdist(self):
        """`verify_archive` is what `pkg-dist` calls; the other checks are stood in for."""
        leaked = (
            (EXAMPLE_WORLD_SOURCE / "de.json").read_bytes().replace(b'"nordhafen"', b'"x-leak"', 1)
        )
        clean = (EXAMPLE_WORLD_SOURCE / "en.json").read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            wheel = Path(directory) / "quiltor-1-py3-none-any.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr("quiltor/resources/example_world/de.json", leaked)
                archive.writestr("quiltor/resources/example_world/en.json", clean)
            sdist = Path(directory) / "quiltor-1.tar.gz"
            with tarfile.open(sdist, "w:gz") as archive:
                for name, data in (("de.json", leaked), ("en.json", clean)):
                    info = tarfile.TarInfo(f"quiltor-1/src/quiltor/resources/example_world/{name}")
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
            stand_ins = (
                patch.object(artifact_profile, "_archive_document", return_value={}),
                patch.object(artifact_profile, "expected_document", return_value={}),
                patch.object(artifact_profile, "_archive_mcp_contract", return_value={}),
                patch.object(artifact_profile, "expected_mcp_contract", return_value={}),
                patch.object(artifact_profile, "_verify_wheel_payload"),
                patch.object(artifact_profile, "_verify_sdist_payload"),
                patch.object(artifact_profile, "_verify_wheel_oidc_dependency"),
            )
            with contextlib.ExitStack() as stack:
                for stand_in in stand_ins:
                    stack.enter_context(stand_in)
                for artifact in (wheel, sdist):
                    with (
                        self.subTest(artifact=artifact.name),
                        self.assertRaisesRegex(artifact_profile.ProfileError, "check part"),
                    ):
                        artifact_profile.verify_archive(artifact)

    def test_the_sdist_is_held_to_the_same_rule(self):
        for leak in (False, True):
            with self.subTest(leak=leak), tempfile.TemporaryDirectory() as directory:
                sdist = Path(directory) / "quiltor-1.tar.gz"
                with tarfile.open(sdist, "w:gz") as archive:
                    for name in ("de.json", "en.json"):
                        data = (EXAMPLE_WORLD_SOURCE / name).read_bytes()
                        if leak and name == "en.json":
                            data = data.replace(b'"nordhafen"', b'"x-leak"', 1)
                        info = tarfile.TarInfo(
                            f"quiltor-1/src/quiltor/resources/example_world/{name}"
                        )
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
                if leak:
                    with self.assertRaisesRegex(artifact_profile.ProfileError, "check part"):
                        artifact_profile._verify_example_world(
                            sdist, "quiltor-1/src/quiltor/resources/"
                        )
                else:
                    artifact_profile._verify_example_world(
                        sdist, "quiltor-1/src/quiltor/resources/"
                    )


if __name__ == "__main__":
    unittest.main()
