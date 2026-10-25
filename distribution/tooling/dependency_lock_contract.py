#!/usr/bin/env python3
"""Validate reviewed, hash-pinned Python dependency locks for release artifacts."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO_ROOT / "distribution" / "dependency-locks.json"
TOOLCHAIN_PATH = REPO_ROOT / "distribution" / "toolchains.json"
EXACT_REQUIREMENT = re.compile(r"^([A-Za-z0-9_.-]+)(?:\[[A-Za-z0-9_,.-]+\])?==[^\s;]+")
HASH = re.compile(r"--hash=sha256:([0-9a-f]{64})(?:\s|$)")
EXPECTED_GENERATOR = {
    "tool": "uv",
    "version": "0.12.5",
    "excludeNewer": "2026-08-22T00:00:00Z",
    "onlyBinary": False,
}
# Security fixes released after `excludeNewer`. Only these packages may resolve past the
# global cut-off, each to its own date and to exactly the fixed version; the advisories and
# the reason are recorded next to them in dependency-locks.json. Moving `excludeNewer`
# instead would update every other dependency as well. An entry is removed once the global
# cut-off passes its date.
EXPECTED_PACKAGE_EXCEPTIONS = {
    "pyjwt": ("2026-09-24T00:00:00Z", "2.15.0"),
    "pillow": ("2026-10-17T00:00:00Z", "13.0.0"),
    "setuptools": ("2026-10-19T20:30:00Z", "84.1.0"),
}
EXCEPTION_FIELDS = {"excludeNewer", "version", "reason", "advisories"}
ADVISORY_ID = re.compile(r"(?:CVE-\d{4}-\d+|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})")
EXPECTED_LOCKS = {
    "native-build-bootstrap": {
        "profiles": ["macos-direct", "windows-direct"],
        "platform": "platform-independent",
        "pythonEnvironment": {
            "role": "release-build",
            "implementation": "CPython",
            "version": "3.12.10",
        },
        "pythonPlatform": "platform-independent",
        "sources": ["distribution/python-build-bootstrap.in"],
        "extras": [],
        "path": "distribution/python-build-bootstrap.lock",
        "packages": {"packaging", "setuptools", "wheel"},
    },
    "macos-direct-runtime": {
        "profiles": ["macos-direct"],
        "platform": "macos-arm64",
        "pythonEnvironment": {
            "role": "target-runtime",
            "implementation": "CPython",
            "version": "3.12.10",
        },
        "pythonPlatform": "aarch64-apple-darwin",
        "sources": ["pyproject.toml", "distribution/native-build-tools.in"],
        "extras": ["desktop"],
        "path": "distribution/desktop/macos/direct/requirements.lock",
        "packages": {
            "altgraph",
            "annotated-doc",
            "bottle",
            "cffi",
            "cryptography",
            "hatchling",
            "macholib",
            "markdown-it-py",
            "mdurl",
            "packaging",
            "pathspec",
            "pillow",
            "pluggy",
            "proxy-tools",
            "pycparser",
            "pygments",
            "pyinstaller",
            "pyinstaller-hooks-contrib",
            "pyjwt",
            "pyobjc-core",
            "pyobjc-framework-cocoa",
            "pyobjc-framework-quartz",
            "pyobjc-framework-security",
            "pyobjc-framework-uniformtypeidentifiers",
            "pyobjc-framework-webkit",
            "pystray",
            "pywebview",
            "rich",
            "setuptools",
            "shellingham",
            "six",
            "trove-classifiers",
            "typer",
            "typing-extensions",
        },
    },
    "windows-direct-runtime": {
        "profiles": ["windows-direct"],
        "platform": "windows-x86_64",
        "pythonEnvironment": {
            "role": "target-runtime",
            "implementation": "CPython",
            "version": "3.12.10",
        },
        "pythonPlatform": "x86_64-pc-windows-msvc",
        "sources": ["pyproject.toml", "distribution/native-build-tools.in"],
        "extras": ["desktop"],
        "path": "distribution/desktop/windows/direct/requirements.lock",
        "packages": {
            "altgraph",
            "annotated-doc",
            "bottle",
            "cffi",
            "clr-loader",
            "colorama",
            "cryptography",
            "hatchling",
            "markdown-it-py",
            "mdurl",
            "packaging",
            "pathspec",
            "pefile",
            "pillow",
            "pluggy",
            "proxy-tools",
            "pycparser",
            "pygments",
            "pyinstaller",
            "pyinstaller-hooks-contrib",
            "pyjwt",
            "pystray",
            "pythonnet",
            "pywebview",
            "pywin32-ctypes",
            "rich",
            "setuptools",
            "shellingham",
            "six",
            "trove-classifiers",
            "typer",
            "typing-extensions",
        },
    },
    "web-self-hosted-runtime": {
        "profiles": ["web-self-hosted"],
        "platform": "linux-x86_64",
        "pythonEnvironment": {
            "role": "target-runtime",
            "implementation": "CPython",
            "version": "3.12.3",
        },
        "pythonPlatform": "x86_64-manylinux_2_39",
        "sources": ["distribution/web/self-hosted/requirements.in"],
        "extras": [],
        "path": "distribution/web/self-hosted/requirements.lock",
        "packages": {"cffi", "cryptography", "markdown-it-py", "mdurl", "pycparser", "pyjwt"},
    },
}


class DependencyLockError(ValueError):
    """A release dependency lock is mutable, incomplete or unreviewed."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _logical_requirements(path: Path) -> list[str]:
    requirements: list[str] = []
    current = ""
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        continuation = stripped.endswith("\\")
        fragment = stripped[:-1].strip() if continuation else stripped
        current = f"{current} {fragment}".strip()
        if not continuation:
            requirements.append(current)
            current = ""
    if current:
        raise DependencyLockError(f"{path} ends inside a continued requirement")
    return requirements


