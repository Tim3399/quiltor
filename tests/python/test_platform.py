"""Build-profile, platform-port and adapter contracts."""

from __future__ import annotations

import ast
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.infrastructure.platform import directories
from quiltor.infrastructure.platform.adapters.credentials import (
    InMemoryCredentialVault,
    RestrictedFileCredentialVault,
    WindowsDpapiCredentialVault,
)
from quiltor.infrastructure.platform.adapters.processes import NativeProcessSupervisor
from quiltor.infrastructure.platform.ports import CredentialVault, ProcessSupervisor
from quiltor.infrastructure.platform.ports.credentials import CredentialVaultError
from quiltor.infrastructure.platform.runtime_target import (
    Architecture,
    DistributionChannel,
    HostKind,
    PlatformKind,
    ProcessRole,
    ReleaseChannel,
    current_profile,
    current_target,
    parse_profile,
    target_for_profile,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def profile_document(**overrides):
    document = {
        "schemaVersion": 1,
        "id": "test-profile",
        "host": "desktop",
        "platform": "windows",
        "architecture": "x86_64",
        "distribution": "direct",
        "releaseChannel": "stable",
        "updateProvider": "direct",
        "constraints": {
            "sandboxed": False,
            "allowsCodeDownload": True,
            "allowsExternalProcess": True,
            "allowsSelfUpdate": True,
            "allowsArbitraryFileAccess": True,
            "allowsBackgroundExecution": True,
        },
    }
    document.update(overrides)
    return document


class BuildProfileTests(unittest.TestCase):
    def test_an_explicit_profile_is_the_distribution_source_of_truth(self):
        document = profile_document(
            distribution="app-store",
            constraints={
                "sandboxed": True,
                "allowsCodeDownload": False,
                "allowsExternalProcess": False,
                "allowsSelfUpdate": False,
                "allowsArbitraryFileAccess": False,
                "allowsBackgroundExecution": False,
            },
        )
        with patch.dict(os.environ, {"QUILTOR_BUILD_PROFILE": json.dumps(document)}, clear=True):
            profile = current_profile()
        self.assertEqual(profile.distribution, DistributionChannel.APP_STORE)
        self.assertTrue(profile.constraints.sandboxed)
        self.assertFalse(profile.constraints.allows_external_process)
        self.assertFalse(profile.constraints.allows_background_execution)

    def test_a_profile_may_be_supplied_as_a_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "profile.json"
            path.write_text(json.dumps(profile_document()), encoding="utf-8")
            with patch.dict(os.environ, {"QUILTOR_BUILD_PROFILE": str(path)}, clear=True):
                self.assertEqual(current_profile().identifier, "test-profile")

    def test_auto_only_resolves_machine_fields_not_distribution_policy(self):
        document = profile_document(platform="auto", architecture="auto")
        with patch(
            "quiltor.infrastructure.platform.runtime_target.system.os_name", return_value="linux"
        ):
            with patch(
                "quiltor.infrastructure.platform.runtime_target.system.machine_arch",
                return_value="arm64",
            ):
                profile = parse_profile(document)
        self.assertEqual(profile.platform, PlatformKind.LINUX)
        self.assertEqual(profile.architecture, Architecture.ARM64)
        self.assertEqual(profile.distribution, DistributionChannel.DIRECT)
        self.assertEqual(profile.release_channel, ReleaseChannel.STABLE)

    def test_the_host_can_be_bound_by_the_composition_root(self):
        with patch.dict(
            os.environ,
            {
                "QUILTOR_BUILD_PROFILE": json.dumps(profile_document()),
                "QUILTOR_RUNTIME_HOST": "mcp",
            },
            clear=True,
        ):
            target = current_target()
            self.assertEqual(target.host, HostKind.DESKTOP)
            self.assertEqual(target.process_role, ProcessRole.MCP)
            self.assertEqual(target.release_channel, ReleaseChannel.STABLE)

    def test_portable_python_artifact_resolves_the_actual_machine_capabilities(self):
        profile = parse_profile(
            profile_document(
                host="python",
                platform="any",
                architecture="platform-independent",
                distribution="python-package",
            )
        )
        with (
            patch(
                "quiltor.infrastructure.platform.runtime_target.system.os_name",
                return_value="linux",
            ),
            patch(
                "quiltor.infrastructure.platform.runtime_target.system.machine_arch",
                return_value="arm64",
            ),
        ):
            target = target_for_profile(profile, frozen=False)
        self.assertEqual(target.platform, PlatformKind.LINUX)
        self.assertEqual(target.architecture, Architecture.ARM64)
        self.assertEqual(target.process_role, ProcessRole.SERVER)

    def test_self_hosted_web_profile_describes_a_server_process_not_a_browser(self):
        profile = parse_profile(
            profile_document(
                host="web",
                platform="linux",
                distribution="self-hosted",
            )
        )
        with patch.dict(os.environ, {}, clear=True):
            target = target_for_profile(profile, frozen=False)
        self.assertEqual(target.process_role, ProcessRole.SERVER)

    def test_source_profile_carries_release_and_background_policy(self):
        source = json.loads(
            (
                REPO_ROOT / "src/quiltor/infrastructure/platform/quiltor-build-profile.json"
            ).read_text(encoding="utf-8")
        )
        profile = parse_profile(source)
        self.assertEqual(profile.release_channel, ReleaseChannel.STABLE)
        self.assertTrue(profile.constraints.allows_background_execution)

    def test_missing_constraints_fail_loudly(self):
        document = profile_document(constraints={"sandboxed": False})
        with self.assertRaisesRegex(ValueError, "missing"):
            parse_profile(document)


class DirectoryTests(unittest.TestCase):
    def test_legacy_home_keeps_durable_paths_while_separating_kinds(self):
        root = Path("somewhere")
        resolved = directories.from_legacy_home(root)
        self.assertEqual(resolved.data, root.resolve() / "data")
        self.assertEqual(resolved.models, root.resolve() / "models")
        self.assertEqual(
            len(
                {
                    resolved.data,
                    resolved.config,
                    resolved.cache,
                    resolved.models,
                    resolved.logs,
                    resolved.temp,
                }
            ),
            6,
        )

    def test_data_override_changes_no_other_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root, data = Path(folder) / "home", Path(folder) / "world-data"
            with patch.dict(
                os.environ,
                {"QUILTOR_HOME": str(root), "QUILTOR_DATA_DIR": str(data)},
                clear=True,
            ):
                resolved = directories.current()
        self.assertEqual(resolved.data, data.resolve())
        self.assertEqual(resolved.models, root.resolve() / "models")


class CredentialVaultTests(unittest.TestCase):
    def test_adapters_satisfy_the_small_port(self):
        with tempfile.TemporaryDirectory() as folder:
            adapters = (
                InMemoryCredentialVault(),
                RestrictedFileCredentialVault(Path(folder) / "credentials.json"),
            )
            for adapter in adapters:
                with self.subTest(adapter=type(adapter).__name__):
                    self.assertIsInstance(adapter, CredentialVault)
                    adapter.write("service", "account", "secret")
                    self.assertEqual(adapter.read("service", "account"), "secret")
                    adapter.delete("service", "account")
                    self.assertIsNone(adapter.read("service", "account"))

    def test_dpapi_file_adapter_persists_only_protected_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "credentials.dpapi"
            vault = WindowsDpapiCredentialVault(path)

            def transform(payload: bytes) -> bytes:
                return bytes(byte ^ 0xA5 for byte in payload)

            with patch.object(vault, "_protect", side_effect=transform):
                with patch.object(vault, "_unprotect", side_effect=transform):
                    vault.write("service", "account", "not-on-disk")
                    self.assertNotIn(b"not-on-disk", path.read_bytes())
                    self.assertEqual(vault.read("service", "account"), "not-on-disk")

    @unittest.skipUnless(os.name == "nt", "DPAPI is a Windows platform service")
    def test_windows_vault_never_writes_the_cleartext_secret(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "credentials.dpapi"
            vault = WindowsDpapiCredentialVault(path)
            try:
                vault.write("service", "account", "not-on-disk")
            except CredentialVaultError as exc:
                self.skipTest(f"this Windows account has no available DPAPI profile: {exc}")
            self.assertNotIn(b"not-on-disk", path.read_bytes())
            self.assertEqual(vault.read("service", "account"), "not-on-disk")


class ProcessSupervisorTests(unittest.TestCase):
    def test_spawn_applies_os_flags_and_binds_lifetime_once(self):
        adapter = NativeProcessSupervisor()
        process = MagicMock()
        with patch(
            "quiltor.infrastructure.platform.adapters.processes.subprocess.Popen",
            return_value=process,
        ) as popen:
            with patch(
                "quiltor.infrastructure.platform.adapters.processes.system.spawn_flags",
                return_value=17,
            ):
                with patch(
                    "quiltor.infrastructure.platform.adapters.processes.system.bind_child_lifetime"
                ) as bind:
                    returned = adapter.spawn(["tool", "--flag"], text=True)
        self.assertIsInstance(adapter, ProcessSupervisor)
        self.assertIs(returned, process)
        self.assertEqual(popen.call_args.kwargs["creationflags"], 17)
        bind.assert_called_once_with(process)


class DependencyBoundaryTests(unittest.TestCase):
    def test_product_code_has_no_legacy_namespace_imports(self):
        offenders = []
        sources = (REPO_ROOT / "src" / "quiltor").rglob("*.py")
        for path in sources:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    names = [node.module]
                for name in names:
                    if name == "backend" or name.startswith("backend."):
                        offenders.append(f"{path.relative_to(REPO_ROOT)}:{node.lineno} {name}")
                    if name == "hosts" or name.startswith("hosts."):
                        offenders.append(f"{path.relative_to(REPO_ROOT)}:{node.lineno} {name}")
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
