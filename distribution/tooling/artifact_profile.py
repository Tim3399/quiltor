#!/usr/bin/env python3
"""Verify the runtime contract embedded in Python release archives."""

from __future__ import annotations

import argparse
import email.parser
import email.policy
import json
import sys
import tarfile
import zipfile
from pathlib import Path

from profile_contract import ProfileError, load_profile, runtime_contract

REPO_ROOT = Path(__file__).resolve().parents[2]
EMBEDDED_SUFFIX = "quiltor/infrastructure/platform/quiltor-build-profile.json"
MCP_CONTRACT_SUFFIX = "quiltor/resources/contracts/mcp/tools.v1.json"
MCP_SOURCE = REPO_ROOT / "contracts/fixtures/mcp/tools.v1.json"
WHEEL_METADATA_SUFFIX = ".dist-info/METADATA"
PYTHON_PACKAGE_PLAYWRIGHT = json.loads(
    (REPO_ROOT / "distribution/toolchains.json").read_text(encoding="utf-8")
)["artifactRuntimes"]["pythonPackage"]["playwright"]
PACKAGE_PREFIX = "quiltor/"
RESOURCE_PREFIX = "quiltor/resources/"
FIXED_RESOURCE_SOURCES = {
    "sidecars/README.md": Path("src/quiltor/resources/sidecars/README.md"),
    "sidecars/pdf/render-book-pdf.mjs": Path(
        "src/quiltor/resources/sidecars/pdf/render-book-pdf.mjs"
    ),
    "sidecars/inference/mlx/bridge.py": Path(
        "src/quiltor/resources/sidecars/inference/mlx/bridge.py"
    ),
    "sidecars/inference/mlx/requirements.lock": Path(
        "src/quiltor/resources/sidecars/inference/mlx/requirements.lock"
    ),
    "contracts/mcp/tools.v1.json": Path("contracts/fixtures/mcp/tools.v1.json"),
    "legal/LICENSE": Path("LICENSE"),
    "legal/THIRD-PARTY-NOTICES.md": Path("THIRD-PARTY-NOTICES.md"),
}
SDIST_FIXED_SOURCES = {
    # Hatch records the VCS ignore file as standard sdist provenance even with
    # ``only-include``.  It is explicit here rather than becoming a wildcard.
    ".gitignore",
    "apps/web/server.py",
    "VERSION",
    "pyproject.toml",
    "README.md",
    "LICENSE",
    "THIRD-PARTY-NOTICES.md",
    "src/quiltor/resources/sidecars/pdf/render-book-pdf.mjs",
    "src/quiltor/resources/sidecars/README.md",
    "src/quiltor/resources/sidecars/inference/mlx/bridge.py",
    "src/quiltor/resources/sidecars/inference/mlx/requirements.lock",
    "distribution/tooling/hatch_build.py",
    "distribution/tooling/profile_contract.py",
    "distribution/profiles/python-package.json",
    "contracts/fixtures/mcp/tools.v1.json",
    "src/quiltor/infrastructure/platform/quiltor-build-profile.json",
    "src/quiltor/resources/contracts/mcp/tools.v1.json",
}


def expected_document(profile_id: str) -> dict[str, object]:
    return runtime_contract(load_profile(profile_id))


def _archive_document(path: Path) -> dict[str, object]:
    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.endswith(EMBEDDED_SUFFIX)]
            if len(names) != 1:
                raise ProfileError(f"{path.name} must contain exactly one embedded build profile")
            payload = archive.read(names[0])
    elif path.name.endswith(".tar.gz"):
        with tarfile.open(path, "r:gz") as archive:
            members = [
                member
                for member in archive.getmembers()
                if member.isfile() and member.name.endswith(EMBEDDED_SUFFIX)
            ]
            if len(members) != 1:
                raise ProfileError(f"{path.name} must contain exactly one embedded build profile")
            extracted = archive.extractfile(members[0])
            if extracted is None:
                raise ProfileError(f"cannot read build profile from {path.name}")
            payload = extracted.read()
    else:
        raise ProfileError(f"unsupported Python package artifact: {path.name}")
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProfileError(f"embedded build profile in {path.name} is invalid JSON") from error
    if not isinstance(document, dict):
        raise ProfileError(f"embedded build profile in {path.name} must be an object")
    return document


