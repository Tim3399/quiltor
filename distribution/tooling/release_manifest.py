#!/usr/bin/env python3
"""Create and verify the immutable build-to-publication hand-off."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Mapping
from pathlib import Path

from dependency_lock_contract import for_profile as dependency_locks_for_profile
from dependency_lock_contract import records as dependency_lock_records

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_PUBLISHED_PROFILES = ("python-package", "web-self-hosted")
PROFILE_ORDER = ("macos-direct", "python-package", "web-self-hosted", "windows-direct")
NATIVE_TARGET_SPECS = (
    {
        "output": "macos_direct",
        "profile": "macos-direct",
        "marker": "distribution/release-targets/macos-direct.enabled",
        "artifact": "Quiltor-{version}.dmg",
        "scheme": "developer-id",
        "requiresNotarization": True,
    },
    {
        "output": "windows_direct",
        "profile": "windows-direct",
        "marker": "distribution/release-targets/windows-direct.enabled",
        "artifact": "Quiltor-Setup-{version}.exe",
        "scheme": "authenticode",
        "requiresNotarization": False,
    },
)
BASE_ARTIFACT_SPECS = (
    ("quiltor-{version}-py3-none-any.whl", "python-package"),
    ("quiltor-{version}.tar.gz", "python-package"),
)
IMAGE_SPECS = (
    {
        "input": "web-self-hosted",
        "name": "web-self-hosted",
        "role": "application",
        "artifactContract": "distribution/profiles/web-self-hosted.json",
    },
    {
        "input": "backup-service",
        "name": "backup-service",
        "role": "backup-service",
        "artifactContract": "services/backup-server/artifact-contract.json",
    },
)


class ManifestError(ValueError):
    pass


def native_targets(repo_root: Path = REPO_ROOT) -> dict[str, bool]:
    """Return the account-backed native release targets enabled by committed markers."""

    return {
        specification["output"]: (repo_root / specification["marker"]).is_file()
        for specification in NATIVE_TARGET_SPECS
    }


def _published_profiles(repo_root: Path) -> list[str]:
    enabled = native_targets(repo_root)
    profiles = set(BASE_PUBLISHED_PROFILES)
    profiles.update(
        specification["profile"]
        for specification in NATIVE_TARGET_SPECS
        if enabled[specification["output"]]
    )
    return [profile for profile in PROFILE_ORDER if profile in profiles]


def _validate_identity(version: str, source_revision: str) -> None:
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ManifestError(f"invalid release version: {version!r}")
    if not isinstance(source_revision, str) or not re.fullmatch(r"[0-9a-f]{40}", source_revision):
        raise ManifestError("source revision must be a full lowercase Git SHA")


def _parse_image_reference(name: str, reference: object) -> tuple[str, str]:
    if not isinstance(reference, str) or not re.fullmatch(
        r"ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}", reference
    ):
        raise ManifestError(f"{name} image must be an immutable GHCR digest reference")
    repository, digest = reference.rsplit("@", 1)
    return repository, digest


def image_records(references: Mapping[str, str]) -> list[dict[str, object]]:
    """Create the only two role-bound OCI records accepted by publication."""

    expected_inputs = {specification["input"] for specification in IMAGE_SPECS}
    if not isinstance(references, Mapping) or set(references) != expected_inputs:
        raise ManifestError(
            "release manifest needs named web-self-hosted and backup-service images"
        )

    parsed = {name: _parse_image_reference(name, references[name]) for name in expected_inputs}
    web_repository, _ = parsed["web-self-hosted"]
    backup_repository, _ = parsed["backup-service"]
    if backup_repository != web_repository + "-backup":
        raise ManifestError(
            "backup-service image repository must be the web repository with '-backup' suffix"
        )

    records = []
    for specification in IMAGE_SPECS:
        input_name = specification["input"]
        _, digest = parsed[input_name]
        contract_path = REPO_ROOT / specification["artifactContract"]
        if not contract_path.is_file():
            raise ManifestError(
                f"image artifact contract is missing: {specification['artifactContract']}"
            )
        records.append(
            {
                "name": specification["name"],
                "role": specification["role"],
                "artifactContract": {
                    "path": specification["artifactContract"],
                    "sha256": _sha256(contract_path),
                },
                "ref": references[input_name],
                "digest": digest,
            }
        )
    return records


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise ManifestError(f"cannot hash release artifact {path}: {error}") from error
    return digest.hexdigest()


def expected_artifacts(version: str, repo_root: Path = REPO_ROOT) -> list[tuple[str, str]]:
    enabled = native_targets(repo_root)
    native = [
        (specification["artifact"], specification["profile"])
        for specification in NATIVE_TARGET_SPECS
        if enabled[specification["output"]]
    ]
    return [
        (name.format(version=version), profile) for name, profile in (*native, *BASE_ARTIFACT_SPECS)
    ]


def _all_signature_specs(version: str) -> list[dict[str, object]]:
    return [
        {
            "artifact": specification["artifact"].format(version=version),
            "record": specification["artifact"].format(version=version) + ".signature.json",
            "profile": specification["profile"],
            "scheme": specification["scheme"],
            "requiresNotarization": specification["requiresNotarization"],
        }
        for specification in NATIVE_TARGET_SPECS
    ]


def signature_specs(version: str, repo_root: Path = REPO_ROOT) -> list[dict[str, object]]:
    """Return the signed-desktop contract publication is allowed to consume."""

    enabled_profiles = set(_published_profiles(repo_root))
    return [
        specification
        for specification in _all_signature_specs(version)
        if specification["profile"] in enabled_profiles
    ]


def _artifact_records(version: str, artifacts: list[Path], repo_root: Path) -> list[dict[str, str]]:
    by_name: dict[str, Path] = {}
    for artifact in artifacts:
        if artifact.name in by_name:
            raise ManifestError(f"duplicate release artifact: {artifact.name}")
        if not artifact.is_file():
            raise ManifestError(f"release artifact is missing: {artifact}")
        by_name[artifact.name] = artifact

    expected = expected_artifacts(version, repo_root)
    expected_names = {name for name, _ in expected}
    actual_names = set(by_name)
    if actual_names != expected_names:
        missing = sorted(expected_names - actual_names)
        unknown = sorted(actual_names - expected_names)
        details = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unknown:
            details.append("unknown " + ", ".join(unknown))
        raise ManifestError("release artifact set is not canonical: " + "; ".join(details))

    return [
        {"name": name, "profile": profile, "sha256": _sha256(by_name[name])}
        for name, profile in expected
    ]


def create(
    version: str,
    source_revision: str,
    images: Mapping[str, str],
    artifacts: list[Path],
    repo_root: Path = REPO_ROOT,
) -> dict[str, object]:
    _validate_identity(version, source_revision)
    image_output = image_records(images)
    artifact_output = _artifact_records(version, artifacts, repo_root)
    return {
        "schemaVersion": 6,
        "version": version,
        "sourceRevision": source_revision,
        "profiles": _published_profiles(repo_root),
        "artifacts": artifact_output,
        "images": image_output,
        "dependencyLocks": dependency_lock_records(),
        "signatures": signature_specs(version, repo_root),
    }


def _canonical_loaded_artifacts(
    version: str, value: object, repo_root: Path
) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise ManifestError("release manifest artifacts must be a list")
    expected = expected_artifacts(version, repo_root)
    if len(value) != len(expected):
        raise ManifestError("release manifest has an incomplete artifact set")
    records: list[dict[str, str]] = []
    for record, (name, profile) in zip(value, expected, strict=True):
        if not isinstance(record, dict) or set(record) != {"name", "profile", "sha256"}:
            raise ManifestError("release manifest artifact record is invalid")
        if record.get("name") != name or record.get("profile") != profile:
            raise ManifestError("release manifest artifact names or profiles are not canonical")
        digest = record.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ManifestError(f"release manifest digest is invalid for {name}")
        records.append({"name": name, "profile": profile, "sha256": digest})
    return records


def _canonical_loaded_images(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list) or len(value) != len(IMAGE_SPECS):
        raise ManifestError("release manifest has an incomplete named image set")
    references: dict[str, str] = {}
    for record, specification in zip(value, IMAGE_SPECS, strict=True):
        expected_fields = {
            "name",
            "role",
            "artifactContract",
            "ref",
            "digest",
        }
        if not isinstance(record, dict) or set(record) != expected_fields:
            raise ManifestError("release manifest image record is invalid")
        for field, expected in (
            ("name", specification["name"]),
            ("role", specification["role"]),
        ):
            if record[field] != expected:
                raise ManifestError(
                    f"release manifest image {field} is not canonical for {specification['name']}"
                )
        contract = record["artifactContract"]
        expected_contract_path = specification["artifactContract"]
        expected_contract = {
            "path": expected_contract_path,
            "sha256": _sha256(REPO_ROOT / expected_contract_path),
        }
        if contract != expected_contract:
            raise ManifestError(
                f"release manifest artifact contract is not canonical for {specification['name']}"
            )
        _, digest = _parse_image_reference(specification["name"], record["ref"])
        if record["digest"] != digest:
            raise ManifestError(
                f"release manifest image digest does not match ref for {specification['name']}"
            )
        references[specification["input"]] = record["ref"]
    canonical = image_records(references)
    if value != canonical:
        raise ManifestError("release manifest image records are not canonical")
    return canonical


def load(path: Path, repo_root: Path = REPO_ROOT) -> dict[str, object]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ManifestError(f"invalid release manifest {path}: {error}") from error
    expected_keys = {
        "schemaVersion",
        "version",
        "sourceRevision",
        "profiles",
        "artifacts",
        "images",
        "dependencyLocks",
        "signatures",
    }
    if not isinstance(manifest, dict) or set(manifest) != expected_keys:
        raise ManifestError("release manifest has missing or unknown fields")
    _validate_identity(manifest["version"], manifest["sourceRevision"])
    images = _canonical_loaded_images(manifest["images"])
    artifacts = _canonical_loaded_artifacts(manifest["version"], manifest["artifacts"], repo_root)
    locks = dependency_lock_records()
    if manifest["dependencyLocks"] != locks:
        raise ManifestError("release manifest dependency locks are not canonical")
    canonical = {
        "schemaVersion": 6,
        "version": manifest["version"],
        "sourceRevision": manifest["sourceRevision"],
        "profiles": _published_profiles(repo_root),
        "artifacts": artifacts,
        "images": images,
        "dependencyLocks": locks,
        "signatures": signature_specs(manifest["version"], repo_root),
    }
    if manifest != canonical:
        raise ManifestError("release manifest does not match the canonical artifact contract")
    return manifest


def attest_signature(
    artifact: Path,
    *,
    version: str,
    source_revision: str,
    profile: str,
    verified: bool,
    notarized: bool,
    output: Path,
) -> dict[str, object]:
    """Record a native signature check performed by the platform build job."""

    _validate_identity(version, source_revision)
    try:
        specification = next(
            item for item in _all_signature_specs(version) if item["profile"] == profile
        )
    except StopIteration as error:
        raise ManifestError(f"profile {profile!r} has no publishable signature contract") from error
    if artifact.name != specification["artifact"]:
        raise ManifestError(
            f"{profile} must attest {specification['artifact']}, not {artifact.name}"
        )
    if not artifact.is_file():
        raise ManifestError(f"signed artifact is missing: {artifact}")
    if not verified:
        raise ManifestError("native signature verification must succeed before attestation")
    if specification["requiresNotarization"] and not notarized:
        raise ManifestError(f"{artifact.name} must be notarized before attestation")

    record = {
        "schemaVersion": 2,
        "version": version,
        "sourceRevision": source_revision,
        "artifact": artifact.name,
        "profile": profile,
        "scheme": specification["scheme"],
        "verified": True,
        "notarized": bool(notarized),
        "sha256": _sha256(artifact),
        "dependencyLocks": dependency_locks_for_profile(profile),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return record


def _verify_signature_records(manifest: dict[str, object], artifact_dir: Path) -> None:
    for specification in manifest["signatures"]:
        artifact = artifact_dir / specification["artifact"]
        record_path = artifact_dir / specification["record"]
        if not artifact.is_file():
            raise ManifestError(f"signed release artifact is missing: {artifact.name}")
        try:
            record = json.loads(record_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ManifestError(
                f"signature record is missing or invalid: {record_path.name}"
            ) from error
        expected = {
            "schemaVersion": 2,
            "version": manifest["version"],
            "sourceRevision": manifest["sourceRevision"],
            "artifact": specification["artifact"],
            "profile": specification["profile"],
            "scheme": specification["scheme"],
            "verified": True,
            "notarized": specification["requiresNotarization"],
            "sha256": _sha256(artifact),
            "dependencyLocks": dependency_locks_for_profile(specification["profile"]),
        }
        if record != expected:
            raise ManifestError(
                f"signature status or digest is invalid for {specification['artifact']}"
            )


def verify(
    path: Path,
    artifact_dir: Path,
    expected_revision: str | None = None,
    repo_root: Path = REPO_ROOT,
) -> dict[str, object]:
    manifest = load(path, repo_root)
    if expected_revision and manifest["sourceRevision"] != expected_revision:
        raise ManifestError(
            f"manifest revision {manifest['sourceRevision']} does not match {expected_revision}"
        )
    for record in manifest["artifacts"]:
        artifact = artifact_dir / record["name"]
        if not artifact.is_file():
            raise ManifestError(f"release artifact is missing: {record['name']}")
        if _sha256(artifact) != record["sha256"]:
            raise ManifestError(f"release artifact digest is invalid: {record['name']}")
    _verify_signature_records(manifest, artifact_dir)
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create_command = commands.add_parser("create")
    create_command.add_argument("--version", required=True)
    create_command.add_argument("--source-revision", required=True)
    create_command.add_argument("--web-image", required=True)
    create_command.add_argument("--backup-image", required=True)
    create_command.add_argument("--artifact", action="append", type=Path, required=True)
    create_command.add_argument("--output", type=Path, required=True)
    verify_command = commands.add_parser("verify")
    verify_command.add_argument("--manifest", type=Path, required=True)
    verify_command.add_argument("--artifact-dir", type=Path, required=True)
    verify_command.add_argument("--source-revision")
    attest_command = commands.add_parser(
        "attest-signature", help="record a successful native signature verification"
    )
    attest_command.add_argument("--artifact", type=Path, required=True)
    attest_command.add_argument("--version", required=True)
    attest_command.add_argument("--source-revision", required=True)
    attest_command.add_argument("--profile", required=True)
    attest_command.add_argument("--verified", action="store_true")
    attest_command.add_argument("--notarized", action="store_true")
    attest_command.add_argument("--output", type=Path, required=True)
    images_command = commands.add_parser("images")
    images_command.add_argument("--manifest", type=Path, required=True)
    files_command = commands.add_parser("files")
    files_command.add_argument("--manifest", type=Path, required=True)
    commands.add_parser("targets")
    return parser


def main(argv: list[str] | None = None, *, repo_root: Path = REPO_ROOT) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "create":
            manifest = create(
                args.version,
                args.source_revision,
                {
                    "web-self-hosted": args.web_image,
                    "backup-service": args.backup_image,
                },
                args.artifact,
                repo_root,
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        elif args.command == "verify":
            verify(args.manifest, args.artifact_dir, args.source_revision, repo_root)
        elif args.command == "attest-signature":
            attest_signature(
                args.artifact,
                version=args.version,
                source_revision=args.source_revision,
                profile=args.profile,
                verified=args.verified,
                notarized=args.notarized,
                output=args.output,
            )
        elif args.command == "images":
            for image in load(args.manifest, repo_root)["images"]:
                print("\t".join((image["name"], image["role"], image["ref"], image["digest"])))
        elif args.command == "files":
            manifest = load(args.manifest, repo_root)
            for artifact in manifest["artifacts"]:
                print(artifact["name"])
            for signature in manifest["signatures"]:
                print(signature["record"])
        else:
            targets = native_targets(repo_root)
            for specification in NATIVE_TARGET_SPECS:
                output = specification["output"]
                print(f"{output}={str(targets[output]).lower()}")
    except ManifestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
