"""Runtime-target adapters for the central feature-availability service."""

from __future__ import annotations

from quiltor.application.capabilities import AxisAvailability, Feature
from quiltor.infrastructure.platform.runtime_target import (
    BuildProfile,
    HostKind,
    PlatformKind,
    ProcessRole,
)


class HostCapabilitySource:
    def __init__(self, host: HostKind, process_role: ProcessRole | None = None) -> None:
        self.host = host
        self.process_role = process_role

    def availability(self, feature: Feature) -> AxisAvailability:
        unsupported = {
            HostKind.MOBILE: {
                Feature.CODE_DOWNLOAD,
                Feature.EXTERNAL_PROCESS,
                Feature.LOCAL_INFERENCE,
                Feature.WRITING_ASSISTANCE_GRAMMAR,
                Feature.SELF_UPDATE,
            },
        }.get(self.host, set())
        role_unsupported = {
            ProcessRole.MCP: {
                Feature.ARBITRARY_FILE_ACCESS,
                Feature.BACKGROUND_EXECUTION,
                Feature.CODE_DOWNLOAD,
                Feature.LOCAL_INFERENCE,
                Feature.REMOTE_BACKUP,
                Feature.SELF_UPDATE,
                Feature.WRITING_ASSISTANCE_GRAMMAR,
            },
            ProcessRole.WEB: {Feature.ARBITRARY_FILE_ACCESS},
            ProcessRole.SERVER: {Feature.ARBITRARY_FILE_ACCESS},
            ProcessRole.MOBILE: {
                Feature.ARBITRARY_FILE_ACCESS,
                Feature.CODE_DOWNLOAD,
                Feature.EXTERNAL_PROCESS,
                Feature.LOCAL_INFERENCE,
                Feature.SELF_UPDATE,
                Feature.WRITING_ASSISTANCE_GRAMMAR,
            },
        }.get(self.process_role, set())
        unsupported = unsupported | role_unsupported
        allowed = feature not in unsupported
        role = f"/{self.process_role.value}" if self.process_role else ""
        return AxisAvailability(
            allowed,
            "" if allowed else f"host {self.host.value}{role} disallows {feature.value}",
        )


class PlatformCapabilitySource:
    def __init__(self, platform: PlatformKind) -> None:
        self.platform = platform

    def availability(self, feature: Feature) -> AxisAvailability:
        unsupported = {
            PlatformKind.IOS: {
                Feature.CODE_DOWNLOAD,
                Feature.EXTERNAL_PROCESS,
                Feature.LOCAL_INFERENCE,
                Feature.WRITING_ASSISTANCE_GRAMMAR,
                Feature.SELF_UPDATE,
            },
            PlatformKind.ANDROID: {
                Feature.EXTERNAL_PROCESS,
                Feature.LOCAL_INFERENCE,
                Feature.WRITING_ASSISTANCE_GRAMMAR,
                Feature.SELF_UPDATE,
            },
            PlatformKind.WEB: {
                Feature.CODE_DOWNLOAD,
                Feature.EXTERNAL_PROCESS,
                Feature.LOCAL_INFERENCE,
                Feature.WRITING_ASSISTANCE_GRAMMAR,
                Feature.ARBITRARY_FILE_ACCESS,
                Feature.SELF_UPDATE,
            },
        }.get(self.platform, set())
        allowed = feature not in unsupported
        return AxisAvailability(
            allowed, "" if allowed else f"platform {self.platform.value} disallows {feature.value}"
        )


class DistributionCapabilitySource:
    def __init__(self, profile: BuildProfile) -> None:
        self.profile = profile

    def availability(self, feature: Feature) -> AxisAvailability:
        constraints = self.profile.constraints
        mapping = {
            Feature.CODE_DOWNLOAD: constraints.allows_code_download,
            Feature.EXTERNAL_PROCESS: constraints.allows_external_process,
            Feature.SELF_UPDATE: constraints.allows_self_update,
            Feature.ARBITRARY_FILE_ACCESS: constraints.allows_arbitrary_file_access,
            Feature.BACKGROUND_EXECUTION: constraints.allows_background_execution,
            Feature.LOCAL_INFERENCE: constraints.allows_external_process,
            Feature.WRITING_ASSISTANCE_GRAMMAR: (
                constraints.allows_code_download and constraints.allows_external_process
            ),
            Feature.REMOTE_BACKUP: True,
        }
        allowed = mapping[feature]
        return AxisAvailability(
            allowed,
            "" if allowed else f"distribution {self.profile.identifier} disallows {feature.value}",
        )


__all__ = [
    "DistributionCapabilitySource",
    "HostCapabilitySource",
    "PlatformCapabilitySource",
]