def _archive_mcp_contract(path: Path) -> dict[str, object]:
    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.endswith(MCP_CONTRACT_SUFFIX)]
            if len(names) != 1:
                raise ProfileError(f"{path.name} must contain exactly one packaged MCP contract")
            payload = archive.read(names[0])
    elif path.name.endswith(".tar.gz"):
        with tarfile.open(path, "r:gz") as archive:
            members = [
                member
                for member in archive.getmembers()
                if member.isfile() and member.name.endswith(MCP_CONTRACT_SUFFIX)
            ]
            if len(members) != 1:
                raise ProfileError(f"{path.name} must contain exactly one packaged MCP contract")
            extracted = archive.extractfile(members[0])
            if extracted is None:
                raise ProfileError(f"cannot read packaged MCP contract from {path.name}")
            payload = extracted.read()
    else:
        raise ProfileError(f"unsupported Python package artifact: {path.name}")
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProfileError(f"packaged MCP contract in {path.name} is invalid JSON") from error
    if not isinstance(document, dict):
        raise ProfileError(f"packaged MCP contract in {path.name} must be an object")
    return document


def expected_mcp_contract() -> dict[str, object]:
    document = json.loads(MCP_SOURCE.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ProfileError("source MCP contract must be an object")
    return document


def _source_files(root: Path) -> set[str]:
    return {item.relative_to(root).as_posix() for item in root.rglob("*") if item.is_file()}


def _archive_files(path: Path) -> set[str]:
    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if not name.endswith("/")]
    elif path.name.endswith(".tar.gz"):
        with tarfile.open(path, "r:gz") as archive:
            names = [member.name for member in archive.getmembers() if member.isfile()]
    else:  # pragma: no cover - callers already reject unsupported artifacts
        raise ProfileError(f"unsupported Python package artifact: {path.name}")
    if len(names) != len(set(names)):
        raise ProfileError(f"{path.name} contains duplicate archive members")
    return set(names)


def _verify_wheel_payload(path: Path) -> None:
    names = _archive_files(path)
    metadata_files = [name for name in names if name.endswith(WHEEL_METADATA_SUFFIX)]
    if len(metadata_files) != 1:
        raise ProfileError(f"{path.name} must contain exactly one wheel METADATA file")
    dist_info = metadata_files[0].removesuffix("/METADATA")
    resources = {
        name.removeprefix(RESOURCE_PREFIX) for name in names if name.startswith(RESOURCE_PREFIX)
    }
    expected_resources = (
        set(FIXED_RESOURCE_SOURCES)
        | {f"web/{name}" for name in _source_files(MCP_SOURCE.parents[3] / "dist")}
        | {
            f"icons/{name}"
            for name in _source_files(MCP_SOURCE.parents[3] / "distribution/assets/icons")
        }
    )
    if resources != expected_resources:
        raise ProfileError(
            f"{path.name} runtime-resource allowlist drift "
            f"(extra={sorted(resources - expected_resources)}, "
            f"missing={sorted(expected_resources - resources)})"
        )
    if f"{PACKAGE_PREFIX}VERSION" not in names:
        raise ProfileError(f"{path.name} does not contain the packaged VERSION")

    allowed_package_non_python = {
        f"{PACKAGE_PREFIX}VERSION",
        f"{PACKAGE_PREFIX}infrastructure/platform/quiltor-build-profile.json",
        *(f"{RESOURCE_PREFIX}{name}" for name in expected_resources),
    }
    expected_python = {
        f"{PACKAGE_PREFIX}{name}"
        for name in _source_files(MCP_SOURCE.parents[3] / "src/quiltor")
        if name.endswith((".py", ".pyi"))
    }
    expected = (
        expected_python
        | allowed_package_non_python
        | {
            f"{dist_info}/METADATA",
            f"{dist_info}/WHEEL",
            f"{dist_info}/entry_points.txt",
            f"{dist_info}/licenses/LICENSE",
            f"{dist_info}/RECORD",
        }
    )
    if names != expected:
        raise ProfileError(
            f"{path.name} wheel allowlist drift "
            f"(extra={sorted(names - expected)}, missing={sorted(expected - names)})"
        )


