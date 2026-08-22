"""Runtime identity and distribution constraints loaded from a build manifest.

The operating system answers what machine is running.  It does not answer how
the application was distributed, what a store permits, or which host is in
control.  Those decisions are build inputs and travel with the artifact in
``quiltor-build-profile.json``.

For source checkouts ``QUILTOR_BUILD_PROFILE`` may contain either a JSON object
or a path to one. Packaged artifacts embed the same contract.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

from quiltor.infrastructure.platform import system

PROFILE_ENV = "QUILTOR_BUILD_PROFILE"
HOST_ENV = "QUILTOR_RUNTIME_HOST"
EMBEDDED_PROFILE = Path(__file__).with_name("quiltor-build-profile.json")


class HostKind(str, Enum):
    DESKTOP = "desktop"
    MOBILE = "mobile"
    WEB = "web"
    PYTHON = "python"


class ProcessRole(str, Enum):
    """What the current process does inside its build host."""

    SERVER = "server"
    DESKTOP = "desktop"
    CLI = "cli"
    MCP = "mcp"
    MOBILE = "mobile"
    WEB = "web"


class PlatformKind(str, Enum):
    MACOS = "macos"
    WINDOWS = "windows"
    LINUX = "linux"
    IOS = "ios"
    ANDROID = "android"
    WEB = "web"
    ANY = "any"


class Architecture(str, Enum):
    ARM64 = "arm64"
    X86_64 = "x86_64"
    UNIVERSAL = "universal"
    WASM = "wasm"
    PLATFORM_INDEPENDENT = "platform-independent"


class DistributionChannel(str, Enum):
    DIRECT = "direct"
    APP_STORE = "app-store"
    MICROSOFT_STORE = "microsoft-store"
    GOOGLE_PLAY = "google-play"
    SELF_HOSTED = "self-hosted"
    PYTHON_PACKAGE = "python-package"


class ReleaseChannel(str, Enum):
    """Audience stream, independent from the publication destination."""

    STABLE = "stable"
    BETA = "beta"
    NIGHTLY = "nightly"
    TESTFLIGHT = "testflight"
    PLAY_INTERNAL = "play-internal"
    STORE_PRODUCTION = "store-production"


STORE_CHANNELS = frozenset(
    {
        DistributionChannel.APP_STORE,
        DistributionChannel.MICROSOFT_STORE,
        DistributionChannel.GOOGLE_PLAY,
    }
)


@dataclass(frozen=True, slots=True)
class DistributionConstraints:
    sandboxed: bool
    allows_code_download: bool
    allows_external_process: bool
    allows_self_update: bool
    allows_arbitrary_file_access: bool
    allows_background_execution: bool


@dataclass(frozen=True, slots=True)
class BuildProfile:
    schema_version: int
    identifier: str
    host: HostKind
    platform: PlatformKind
    architecture: Architecture
    distribution: DistributionChannel
    release_channel: ReleaseChannel
    update_provider: str
    constraints: DistributionConstraints


@dataclass(frozen=True, slots=True)
class RuntimeTarget:
    host: HostKind
    process_role: ProcessRole
    platform: PlatformKind
    architecture: Architecture
    distribution: DistributionChannel
    release_channel: ReleaseChannel
    frozen: bool


def _machine_platform() -> PlatformKind:
    try:
        return PlatformKind(system.os_name())
    except ValueError as exc:
        raise RuntimeError(f"Unsupported runtime platform: {system.os_name()}") from exc


def _machine_architecture() -> Architecture:
    value = system.machine_arch()
    if value == "x64":
        value = "x86_64"
    try:
        return Architecture(value)
    except ValueError as exc:
        raise RuntimeError(f"Unsupported runtime architecture: {value}") from exc


def _read_source(source: str) -> Mapping[str, Any]:
    candidate = source.strip()
    if candidate.startswith("{"):
        parsed = json.loads(candidate)
    else:
        parsed = json.loads(Path(candidate).expanduser().read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Build profile must be a JSON object.")
    return parsed


def _value(mapping: Mapping[str, Any], key: str, expected: type) -> Any:
    value = mapping.get(key)
    if not isinstance(value, expected):
        raise ValueError(f"Build profile field {key!r} must be {expected.__name__}.")
    return value


def parse_profile(document: Mapping[str, Any]) -> BuildProfile:
    version = _value(document, "schemaVersion", int)
    if version != 1:
        raise ValueError(f"Unsupported build-profile schema version: {version}")
    identifier = _value(document, "id", str).strip()
    if not identifier:
        raise ValueError("Build profile id must not be empty.")

    raw_platform = _value(document, "platform", str)
    platform = _machine_platform() if raw_platform == "auto" else PlatformKind(raw_platform)
    raw_architecture = _value(document, "architecture", str)
    architecture = (
        _machine_architecture() if raw_architecture == "auto" else Architecture(raw_architecture)
    )
    host_value = _value(document, "host", str)
    constraints = _value(document, "constraints", dict)
    required_constraints = {
        "sandboxed",
        "allowsCodeDownload",
        "allowsExternalProcess",
        "allowsSelfUpdate",
        "allowsArbitraryFileAccess",
        "allowsBackgroundExecution",
    }
    missing = sorted(required_constraints - constraints.keys())
    if missing:
        raise ValueError(f"Build profile constraints are missing: {', '.join(missing)}")
    for key in required_constraints:
        if not isinstance(constraints[key], bool):
            raise ValueError(f"Build profile constraint {key!r} must be bool.")

    return BuildProfile(
        schema_version=version,
        identifier=identifier,
        host=HostKind(host_value),
        platform=platform,
        architecture=architecture,
        distribution=DistributionChannel(_value(document, "distribution", str)),
        release_channel=ReleaseChannel(_value(document, "releaseChannel", str)),
        update_provider=_value(document, "updateProvider", str),
        constraints=DistributionConstraints(
            sandboxed=constraints["sandboxed"],
            allows_code_download=constraints["allowsCodeDownload"],
            allows_external_process=constraints["allowsExternalProcess"],
            allows_self_update=constraints["allowsSelfUpdate"],
            allows_arbitrary_file_access=constraints["allowsArbitraryFileAccess"],
            allows_background_execution=constraints["allowsBackgroundExecution"],
        ),
    )


def current_profile() -> BuildProfile:
    explicit = os.environ.get(PROFILE_ENV, "").strip()
    if explicit:
        return parse_profile(_read_source(explicit))
    embedded = EMBEDDED_PROFILE
    if not embedded.exists():
        # PyInstaller one-file and alternative loaders may keep module metadata
        # outside the extraction root even though ``datas`` landed correctly.
        import sys

        bundle = getattr(sys, "_MEIPASS", None)
        if bundle:
            candidate = Path(bundle) / "quiltor" / "infrastructure" / "platform" / embedded.name
            if candidate.exists():
                embedded = candidate
    return parse_profile(_read_source(str(embedded)))


def target_for_profile(
    profile: BuildProfile,
    *,
    process_role: ProcessRole | None = None,
    frozen: bool | None = None,
) -> RuntimeTarget:
    """Resolve an artifact contract into the process actually executing it.

    ``any`` and ``platform-independent`` describe portable artifacts, not a
    fictional operating system.  Capabilities must therefore use the concrete
    machine after installation.  Likewise, a self-hosted web artifact executes
    a server process on Linux; its browser surface is not the execution role.
    """

    import sys

    return RuntimeTarget(
        host=profile.host,
        process_role=(
            process_role
            or ProcessRole(
                os.environ.get(HOST_ENV, "").strip()
                or {
                    HostKind.DESKTOP: ProcessRole.DESKTOP.value,
                    HostKind.MOBILE: ProcessRole.MOBILE.value,
                    HostKind.WEB: ProcessRole.SERVER.value,
                    HostKind.PYTHON: ProcessRole.SERVER.value,
                }[profile.host]
            )
        ),
        platform=(
            _machine_platform() if profile.platform is PlatformKind.ANY else profile.platform
        ),
        architecture=(
            _machine_architecture()
            if profile.architecture in {Architecture.PLATFORM_INDEPENDENT, Architecture.UNIVERSAL}
            else profile.architecture
        ),
        distribution=profile.distribution,
        release_channel=profile.release_channel,
        frozen=bool(getattr(sys, "frozen", False)) if frozen is None else frozen,
    )


def current_target() -> RuntimeTarget:
    return target_for_profile(current_profile())


def constraints() -> DistributionConstraints:
    return current_profile().constraints


def is_store_distribution() -> bool:
    return current_profile().distribution in STORE_CHANNELS


__all__ = [
    "Architecture",
    "BuildProfile",
    "DistributionChannel",
    "DistributionConstraints",
    "HostKind",
    "PlatformKind",
    "ProcessRole",
    "ReleaseChannel",
    "RuntimeTarget",
    "constraints",
    "current_profile",
    "current_target",
    "is_store_distribution",
    "parse_profile",
    "target_for_profile",
]
