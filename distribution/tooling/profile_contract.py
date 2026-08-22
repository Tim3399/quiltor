#!/usr/bin/env python3
"""Validate distribution targets and materialise the runtime build contract.

The profiles are the source of truth for packaging, runtime constraints and
publication.  This module intentionally uses only the standard library: profile
validation must run before installing the project or any build dependencies.
"""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import sys
import tomllib
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DISTRIBUTION_ROOT = REPO_ROOT / "distribution"
PROFILE_ROOT = DISTRIBUTION_ROOT / "profiles"
CONTRACT_ROOT = DISTRIBUTION_ROOT / "contracts"
BUILD_ROOT = DISTRIBUTION_ROOT / ".build"

EXPECTED_PROFILES = {
    "android-play",
    "ios-app-store",
    "linux-direct",
    "macos-app-store",
    "macos-direct",
    "python-package",
    "web-self-hosted",
    "windows-direct",
    "windows-store",
}

HOSTS = {"desktop", "mobile", "web", "python"}
PLATFORMS = {"macos", "windows", "linux", "ios", "android", "web", "any"}
DISTRIBUTIONS = {
    "direct",
    "app-store",
    "microsoft-store",
    "google-play",
    "self-hosted",
    "python-package",
}
ARCHITECTURES = {"arm64", "x86_64", "universal", "wasm", "platform-independent"}
ARTIFACTS = {
    "dmg",
    "pkg",
    "exe-installer",
    "msix",
    "ipa",
    "aab",
    "appimage",
    "oci-image",
    "wheel-sdist",
}
SANDBOXES = {
    "none",
    "app-sandbox",
    "package-identity",
    "mobile-sandbox",
    "container",
    "python-environment",
}
SIGNING = {
    "developer-id",
    "apple-distribution",
    "authenticode",
    "store-managed",
    "container-provenance",
    "release-manifest",
    "package-provenance",
}
UPDATE_PROVIDERS = {
    "github-release",
    "app-store",
    "microsoft-store",
    "google-play",
    "deployment",
    "python-index",
}
PUBLICATION_CHANNELS = {
    "github-release",
    "app-store",
    "microsoft-store",
    "google-play",
    "oci-registry",
    "python-index",
}
RELEASE_CHANNELS = {
    "stable",
    "beta",
    "nightly",
    "testflight",
    "play-internal",
    "store-production",
}
ROLLOUT_TRACKS = {"public", "staged", "internal", "external-testing"}


class ProfileError(ValueError):
    """A profile or its referenced release input is inconsistent."""


def _object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProfileError(f"{field} must be an object")
    return value


def _exact_keys(value: dict[str, Any], expected: set[str], field: str) -> None:
    actual = set(value)
    missing = expected - actual
    extra = actual - expected
    if missing:
        raise ProfileError(f"{field} is missing: {', '.join(sorted(missing))}")
    if extra:
        raise ProfileError(f"{field} contains unknown fields: {', '.join(sorted(extra))}")