def _verify_sdist_payload(path: Path) -> None:
    names = _archive_files(path)
    roots = {name.split("/", 1)[0] for name in names}
    if len(roots) != 1:
        raise ProfileError(f"{path.name} must contain one source-distribution root")
    root = next(iter(roots))
    relative = {name.removeprefix(root + "/") for name in names}

    expected_python = {
        f"src/quiltor/{name}"
        for name in _source_files(MCP_SOURCE.parents[3] / "src/quiltor")
        if name.endswith((".py", ".pyi"))
    }
    expected = (
        expected_python
        | SDIST_FIXED_SOURCES
        | {f"dist/{name}" for name in _source_files(MCP_SOURCE.parents[3] / "dist")}
        | {
            f"distribution/assets/icons/{name}"
            for name in _source_files(MCP_SOURCE.parents[3] / "distribution/assets/icons")
        }
        | {"PKG-INFO"}
    )
    if relative != expected:
        raise ProfileError(
            f"{path.name} source allowlist drift "
            f"(extra={sorted(relative - expected)}, missing={sorted(expected - relative)})"
        )


def _verify_wheel_oidc_dependency(path: Path) -> None:
    if path.suffix != ".whl":
        return
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.endswith(WHEEL_METADATA_SUFFIX)]
        if len(names) != 1:
            raise ProfileError(f"{path.name} must contain exactly one wheel METADATA file")
        metadata = email.parser.BytesParser(policy=email.policy.default).parsebytes(
            archive.read(names[0])
        )
    requirements = [
        str(value).replace(" ", "").lower() for value in metadata.get_all("Requires-Dist", [])
    ]
    if not any(
        value.startswith("pyjwt[crypto]") and ">=2.13" in value and "<3" in value
        for value in requirements
    ):
        raise ProfileError(f"{path.name} must declare the pinned PyJWT crypto runtime dependency")
    browser_pdf = [
        value for value in requirements if "extra=='browser-pdf'" in value.replace('"', "'")
    ]
    if [value.replace('"', "'") for value in browser_pdf] != [
        f"playwright=={PYTHON_PACKAGE_PLAYWRIGHT};extra=='browser-pdf'"
    ]:
        raise ProfileError(
            f"{path.name} browser-pdf extra must contain exactly "
            f"Playwright {PYTHON_PACKAGE_PLAYWRIGHT}"
        )


def verify_archive(path: Path, profile_id: str = "python-package") -> None:
    if _archive_document(path) != expected_document(profile_id):
        raise ProfileError(f"{path.name} does not embed the {profile_id} runtime contract")
    if _archive_mcp_contract(path) != expected_mcp_contract():
        raise ProfileError(f"{path.name} does not embed the source MCP contract")
    if path.suffix == ".whl":
        _verify_wheel_payload(path)
    else:
        _verify_sdist_payload(path)
    _verify_wheel_oidc_dependency(path)


def verify_directory(directory: Path, profile_id: str = "python-package") -> list[Path]:
    artifacts = sorted(directory.glob("*.whl")) + sorted(directory.glob("*.tar.gz"))
    if len([path for path in artifacts if path.suffix == ".whl"]) != 1:
        raise ProfileError("release output must contain exactly one wheel")
    if len([path for path in artifacts if path.name.endswith(".tar.gz")]) != 1:
        raise ProfileError("release output must contain exactly one source distribution")
    for artifact in artifacts:
        verify_archive(artifact, profile_id)
    return artifacts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--profile", default="python-package")
    args = parser.parse_args(argv)
    try:
        verified = verify_directory(args.directory, args.profile)
    except ProfileError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for artifact in verified:
        print(f"valid embedded profile: {artifact.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
