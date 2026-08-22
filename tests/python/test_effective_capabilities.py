from __future__ import annotations

import io
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from quiltor.application.capabilities import (
    FREE_LOCAL_PRODUCT,
    Feature,
    FeatureAvailability,
    StaticCapabilitySource,
)
from quiltor.bootstrap import build_feature_availability
from quiltor.application.backups import BackupAuthorization
from quiltor.application.observability import Diagnostics, Metrics, StructuredLogger
from quiltor.infrastructure.commerce import FreeLocalEntitlementProvider
from quiltor.infrastructure.backup.adapters import HttpRemoteBackupGateway
from quiltor.infrastructure.inference.engine import LocalInferenceEngine
from quiltor.infrastructure.observability import (
    InMemoryMetrics,
    RuntimeDiagnostics,
    StdlibStructuredLogger,
)
from quiltor.infrastructure.persistence.writing_assistance import (
    SQLiteWritingAssistanceRepository,
)
from quiltor.infrastructure.platform.feature_availability import HostCapabilitySource
from quiltor.infrastructure.platform.runtime_target import (
    Architecture,
    BuildProfile,
    DistributionChannel,
    DistributionConstraints,
    HostKind,
    PlatformKind,
    ProcessRole,
    ReleaseChannel,
    RuntimeTarget,
)
from quiltor.modules.commerce.contract import Entitlement, EntitlementState
from quiltor.modules.assistant.ports import InferenceUnavailableError


class _Entitlements:
    def __init__(self, state: EntitlementState = EntitlementState.ACTIVE) -> None:
        self.state = state
        self.requested: list[str] = []

    def entitlement(self, product_id: str) -> Entitlement:
        self.requested.append(product_id)
        return Entitlement(product_id, self.state, "test")