def _enum(value: Any, allowed: set[str], field: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ProfileError(f"{field} must be one of: {', '.join(sorted(allowed))}")
    return value


def _optional_string(value: Any, field: str) -> str | None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise ProfileError(f"{field} must be a non-empty string or null")
    return value


def _repo_path(relative: str, field: str, *, must_exist: bool = True) -> Path:
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ProfileError(f"{field} must stay inside the repository: {relative!r}")
    resolved = (REPO_ROOT / candidate).resolve()
    try:
        resolved.relative_to(REPO_ROOT.resolve())
    except ValueError as error:
        raise ProfileError(f"{field} escapes the repository: {relative!r}") from error
    if must_exist and not resolved.exists():
        raise ProfileError(f"{field} does not exist: {relative}")
    return resolved


def load_profile(profile_id: str, repo_root: Path = REPO_ROOT) -> dict[str, Any]:
    path = repo_root / "distribution" / "profiles" / f"{profile_id}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ProfileError(f"unknown distribution profile: {profile_id}") from error
    except json.JSONDecodeError as error:
        raise ProfileError(f"{path.relative_to(repo_root)} is not valid JSON: {error}") from error
    return _object(data, profile_id)


def validate_profile(profile: dict[str, Any], path: Path | None = None) -> None:
    """Validate one profile, including the cross-field rules JSON Schema cannot express."""

    _exact_keys(
        profile,
        {
            "$schema",
            "contractVersion",
            "id",
            "product",
            "target",
            "build",
            "security",
            "capabilities",
            "updates",
            "release",
            "publication",
        },
        "profile",
    )
    if profile["$schema"] != "../contracts/build-profile.schema.json":
        raise ProfileError("profile.$schema must reference the repository build-profile contract")
    if profile["contractVersion"] != 1:
        raise ProfileError("profile.contractVersion must be 1")
    profile_id = profile["id"]
    if not isinstance(profile_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", profile_id):
        raise ProfileError("profile.id must be lowercase kebab-case")
    if path is not None and path.stem != profile_id:
        raise ProfileError(f"{path.name} declares id {profile_id!r}")

    product = _object(profile["product"], "product")
    _exact_keys(product, {"name", "applicationId"}, "product")
    if product["name"] != "Quiltor":
        raise ProfileError("product.name must be Quiltor")
    if not isinstance(product["applicationId"], str) or not re.fullmatch(
        r"[A-Za-z0-9]+(?:[.-][A-Za-z0-9-]+)+", product["applicationId"]
    ):
        raise ProfileError("product.applicationId must be a reverse-DNS identifier")

    target = _object(profile["target"], "target")
    _exact_keys(target, {"host", "platform", "distribution", "architectures"}, "target")
    host = _enum(target["host"], HOSTS, "target.host")
    platform = _enum(target["platform"], PLATFORMS, "target.platform")
    distribution = _enum(target["distribution"], DISTRIBUTIONS, "target.distribution")
    architectures = target["architectures"]
    if (
        not isinstance(architectures, list)
        or not architectures
        or len(set(architectures)) != len(architectures)
    ):
        raise ProfileError("target.architectures must be a non-empty unique list")
    for architecture in architectures:
        _enum(architecture, ARCHITECTURES, "target.architectures[]")

    expected_target = {
        "macos-direct": ("desktop", "macos", "direct"),
        "macos-app-store": ("desktop", "macos", "app-store"),
        "windows-direct": ("desktop", "windows", "direct"),
        "windows-store": ("desktop", "windows", "microsoft-store"),
        "linux-direct": ("desktop", "linux", "direct"),
        "ios-app-store": ("mobile", "ios", "app-store"),
        "android-play": ("mobile", "android", "google-play"),
        "web-self-hosted": ("web", "linux", "self-hosted"),
        "python-package": ("python", "any", "python-package"),
    }.get(profile_id)
    if expected_target is not None and (host, platform, distribution) != expected_target:
        raise ProfileError(f"{profile_id} has an inconsistent host/platform/distribution tuple")

    build = _object(profile["build"], "build")
    _exact_keys(
        build,
        {"status", "artifact", "entrypoint", "smokeEntrypoint", "outputPattern"},
        "build",
    )
    status = _enum(build["status"], {"supported", "scaffold"}, "build.status")
    _enum(build["artifact"], ARTIFACTS, "build.artifact")
    entrypoint = _optional_string(build["entrypoint"], "build.entrypoint")
    smoke_entrypoint = _optional_string(build["smokeEntrypoint"], "build.smokeEntrypoint")
    output_pattern = _optional_string(build["outputPattern"], "build.outputPattern")
    if status == "supported":
        if entrypoint is None or output_pattern is None:
            raise ProfileError("a supported build needs an entrypoint and outputPattern")
        _repo_path(entrypoint, "build.entrypoint")
        if "{version}" not in output_pattern:
            raise ProfileError("a supported build.outputPattern must contain {version}")
        if distribution == "direct":
            if smoke_entrypoint is None:
                raise ProfileError("a supported direct build needs a native smokeEntrypoint")
            _repo_path(smoke_entrypoint, "build.smokeEntrypoint")
        elif smoke_entrypoint is not None:
            raise ProfileError("only supported direct builds may declare a smokeEntrypoint")
    elif entrypoint is not None or smoke_entrypoint is not None or output_pattern is not None:
        raise ProfileError(
            "a scaffold must not pretend to have build, smoke or artifact entrypoints"
        )

    security = _object(profile["security"], "security")
    _exact_keys(security, {"sandbox", "signing", "entitlements"}, "security")
    sandbox = _enum(security["sandbox"], SANDBOXES, "security.sandbox")
    _enum(security["signing"], SIGNING, "security.signing")
    entitlements = _optional_string(security["entitlements"], "security.entitlements")
    if entitlements:
        entitlement_path = _repo_path(entitlements, "security.entitlements")
        try:
            values = plistlib.loads(entitlement_path.read_bytes())
        except Exception as error:
            raise ProfileError(
                f"security.entitlements is not a valid plist: {entitlements}"
            ) from error
        sandbox_entitlement = values.get("com.apple.security.app-sandbox") is True
        if sandbox == "app-sandbox" and not sandbox_entitlement:
            raise ProfileError("an app-sandbox profile must enable the App Sandbox entitlement")
        if sandbox == "none" and sandbox_entitlement:
            raise ProfileError(
                "a non-sandboxed profile must not enable the App Sandbox entitlement"
            )
    elif sandbox == "app-sandbox":
        raise ProfileError("an app-sandbox profile needs an entitlement file")

    capabilities = _object(profile["capabilities"], "capabilities")
    _exact_keys(
        capabilities,
        {"externalProcess", "codeDownload", "arbitraryFilesystem", "backgroundExecution"},
        "capabilities",
    )
    for name, value in capabilities.items():
        if not isinstance(value, bool):
            raise ProfileError(f"capabilities.{name} must be boolean")
    if distribution in {"app-store", "google-play"} and capabilities["codeDownload"]:
        raise ProfileError(f"{distribution} profiles may not download executable code")
    if distribution in {"app-store", "google-play"} and capabilities["externalProcess"]:
        raise ProfileError(
            f"{distribution} profiles may not launch executables outside the signed bundle"
        )
    if platform in {"ios", "android"} and capabilities["externalProcess"]:
        raise ProfileError(f"{platform} profiles may not launch external processes")

    updates = _object(profile["updates"], "updates")
    _exact_keys(updates, {"provider"}, "updates")
    _enum(updates["provider"], UPDATE_PROVIDERS, "updates.provider")

    release = _object(profile["release"], "release")
    _exact_keys(release, {"channel", "rolloutTrack"}, "release")
    release_channel = _enum(release["channel"], RELEASE_CHANNELS, "release.channel")
    rollout_track = _enum(release["rolloutTrack"], ROLLOUT_TRACKS, "release.rolloutTrack")

    publication = _object(profile["publication"], "publication")
    _exact_keys(publication, {"status", "channel", "storeListing"}, "publication")
    publication_status = _enum(
        publication["status"], {"supported", "scaffold"}, "publication.status"
    )
    _enum(publication["channel"], PUBLICATION_CHANNELS, "publication.channel")
    listing = _optional_string(publication["storeListing"], "publication.storeListing")
    if publication_status != status:
        raise ProfileError("build.status and publication.status must advance together")
    if publication["channel"] in {"app-store", "microsoft-store", "google-play"}:
        if listing is None:
            raise ProfileError("store publication needs a storeListing directory")
        _repo_path(listing, "publication.storeListing")
    elif listing is not None:
        raise ProfileError("non-store publication must not declare a storeListing")

    if profile_id == "python-package" and (
        updates["provider"] != "github-release" or publication["channel"] != "github-release"
    ):
        raise ProfileError(
            "python-package is published and updated through GitHub Release until a "
            "Python-index publication workflow exists"
        )

    release_destinations = {
        "testflight": {"app-store"},
        "play-internal": {"google-play"},
        "store-production": {"app-store", "microsoft-store", "google-play"},
    }
    allowed_destinations = release_destinations.get(release_channel)
    if allowed_destinations and publication["channel"] not in allowed_destinations:
        raise ProfileError(
            f"release.channel {release_channel} cannot publish to {publication['channel']}"
        )
    if release_channel in {"testflight", "play-internal"} and rollout_track not in {
        "internal",
        "external-testing",
    }:
        raise ProfileError(f"release.channel {release_channel} needs a testing rollout track")


def _validate_contract_documents(repo_root: Path = REPO_ROOT) -> None:
    for name in ("build-profile.schema.json", "embedded-build-profile.schema.json"):
        path = repo_root / "distribution" / "contracts" / name
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ProfileError(f"invalid contract document {path}: {error}") from error
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            raise ProfileError(f"{name} must declare JSON Schema 2020-12")
        if schema.get("additionalProperties") is not False:
            raise ProfileError(f"{name} must reject unknown top-level fields")


def validate_all(repo_root: Path = REPO_ROOT) -> list[dict[str, Any]]:
    _validate_contract_documents(repo_root)
    profile_root = repo_root / "distribution" / "profiles"
    paths = sorted(profile_root.glob("*.json"))
    ids = {path.stem for path in paths}
    missing = EXPECTED_PROFILES - ids
    if missing:
        raise ProfileError(
            "distribution profile set is incomplete: missing " + ", ".join(sorted(missing))
        )

    profiles: list[dict[str, Any]] = []
    target_keys: set[tuple[str, str, str]] = set()
    listing_owners: dict[str, str] = {}
    for path in paths:
        try:
            profile = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ProfileError(f"{path.relative_to(repo_root)} is invalid JSON: {error}") from error
        validate_profile(_object(profile, path.name), path)
        key = (
            profile["target"]["host"],
            profile["target"]["platform"],
            profile["target"]["distribution"],
        )
        if key in target_keys:
            raise ProfileError(f"multiple profiles declare target {key}")
        target_keys.add(key)
        listing = profile["publication"]["storeListing"]
        if listing is not None:
            previous_owner = listing_owners.get(listing)
            if previous_owner is not None:
                raise ProfileError(
                    f"store listing {listing} is shared by {previous_owner} and {profile['id']}"
                )
            listing_owners[listing] = profile["id"]
        profiles.append(profile)
    expected_apple_roots = {
        "macos-app-store": "distribution/store-listings/apple/macos",
        "ios-app-store": "distribution/store-listings/apple/ios",
    }
    actual_apple_roots = {
        profile["id"]: profile["publication"]["storeListing"]
        for profile in profiles
        if profile["id"] in expected_apple_roots
    }
    if actual_apple_roots != expected_apple_roots:
        raise ProfileError("macOS and iOS must own distinct target-specific Apple listing roots")
    return profiles


def validate_version_alignment(repo_root: Path = REPO_ROOT) -> str:
    version = (repo_root / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ProfileError(f"VERSION is not semantic major.minor.patch: {version!r}")
    package = json.loads((repo_root / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((repo_root / "package-lock.json").read_text(encoding="utf-8"))
    cargo = tomllib.loads((repo_root / "Cargo.toml").read_text(encoding="utf-8"))
    cargo_lock = tomllib.loads((repo_root / "Cargo.lock").read_text(encoding="utf-8"))
    workspace_version = cargo.get("workspace", {}).get("package", {}).get("version")
    local_crates = {
        package.get("name"): package.get("version")
        for package in cargo_lock.get("package", [])
        if package.get("name") in {"quiltor-core", "quiltor-ffi"}
    }
    copies = {
        "VERSION": version,
        "package.json": package.get("version"),
        "package-lock.json": lock.get("version"),
        "package-lock.json packages root": lock.get("packages", {}).get("", {}).get("version"),
        "Cargo.toml workspace": workspace_version,
        "Cargo.lock quiltor-core": local_crates.get("quiltor-core"),
        "Cargo.lock quiltor-ffi": local_crates.get("quiltor-ffi"),
    }
    if set(copies.values()) != {version}:
        details = ", ".join(f"{name}={value!r}" for name, value in copies.items())
        raise ProfileError("release version drift: " + details)
    return version


def runtime_contract(profile: dict[str, Any], architecture: str | None = None) -> dict[str, Any]:
    validate_profile(profile)
    supported_architectures = profile["target"]["architectures"]
    selected_architecture = architecture or os.environ.get("QUILTOR_TARGET_ARCH", "").strip()
    if not selected_architecture:
        selected_architecture = supported_architectures[0]
    if selected_architecture not in supported_architectures:
        raise ProfileError(
            f"{profile['id']} does not support architecture {selected_architecture!r}; "
            f"expected one of {', '.join(supported_architectures)}"
        )
    capabilities = profile["capabilities"]
    update_provider = profile["updates"]["provider"]
    return {
        "schemaVersion": 1,
        "id": profile["id"],
        "host": profile["target"]["host"],
        "platform": profile["target"]["platform"],
        "architecture": selected_architecture,
        "distribution": profile["target"]["distribution"],
        "releaseChannel": profile["release"]["channel"],
        "updateProvider": update_provider,
        "constraints": {
            "sandboxed": profile["security"]["sandbox"] not in {"none", "python-environment"},
            "allowsCodeDownload": capabilities["codeDownload"],
            "allowsExternalProcess": capabilities["externalProcess"],
            "allowsSelfUpdate": update_provider == "github-release",
            "allowsArbitraryFileAccess": capabilities["arbitraryFilesystem"],
            "allowsBackgroundExecution": capabilities["backgroundExecution"],
        },
    }


def materialize_profile(
    profile_id: str,
    output: Path | None = None,
    *,
    repo_root: Path = REPO_ROOT,
    architecture: str | None = None,
) -> Path:
    profile = load_profile(profile_id, repo_root)
    validate_profile(profile, repo_root / "distribution" / "profiles" / f"{profile_id}.json")
    contract = runtime_contract(profile, architecture)
    target = output or (
        repo_root / "distribution" / ".build" / profile_id / "quiltor-build-profile.json"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(contract, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate and materialise Quiltor build profiles")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="validate every profile or selected IDs")
    validate.add_argument("profiles", nargs="*")
    materialize = commands.add_parser("materialize", help="write the runtime build contract")
    materialize.add_argument("profile")
    materialize.add_argument("--architecture")
    materialize.add_argument("--output", type=Path)
    commands.add_parser("check-release", help="validate profiles and all version copies")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "validate":
            if not args.profiles:
                profiles = validate_all()
            else:
                profiles = []
                for profile_id in args.profiles:
                    profile = load_profile(profile_id)
                    validate_profile(profile, PROFILE_ROOT / f"{profile_id}.json")
                    profiles.append(profile)
            for profile in profiles:
                print(f"valid: {profile['id']} ({profile['build']['status']})")
        elif args.command == "materialize":
            target = materialize_profile(args.profile, args.output, architecture=args.architecture)
            print(target)
        else:
            profiles = validate_all()
            version = validate_version_alignment()
            print(f"valid: {len(profiles)} distribution profiles for Quiltor {version}")
    except ProfileError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