def validate_lock(path: Path) -> set[str]:
    packages: set[str] = set()
    for requirement in _logical_requirements(path):
        match = EXACT_REQUIREMENT.match(requirement)
        if match is None:
            raise DependencyLockError(f"{path} has a dependency without an exact == pin")
        hashes = HASH.findall(requirement)
        if not hashes:
            raise DependencyLockError(f"{path} has an unhashed dependency: {match.group(1)}")
        package = match.group(1).lower().replace("_", "-")
        if package in packages:
            raise DependencyLockError(f"{path} has duplicate dependency {package}")
        packages.add(package)
    if not packages:
        raise DependencyLockError(f"{path} is empty")
    return packages


def _package_exceptions(value: object) -> dict[str, str]:
    """The per-package cut-off exceptions, checked against EXPECTED_PACKAGE_EXCEPTIONS."""
    if not isinstance(value, dict) or set(value) != set(EXPECTED_PACKAGE_EXCEPTIONS):
        raise DependencyLockError("dependency-lock package exceptions are not the reviewed set")
    versions: dict[str, str] = {}
    for package, (cut_off, version) in EXPECTED_PACKAGE_EXCEPTIONS.items():
        entry = value[package]
        if (
            not isinstance(entry, dict)
            or set(entry) != EXCEPTION_FIELDS
            or entry["excludeNewer"] != cut_off
            or entry["version"] != version
            or not isinstance(entry["reason"], str)
            or not entry["reason"].strip()
            or not isinstance(entry["advisories"], list)
            or not entry["advisories"]
            or not all(
                isinstance(advisory, str) and ADVISORY_ID.fullmatch(advisory)
                for advisory in entry["advisories"]
            )
        ):
            raise DependencyLockError(f"dependency-lock exception for {package} is invalid")
        versions[package] = version
    return versions


def _pinned_version(path: Path, package: str) -> str | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        name, separator, version = line.partition("==")
        if separator and name.strip().lower() == package:
            return version.split()[0].rstrip("\\").strip()
    return None


def records(repo_root: Path = REPO_ROOT) -> list[dict[str, object]]:
    contract_path = repo_root / "distribution" / "dependency-locks.json"
    try:
        document = json.loads(contract_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DependencyLockError(f"invalid dependency-lock contract: {error}") from error
    if not isinstance(document, dict) or set(document) != {
        "schemaVersion",
        "generator",
        "locks",
    }:
        raise DependencyLockError("dependency-lock contract has missing or unknown fields")
    generator = document["generator"]
    if (
        document["schemaVersion"] != 2
        or not isinstance(generator, dict)
        or {key: value for key, value in generator.items() if key != "excludeNewerPackages"}
        != EXPECTED_GENERATOR
        or not isinstance(document["locks"], list)
    ):
        raise DependencyLockError("unsupported dependency-lock contract schema")
    pinned_exceptions = _package_exceptions(generator.get("excludeNewerPackages"))
    toolchains = json.loads(
        (repo_root / "distribution" / "toolchains.json").read_text(encoding="utf-8")
    )
    if toolchains.get("dependencyLockGenerator") != {"uv": EXPECTED_GENERATOR["version"]}:
        raise DependencyLockError("dependency-lock generator does not match the toolchain lock")
    if len(document["locks"]) != len(EXPECTED_LOCKS):
        raise DependencyLockError("dependency-lock contract is incomplete")

    canonical: list[dict[str, object]] = []
    for record, (name, expected) in zip(document["locks"], EXPECTED_LOCKS.items(), strict=True):
        fields = {
            "name",
            "profiles",
            "platform",
            "pythonEnvironment",
            "pythonPlatform",
            "sources",
            "extras",
            "path",
            "sha256",
        }
        if not isinstance(record, dict) or set(record) != fields or record.get("name") != name:
            raise DependencyLockError("dependency-lock records are not canonical")
        for field in (
            "profiles",
            "platform",
            "pythonEnvironment",
            "pythonPlatform",
            "sources",
            "extras",
            "path",
        ):
            if record[field] != expected[field]:
                raise DependencyLockError(f"dependency-lock {name} has invalid {field}")
        for source in record["sources"]:
            if not (repo_root / source).is_file():
                raise DependencyLockError(f"dependency-lock {name} input is missing: {source}")
        digest = record["sha256"]
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise DependencyLockError(f"dependency-lock {name} has an invalid digest")
        path = repo_root / str(record["path"])
        if _sha256(path) != digest:
            raise DependencyLockError(f"dependency-lock {name} digest does not match {path}")
        packages = validate_lock(path)
        exact = expected.get("packages")
        if isinstance(exact, set) and packages != exact:
            raise DependencyLockError(f"dependency-lock {name} package allowlist drift")
        for package, version in pinned_exceptions.items():
            pin = _pinned_version(path, package)
            if pin is not None and pin != version:
                raise DependencyLockError(
                    f"dependency-lock {name} pins {package}=={pin}; its exception allows {version}"
                )
        canonical.append(dict(record))
    return canonical


def for_profile(profile: str, repo_root: Path = REPO_ROOT) -> list[dict[str, object]]:
    return [record for record in records(repo_root) if profile in record["profiles"]]


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments != ["check"]:
        print("usage: dependency_lock_contract.py check", file=sys.stderr)
        return 2
    try:
        validated = records()
    except (DependencyLockError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"Dependency locks are valid: {len(validated)} reviewed files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