class EffectiveCapabilityTests(unittest.TestCase):
    def _service(
        self,
        *,
        host: bool = True,
        platform: bool = True,
        distribution: bool = True,
        entitlement: EntitlementState = EntitlementState.ACTIVE,
    ) -> tuple[FeatureAvailability, _Entitlements]:
        provider = _Entitlements(entitlement)
        feature = Feature.LOCAL_INFERENCE
        return (
            FeatureAvailability(
                host=StaticCapabilitySource({feature: host}, axis="host"),
                platform=StaticCapabilitySource({feature: platform}, axis="platform"),
                distribution=StaticCapabilitySource({feature: distribution}, axis="distribution"),
                entitlements=provider,
            ),
            provider,
        )

    def test_every_axis_can_independently_disable_a_feature(self) -> None:
        for axis in ("host", "platform", "distribution"):
            with self.subTest(axis=axis):
                values = {"host": True, "platform": True, "distribution": True}
                values[axis] = False
                service, _ = self._service(**values)
                result = service.evaluate(Feature.LOCAL_INFERENCE)
                self.assertFalse(result.available)
                self.assertTrue(any(axis in reason for reason in result.reasons))

    def test_entitlement_provider_is_injected_and_part_of_the_intersection(self) -> None:
        service, provider = self._service(entitlement=EntitlementState.INACTIVE)
        result = service.evaluate(Feature.LOCAL_INFERENCE)
        self.assertFalse(result.available)
        self.assertEqual(provider.requested, [FREE_LOCAL_PRODUCT])
        self.assertIn("entitlement", result.reasons[0])

    def test_all_axes_allow_the_feature(self) -> None:
        service, _ = self._service()
        self.assertTrue(service.is_available(Feature.LOCAL_INFERENCE))

    def test_default_provider_is_explicitly_free_and_local_only(self) -> None:
        provider = FreeLocalEntitlementProvider()
        self.assertEqual(provider.entitlement(FREE_LOCAL_PRODUCT).state, EntitlementState.ACTIVE)
        self.assertEqual(provider.entitlement("quiltor.pro").state, EntitlementState.INACTIVE)

    def test_inference_adapter_enforces_the_central_decision(self) -> None:
        service, _ = self._service(host=False)
        with (
            tempfile.TemporaryDirectory() as directory,
            patch("quiltor.infrastructure.inference.engine.select.start_runtime") as start,
            patch("quiltor.infrastructure.inference.engine.check_health") as health,
        ):
            path = Path(directory)
            engine = LocalInferenceEngine(path, path, service)
            status = engine.status()

        self.assertFalse(status["available"])
        self.assertIn("host", status["reason"])
        start.assert_not_called()
        health.assert_not_called()
        with self.assertRaises(InferenceUnavailableError):
            engine.invoke({})

    def test_remote_backup_adapter_enforces_the_central_decision_before_network(self) -> None:
        feature = Feature.REMOTE_BACKUP
        capabilities = FeatureAvailability(
            host=StaticCapabilitySource({feature: False}, axis="host"),
            platform=StaticCapabilitySource(),
            distribution=StaticCapabilitySource(),
            entitlements=FreeLocalEntitlementProvider(),
        )
        gateway = HttpRemoteBackupGateway("https://backup.test", capabilities)
        authorization = BackupAuthorization("https://backup.test", "secret")
        with patch("quiltor.infrastructure.backup.adapters.remote.worlds") as request:
            with self.assertRaises(PermissionError):
                gateway.worlds("https://backup.test", authorization)
        request.assert_not_called()

    def test_process_roles_are_explicit_capability_inputs(self) -> None:
        expectations = {
            ProcessRole.DESKTOP: {
                Feature.ARBITRARY_FILE_ACCESS: True,
                Feature.REMOTE_BACKUP: True,
            },
            ProcessRole.CLI: {
                Feature.CODE_DOWNLOAD: True,
                Feature.REMOTE_BACKUP: True,
            },
            ProcessRole.WEB: {
                Feature.ARBITRARY_FILE_ACCESS: False,
                Feature.REMOTE_BACKUP: True,
            },
            ProcessRole.MCP: {
                Feature.ARBITRARY_FILE_ACCESS: False,
                Feature.REMOTE_BACKUP: False,
            },
            ProcessRole.MOBILE: {
                Feature.ARBITRARY_FILE_ACCESS: False,
                Feature.LOCAL_INFERENCE: False,
            },
        }
        for role, features in expectations.items():
            source = HostCapabilitySource(
                HostKind.MOBILE if role is ProcessRole.MOBILE else HostKind.DESKTOP,
                role,
            )
            for feature, expected in features.items():
                with self.subTest(role=role, feature=feature):
                    self.assertEqual(source.availability(feature).allowed, expected)

    def test_runtime_platform_is_the_platform_axis_source(self) -> None:
        profile = BuildProfile(
            schema_version=1,
            identifier="test-direct",
            host=HostKind.DESKTOP,
            platform=PlatformKind.WINDOWS,
            architecture=Architecture.X86_64,
            distribution=DistributionChannel.DIRECT,
            release_channel=ReleaseChannel.STABLE,
            update_provider="direct",
            constraints=DistributionConstraints(
                sandboxed=False,
                allows_code_download=True,
                allows_external_process=True,
                allows_self_update=True,
                allows_arbitrary_file_access=True,
                allows_background_execution=True,
            ),
        )
        target = RuntimeTarget(
            host=HostKind.DESKTOP,
            process_role=ProcessRole.DESKTOP,
            platform=PlatformKind.IOS,
            architecture=Architecture.ARM64,
            distribution=DistributionChannel.DIRECT,
            release_channel=ReleaseChannel.STABLE,
            frozen=True,
        )

        result = build_feature_availability(profile=profile, target=target).evaluate(
            Feature.LOCAL_INFERENCE
        )

        self.assertFalse(result.available)
        self.assertFalse(result.platform.allowed)
        self.assertIn("platform ios", result.platform.reason)


class ObservabilityTests(unittest.TestCase):
    def test_stdlib_logger_emits_one_structured_json_event(self) -> None:
        stream = io.StringIO()
        logger = StdlibStructuredLogger("quiltor.test.observability", stream)
        logger.event("warning", "test.event", count=2)
        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["event"], "test.event")
        self.assertEqual(payload["level"], "warning")
        self.assertEqual(payload["count"], 2)

    def test_adapters_implement_the_small_observability_ports(self) -> None:
        logger = StdlibStructuredLogger("quiltor.test.observability.ports", io.StringIO())
        diagnostics = RuntimeDiagnostics({"host": "test"})
        metrics = InMemoryMetrics()

        self.assertIsInstance(logger, StructuredLogger)
        self.assertIsInstance(diagnostics, Diagnostics)
        self.assertIsInstance(metrics, Metrics)
        self.assertEqual(diagnostics.snapshot(), {"host": "test"})

        metrics.increment("requests", route="status")
        metrics.observe("latency", 1.25, route="status")
        metrics.observe("latency", 0.75, route="status")
        snapshot = metrics.snapshot()
        self.assertEqual(
            snapshot["counters"],
            [{"name": "requests", "labels": {"route": "status"}, "value": 1}],
        )
        self.assertEqual(
            snapshot["observations"],
            [
                {
                    "name": "latency",
                    "labels": {"route": "status"},
                    "count": 2,
                    "sum": 2.0,
                    "minimum": 0.75,
                    "maximum": 1.25,
                }
            ],
        )
        # Diagnostics are deliberately suitable for direct JSON responses: no
        # tuple keys or adapter-private values leak through the host boundary.
        json.dumps(snapshot)


