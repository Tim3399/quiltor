#!/usr/bin/env python3
"""Versioned, digest-bound base-image and OCI payload contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from backup_service_artifact import load_contract as load_backup_artifact_contract
from browser_payload_digest import load_contract as load_browser_payload_contract
from dependency_lock_contract import records as dependency_lock_records
from dependency_lock_contract import validate_lock

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO_ROOT / "distribution" / "containers" / "base-images.json"
BROWSER_PAYLOAD_PATH = REPO_ROOT / "distribution" / "containers" / "browser-payloads.json"
REFERENCE = re.compile(r"^[a-z0-9./_-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$")
LEGAL_FILES = ("LICENSE", "THIRD-PARTY-NOTICES.md")


def load_contract(path: Path = CONTRACT_PATH) -> dict[str, object]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schemaVersion") != 2:
        raise ValueError("Unsupported container base-image contract.")
    for name in ("webRuntime", "nodeBuild", "backupPython"):
        entry = document.get(name)
        image = entry.get("reference") if isinstance(entry, dict) else None
        if not isinstance(image, str) or REFERENCE.fullmatch(image) is None:
            raise ValueError(f"Container base image {name} is not digest-bound.")
    return document


def reference(name: str, path: Path = CONTRACT_PATH) -> str:
    document = load_contract(path)
    entry = document.get(name)
    if not isinstance(entry, dict):
        raise ValueError(f"Unknown container base image: {name}")
    image = entry.get("reference")
    if not isinstance(image, str):
        raise ValueError(f"Container base image {name} has no reference.")
    return image


def validate_sources(repo_root: Path = REPO_ROOT) -> None:
    """Reject Dockerfiles whose bases or required payload drift from the lock."""

    contract_path = repo_root / "distribution" / "containers" / "base-images.json"
    browser_contract_path = repo_root / "distribution" / "containers" / "browser-payloads.json"
    app_path = repo_root / "Dockerfile"
    backup_path = repo_root / "services" / "backup-server" / "Dockerfile"
    artifact_path = repo_root / "services" / "backup-server" / "artifact-contract.json"
    app = app_path.read_text(encoding="utf-8")
    backup = backup_path.read_text(encoding="utf-8")
    web_runtime = reference("webRuntime", contract_path)
    node_build = reference("nodeBuild", contract_path)
    backup_python = reference("backupPython", contract_path)
    if f"ARG WEB_RUNTIME_BASE_IMAGE={web_runtime}" not in app:
        raise ValueError("Dockerfile web runtime base does not match the committed digest lock.")
    if (
        app.count(web_runtime) < 2
        or "FROM ${WEB_RUNTIME_BASE_IMAGE} AS web-runtime-base" not in app
    ):
        raise ValueError("Dockerfile must both default and assert its locked web runtime base.")
    if not re.fullmatch(r"ubuntu:24\.04@sha256:[0-9a-f]{64}", web_runtime):
        raise ValueError("Web target runtime must remain on digest-bound Ubuntu 24.04.")
    if f"ARG NODE_BASE_IMAGE={node_build}" not in app:
        raise ValueError("Dockerfile Node base does not match the committed digest lock.")
    if app.count(node_build) < 2 or "FROM ${NODE_BASE_IMAGE} AS node-runtime" not in app:
        raise ValueError("Dockerfile must both default and assert its locked Node base.")
    toolchains = json.loads(
        (repo_root / "distribution" / "toolchains.json").read_text(encoding="utf-8")
    )
    release_toolchains = toolchains.get("releaseToolchains")
    node_version = release_toolchains.get("node") if isinstance(release_toolchains, dict) else None
    npm_version = release_toolchains.get("npm") if isinstance(release_toolchains, dict) else None
    artifact_runtimes = toolchains.get("artifactRuntimes")
    web_oci_runtime = (
        artifact_runtimes.get("webOci") if isinstance(artifact_runtimes, dict) else None
    )
    web_playwright = (
        web_oci_runtime.get("playwright") if isinstance(web_oci_runtime, dict) else None
    )
    if not isinstance(web_playwright, str):
        raise ValueError("Container Playwright runtime lock is missing.")
    browser_payload = load_browser_payload_contract(browser_contract_path, "linux/amd64")
    if browser_payload.playwright_version != web_playwright:
        raise ValueError("Browser payload and container Playwright runtime locks disagree.")
    if "node node_modules/playwright/cli.js install-deps chromium" not in app:
        raise ValueError("Web OCI must install Playwright's Chromium system dependencies.")
    if "ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright" not in app:
        raise ValueError("Web OCI must use the explicit shared Playwright browser path.")
    if "node node_modules/playwright/cli.js install --only-shell chromium" not in app:
        raise ValueError("Web OCI must install only the headless Chromium shell.")
    browser_lock_evidence = (
        "FROM web-runtime-base AS playwright-browser",
        'test "$TARGETARCH" = "amd64"',
        "COPY distribution/containers/browser-payloads.json /tmp/quiltor-browser-payloads.json",
        "COPY distribution/tooling/browser_payload_digest.py /tmp/browser_payload_digest.py",
        "python3 /tmp/browser_payload_digest.py check-contract /ms-playwright",
        "--contract /tmp/quiltor-browser-payloads.json",
        "--platform linux/amd64",
        f"--playwright-version {web_playwright}",
        "COPY --from=playwright-browser",
    )
    for evidence in browser_lock_evidence:
        if evidence not in app:
            raise ValueError(
                "Web OCI must verify its browser payload against the committed cryptographic lock: "
                f"{evidence}"
            )
    locked_browser_directory = f"/ms-playwright/{browser_payload.directory}"
    if app.count(locked_browser_directory) != 2:
        raise ValueError("Web OCI must copy only the checksum-verified browser directory.")
    for unused_browser in ("ffmpeg-*", "firefox-*", "webkit-*", "chromium-[0-9]*"):
        if unused_browser not in app:
            raise ValueError(f"Web OCI must reject the unused browser payload {unused_browser}.")
    if "PLAYWRIGHT_BASE_IMAGE" in app or "mcr.microsoft.com/playwright" in app:
        raise ValueError("Web OCI must not inherit the multi-browser Playwright image.")
    if not isinstance(node_version, str) or f"node:{node_version}-" not in node_build:
        raise ValueError("Container and repository Node toolchain locks disagree.")
    if "process.versions.node !== t.node" not in app or ".releaseToolchains" not in app:
        raise ValueError(
            "Dockerfile must assert the effective Node runtime against toolchains.json."
        )
    if not isinstance(npm_version, str) or f'test "$(npm --version)" = "{npm_version}"' not in app:
        raise ValueError(
            "Dockerfile must assert the effective npm runtime against toolchains.json."
        )
    web_lock = next(
        (
            record
            for record in dependency_lock_records(repo_root)
            if record["name"] == "web-self-hosted-runtime"
        ),
        None,
    )
    if web_lock is None:
        raise ValueError("Web target dependency lock is missing.")
    python_environment = web_lock["pythonEnvironment"]
    if not isinstance(python_environment, dict):
        raise ValueError("Web dependency lock has no explicit target Python runtime.")
    web_python = python_environment.get("version")
    runtime_assertion = f"platform.python_version() == '{web_python}'"
    if not isinstance(web_python, str) or app.count(runtime_assertion) != 1:
        raise ValueError("The shared web OCI base must assert the locked target runtime once.")
    if "FROM web-runtime-base AS web-build" not in app or app.count("FROM web-runtime-base") != 3:
        raise ValueError("All web OCI Ubuntu stages must inherit the validated runtime base.")
    if f"ARG BACKUP_BASE_IMAGE={backup_python}" not in backup:
        raise ValueError("Backup Dockerfile base does not match the committed digest lock.")
    if backup.count(backup_python) < 2 or "FROM ${BACKUP_BASE_IMAGE}" not in backup:
        raise ValueError("Backup Dockerfile must both default and assert its locked base.")
    if not re.fullmatch(r"python:3\.12\.13-slim-[a-z]+@sha256:[0-9a-f]{64}", backup_python):
        raise ValueError("Backup target runtime must remain explicit in its digest-bound base.")
    for name in LEGAL_FILES:
        if name not in app or name not in backup:
            raise ValueError(f"Both OCI payloads must contain {name}.")
    if "--require-hashes" not in app:
        raise ValueError("Web OCI dependencies must install in pip hash-checking mode.")
    artifact = load_backup_artifact_contract(artifact_path)
    if artifact.get("baseImage") != backup_python:
        raise ValueError("Backup artifact and base-image contracts disagree.")
    if "COPY services/backup-server/artifact-contract.json" not in backup:
        raise ValueError("Backup Dockerfile does not embed its artifact contract.")


def validate_runtime_locks(repo_root: Path = REPO_ROOT) -> None:
    toolchains = json.loads(
        (repo_root / "distribution/toolchains.json").read_text(encoding="utf-8")
    )
    web_playwright = toolchains["artifactRuntimes"]["webOci"]["playwright"]
    browser_payload = load_browser_payload_contract(
        repo_root / "distribution" / "containers" / "browser-payloads.json",
        "linux/amd64",
    )
    if browser_payload.playwright_version != web_playwright:
        raise ValueError("Browser payload and container Playwright runtime locks disagree.")
    runtime_package = json.loads(
        (repo_root / "distribution/web/self-hosted/package.json").read_text(encoding="utf-8")
    )
    runtime_lock = json.loads(
        (repo_root / "distribution/web/self-hosted/package-lock.json").read_text(encoding="utf-8")
    )
    if runtime_package.get("dependencies") != {"playwright": web_playwright}:
        raise ValueError("OCI runtime Node dependencies are outside the exact allowlist.")
    if runtime_package.get("packageManager") != "npm@10.9.8":
        raise ValueError("OCI runtime package manager must be exactly npm 10.9.8.")
    packages = runtime_lock.get("packages")
    if not isinstance(packages, dict) or set(packages) != {
        "",
        "node_modules/playwright",
        "node_modules/playwright-core",
    }:
        raise ValueError("OCI runtime Node lock contains packages outside its allowlist.")
    for name in ("node_modules/playwright", "node_modules/playwright-core"):
        entry = packages[name]
        if not isinstance(entry, dict) or entry.get("version") != web_playwright:
            raise ValueError(f"OCI runtime Playwright packages must be exactly {web_playwright}.")
        integrity = entry.get("integrity")
        if not isinstance(integrity, str) or not integrity.startswith("sha512-"):
            raise ValueError("OCI runtime Node lock must carry integrity digests.")

    pins = validate_lock(repo_root / "distribution/web/self-hosted/requirements.lock")
    if pins != {
        "cffi",
        "cryptography",
        "pycparser",
        "pyjwt",
    }:
        raise ValueError("OCI Python runtime lock is not the reviewed exact allowlist.")


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments != ["check"]:
        print("usage: container_contract.py check", file=sys.stderr)
        return 2
    try:
        load_contract()
        validate_sources()
        validate_runtime_locks()
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("Container base-image and payload contracts are valid.")
    return 0


__all__ = [
    "BROWSER_PAYLOAD_PATH",
    "CONTRACT_PATH",
    "load_contract",
    "reference",
    "validate_runtime_locks",
    "validate_sources",
]


if __name__ == "__main__":
    raise SystemExit(main())