class WritingAssistanceMigrationTests(unittest.TestCase):
    def test_legacy_data_directory_moves_to_the_named_capability(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            legacy = data / "language"
            legacy.mkdir()
            (legacy / "writing.sqlite3").write_bytes(b"legacy")
            repository = SQLiteWritingAssistanceRepository(data)
            self.assertEqual(repository.path.read_bytes(), b"legacy")
            self.assertFalse(legacy.exists())
            self.assertEqual(repository.path.parent.name, "writing-assistance")

    def test_legacy_symlink_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
            data = Path(folder)
            try:
                (data / "language").symlink_to(Path(outside), target_is_directory=True)
            except OSError:
                self.skipTest("directory symlinks are unavailable on this platform")
            with self.assertRaises(ValueError):
                SQLiteWritingAssistanceRepository(data)

    def test_legacy_database_symlink_is_refused_before_directory_move(self) -> None:
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
            data = Path(folder)
            legacy = data / "language"
            legacy.mkdir()
            external = Path(outside) / "writing.sqlite3"
            external.write_bytes(b"outside")
            try:
                (legacy / "writing.sqlite3").symlink_to(external)
            except OSError:
                self.skipTest("file symlinks are unavailable on this platform")
            with self.assertRaises(ValueError):
                SQLiteWritingAssistanceRepository(data)
            self.assertEqual(external.read_bytes(), b"outside")

    def test_all_legacy_artifacts_including_languagetool_are_migrated(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            legacy = data / "language"
            language_tool = legacy / "LanguageTool-6.6"
            language_tool.mkdir(parents=True)
            (language_tool / "languagetool-server.jar").write_bytes(b"jar")
            (legacy / "custom-dictionary.txt").write_text("Quiltor", encoding="utf-8")
            target = data / "writing-assistance"
            target.mkdir()
            (target / "writing.sqlite3").write_bytes(b"current")

            repository = SQLiteWritingAssistanceRepository(data)

            self.assertEqual(repository.path.read_bytes(), b"current")
            self.assertEqual(
                (repository.directory / "LanguageTool-6.6/languagetool-server.jar").read_bytes(),
                b"jar",
            )
            self.assertEqual(
                (repository.directory / "custom-dictionary.txt").read_text(encoding="utf-8"),
                "Quiltor",
            )
            self.assertFalse(legacy.exists())

    def test_differing_collision_keeps_current_and_preserves_legacy_by_digest(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            legacy = data / "language"
            target = data / "writing-assistance"
            legacy.mkdir()
            target.mkdir()
            (legacy / "writing.sqlite3").write_bytes(b"legacy")
            (target / "writing.sqlite3").write_bytes(b"current")

            repository = SQLiteWritingAssistanceRepository(data)

            self.assertEqual(repository.path.read_bytes(), b"current")
            conflicts = list((target / ".legacy-import-conflicts").glob("writing.sqlite3.legacy-*"))
            self.assertEqual(len(conflicts), 1)
            self.assertEqual(conflicts[0].read_bytes(), b"legacy")
            SQLiteWritingAssistanceRepository(data)
            self.assertEqual(len(list(conflicts[0].parent.iterdir())), 1)

    def test_concurrent_initialization_performs_one_idempotent_migration(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            legacy = data / "language"
            legacy.mkdir()
            (legacy / "writing.sqlite3").write_bytes(b"legacy")

            with ThreadPoolExecutor(max_workers=8) as executor:
                paths = list(
                    executor.map(
                        lambda _index: SQLiteWritingAssistanceRepository(data).path,
                        range(24),
                    )
                )

            self.assertEqual(set(paths), {data / "writing-assistance/writing.sqlite3"})
            self.assertEqual(paths[0].read_bytes(), b"legacy")
            self.assertFalse(legacy.exists())


if __name__ == "__main__":
    unittest.main()
