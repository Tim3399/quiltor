#!/usr/bin/env python3
"""Validate the immutable CI and release-workflow dependency boundary."""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import cast

import path_filter
from browser_payload_digest import load_contract as load_browser_payload_contract
from release_preflight import COVERAGE as PREFLIGHT_COVERAGE

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_ROOT = REPO_ROOT / ".github" / "workflows"
ACTION_LOCK = REPO_ROOT / ".github" / "actions.lock.json"
TOOLCHAIN_LOCK = REPO_ROOT / "distribution" / "toolchains.json"
FULL_SHA = re.compile(r"[0-9a-f]{40}")
ACTION_USE = re.compile(r"^\s*(?:-\s+)?uses:\s+([^\s@]+)@([^\s#]+)", re.MULTILINE)
CARGO_COMMAND = re.compile(
    r"\bcargo(?:\.exe)?\s+(?!--locked\b)(?:fmt|clippy|test|build|check|run|install)\b"
)
JOB_HEADER = re.compile(r"^  ([a-z0-9][a-z0-9-]*):\s*$", re.MULTILINE)


class WorkflowContractError(ValueError):
    """A workflow can resolve or publish input outside the release contract."""


def _load_json(path: Path, *, schema_version: int = 1) -> dict[str, object]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise WorkflowContractError(f"invalid contract {path}: {error}") from error
    if not isinstance(document, dict) or document.get("schemaVersion") != schema_version:
        raise WorkflowContractError(f"unsupported contract schema in {path}")
    return document


def action_lock(path: Path = ACTION_LOCK) -> dict[str, str]:
    document = _load_json(path)
    actions = document.get("actions")
    if not isinstance(actions, dict) or not actions:
        raise WorkflowContractError("the GitHub Action lock is empty")
    locked: dict[str, str] = {}
    for name, record in actions.items():
        if not isinstance(name, str) or not isinstance(record, dict):
            raise WorkflowContractError("the GitHub Action lock has an invalid entry")
        commit = record.get("commit")
        source_ref = record.get("sourceRef")
        if not isinstance(commit, str) or FULL_SHA.fullmatch(commit) is None:
            raise WorkflowContractError(f"{name} is not locked to a full lowercase commit SHA")
        if not isinstance(source_ref, str) or not source_ref.startswith("refs/"):
            raise WorkflowContractError(f"{name} has no auditable source ref")
        locked[name] = commit
    return locked


def toolchain_lock(path: Path = TOOLCHAIN_LOCK) -> dict[str, object]:
    document = _load_json(path, schema_version=2)
    release = document.get("releaseToolchains")
    tools = document.get("pythonBuildTools")
    artifact_runtimes = document.get("artifactRuntimes")
    lock_generator = document.get("dependencyLockGenerator")
    runtime_version = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
    tool_version = re.compile(r"[0-9]+(?:\.[0-9]+){1,3}")
    if not isinstance(release, dict) or set(release) != {"node", "npm", "python", "rust"}:
        raise WorkflowContractError("the release runtime toolchain lock is incomplete")
    python = release["python"]
    node = release["node"]
    npm = release["npm"]
    rust = release["rust"]
    if not isinstance(node, str) or runtime_version.fullmatch(node) is None:
        raise WorkflowContractError("Node.js must be locked to an exact patch version")
    if not isinstance(npm, str) or runtime_version.fullmatch(npm) is None:
        raise WorkflowContractError("npm must be locked to an exact patch version")
    if not isinstance(python, str) or runtime_version.fullmatch(python) is None:
        raise WorkflowContractError("Python must be locked to an exact patch version")
    if not isinstance(rust, str) or runtime_version.fullmatch(rust) is None:
        raise WorkflowContractError("Rust must be locked to an exact release")
    if not isinstance(tools, dict) or set(tools) != {
        "build",
        "editables",
        "hatchling",
        "pyinstaller",
        "ruff",
    }:
        raise WorkflowContractError("the Python release-tool lock is incomplete")
    for name, value in tools.items():
        if not isinstance(value, str) or tool_version.fullmatch(value) is None:
            raise WorkflowContractError(f"Python build tool {name} is not exactly pinned")
    if not isinstance(artifact_runtimes, dict) or set(artifact_runtimes) != {
        "pythonPackage",
        "webOci",
    }:
        raise WorkflowContractError("the artifact runtime lock is incomplete")
    for target in ("pythonPackage", "webOci"):
        runtime = artifact_runtimes[target]
        if (
            not isinstance(runtime, dict)
            or set(runtime) != {"playwright"}
            or not isinstance(runtime["playwright"], str)
            or runtime_version.fullmatch(runtime["playwright"]) is None
        ):
            raise WorkflowContractError(f"the {target} Playwright runtime must be exactly pinned")
    if lock_generator != {"uv": "0.12.5"}:
        raise WorkflowContractError("the dependency-lock generator must be exactly pinned")
    return document


def _workflow_sources(root: Path = WORKFLOW_ROOT) -> dict[Path, str]:
    sources = {
        path: path.read_text(encoding="utf-8")
        for pattern in ("*.yml", "*.yaml")
        for path in root.glob(pattern)
    }
    if not sources:
        raise WorkflowContractError("no GitHub workflows were found")
    return sources


def validate_actions(sources: dict[Path, str], locked: dict[str, str]) -> None:
    used: set[str] = set()
    for path, source in sources.items():
        for name, revision in ACTION_USE.findall(source):
            used.add(name)
            expected = locked.get(name)
            if expected is None:
                raise WorkflowContractError(f"{path.name} uses unlocked action {name}")
            if FULL_SHA.fullmatch(revision) is None:
                raise WorkflowContractError(
                    f"{path.name} uses mutable action ref {name}@{revision}; expected {expected}"
                )
            if revision != expected:
                raise WorkflowContractError(
                    f"{path.name} uses {name}@{revision}, not locked commit {expected}"
                )
    unused = set(locked) - used
    if unused:
        raise WorkflowContractError("unused GitHub Action locks: " + ", ".join(sorted(unused)))


MATRIX_RUNNER = re.compile(r"^\$\{\{\s*matrix\.([a-z_][a-z0-9_]*)\s*\}\}$")


RUST_TOOLCHAIN_STEP = re.compile(
    r"^(?P<indent>[ \t]*)-[ \t]+uses:[ \t]+dtolnay/rust-toolchain@[^\n]*\n"
    r"(?P<body>(?:(?P=indent)[ \t]+[^\n]*\n|[ \t]*\n)*)",
    re.MULTILINE,
)


def _step_input(body: str, key: str) -> str | None:
    match = re.search(
        rf"^[ \t]+{key}:[ \t]*[\"']?([^\"'#\n]*?)[\"']?[ \t]*(?:#.*)?$", body, re.MULTILINE
    )
    return match.group(1).strip() if match else None


def validate_rust_toolchain_steps(
    sources: dict[Path, str], toolchain_file: str | None = None
) -> None:
    """
    Every dtolnay/rust-toolchain step installs exactly what rust-toolchain.toml names.

    rustup reads that file on every cargo call, `cargo --version` included. A component
    the step left out is then fetched lazily, and in a release gate that failed at random.
    """

    if toolchain_file is None:
        toolchain_file = (REPO_ROOT / "rust-toolchain.toml").read_text(encoding="utf-8")
    pinned = tomllib.loads(toolchain_file).get("toolchain", {})
    channel = pinned.get("channel")
    components = pinned.get("components", [])
    if not isinstance(channel, str) or not isinstance(components, list):
        raise WorkflowContractError("rust-toolchain.toml must name a channel and its components")
    expected = set(components)
    steps = 0
    for path, source in sources.items():
        for match in RUST_TOOLCHAIN_STEP.finditer(source):
            steps += 1
            body = match.group("body")
            where = f"{path.name}: rust-toolchain step at line {source.count(chr(10), 0, match.start()) + 1}"
            toolchain = _step_input(body, "toolchain")
            if toolchain != channel:
                raise WorkflowContractError(
                    f"{where} must request toolchain {channel} from rust-toolchain.toml; found {toolchain}"
                )
            requested = _step_input(body, "components")
            found = {item.strip() for item in (requested or "").split(",") if item.strip()}
            if found != expected:
                raise WorkflowContractError(
                    f"{where} must install components {sorted(expected)} from rust-toolchain.toml; "
                    f"found {sorted(found)}"
                )
    if not steps:
        raise WorkflowContractError("no dtolnay/rust-toolchain step found in the workflows")


def _job_blocks(source: str) -> list[tuple[str, str]]:
    """Every job of a workflow as (name, body)."""
    _, _, jobs = source.partition("\njobs:")
    matches = list(JOB_HEADER.finditer(jobs))
    blocks = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(jobs)
        blocks.append((match.group(1), jobs[match.end() : end]))
    return blocks


def _matrix_values(job: str, key: str) -> list[str]:
    """The values a matrix key can take, from a flow list, a block list or `include:` rows."""
    values: list[str] = []
    flow = re.search(rf"^\s*{re.escape(key)}:\s*\[([^\]]*)\]", job, re.MULTILINE)
    if flow:
        values += [item.strip().strip("\"'") for item in flow.group(1).split(",")]
    rows = rf"^\s*(?:-\s+)?{re.escape(key)}:\s*([^\s#\[]+)\s*$"
    for match in re.finditer(rows, job, re.MULTILINE):
        values.append(match.group(1).strip("\"'"))
    return [value for value in values if value]


def resolved_runners(sources: dict[Path, str]) -> set[str]:
    """
    Every runner label a workflow can actually land on.

    `runs-on: ${{ matrix.os }}` is resolved against that job's matrix instead of being read
    literally. Without this the lock could only be honoured by workflows that never use a
    matrix -- and running the suite on three platforms is exactly a matrix. An expression
    that cannot be resolved raises: an unreadable runner is an unchecked runner.
    """
    runners: set[str] = set()
    for path, source in sources.items():
        for name, job in _job_blocks(source):
            for match in re.finditer(r"runs-on:\s*([^\n#]+)", job):
                value = match.group(1).strip()
                expression = MATRIX_RUNNER.fullmatch(value)
                if not expression:
                    runners.add(value)
                    continue
                key = expression.group(1)
                values = _matrix_values(job, key)
                if not values:
                    raise WorkflowContractError(
                        f"{path.name}:{name} runs on a matrix expression for {key}, "
                        "but that key has no readable list of runner labels"
                    )
                runners.update(values)
    return runners


def validate_toolchains(sources: dict[Path, str], contract: dict[str, object]) -> None:
    release_toolchains = contract["releaseToolchains"]
    if not isinstance(release_toolchains, dict):
        raise WorkflowContractError("the release runtime toolchain lock is incomplete")
    node = str(release_toolchains["node"])
    npm = str(release_toolchains["npm"])
    python = str(release_toolchains["python"])
    rust = str(release_toolchains["rust"])
    # toolchain_lock() validated this as a name-to-version mapping.
    tools = cast(dict[str, str], contract["pythonBuildTools"])
    native_tools = contract.get("nativePackagingTools")
    hosted_runners = contract.get("hostedRunners")
    if not isinstance(native_tools, dict) or not isinstance(native_tools.get("innoSetup"), dict):
        raise WorkflowContractError("the native packaging toolchain lock is incomplete")
    inno = native_tools["innoSetup"]
    if set(inno) != {"version", "downloadUrl", "sha256"}:
        raise WorkflowContractError("the Inno Setup lock must contain version, URL and SHA-256")
    inno_version = str(inno["version"])
    inno_tag = inno_version.replace(".", "_")
    expected_inno_url = (
        "https://github.com/jrsoftware/issrc/releases/download/"
        f"is-{inno_tag}/innosetup-{inno_version}.exe"
    )
    if inno["downloadUrl"] != expected_inno_url:
        raise WorkflowContractError(
            "the Inno Setup download must use its immutable official GitHub release URL"
        )
    if re.fullmatch(r"[0-9a-f]{64}", str(inno["sha256"])) is None:
        raise WorkflowContractError("the Inno Setup lock must contain a lowercase SHA-256")
    if not isinstance(hosted_runners, dict) or set(hosted_runners) != {
        "linuxX64",
        "macosArm64",
        "windowsX64",
    }:
        raise WorkflowContractError("the hosted runner lock is incomplete")
    runner_values = resolved_runners(sources)
    expected_runners = {str(value) for value in hosted_runners.values()}
    if runner_values != expected_runners or any("latest" in value for value in runner_values):
        raise WorkflowContractError(
            f"workflow runners must use exactly {sorted(expected_runners)}; "
            f"found {sorted(runner_values)}"
        )
    artifact_runtimes = contract["artifactRuntimes"]
    if not isinstance(artifact_runtimes, dict):
        raise WorkflowContractError("the artifact runtime lock is incomplete")
    python_playwright = str(artifact_runtimes["pythonPackage"]["playwright"])
    oci_playwright = str(artifact_runtimes["webOci"]["playwright"])
    combined = "\n".join(sources.values())
    node_values = re.findall(r"node-version:\s*[\"']?([^\s\"'#]+)", combined)
    if not node_values or set(node_values) != {node}:
        raise WorkflowContractError(
            f"every setup-node step must use exact version {node}; found {sorted(set(node_values))}"
        )
    python_values = re.findall(r"python-version:\s*[\"']?([^\s\"'#]+)", combined)
    if not python_values or set(python_values) != {python}:
        raise WorkflowContractError(
            f"every setup-python step must use exact version {python}; found {sorted(set(python_values))}"
        )
    rust_values = re.findall(r"toolchain:\s*[\"']?([^\s\"'#]+)", combined)
    if not rust_values or set(rust_values) != {rust}:
        raise WorkflowContractError(
            f"every rust-toolchain step must request exact version {rust}; found {sorted(set(rust_values))}"
        )
    repository_pins = {
        REPO_ROOT / ".node-version": node,
        REPO_ROOT / ".python-version": python,
    }
    for path, expected in repository_pins.items():
        if path.read_text(encoding="utf-8").strip() != expected:
            raise WorkflowContractError(f"{path.name} must contain exactly {expected}")
    rust_toolchain = (REPO_ROOT / "rust-toolchain.toml").read_text(encoding="utf-8")
    if f'channel = "{rust}"' not in rust_toolchain:
        raise WorkflowContractError(f"rust-toolchain.toml must pin Rust {rust}")
    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    if f'test "$(npm --version)" = "{npm}"' not in dockerfile:
        raise WorkflowContractError(f"the OCI build must assert exact npm {npm}")
    for path in (
        REPO_ROOT / "package.json",
        REPO_ROOT / "distribution" / "web" / "self-hosted" / "package.json",
    ):
        package = json.loads(path.read_text(encoding="utf-8"))
        if package.get("packageManager") != f"npm@{npm}":
            raise WorkflowContractError(f"{path} must declare exact npm@{npm}")
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    expected_build_requirements = [
        f"hatchling=={tools['hatchling']}",
        f"editables=={tools['editables']}",
    ]
    if pyproject.get("build-system", {}).get("requires") != expected_build_requirements:
        raise WorkflowContractError(
            "pyproject build-system must pin Hatchling and its editable-build dependency"
        )
    browser_pdf = pyproject["project"]["optional-dependencies"].get("browser-pdf")
    if browser_pdf != [f"playwright=={python_playwright}"]:
        raise WorkflowContractError(
            "the Python package PDF extra disagrees with artifactRuntimes.pythonPackage"
        )
    oci_package = json.loads(
        (REPO_ROOT / "distribution/web/self-hosted/package.json").read_text(encoding="utf-8")
    )
    if oci_package.get("dependencies") != {"playwright": oci_playwright}:
        raise WorkflowContractError("the OCI PDF runtime disagrees with artifactRuntimes.webOci")
    base_images = json.loads(
        (REPO_ROOT / "distribution/containers/base-images.json").read_text(encoding="utf-8")
    )
    web_runtime_base = base_images.get("webRuntime", {}).get("reference", "")
    if re.fullmatch(r"ubuntu:24\.04@sha256:[0-9a-f]{64}", web_runtime_base) is None:
        raise WorkflowContractError("the OCI web runtime base must pin Ubuntu 24.04")
    if "node node_modules/playwright/cli.js install --only-shell chromium" not in dockerfile:
        raise WorkflowContractError(
            f"the OCI Playwright {oci_playwright} runtime must install Chromium headless shell only"
        )
    try:
        browser_payload = load_browser_payload_contract(
            REPO_ROOT / "distribution" / "containers" / "browser-payloads.json",
            "linux/amd64",
        )
    except ValueError as error:
        raise WorkflowContractError(f"the OCI browser payload lock is invalid: {error}") from error
    if browser_payload.playwright_version != oci_playwright:
        raise WorkflowContractError(
            "the OCI browser payload lock disagrees with artifactRuntimes.webOci"
        )
    for evidence in (
        "distribution/containers/browser-payloads.json",
        "browser_payload_digest.py check-contract /ms-playwright",
        "--platform linux/amd64",
        f"--playwright-version {oci_playwright}",
        "COPY --from=playwright-browser",
    ):
        if evidence not in dockerfile:
            raise WorkflowContractError(
                f"the OCI browser payload is not cryptographically bound: {evidence}"
            )
    if dockerfile.count(f"/ms-playwright/{browser_payload.directory}") != 2:
        raise WorkflowContractError(
            "the OCI runtime must copy only its checksum-verified browser directory"
        )
    release = sources[WORKFLOW_ROOT / "release.yml"]
    for command in (
        ".nativePackagingTools.innoSetup",
        "Invoke-WebRequest -Uri $inno.downloadUrl -OutFile $installer",
        "Get-FileHash -LiteralPath $installer -Algorithm SHA256",
        "$actual -ne $inno.sha256",
        "Start-Process -FilePath $installer",
    ):
        if command not in release:
            raise WorkflowContractError(
                f"Windows packaging is missing its locked Inno Setup step: {command}"
            )
    if "choco install innosetup" in release.casefold():
        raise WorkflowContractError("Windows packaging may not resolve mutable Inno Setup packages")
    native_locks = "\n".join(
        (REPO_ROOT / path).read_text(encoding="utf-8")
        for path in (
            "distribution/desktop/macos/direct/requirements.lock",
            "distribution/desktop/windows/direct/requirements.lock",
        )
    )
    for name, version in tools.items():
        expected = f'"{name}=={version}"'
        if expected not in release and f"{name}=={version}" not in native_locks:
            raise WorkflowContractError(f"release workflow does not install exact {expected}")

    required_lock_commands = (
        "python distribution/tooling/dependency_lock_contract.py check",
        "python -m pip install --require-hashes",
        "--requirement distribution/python-build-bootstrap.lock",
        "--requirement distribution/desktop/macos/direct/requirements.lock",
        "--requirement distribution/desktop/windows/direct/requirements.lock",
    )
    for command in required_lock_commands:
        if command not in release:
            raise WorkflowContractError(
                f"release workflow is missing hash-locked native install: {command}"
            )
    if '-e ".[desktop]"' in release or "-e '.[desktop]'" in release:
        raise WorkflowContractError("release workflow may not resolve open desktop extras")


def validate_job_runtime_setups(sources: dict[Path, str], locked: dict[str, str]) -> None:
    """Every job must install the locked runtime before invoking its commands."""

    setup_python = f"actions/setup-python@{locked['actions/setup-python']}"
    setup_node = f"actions/setup-node@{locked['actions/setup-node']}"
    for path, source in sources.items():
        try:
            jobs = source.split("\njobs:\n", 1)[1]
        except IndexError as error:
            raise WorkflowContractError(f"{path.name} has no jobs mapping") from error
        matches = list(JOB_HEADER.finditer(jobs))
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(jobs)
            # A job that only reads the python-package job's result runs no Python.
            job = jobs[match.end() : end].replace("python-package", "")
            name = match.group(1)
            if re.search(r"\bpython(?:3)?\b", job) and setup_python not in job:
                raise WorkflowContractError(
                    f"{path.name}:{name} invokes Python without the locked setup-python action"
                )
            if re.search(r"\b(?:node|npm|npx)\b", job) and setup_node not in job:
                raise WorkflowContractError(
                    f"{path.name}:{name} invokes Node.js without the locked setup-node action"
                )


def validate_cargo(sources: dict[Path, str], preflight: Path | None = None) -> None:
    candidates = dict(sources)
    preflight_path = preflight or REPO_ROOT / "distribution" / "tooling" / "release_preflight.py"
    candidates[preflight_path] = preflight_path.read_text(encoding="utf-8")
    for path, source in candidates.items():
        match = CARGO_COMMAND.search(source)
        if match is not None:
            raise WorkflowContractError(
                f"{path.name} has a Cargo command without --locked: {match.group(0)}"
            )


def validate_publication_boundary(sources: dict[Path, str]) -> None:
    build = sources[WORKFLOW_ROOT / "release.yml"]
    publish = sources[WORKFLOW_ROOT / "release-publish.yml"]
    for forbidden in (":latest", "gh release create", "gh release edit"):
        if forbidden in build:
            raise WorkflowContractError(f"Release Build crosses publication boundary: {forbidden}")
    handoff = "build-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_SHA}"
    if build.count(handoff) != 2:
        raise WorkflowContractError("both OCI builds need unique run/attempt/SHA hand-off tags")
    if build.count("steps.build.outputs.digest") != 2:
        raise WorkflowContractError("both OCI outputs must be captured by manifest digest")
    if publish.count("docker buildx imagetools create") != 1:
        raise WorkflowContractError("only the publisher may promote OCI image tags")
    for required in (
        '-t "$REPOSITORY:$VERSION"',
        '-t "$REPOSITORY:latest"',
        "release_manifest.py images",
        "${IMAGE%@sha256:*}",
    ):
        if required not in publish:
            raise WorkflowContractError(
                f"publisher is missing immutable promotion guard: {required}"
            )
    for path, source in sources.items():
        if path.name not in {"release.yml", "release-publish.yml"} and (
            "packages: write" in source or "imagetools create" in source
        ):
            raise WorkflowContractError(f"{path.name} may not publish OCI packages")


def validate_image_size_guard(sources: dict[Path, str]) -> None:
    """The pushed web runtime must pass its central compressed-size budget."""

    build = sources[WORKFLOW_ROOT / "release.yml"]
    web_image = _job_body(build, "web-image")
    command = 'python distribution/tooling/oci_image_size.py check "$IMAGE" --budget web'
    immutable_binding = "IMAGE: ${{ steps.immutable.outputs.value }}"
    if build.count(command) != 1 or web_image.count(command) != 1:
        raise WorkflowContractError("Release Build must enforce the web image-size budget once")
    command_index = web_image.index(command)
    step_start = web_image.rfind("\n      - ", 0, command_index)
    step_end = web_image.find("\n      - ", command_index)
    if step_start < 0:
        raise WorkflowContractError("web image-size guard must be a dedicated workflow step")
    if step_end < 0:
        step_end = len(web_image)
    guard_step = web_image[step_start:step_end]
    if immutable_binding not in guard_step:
        raise WorkflowContractError("web image-size guard must inspect the immutable pushed digest")
    if "continue-on-error:" in guard_step:
        raise WorkflowContractError("web image-size guard must not continue on error")
    if command_index < web_image.index("- id: immutable"):
        raise WorkflowContractError("web image-size guard must run after the image digest is bound")


def validate_browser_e2e_sharding(sources: dict[Path, str]) -> None:
    """Keep normal-CI browser sharding complete, diagnosable and fail-closed."""

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    shards = _job_body(workflow, "browser-e2e-shards")
    aggregator = _job_body(workflow, "browser-e2e")

    if re.findall(r"^        slot: \[([^\]\n]*)\]$", shards, re.MULTILINE) != ["1, 2, 3, 4"]:
        raise WorkflowContractError(
            "normal CI must run the product and design suites across exactly four browser "
            "matrix slots: slot: [1, 2, 3, 4]"
        )
    if "if: matrix.product_shard" in shards or "--shard=" in shards:
        raise WorkflowContractError(
            "every Linux slot must run its duration-assigned part of both suites, none by count"
        )

    required_shard_evidence = (
        "    needs: plan\n",
        "fail-fast: false",
        "SLOT: ${{ matrix.slot }}",
        "set +e",
        "node tools/dev/test-shards.mjs select --os linux --slots 4 "
        '--slot "$SLOT" --offset 4=9000 --out-dir "$lists"',
        *SLOT_RUN_EVIDENCE,
        'PLAYWRIGHT_WORKERS="$WORKERS_LINUX_PRODUCT" PLAYWRIGHT_FULLY_PARALLEL=1 '
        "PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/reports/product.json",
        'PLAYWRIGHT_WORKERS="$WORKERS_LINUX_DESIGN" '
        "PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/reports/design.json",
        "if: failure()",
        "name: browser-e2e-slot-${{ matrix.slot }}-of-4-diagnostics",
        "name: browser-durations-linux-slot-${{ matrix.slot }}-of-4",
        "test-results/**",
    )
    for evidence in required_shard_evidence:
        if evidence not in shards:
            raise WorkflowContractError(
                f"browser E2E matrix is missing fail-closed shard evidence: {evidence}"
            )
    if "continue-on-error" in shards:
        raise WorkflowContractError(
            "browser E2E shards must collect both suite results in shell and fail closed"
        )
    # The pull-request smoke test on Windows and macOS is acceptable only because Linux runs
    # the complete product and design suites whenever any browser suite runs. The one way the
    # Linux slots may drop out is the path filter's browser group, and validate_path_filter
    # holds that group true in full mode. Any other condition, and any mention of the matrix
    # plan, stays red.
    conditions = re.findall(r"^    if:[^\n]*", shards, re.MULTILINE)
    if conditions != [LINUX_BROWSER_GUARD] or "full_matrix" in shards:
        raise WorkflowContractError(
            "the Linux browser slots may only drop out through the path filter's browser group: "
            + LINUX_BROWSER_GUARD.strip()
        )

    required_aggregator_evidence = (
        "      - browser-e2e-shards\n",
        "    if: always()\n",
        "RESULT_BROWSER_E2E_SHARDS: ${{ needs['browser-e2e-shards'].result }}",
        'require browser-e2e-shards "$RESULT_BROWSER_E2E_SHARDS" "$SELECTED_BROWSER_E2E_SHARDS"',
        GATE_TAIL,
    )
    for evidence in required_aggregator_evidence:
        if evidence not in aggregator:
            raise WorkflowContractError(
                "stable browser-e2e aggregator is missing fail-closed evidence: " + evidence.strip()
            )
    if "continue-on-error" in aggregator or "strategy:" in aggregator:
        raise WorkflowContractError(
            "stable browser-e2e aggregator must be a single fail-closed branch-protection check"
        )


WORKER_SETTINGS = (
    "WORKERS_LINUX_PRODUCT",
    "WORKERS_LINUX_DESIGN",
    "WORKERS_WINDOWS",
    "WORKERS_MACOS",
)
CROSS_PLATFORM_WORKERS_BINDING = (
    "PLAYWRIGHT_WORKERS: ${{ matrix.os == 'windows-2025' "
    "&& env.WORKERS_WINDOWS || env.WORKERS_MACOS }}"
)


def validate_playwright_worker_settings(sources: dict[Path, str]) -> None:
    """Keep the worker count of every browser job in one workflow-level setting per system."""

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    head = workflow.split("\njobs:\n", 1)[0]
    declared = dict(re.findall(r'^  (WORKERS_[A-Z_]+): "([^"\n]*)"$', head, re.MULTILINE))
    if set(declared) != set(WORKER_SETTINGS) or not re.search(r"^env:$", head, re.MULTILINE):
        raise WorkflowContractError(
            "test.yml must declare one workflow-level worker count per system: "
            + ", ".join(WORKER_SETTINGS)
        )
    for name, value in declared.items():
        if not re.fullmatch(r"[1-9][0-9]*", value):
            raise WorkflowContractError(f"{name} must be a positive integer, not {value!r}")
    for job in ("browser-e2e-shards", "cross-platform-browser", "cross-platform-smoke"):
        body = _job_body(workflow, job)
        if re.search(r"PLAYWRIGHT_WORKERS(?:=|: )\s*[\"']?[0-9]", body) or "&& '1' ||" in body:
            raise WorkflowContractError(
                f"{job} must take its Playwright worker count from the WORKERS_* settings, "
                "not a literal"
            )
    if workflow.count(CROSS_PLATFORM_WORKERS_BINDING) != 2:
        raise WorkflowContractError(
            "the cross-platform browser slots and the smoke specs must both bind "
            "PLAYWRIGHT_WORKERS to the Windows and macOS settings"
        )


SERVER_START = "python apps/web/server.py 8010 --no-open"
SERVER_LOG_SETTINGS = (
    'export QUILTOR_LOG_FILE="$RUNNER_TEMP/quiltor-structured.log"',
    'echo "PLAYWRIGHT_SERVER_LOG=$QUILTOR_LOG_FILE" >> "$GITHUB_ENV"',
)


def validate_product_server_log(sources: dict[Path, str]) -> None:
    """Every product server of test.yml writes its structured log where the suite reads it.

    save-error-id.spec.ts looks the editor's error id up in that file and fails in CI when
    PLAYWRIGHT_SERVER_LOG is missing; this keeps the failure from appearing only at run time.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    starts = 0
    for job, body in _job_blocks(workflow):
        for step in body.split("\n      - ")[1:]:
            if SERVER_START not in step:
                continue
            starts += 1
            before = step.split(SERVER_START, 1)[0]
            missing = [line for line in SERVER_LOG_SETTINGS if line not in before]
            if missing:
                raise WorkflowContractError(
                    f"test.yml:{job} starts the product server without its log file; "
                    "set before the start: " + "; ".join(missing)
                )
    if starts == 0:
        raise WorkflowContractError("test.yml starts no product server on 8010")


def validate_cross_platform_browser_sharding(sources: dict[Path, str]) -> None:
    """Keep the full Windows and macOS matrix complete, balanced and fail-closed."""

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    browser = _job_body(workflow, "cross-platform-browser")
    product_config = (REPO_ROOT / "playwright.config.ts").read_text(encoding="utf-8")
    parallel_switch = 'fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1"'
    if product_config.count(parallel_switch) != 1:
        raise WorkflowContractError(
            "product Playwright config must expose one exact opt-in test-level sharding switch"
        )
    entries = re.findall(
        r"^\s+- os: (macos-15|windows-2025)\n"
        r"^[ \t]+system: ([^\n]+)\n"
        r"^[ \t]+label: ([^\n]+)\n"
        r"^[ \t]+slot: ([^\n]+)\n"
        r"^[ \t]+slots: ([^\n]+)\n"
        r"^[ \t]+diagnostics: ([^\n]+)$",
        browser,
        re.MULTILINE,
    )
    expected = {
        (
            os,
            system,
            f"{os} / slot {slot} of {count}",
            str(slot),
            str(count),
            f"{os}-{slot}-of-{count}",
        )
        for os, system, count in CROSS_PLATFORM_SLOTS
        for slot in range(1, count + 1)
    }
    if len(entries) != len(expected) or set(entries) != expected:
        raise WorkflowContractError(
            "the full cross-platform matrix must run slots 1..3 on macOS and 1..8 on Windows, "
            "each with both suites, one entry per slot, with unique diagnostics"
        )
    if "--shard=" in browser:
        raise WorkflowContractError(
            "the cross-platform slots must run their duration-assigned tests, none by count"
        )

    required_evidence = (
        "name: Browser on ${{ matrix.label }}",
        "    needs: plan\n",
        FULL_MATRIX_GUARD,
        "fail-fast: false",
        "if: matrix.slot == 1",
        "run: npx vitest run",
        CROSS_PLATFORM_WORKERS_BINDING,
        "SYSTEM: ${{ matrix.system }}",
        "SLOT: ${{ matrix.slot }}",
        "SLOTS: ${{ matrix.slots }}",
        "set +e",
        'if [ "$SYSTEM" = windows ]; then',
        'shape=(--max-tests 100 --offset "1=186000")',
        'shape=(--offset "1=150000")',
        'node tools/dev/test-shards.mjs select --os "$SYSTEM" --slots "$SLOTS" --slot "$SLOT" '
        '"${shape[@]}" --out-dir "$lists"',
        *SLOT_RUN_EVIDENCE,
        "PLAYWRIGHT_FULLY_PARALLEL=1 PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/reports/product.json",
        "PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/reports/design.json",
        "name: cross-platform-browser-${{ matrix.diagnostics }}-diagnostics",
        "name: browser-durations-${{ matrix.diagnostics }}",
        "test-results/**",
        "${{ runner.temp }}/quiltor-server.log",
    )
    for evidence in required_evidence:
        if evidence not in browser:
            raise WorkflowContractError(
                f"cross-platform browser matrix is missing shard evidence: {evidence}"
            )
    if "continue-on-error" in browser:
        raise WorkflowContractError("cross-platform browser shards must fail closed")


PLAYWRIGHT_LINUX = "tools/dev/playwright-linux.sh"
PLAYWRIGHT_LINUX_EVIDENCE = (
    "set -euo pipefail",
    "'Acquire::http::Timeout \"30\";'",
    "'Acquire::https::Timeout \"30\";'",
    "'Acquire::Retries \"3\";'",
    "/etc/apt/apt.conf.d/99quiltor-timeouts",
    'timeout --kill-after=15 "$1" npx playwright install-deps chromium',
    'if ! install_deps "$FIRST_LIMIT"; then',
    "sudo dpkg --configure -a",
    'echo "$FALLBACK_MIRROR" | sudo tee "$MIRRORS"',
    'if ! install_deps "$SECOND_LIMIT"; then\n'
    '    echo "::error::apt failed on ${FALLBACK_MIRROR} as well; '
    "the browser's system packages are missing\"\n"
    "    exit 1\n",
    "npx playwright install chromium",
)


def _linux_steps(job: str) -> list[str] | None:
    """The steps of a job that may run on Ubuntu, or None when it never does."""

    runs_on = re.search(r"^    runs-on: ([^\n]+)$", job, re.MULTILINE)
    target = runs_on.group(1) if runs_on else ""
    if "ubuntu" not in target and not ("matrix." in target and "ubuntu" in job):
        return None
    steps = re.split(r"^      - ", job, flags=re.MULTILINE)[1:]
    return [step for step in steps if "if: runner.os != 'Linux'" not in step]


def validate_linux_playwright_install(sources: dict[Path, str], script: str | None = None) -> None:
    """
    On Ubuntu, Chromium's apt packages install with a time limit and exactly one mirror switch.

    apt hung for 10-11 minutes in `playwright install --with-deps` on several Linux slots of two
    runs in a row. tools/dev/playwright-linux.sh bounds each attempt, switches the mirror once and
    fails after the second attempt; every Linux job that installs Chromium must go through it.
    """

    for path, source in sources.items():
        for name, job in _job_blocks(source):
            steps = _linux_steps(job)
            if steps is None:
                continue
            for step in steps:
                if "playwright install" in step and "--with-deps" in step:
                    raise WorkflowContractError(
                        f"{path.name}:{name} installs Playwright's apt packages without a time "
                        f"limit; use bash {PLAYWRIGHT_LINUX}"
                    )
    text = script if script is not None else (REPO_ROOT / PLAYWRIGHT_LINUX).read_text("utf-8")
    for evidence in PLAYWRIGHT_LINUX_EVIDENCE:
        if evidence not in text:
            raise WorkflowContractError(
                f"{PLAYWRIGHT_LINUX} must bound apt and fail after one mirror switch: "
                + evidence.strip().splitlines()[0]
            )
    if len(re.findall(r'\binstall_deps "\$', text)) != 2:
        raise WorkflowContractError(f"{PLAYWRIGHT_LINUX} must try apt exactly twice")
    if re.search(r"\|\|\s*(true|:)\b", text) or "set +e" in text:
        raise WorkflowContractError(f"{PLAYWRIGHT_LINUX} must not swallow a failed attempt")


WINDOWS_PORT_RANGE = "netsh int ipv4 set dynamicport tcp start=10000 num=55535"
WINDOWS_PORT_RANGE_CHECK = "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"


def _may_run_on_windows(job: str) -> bool:
    runs_on = re.search(r"^    runs-on: ([^\n]+)$", job, re.MULTILINE)
    target = runs_on.group(1) if runs_on else ""
    if "windows" in target:
        return True
    return "matrix." in target and any("windows" in v for v in _matrix_values(job, "os"))


def validate_windows_port_range(sources: dict[Path, str]) -> None:
    """
    Every Windows job of test.yml that runs Playwright widens the ephemeral port range first.

    The default 16384 ports ran out on browser slots (F2, WSAENOBUFS); the step must come before
    the first Playwright step and must fail the job when netsh refuses.
    """

    for path, source in sources.items():
        if path.name != "test.yml":
            continue
        for name, job in _job_blocks(source):
            if "playwright" not in job or not _may_run_on_windows(job):
                continue
            steps = re.split(r"^      - ", job, flags=re.MULTILINE)[1:]
            widen = [i for i, step in enumerate(steps) if WINDOWS_PORT_RANGE in step]
            first = next((i for i, step in enumerate(steps) if "playwright" in step), None)
            if not widen or first is None or widen[0] > first:
                raise WorkflowContractError(
                    f"{path.name}:{name} runs Playwright on Windows without widening the dynamic "
                    f"port range first: {WINDOWS_PORT_RANGE}"
                )
            step = steps[widen[0]]
            if (
                re.search(r"\|\|\s*(true|:)\b", step)
                or "continue-on-error" in step
                or f"{WINDOWS_PORT_RANGE}\n          {WINDOWS_PORT_RANGE_CHECK}" not in step
            ):
                raise WorkflowContractError(
                    f"{path.name}:{name} must fail when the port range cannot be widened"
                )


CHROMIUM_STARTS = "tools/dev/chromium-starts.mjs"
WINDOWS_ONLY = "if: runner.os == 'Windows'"
NOT_WINDOWS = "if: runner.os != 'Windows'"
WINDOWS_CHROMIUM_INSTALL = "run: npx playwright install chromium\n"
CHROMIUM_STARTS_STEP = f"run: node {CHROMIUM_STARTS}\n"
CHROMIUM_STARTS_EVIDENCE = ("chromium.launch(", "await page.setContent(", "process.exitCode = 1;")


def validate_windows_playwright_install(
    sources: dict[Path, str], script: str | None = None
) -> None:
    """
    test.yml's Windows browser jobs install Chromium without `--with-deps` and check it starts.

    The system half enabled Media Foundation on every Windows run (144-225 s per job); the full
    matrix passed without it (T-45). macOS keeps `--with-deps`. Since nothing installs the system
    half any more, tools/dev/chromium-starts.mjs launches the browser right after the download
    and fails the job before any test when it cannot start.
    """

    for path, source in sources.items():
        if path.name != "test.yml":
            continue
        for name, job in _job_blocks(source):
            if "playwright install" not in job or not _may_run_on_windows(job):
                continue
            steps = re.split(r"^      - ", job, flags=re.MULTILINE)[1:]
            installs = [i for i, step in enumerate(steps) if "playwright install" in step]
            windows = [i for i in installs if WINDOWS_ONLY in steps[i]]
            others = [i for i in installs if NOT_WINDOWS in steps[i]]
            if len(windows) != 1 or len(others) != 1 or len(installs) != 2:
                raise WorkflowContractError(
                    f"{path.name}:{name} must install Chromium in one step for Windows "
                    f"({WINDOWS_ONLY}) and one for the other systems ({NOT_WINDOWS})"
                )
            if (
                WINDOWS_CHROMIUM_INSTALL not in steps[windows[0]]
                or "--with-deps" in steps[windows[0]]
            ):
                raise WorkflowContractError(
                    f"{path.name}:{name} must install only the browser on Windows: "
                    + WINDOWS_CHROMIUM_INSTALL.strip()
                )
            if "playwright install --with-deps chromium" not in steps[others[0]]:
                raise WorkflowContractError(f"{path.name}:{name} must keep --with-deps for macOS")
            checks = [i for i, step in enumerate(steps) if CHROMIUM_STARTS_STEP in step]
            first_test = next(
                (i for i, step in enumerate(steps) if "playwright test" in step), len(steps)
            )
            if (
                len(checks) != 1
                or not windows[0] < checks[0] < first_test
                or WINDOWS_ONLY not in steps[checks[0]]
                or "continue-on-error" in steps[checks[0]]
                or re.search(r"\|\|\s*(true|:)\b", steps[checks[0]])
            ):
                raise WorkflowContractError(
                    f"{path.name}:{name} must check that Chromium starts on Windows, after the "
                    f"install and before the tests, and fail when it does not: node {CHROMIUM_STARTS}"
                )
    text = script if script is not None else (REPO_ROOT / CHROMIUM_STARTS).read_text("utf-8")
    for evidence in CHROMIUM_STARTS_EVIDENCE:
        if evidence not in text:
            raise WorkflowContractError(
                f"{CHROMIUM_STARTS} must launch Chromium, render a page and fail otherwise: "
                + evidence
            )


# Every browser slot, Linux and the full matrix alike: tools/dev/test-shards.mjs selects the
# slot's tests and has Playwright confirm the lists; a failed selection runs nothing and fails
# the slot, each suite's status counts, and the JSON reports with the durations are kept.
SLOT_RUN_EVIDENCE = (
    "select_status=$?",
    "product_status=1",
    "design_status=1",
    'if [ "$select_status" -eq 0 ]; then',
    'npx playwright test --test-list "$lists/product.txt" --output=test-results/product '
    "--reporter=line,json",
    "product_status=$?",
    "npx playwright test --config playwright.design.config.ts",
    '--test-list "$lists/design.txt" --output=test-results/design --reporter=line,json',
    "design_status=$?",
    'if [ "$select_status" -ne 0 ] || [ "$product_status" -ne 0 ] '
    '|| [ "$design_status" -ne 0 ]; then',
    "            exit 1\n",
    "if: ${{ !cancelled() }}",
    "retention-days: 7",
    "path: test-results/reports/*.json",
)
# (runner, the system name tools/dev/test-shards.mjs takes, slots)
CROSS_PLATFORM_SLOTS = (("macos-15", "macos", 3), ("windows-2025", "windows", 8))
LINUX_BROWSER_GUARD = "    if: needs.plan.outputs.run_browser == 'true'"
FULL_MATRIX_GUARD = (
    "if: needs.plan.outputs.full_matrix == 'true' && needs.plan.outputs.run_browser == 'true'"
)
REDUCED_MATRIX_GUARD = (
    "if: needs.plan.outputs.full_matrix != 'true' && needs.plan.outputs.run_browser == 'true'"
)
FULL_MATRIX_DECISION = (
    "FULL_MATRIX: ${{ inputs.full_matrix == true "
    "|| (github.event_name == 'push' && github.ref == 'refs/heads/main') "
    "|| (github.event_name != 'pull_request' && format('{0}', inputs.full_matrix) != 'false') }}"
)


def validate_full_matrix_switch(sources: dict[Path, str]) -> None:
    """
    One job decides between the full and the reduced matrix, and main always gets the full one.

    This is the interface a caller -- later release.yml through workflow_call -- relies on:
    a boolean input `full_matrix` on workflow_dispatch and workflow_call, and a `plan` job whose
    output every matrix job reads instead of looking at the event itself.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    triggers = workflow.partition("\njobs:")[0]
    for trigger in ("workflow_dispatch", "workflow_call"):
        block = re.search(
            rf"^  {trigger}:\n((?:    .*\n|\n)*)",
            triggers + "\n",
            re.MULTILINE,
        )
        body = block.group(1) if block else ""
        field = re.search(r"^      full_matrix:\n((?:        .*\n)*)", body, re.MULTILINE)
        fields = field.group(1) if field else ""
        if "        type: boolean\n" not in fields or "        default: true\n" not in fields:
            raise WorkflowContractError(
                f"test.yml {trigger} must declare the boolean input full_matrix, default true"
            )

    plan = _job_body(workflow, "plan")
    for evidence in (
        "full_matrix: ${{ steps.decide.outputs.full_matrix }}",
        FULL_MATRIX_DECISION,
        'echo "full_matrix=$FULL_MATRIX" >> "$GITHUB_OUTPUT"',
    ):
        if evidence not in plan:
            raise WorkflowContractError(f"the plan job is missing its matrix decision: {evidence}")
    # T-33 decided without checkout or actions. The path filter (T-37) needs exactly two:
    # a sparse checkout of the history, and the locked Python to run the base's filter,
    # both only on a pull request in reduced mode. validate_path_filter holds the rest.
    for step in re.split(r"^      - ", plan, flags=re.MULTILINE)[1:]:
        if "uses:" in step and f"if: {PATH_FILTER_CONDITION}\n" not in step:
            raise WorkflowContractError(
                "the plan job may use actions only for the path filter, on its condition"
            )
    uses = re.findall(r"uses:\s+([^\s@]+)@", plan)
    if sorted(uses) != ["actions/checkout", "actions/setup-python"]:
        raise WorkflowContractError(
            "the plan job may use only checkout and setup-python, once each, for the path filter"
        )
    permissions = re.search(r"^    permissions:\n((?:      .*\n)*)", plan, re.MULTILINE)
    granted = (
        re.findall(r"^      ([a-z-]+):", permissions.group(1), re.MULTILINE) if permissions else []
    )
    if granted != ["contents"] or "      contents: read" not in plan:
        raise WorkflowContractError(
            "the plan job may read the repository contents and nothing else"
        )

    for name, body in _job_blocks(workflow):
        if name != "plan" and "github.event_name" in body:
            raise WorkflowContractError(
                f"test.yml:{name} reads github.event_name; matrix decisions belong to the plan job"
            )
    if FULL_MATRIX_GUARD not in _job_body(workflow, "cross-platform-browser"):
        raise WorkflowContractError("the full cross-platform matrix must run on the plan decision")
    if REDUCED_MATRIX_GUARD not in _job_body(workflow, "cross-platform-smoke"):
        raise WorkflowContractError("the cross-platform smoke test must run on the reduced matrix")


PATH_FILTER_CONDITION = (
    "steps.decide.outputs.full_matrix != 'true' && github.event_name == 'pull_request'"
)
# The filter step runs the base's script on the base's configuration (F-37-3). A pull request
# that rewrites either is judged by the rules it replaces; a base without them writes nothing,
# and every run_<group> falls back to 'true'.
PATH_FILTER_COMMAND = (
    "        run: |\n"
    '          base="$RUNNER_TEMP/path-filter-base"\n'
    '          mkdir -p "$base/.github" "$base/distribution/tooling"\n'
    '          if git show HEAD^1:.github/test-paths.json > "$base/.github/test-paths.json" &&\n'
    "            git show HEAD^1:distribution/tooling/path_filter.py"
    ' > "$base/distribution/tooling/path_filter.py"; then\n'
    "            # A crashed filter must never mean fewer tests: it runs every group. The step\n"
    "            # itself stays green; later lines of $GITHUB_OUTPUT win over earlier ones.\n"
    '            python "$base/distribution/tooling/path_filter.py" plan --repository .'
    ' --merge HEAD --output "$GITHUB_OUTPUT" || {\n'
    '              echo "::warning::the path filter failed, running everything"\n'
    "              for group in checks python rust client browser lint; do\n"
    '                echo "run_$group=true" >> "$GITHUB_OUTPUT"\n'
    "              done\n"
    "            }\n"
    "          else\n"
    '            echo "::warning::the base has no readable path filter, running everything"\n'
    "          fi\n"
)
# Nothing of the pull request is needed in the working tree; VERSION keeps it to one file, and
# the next step follows right after it, so no second path can slip in.
PATH_FILTER_SPARSE = (
    "          sparse-checkout-cone-mode: false\n"
    "          sparse-checkout: |\n"
    "            VERSION\n"
    "      - name: Set up Python for the path filter\n"
)
LINT_TOOL = REPO_ROOT / "tools" / "dev" / "lint-tool.mjs"
JS_STRING = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
# Which plan output lets each job of test.yml run. The first is the job's `if:`, the second
# what the browser-e2e gate compares a skip with. Every job other than plan and browser-e2e
# must be listed: a new job has to be placed in a group before it can land.
FILTERED_JOBS = {
    "backend": (
        "needs.plan.outputs.run_python == 'true'",
        "needs.plan.outputs.run_python != 'false'",
    ),
    "portable-core": (
        "needs.plan.outputs.run_rust == 'true'",
        "needs.plan.outputs.run_rust != 'false'",
    ),
    "frontend": (
        "needs.plan.outputs.run_checks == 'true'",
        "needs.plan.outputs.run_checks != 'false'",
    ),
    "workflow-docker-shell-lint": (
        "needs.plan.outputs.run_lint == 'true'",
        "needs.plan.outputs.run_lint != 'false'",
    ),
    "browser-e2e-shards": (
        "needs.plan.outputs.run_browser == 'true'",
        "needs.plan.outputs.run_browser != 'false'",
    ),
    "visual-baseline-reach": (
        "needs.plan.outputs.run_browser == 'true'",
        "needs.plan.outputs.run_browser != 'false'",
    ),
    "cross-platform-native": (
        "needs.plan.outputs.run_python == 'true' || needs.plan.outputs.run_rust == 'true'",
        "needs.plan.outputs.run_python != 'false' || needs.plan.outputs.run_rust != 'false'",
    ),
    "cross-platform-browser": (
        FULL_MATRIX_GUARD.removeprefix("if: "),
        "needs.plan.outputs.full_matrix == 'true' && needs.plan.outputs.run_browser != 'false'",
    ),
    "cross-platform-smoke": (
        REDUCED_MATRIX_GUARD.removeprefix("if: "),
        "needs.plan.outputs.full_matrix != 'true' && needs.plan.outputs.run_browser != 'false'",
    ),
}
CLIENT_STEPS = ("Unit tests", "Type-check and build", "dist/ matches the sources")


def plan_output_expression(group: str) -> str:
    """The one allowed form of a run_<group> output: full mode first, only 'false' reduces."""

    return (
        f"${{{{ steps.decide.outputs.full_matrix == 'true' && 'true' || "
        f"(steps.filter.outputs.run_{group} == 'false' && 'false' || 'true') }}}}"
    )


def _env_name(job: str) -> str:
    return job.upper().replace("-", "_")


def _js_function(source: str, name: str) -> str:
    match = re.search(
        rf"^(?:export )?function {re.escape(name)}\([^)]*\) \{{\n(.*?)^\}}\n",
        source,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise WorkflowContractError(f"tools/dev/lint-tool.mjs has no function {name}")
    return match.group(1)


def _ls_files(pathspecs: list[str]) -> list[str]:
    if not pathspecs:
        return []
    result = subprocess.run(
        ["git", "ls-files", "-z", "--", *pathspecs],
        cwd=REPO_ROOT,
        capture_output=True,
        check=True,
    )
    return [path for path in result.stdout.decode("utf-8").split("\0") if path]


def lint_inputs(lint_tool: str | None = None) -> list[str]:
    """
    Every tracked file the lint job's tools read, derived from tools/dev/lint-tool.mjs.

    Each string literal in argumentsFor and osvLockfiles is resolved as a git pathspec, the way
    trackedFiles() resolves the hadolint and shellcheck patterns; an option or a word that names
    no file resolves to nothing. osvLockfiles also scans every lock the lock contract names, so
    those are added from distribution/dependency-locks.json. A new tool, pattern or lock is
    covered without touching this list.
    """

    source = lint_tool if lint_tool is not None else LINT_TOOL.read_text(encoding="utf-8")
    bodies = _js_function(source, "argumentsFor") + _js_function(source, "osvLockfiles")
    literals = sorted(
        {
            literal
            for literal in JS_STRING.findall(bodies)
            if literal and not literal.startswith("-") and literal != "utf8"
        }
    )
    files = set(_ls_files(literals))
    if "distribution/dependency-locks.json" in literals:
        document = json.loads(
            (REPO_ROOT / "distribution" / "dependency-locks.json").read_text(encoding="utf-8")
        )
        files.update(lock["path"] for lock in document["locks"])
    return sorted(files)


def lint_programs(workflow: str, package_json: str, tracked: list[str]) -> list[str]:
    """
    Every tracked file under tools/ that the lint job runs, derived from the job itself.

    The chain is `npm run <script>` in the job -> the script in package.json -> each tools/ path
    it names; a program the job starts directly (`node tools/...`, `python tools/...`) counts as
    well. A change to one of these files changes what the job does, so each must select lint.
    """

    return _job_programs(workflow, package_json, tracked, ("workflow-docker-shell-lint",), "lint")


# The jobs of the browser group; what they run decides which tests run on which slot.
BROWSER_JOBS = ("browser-e2e-shards", "cross-platform-browser", "cross-platform-smoke")


def browser_programs(workflow: str, package_json: str, tracked: list[str]) -> list[str]:
    """Every tracked file under tools/ that a browser job runs, derived as for the lint job."""

    return _job_programs(workflow, package_json, tracked, BROWSER_JOBS, "browser")


def _job_programs(
    workflow: str, package_json: str, tracked: list[str], jobs: tuple[str, ...], label: str
) -> list[str]:
    scripts = json.loads(package_json)["scripts"]
    commands = []
    for job in jobs:
        body = _job_body(workflow, job)
        commands.append(body)
        for name in re.findall(r"\bnpm run ([\w:.-]+)", body):
            if name not in scripts:
                raise WorkflowContractError(
                    f"the {label} job runs npm run {name}, which package.json lacks"
                )
            commands.append(scripts[name])
    known = set(tracked)
    return sorted(
        {
            path
            for command in commands
            for path in re.findall(r"\btools/[\w./-]+", command)
            if path in known
        }
    )


def client_test_inputs(tracked: list[str]) -> list[str]:
    """
    Every tracked file outside packages/ that a client unit test references.

    A test references a file by a relative import or path literal, by a repository path literal
    (`readFileSync(join(process.cwd(), "contracts/..."))`), or by the literal segments of a
    `join(process.cwd(), "a", "b")`. A referenced directory stands for every file below it.
    """

    known = set(tracked)
    referenced: set[str] = set()
    for test in tracked:
        if not test.startswith("packages/") or not re.search(r"\.test\.tsx?$", test):
            continue
        source = (REPO_ROOT / test).read_text(encoding="utf-8")
        candidates = set()
        for literal in JS_STRING.findall(source):
            if literal.startswith("."):
                candidates.add(posixpath.normpath(posixpath.join(posixpath.dirname(test), literal)))
            elif "/" in literal:
                candidates.add(literal)
        for call in re.findall(r"join\(process\.cwd\(\),((?:\s*\"[^\"]*\",?)+)\s*\)", source):
            candidates.add("/".join(JS_STRING.findall(call)))
        for candidate in candidates:
            if candidate in known:
                referenced.add(candidate)
            elif candidate and not candidate.startswith(".."):
                referenced.update(path for path in known if path.startswith(candidate + "/"))
    return sorted(path for path in referenced if not path.startswith("packages/"))


def _unselected(config: path_filter.Config, files: list[str], group: str) -> list[str]:
    return [path for path in files if not path_filter.plan(config, [path])[0][group]]


def validate_path_filter(sources: dict[Path, str], tracked: list[str] | None = None) -> None:
    """
    Pull requests run the job groups their paths need; everything else runs everything.

    .github/test-paths.json is the only place that maps paths to groups. It must cover every
    tracked file, and the plan job may only turn a group off on a pull request in reduced
    mode. Every other job reads only the plan's outputs, and browser-e2e lets a job be
    skipped only when the plan did not select it.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    triggers = workflow.partition("\njobs:")[0]
    if re.search(r"^\s+paths(?:-ignore)?:", triggers, re.MULTILINE):
        raise WorkflowContractError(
            "test.yml may not filter paths in its triggers; a skipped workflow reports nothing"
        )
    try:
        config = path_filter.load_config(REPO_ROOT / ".github" / "test-paths.json")
        files = tracked if tracked is not None else path_filter.tracked_paths(REPO_ROOT)
    except path_filter.PathFilterError as error:
        raise WorkflowContractError(f"the path filter configuration is invalid: {error}") from error
    except (OSError, subprocess.CalledProcessError) as error:
        raise WorkflowContractError(f"cannot list tracked files: {error}") from error
    errors = path_filter.coverage_errors(config, files)
    if errors:
        raise WorkflowContractError(
            "test-paths.json does not cover the repository: " + "; ".join(errors[:5])
        )
    try:
        linted = lint_inputs()
    except (OSError, KeyError, ValueError, subprocess.CalledProcessError) as error:
        raise WorkflowContractError(f"cannot derive the lint job's inputs: {error}") from error
    try:
        linted += lint_programs(
            workflow,
            (REPO_ROOT / "package.json").read_text(encoding="utf-8"),
            files,
        )
    except (OSError, KeyError, ValueError) as error:
        raise WorkflowContractError(f"cannot derive the lint job's programs: {error}") from error
    missing = _unselected(config, linted, "lint")
    if missing:
        raise WorkflowContractError(
            "a file the lint job's tools read must select the lint group: " + ", ".join(missing)
        )
    try:
        programs = browser_programs(
            workflow,
            (REPO_ROOT / "package.json").read_text(encoding="utf-8"),
            files,
        )
    except (OSError, KeyError, ValueError) as error:
        raise WorkflowContractError(f"cannot derive the browser jobs' programs: {error}") from error
    missing = _unselected(config, programs, "browser")
    if missing:
        raise WorkflowContractError(
            "a program a browser job runs must select the browser group: " + ", ".join(missing)
        )
    missing = _unselected(config, client_test_inputs(files), "client")
    if missing:
        raise WorkflowContractError(
            "a file a client unit test references must select the client group: "
            + ", ".join(missing)
        )

    plan = _job_body(workflow, "plan")
    outputs = re.findall(r"^      (run_[a-z0-9_]+): ([^\n]+)$", plan, re.MULTILINE)
    expected = [(f"run_{group}", plan_output_expression(group)) for group in config.groups]
    if sorted(outputs) != sorted(expected):
        raise WorkflowContractError(
            "the plan job needs one run_<group> output per test-paths group, each "
            "true in full mode and false only on the filter's literal 'false'"
        )
    if plan.count(f"if: {PATH_FILTER_CONDITION}\n") != 3:
        raise WorkflowContractError(
            "the path filter's checkout, Python and run must each be guarded by: "
            + PATH_FILTER_CONDITION
        )
    for evidence in (
        "      - id: filter\n",
        PATH_FILTER_COMMAND,
        "          fetch-depth: 2\n",
        PATH_FILTER_SPARSE,
        "          persist-credentials: false\n",
    ):
        if evidence not in plan:
            raise WorkflowContractError(f"the path filter step is missing: {evidence.strip()}")

    fallback = re.search(r"^ +for group in ([a-z0-9_ ]+); do$", plan, re.MULTILINE)
    if fallback is None or sorted(fallback.group(1).split()) != sorted(config.groups):
        raise WorkflowContractError(
            "the path filter's crash fallback must set run_<group>=true for exactly the "
            "test-paths groups: " + ", ".join(config.groups)
        )

    groups_read = set(re.findall(r"needs\.plan\.outputs\.run_([a-z0-9_]+)", workflow))
    if groups_read - set(config.groups):
        raise WorkflowContractError(
            "test.yml reads plan outputs no group declares: "
            + ", ".join(sorted(groups_read - set(config.groups)))
        )

    jobs = dict(_job_blocks(workflow))
    unplaced = set(jobs) - set(FILTERED_JOBS) - {"plan", "browser-e2e"}
    if unplaced:
        raise WorkflowContractError(
            "test.yml jobs without a path-filter group: " + ", ".join(sorted(unplaced))
        )
    # The browser jobs start beside frontend, not after it (T-46): they serve the committed
    # dist/ and take nothing from frontend. Its edge used to drop them whenever frontend was
    # filtered off; now every rule that selects browser must also select checks.
    for name in BROWSER_JOBS:
        if not re.search(r"^    needs: plan$", jobs.get(name, ""), re.MULTILINE):
            raise WorkflowContractError(
                f"test.yml:{name} must need only the plan job, so it starts beside frontend"
            )
    for rule in config.rules:
        if "browser" in rule.groups and "checks" not in rule.groups:
            raise WorkflowContractError(
                f"test-paths.json rule {rule.name!r} selects browser without checks; "
                "a browser job must never run without frontend"
            )
    for name, (condition, _) in FILTERED_JOBS.items():
        body = jobs.get(name)
        if body is None:
            raise WorkflowContractError(f"workflow is missing the {name} job")
        if not re.search(r"^    needs: (?:plan|\[plan, [a-z0-9-]+\])$", body, re.MULTILINE):
            raise WorkflowContractError(f"test.yml:{name} must need the plan job")
        if re.findall(r"^    if: ([^\n]*)$", body, re.MULTILINE) != [condition]:
            raise WorkflowContractError(f"test.yml:{name} must run on exactly: if: {condition}")
    for step in CLIENT_STEPS:
        guarded = f"      - name: {step}\n        if: needs.plan.outputs.run_client == 'true'\n"
        if guarded not in jobs["frontend"]:
            raise WorkflowContractError(f"the frontend step {step!r} must run on run_client")

    aggregator = jobs["browser-e2e"]
    needs = re.search(r"^    needs:\n((?:      - .*\n)*)", aggregator, re.MULTILINE)
    listed = re.findall(r"^      - ([a-z0-9-]+)$", needs.group(1), re.MULTILINE) if needs else []
    # The browser jobs no longer wait for frontend, so this gate is the only place a red
    # frontend turns the run red. It must stay a required need here, whatever FILTERED_JOBS says.
    if "frontend" not in listed or "frontend" not in FILTERED_JOBS:
        raise WorkflowContractError("browser-e2e must need and gate the frontend job")
    if sorted(listed) != sorted(["plan", *FILTERED_JOBS]):
        raise WorkflowContractError("browser-e2e must need the plan and every filtered job")
    for evidence in (
        "    if: always()\n",
        "          PLAN_RESULT: ${{ needs.plan.result }}\n",
        '          require plan "$PLAN_RESULT" true\n',
        '            if [ "$2" = "success" ]; then\n',
        '            elif [ "$2" = "skipped" ] && [ "$3" = "false" ]; then\n',
        "              status=1\n",
        GATE_TAIL,
    ):
        if evidence not in aggregator:
            raise WorkflowContractError(f"browser-e2e is missing its gate: {evidence.strip()}")
    for name, (_, selection) in FILTERED_JOBS.items():
        env = _env_name(name)
        for evidence in (
            f"          RESULT_{env}: ${{{{ needs['{name}'].result }}}}\n",
            f"          SELECTED_{env}: ${{{{ {selection} }}}}\n",
            f'          require {name} "$RESULT_{env}" "$SELECTED_{env}"\n',
        ):
            if evidence not in aggregator:
                raise WorkflowContractError(f"browser-e2e does not gate {name}: {evidence.strip()}")
    if "continue-on-error" in workflow:
        raise WorkflowContractError("test.yml may not use continue-on-error")


CHECK_RUNNER = "node tools/dev/run-check.mjs"


def _check_links(check_script: str) -> set[str]:
    """
    The npm scripts `npm run check` runs.

    `check` is either a chain of `npm run <script>` links or the parallel runner, whose LINKS
    array is then the only list of them.
    """

    if check_script.strip() == CHECK_RUNNER:
        runner = (REPO_ROOT / "tools" / "dev" / "run-check.mjs").read_text(encoding="utf-8")
        array = re.search(r"export const LINKS = \[(.*?)\];", runner, re.DOTALL)
        if array is None:
            raise WorkflowContractError("tools/dev/run-check.mjs must export its LINKS array")
        return set(re.findall(r'"([a-z0-9:-]+)"', array.group(1)))
    return {
        link.strip()[8:] for link in check_script.split("&&") if link.strip().startswith("npm run ")
    }


def validate_frontend_gates_once(sources: dict[Path, str]) -> None:
    """
    The frontend job runs the check:* gates once, through `npm run check`, not again in build.

    Its build step is the tail of the `build` script after the check:* gates. Every gate left
    out must be part of `check`, so nothing `build` checks goes unchecked in CI.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    frontend = _job_body(workflow, "frontend")
    scripts = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
    links = [link.strip() for link in scripts["build"].split("&&")]
    gates = [link for link in links if re.fullmatch(r"npm run check:[a-z0-9:-]+", link)]
    tail = [link for link in links if link not in gates]
    check_links = _check_links(scripts["check"])
    missing = [gate for gate in gates if gate[8:] not in check_links]
    if missing:
        raise WorkflowContractError(
            "package.json build runs gates that check does not: " + ", ".join(missing)
        )
    if "run: npm run check\n" not in frontend:
        raise WorkflowContractError("the frontend job must run npm run check")
    expected = "run: " + " && ".join(f"npx {link}" for link in tail) + "\n"
    if expected not in frontend:
        raise WorkflowContractError(
            f"the frontend build step must be the build script after its gates: {expected.strip()}"
        )
    if "npm run build" in re.sub(r"#[^\n]*|echo [^\n]*", "", frontend):
        raise WorkflowContractError("the frontend job must not run the check gates twice")


def validate_test_caches(sources: dict[Path, str]) -> None:
    """
    test.yml caches npm and nothing else.

    A browser cache would save at most the 7-27 s Chromium download per job, a pip cache less
    than half a minute (docs/quality/ci.md, "Caches"). Neither is worth the cache-poisoning
    surface a restored cache adds, so a new one needs a measurement and a change here first.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    if re.search(r"uses:\s+actions/cache(?:/[a-z]+)?@", workflow):
        raise WorkflowContractError("test.yml may not use actions/cache; it caches npm only")
    caches = set(re.findall(r"^\s+cache:\s*([^\s#]+)", workflow, re.MULTILINE))
    if caches - {"npm"}:
        raise WorkflowContractError(
            "test.yml caches npm only; found cache: " + ", ".join(sorted(caches - {"npm"}))
        )


# T-35: test.yml as the release's test evidence. release.yml calls it with full_matrix: true and
# builds artifacts only on the browser-e2e verdict full-success. The contracts below (C-1, C-2,
# C-7 for test.yml, C-8, C-13, C-18, C-20) hold that verdict to "every required job and every
# matrix expansion succeeded".

# The one filtered job that full mode skips: the pull-request smoke test standing in for the
# full Windows and macOS matrix. Every other filtered job must run in full mode.
REDUCED_ONLY = frozenset({"cross-platform-smoke"})
# Matrix expansions per job in full mode. A job not listed here has no matrix.
FULL_MATRIX_EXPANSIONS = {
    "browser-e2e-shards": 4,
    "cross-platform-native": 2,
    "cross-platform-browser": sum(count for _, _, count in CROSS_PLATFORM_SLOTS),
}
TEST_TRIGGERS = ("pull_request", "workflow_dispatch", "workflow_call")
VERDICT_OUTPUT = (
    "    outputs:\n"
    "      verdict:\n"
    '        description: "full-success only when every job the full matrix requires succeeded"\n'
    "        value: ${{ jobs.browser-e2e.outputs.verdict }}\n"
)
TEST_CONCURRENCY = (
    "\nconcurrency:\n"
    "  group: ${{ github.event_name == 'pull_request' && format('test-pr-{0}', github.ref) "
    "|| format('test-run-{0}', github.run_id) }}\n"
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n"
)
FULL_MODE_CHECK = (
    "          full_mode() {\n"
    '            if [ "$FULL_MATRIX" = "true" ] && [ "$2" != "$3" ]; then\n'
    '              echo "::error::$1 has selected=$2 in full mode; the full matrix requires $3."\n'
    "              status=1\n"
    "            fi\n"
    "          }\n"
)
# The end of the gate script: no verdict unless every check passed, full-success only in full
# mode. A red gate leaves the output empty, and an empty verdict builds nothing.
GATE_TAIL = (
    '          if [ "$status" -ne 0 ]; then\n'
    "            exit 1\n"
    "          fi\n"
    '          if [ "$FULL_MATRIX" = "true" ]; then\n'
    "            verdict=full-success\n"
    "          else\n"
    "            verdict=reduced-success\n"
    "          fi\n"
    '          echo "verdict=$verdict" >> "$GITHUB_OUTPUT"\n'
)


def _matrix_expansions(name: str, body: str) -> int:
    """How many jobs a matrix expands to: a product of flow lists, or one per `include:` row."""

    if "\n    strategy:\n" not in "\n" + body:
        return 1
    block = re.search(r"^      matrix:\n((?:        .*\n)*)", body, re.MULTILINE)
    if block is None:
        raise WorkflowContractError(f"test.yml:{name} has a strategy without a readable matrix")
    lines = block.group(1)
    if lines.startswith("        include:\n"):
        rows = lines.removeprefix("        include:\n")
        if re.search(r"^        \S", rows, re.MULTILINE):
            raise WorkflowContractError(
                f"test.yml:{name} mixes include: with other matrix keys; the contract cannot count it"
            )
        return len(re.findall(r"^          - ", rows, re.MULTILINE))
    total = 1
    for line in lines.splitlines():
        flow = re.fullmatch(r"        [a-z_]+: \[([^\]]*)\]", line)
        if flow is None:
            raise WorkflowContractError(
                f"test.yml:{name} has a matrix the contract cannot count: {line.strip()}"
            )
        total *= len([value for value in flow.group(1).split(",") if value.strip()])
    return total


def validate_full_matrix_coverage(sources: dict[Path, str]) -> None:
    """
    C-1: browser-e2e covers every job of test.yml, and its verdict is the workflow's output.

    validate_path_filter holds browser-e2e's needs to plan plus FILTERED_JOBS. This adds the
    other direction -- no job outside that set -- the matrix expansions full mode runs, and the
    workflow_call output a caller reads.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    triggers = workflow.partition("\njobs:")[0]
    call = re.search(r"^  workflow_call:\n((?:    .*\n|\n)*)", triggers + "\n", re.MULTILINE)
    if call is None or VERDICT_OUTPUT not in call.group(1):
        raise WorkflowContractError(
            "test.yml workflow_call must output verdict from jobs.browser-e2e.outputs.verdict"
        )
    if not set(FILTERED_JOBS) >= REDUCED_ONLY:
        raise WorkflowContractError("every reduced-only job must be a filtered job")
    jobs = dict(_job_blocks(workflow))
    if set(jobs) != {"plan", "browser-e2e", *FILTERED_JOBS}:
        raise WorkflowContractError(
            "test.yml must consist of plan, browser-e2e and the filtered jobs browser-e2e gates; "
            "found " + ", ".join(sorted(set(jobs) ^ {"plan", "browser-e2e", *FILTERED_JOBS}))
        )
    for name, body in jobs.items():
        if name in REDUCED_ONLY:
            continue
        count = _matrix_expansions(name, body)
        expected = FULL_MATRIX_EXPANSIONS.get(name, 1)
        if count != expected:
            raise WorkflowContractError(
                f"test.yml:{name} expands to {count} jobs in full mode; the contract expects "
                f"{expected}"
            )


def validate_full_matrix_verdict(sources: dict[Path, str]) -> None:
    """
    C-2: browser-e2e writes full-success only in full mode, and only after every check passed.

    In full mode every filtered job outside REDUCED_ONLY must be selected and the reduced-only
    ones must not be. The verdict is the last thing the gate does; a red gate leaves it empty.
    """

    aggregator = _job_body(sources[WORKFLOW_ROOT / "test.yml"], "browser-e2e")
    for evidence in (
        "    permissions: {}\n",
        "    outputs:\n      verdict: ${{ steps.gate.outputs.verdict }}\n",
        "        id: gate\n",
        "          FULL_MATRIX: ${{ needs.plan.outputs.full_matrix }}\n",
        FULL_MODE_CHECK,
    ):
        if evidence not in aggregator:
            raise WorkflowContractError(f"browser-e2e is missing its verdict: {evidence.strip()}")
    if aggregator.count("permissions:") != 1:
        raise WorkflowContractError("browser-e2e may hold no permissions: permissions: {}")
    if len(re.findall(r"^      - (?:name|id|uses|run):", aggregator, re.MULTILINE)) != 1:
        raise WorkflowContractError("browser-e2e must be one step, the gate")
    for name in FILTERED_JOBS:
        expected = "false" if name in REDUCED_ONLY else "true"
        line = f'          full_mode {name} "$SELECTED_{_env_name(name)}" {expected}\n'
        if aggregator.count(f"          full_mode {name} ") != 1 or line not in aggregator:
            raise WorkflowContractError(
                f"browser-e2e must require selected={expected} for {name} in full mode: "
                + line.strip()
            )
    # A job's body runs up to the next job header and so carries that job's leading comment.
    script_end = re.sub(r"(?:\n  #[^\n]*|\n[ \t]*)*\Z", "", aggregator)
    if not script_end.endswith(GATE_TAIL.rstrip("\n")):
        raise WorkflowContractError(
            "browser-e2e must end with the verdict, written only after every check passed"
        )
    if aggregator.count("GITHUB_OUTPUT") != 1 or aggregator.count("full-success") != 1:
        raise WorkflowContractError("browser-e2e may write its verdict in exactly one place")


def validate_test_triggers(sources: dict[Path, str]) -> None:
    """C-7, test.yml half: no push trigger. A push to main reaches the tests through release.yml."""

    triggers = sources[WORKFLOW_ROOT / "test.yml"].partition("\njobs:")[0]
    block = re.search(r"^on:\n((?:  .*\n|\n|#.*\n)*)", triggers, re.MULTILINE)
    found = re.findall(r"^  ([a-z_]+):", block.group(1), re.MULTILINE) if block else []
    if sorted(found) != sorted(TEST_TRIGGERS):
        raise WorkflowContractError(
            "test.yml must run on exactly "
            + ", ".join(TEST_TRIGGERS)
            + "; found "
            + ", ".join(found)
            + ". Pushes to main reach it through release.yml"
        )


def validate_test_concurrency(sources: dict[Path, str]) -> None:
    """
    C-8, test.yml half: only pull requests share a group and cancel superseded runs.

    Every other run -- a dispatch, or release.yml's call for a push to main -- has a group of its
    own, so a newer push can no longer cancel the tests of an older one.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    if TEST_CONCURRENCY not in workflow or workflow.count("concurrency:") != 1:
        raise WorkflowContractError(
            "test.yml needs exactly one concurrency, at the top: " + TEST_CONCURRENCY.strip()
        )


# Ways a test can read the run attempt: an environment lookup in any language, the expression
# context, or a shell expansion outside Python and TypeScript sources (whose string literals may
# name the variable without reading it, as the hand-off tag checks do).
ATTEMPT_READ = re.compile(
    r"(?:environ|getenv|process\.env|\$env:)[^\n]{0,8}GITHUB_RUN_ATTEMPT|github\.run_attempt"
)
ATTEMPT_EXPANSION = re.compile(r"\$\{?GITHUB_RUN_ATTEMPT")
TEXT_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".ps1", ".json", ".yml")


def validate_no_attempt_dependent_tests(files: dict[str, str] | None = None) -> None:
    """
    C-13: no test behaves differently on a re-run.

    "Re-run failed jobs" is how a red release continues. A test that reads the attempt number
    could pass on the second attempt only, and the verdict would hide that.
    """

    if files is None:
        files = {
            path: (REPO_ROOT / path).read_text(encoding="utf-8", errors="replace")
            for path in _ls_files(["tests"])
            if path.endswith(TEXT_SUFFIXES)
        }
    for path, source in sorted(files.items()):
        code = path.endswith((".py", ".ts", ".tsx", ".js", ".mjs", ".cjs"))
        if ATTEMPT_READ.search(source) or (not code and ATTEMPT_EXPANSION.search(source)):
            raise WorkflowContractError(
                f"{path} reads the run attempt; a test may not depend on it"
            )


CONDITION_TOKEN = re.compile(r"\s*('[^']*'|==|!=|&&|\|\||[()]|[A-Za-z_][A-Za-z0-9_.-]*)")


def evaluate_condition(expression: str, context: dict[str, str]) -> bool:
    """
    Evaluate a job condition of test.yml: ==, !=, &&, ||, brackets, string literals, context names.

    Fail-closed: any other form, a name the context lacks, or a non-boolean result raises
    ValueError instead of guessing.
    """

    text = expression.strip()
    if text.startswith("${{") and text.endswith("}}"):
        text = text[3:-2]
    tokens: list[str] = []
    position = 0
    while text[position:].strip():
        match = CONDITION_TOKEN.match(text, position)
        if match is None:
            raise ValueError(f"unknown form at: {text[position:].strip()}")
        tokens.append(match.group(1))
        position = match.end()
    index = 0

    def take() -> str:
        nonlocal index
        if index >= len(tokens):
            raise ValueError("the condition ends early")
        index += 1
        return tokens[index - 1]

    def primary() -> str | bool:
        word = take()
        if word == "(":
            value = disjunction()
            if take() != ")":
                raise ValueError("unbalanced brackets")
            return value
        if word.startswith("'"):
            return word[1:-1]
        if word in ("true", "false"):
            return word == "true"
        if word in context:
            return context[word]
        raise ValueError(f"unknown name or operator: {word}")

    def comparison() -> str | bool:
        left = primary()
        if index < len(tokens) and tokens[index] in ("==", "!="):
            operator = take()
            right = primary()
            if type(left) is not type(right):
                raise ValueError(f"compares {left!r} with {right!r}")
            return (left == right) == (operator == "==")
        return left

    def boolean(value: str | bool) -> bool:
        if not isinstance(value, bool):
            raise ValueError(f"{value!r} is not a comparison")
        return value

    def conjunction() -> bool:
        value = boolean(comparison())
        while index < len(tokens) and tokens[index] == "&&":
            take()
            value = boolean(comparison()) and value
        return value

    def disjunction() -> bool:
        value = conjunction()
        while index < len(tokens) and tokens[index] == "||":
            take()
            value = conjunction() or value
        return value

    result = disjunction()
    if index != len(tokens):
        raise ValueError(f"unparsed tail: {' '.join(tokens[index:])}")
    return result


def validate_full_mode_runs_everything(sources: dict[Path, str]) -> None:
    """
    C-18: in full mode every filtered job runs, except REDUCED_ONLY, which is skipped.

    Each job's `if:` and each gate selection is evaluated with full_matrix 'true'. Every
    run_<group> output must have the form that is 'true' in full mode, so it is 'true' here.
    A condition this check cannot read fails it.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    plan = _job_body(workflow, "plan")
    context = {"needs.plan.outputs.full_matrix": "true"}
    for output, expression in re.findall(r"^      (run_[a-z0-9_]+): ([^\n]+)$", plan, re.MULTILINE):
        if expression != plan_output_expression(output.removeprefix("run_")):
            raise WorkflowContractError(
                f"the plan output {output} must be 'true' in full mode: "
                + plan_output_expression(output.removeprefix("run_"))
            )
        context[f"needs.plan.outputs.{output}"] = "true"
    jobs = dict(_job_blocks(workflow))
    for name, (_, selection) in FILTERED_JOBS.items():
        expected = name not in REDUCED_ONLY
        conditions = re.findall(r"^    if: ([^\n]*)$", jobs.get(name, ""), re.MULTILINE)
        if len(conditions) != 1:
            raise WorkflowContractError(f"test.yml:{name} needs exactly one job condition")
        for kind, expression in (("condition", conditions[0]), ("gate selection", selection)):
            try:
                runs = evaluate_condition(expression, context)
            except ValueError as error:
                raise WorkflowContractError(
                    f"test.yml:{name} has a {kind} the full-mode check cannot read ({error}): "
                    + expression
                ) from error
            if runs is not expected:
                raise WorkflowContractError(
                    f"test.yml:{name} {'is skipped' if expected else 'runs'} in full mode; its "
                    f"{kind} must be {str(expected).lower()} there: {expression}"
                )


# Step conditions a job of test.yml may carry. Each is either fixed per matrix expansion or per
# runner, or true in full mode; none can drop a test from the full matrix.
STEP_CONDITIONS = (
    re.compile(r"matrix\.[a-z_]+ == (?:\d+|'[^'\n]*')"),
    re.compile(r"matrix\.[a-z_]+ != ''"),
    re.compile(r"runner\.os [!=]= 'Windows'"),
)
# Status functions are for collecting results after a test step, so only uploads may use them.
UPLOAD_CONDITIONS = ("failure()", "always()", "${{ !cancelled() }}")


def validate_required_step_conditions(sources: dict[Path, str]) -> None:
    """
    C-20: no step condition in a gated job can skip a test in full mode.

    The plan job is exempt; PATH_FILTER_CONDITION holds its three conditions.
    """

    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    outputs = dict(
        re.findall(r"^      (run_[a-z0-9_]+): ([^\n]+)$", _job_body(workflow, "plan"), re.MULTILINE)
    )
    for name, body in _job_blocks(workflow):
        if name == "plan":
            continue
        for step in re.split(r"^      - ", body, flags=re.MULTILINE)[1:]:
            for condition in re.findall(r"^(?:        )?if:[ ]*([^\n]*)$", step, re.MULTILINE):
                if any(pattern.fullmatch(condition) for pattern in STEP_CONDITIONS):
                    continue
                if condition in UPLOAD_CONDITIONS and re.search(
                    r"^        uses: actions/upload-artifact@", step, re.MULTILINE
                ):
                    continue
                group = re.fullmatch(r"needs\.plan\.outputs\.(run_[a-z0-9_]+) == 'true'", condition)
                if group and outputs.get(group.group(1)) == plan_output_expression(
                    group.group(1).removeprefix("run_")
                ):
                    continue
                raise WorkflowContractError(
                    f"test.yml:{name} has a step condition that could skip a test in full mode: "
                    f"if: {condition}"
                )


def validate_type_check_extras(sources: dict[Path, str], pyproject: Path | None = None) -> None:
    """
    The frontend job installs the optional packages pyright needs with the pyproject's own pins.

    pystray and Pillow come from the `desktop` extra and hatchling from `build-system.requires`;
    pywebview is left out on purpose (docs/quality/linting.md). The expectation is read from
    pyproject.toml, so a changed pin there fails here until test.yml follows.
    """

    path = pyproject or REPO_ROOT / "pyproject.toml"
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    extras = data["project"]["optional-dependencies"]["desktop"]
    build = data["build-system"]["requires"]
    expected = {
        spec.replace(" ", "")
        for spec in [*extras, *build]
        if re.match(r"(pystray|pillow|hatchling)\b", spec, re.IGNORECASE)
    }
    if len(expected) != 3:
        raise WorkflowContractError(
            "pyproject.toml must pin pystray, Pillow and hatchling for the type check"
        )
    frontend = _job_body(sources[WORKFLOW_ROOT / "test.yml"], "frontend")
    match = re.search(r"pip install[^\n]*-e \.([^\n]*)", frontend)
    if match is None:
        raise WorkflowContractError("the frontend job must install the project with pip -e .")
    installed = {spec.replace(" ", "") for spec in re.findall(r'"([^"]+)"', match.group(1))}
    if installed != expected:
        raise WorkflowContractError(
            "the frontend job's type-check extras differ from pyproject.toml: "
            f"installed {sorted(installed)}, pyproject pins {sorted(expected)}"
        )


def _job_body(source: str, name: str) -> str:
    try:
        jobs = source.split("\njobs:\n", 1)[1]
    except IndexError as error:
        raise WorkflowContractError("workflow has no jobs mapping") from error
    matches = list(JOB_HEADER.finditer(jobs))
    for index, match in enumerate(matches):
        if match.group(1) != name:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(jobs)
        return jobs[match.start() : end]
    raise WorkflowContractError(f"workflow is missing the {name} job")


def validate_native_release_targets(sources: dict[Path, str]) -> None:
    """Native release jobs and publishing must follow the opt-in target contract."""

    build = sources[WORKFLOW_ROOT / "release.yml"]
    publish = sources[WORKFLOW_ROOT / "release-publish.yml"]
    if build.count("release_manifest.py targets") != 1:
        raise WorkflowContractError("Release Build must resolve native targets exactly once")
    if publish.count("release_manifest.py targets") != 1:
        raise WorkflowContractError("Release Publish must resolve native targets exactly once")

    manifest_job = _job_body(build, "release-manifest")
    target_contracts = (
        ("macos_direct", "macos-direct", "macos-dmg"),
        ("windows_direct", "windows-direct", "windows-installer"),
    )
    for output, job_name, artifact_name in target_contracts:
        output_binding = f"{output}: ${{{{ steps.targets.outputs.{output} }}}}"
        if output_binding not in build:
            raise WorkflowContractError(f"Release Build does not expose the {output} target")

        native_job = _job_body(build, job_name)
        job_guard = f"if: needs.version-check.outputs.{output} == 'true'"
        if job_guard.removeprefix("if: ") not in (_and_terms(_job_condition(native_job)) or []):
            raise WorkflowContractError(f"{job_name} is not guarded by its opt-in target")

        enabled_result = re.compile(
            rf"needs\.version-check\.outputs\.{output} == 'true'\s*"
            rf"&& needs\['{re.escape(job_name)}'\]\.result == 'success'"
        )
        disabled_result = re.compile(
            rf"needs\.version-check\.outputs\.{output} == 'false'\s*"
            rf"&& needs\['{re.escape(job_name)}'\]\.result == 'skipped'"
        )
        if (
            enabled_result.search(manifest_job) is None
            or disabled_result.search(manifest_job) is None
        ):
            raise WorkflowContractError(
                f"release-manifest does not fail closed over the {job_name} result"
            )
        if job_guard not in manifest_job or f"name: {artifact_name}" not in manifest_job:
            raise WorkflowContractError(
                f"release-manifest does not conditionally download {artifact_name}"
            )

        publish_variable = output.upper()
        publish_output = f"{publish_variable}: ${{{{ steps.release-targets.outputs.{output} }}}}"
        if publish_output not in publish:
            raise WorkflowContractError(f"Release Publish does not expose the {output} target")
        conditional_download = re.compile(
            rf'if \[ "\${publish_variable}" = true \]; then\s*'
            rf'gh run download "\$RUN_ID" --name {re.escape(artifact_name)} '
            rf"--dir release-assets\s*fi"
        )
        if conditional_download.search(publish) is None:
            raise WorkflowContractError(
                f"Release Publish does not conditionally download {artifact_name}"
            )
        if publish.count(f"--name {artifact_name} --dir release-assets") != 1:
            raise WorkflowContractError(
                f"Release Publish has an ambiguous download path for {artifact_name}"
            )

    if "!cancelled()" not in manifest_job:
        raise WorkflowContractError("release-manifest cannot evaluate skipped native dependencies")
    if "release_manifest.py files" not in publish:
        raise WorkflowContractError("Release Publish must derive assets from the verified manifest")
    if "for artifact in release-manifest python-package; do" not in publish:
        raise WorkflowContractError("Release Publish must not require disabled native artifacts")
    draft_step = publish.split("- name: Create a draft release from the verified build", 1)[-1]
    draft_step = draft_step.split("- name: Promote immutable images and publish the draft", 1)[0]
    if ".dmg" in draft_step or ".exe" in draft_step:
        raise WorkflowContractError(
            "Release Publish must derive native asset names from the manifest"
        )


def validate_security_events_scope(sources: dict[Path, str]) -> None:
    """
    `security-events: write` belongs to the job that uploads results, never to the workflow.

    At workflow level every job would inherit it, and zizmor does not flag that in its default
    persona. Everything above the `jobs:` mapping is workflow level.
    """

    for path, source in sources.items():
        workflow_level = re.split(r"^jobs:", source, maxsplit=1, flags=re.MULTILINE)[0]
        if re.search(r"^\s*security-events\s*:\s*write", workflow_level, re.MULTILINE):
            raise WorkflowContractError(
                f"{path.name} grants security-events: write at workflow level; "
                "grant it in the job that uploads the results"
            )


WRITING_DATA_PUBLISH_INPUT = """    inputs:
      publish:
        description: Create the writing-data release and upload the database and its sources
        required: true
        type: boolean
        default: false
"""
WRITING_DATA_TAG_GUARD = '[[ "$TAG" =~ ^writing-data-[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}$ ]]'


def validate_writing_data(sources: dict[Path, str]) -> None:
    """
    The dictionary build publishes only on an explicit switch, and only as a data release.

    A run without `publish` must not be able to write anything: the workflow grants
    `contents: read`, and `contents: write` belongs to the publish job alone, which runs
    only when the switch is on. The release it creates carries the `writing-data-` tag
    prefix and is never marked latest, so app releases keep finding their predecessor
    (plan T-88, F-88-5).
    """

    source = sources.get(WORKFLOW_ROOT / "writing-data.yml")
    if source is None:
        raise WorkflowContractError("writing-data.yml is missing")
    header, _, _ = source.partition("\njobs:\n")
    triggers = header.split("\non:\n", 1)[-1].split("\n\n", 1)[0] + "\n"
    if re.findall(r"^  ([a-z_]+):", triggers, re.MULTILINE) != ["workflow_dispatch"]:
        raise WorkflowContractError("writing-data.yml may only be started by hand")
    if WRITING_DATA_PUBLISH_INPUT not in triggers:
        raise WorkflowContractError(
            "writing-data.yml needs a boolean publish input, off by default"
        )
    workflow_permissions = header.split("\npermissions:\n", 1)
    if len(workflow_permissions) != 2 or workflow_permissions[1].strip() != "contents: read":
        raise WorkflowContractError(
            "writing-data.yml must grant only contents: read at workflow level"
        )
    if "secrets." in source:
        raise WorkflowContractError("writing-data.yml may not read repository secrets")
    build = _job_body(source, "build")
    publish = _job_body(source, "publish")
    for forbidden in ("contents: write", "gh release", "GH_TOKEN"):
        if forbidden in build:
            raise WorkflowContractError(f"the writing-data build job may not publish: {forbidden}")
    if (
        source.count("contents: write") != 1
        or "\n    permissions:\n      contents: write\n" not in publish
    ):
        raise WorkflowContractError("only the writing-data publish job may write contents")
    if "\n    needs: build\n    if: inputs.publish\n" not in publish:
        raise WorkflowContractError("the writing-data publish job must wait for the publish switch")
    if source.count("gh release create") != 1 or "gh release create" not in publish:
        raise WorkflowContractError(
            "writing-data.yml must create exactly one release, when publishing"
        )
    if "--latest=false" not in publish:
        raise WorkflowContractError("a writing-data release must never be marked latest")
    if 'TAG="writing-data-$VERSION"' not in publish or WRITING_DATA_TAG_GUARD not in publish:
        raise WorkflowContractError("a writing-data release tag must be writing-data-<YYYY.MM.DD>")
    for path, other in sources.items():
        if path.name != "writing-data.yml" and "writing-data-" in other:
            raise WorkflowContractError(f"{path.name} may not create writing-data releases")


def _runs_line(job: str, evidence: str) -> bool:
    """A line of the job is the evidence, or the evidence followed by further arguments."""

    for line in job.splitlines():
        text = line.strip().removeprefix("- ")
        if text == evidence or text.startswith(evidence + " "):
            return True
    return False


def validate_preflight_coverage(
    sources: dict[Path, str],
    coverage: dict[str, tuple[str, tuple[str, ...]]] | None = None,
) -> None:
    """
    C-15: every preflight step the CI release scope skips runs in the full test matrix.

    Each covered label names a test.yml job that the path filter aggregates (FILTERED_JOBS)
    and lines that job runs verbatim. Where the matrix runs a different command than the
    preflight, the link between the two is checked as well.
    """

    covered = PREFLIGHT_COVERAGE if coverage is None else coverage
    workflow = sources[WORKFLOW_ROOT / "test.yml"]
    for label, (job_name, lines) in covered.items():
        if job_name not in FILTERED_JOBS:
            raise WorkflowContractError(
                f"preflight step {label!r} is covered by {job_name}, which the matrix does not "
                "require"
            )
        if not lines:
            raise WorkflowContractError(f"preflight step {label!r} names no covering line")
        job = _job_body(workflow, job_name)
        for evidence in lines:
            if not _runs_line(job, evidence):
                raise WorkflowContractError(
                    f"preflight step {label!r} is skipped in CI, but the {job_name} job "
                    f"does not run: {evidence}"
                )
    scripts = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
    if "Repository formatting" in covered and "check:format" not in _check_links(scripts["check"]):
        raise WorkflowContractError("npm run check must run check:format")
    if "Frontend unit suite" in covered and scripts.get("test") != "vitest run":
        raise WorkflowContractError(
            'package.json test must be "vitest run", the command the frontend job runs'
        )
    if "Frontend gates and production build" in covered:
        validate_frontend_gates_once(sources)


# T-35: release.yml is the single entry point for pushes to main and builds only on the called
# full test matrix's verdict. C-3 to C-12, C-15 (a, b), C-16, C-17 and C-19 hold that shape.

VERDICT_TERM = "needs.tests.outputs.verdict == 'full-success'"
RELEASE_TERM = "needs.release-plan.outputs.release == 'true'"
NOT_DRY_RUN = "needs.release-plan.outputs.dry_run == 'false'"
ARTIFACT_JOBS = ("web-image", "backup-image", "python-package", "macos-direct", "windows-direct")
ARTIFACT_NEEDS = frozenset(
    {"release-plan", "release-context", "version-check", "release-gate", "tests"}
)
REGISTRY_JOBS = ("web-image", "backup-image")
# A floor for the write class: if the detection below ever misses one of these, the contract
# fails instead of quietly checking fewer jobs.
KNOWN_WRITE_JOBS = frozenset(
    {"web-image", "backup-image", "macos-direct", "windows-direct", "release-manifest"}
)
SIGNING_JOBS = frozenset({"macos-direct", "windows-direct"})
REGISTRY_MARKERS = (
    "docker push",
    "docker buildx imagetools create",
    "oras push",
    "crane ",
    "skopeo copy",
)
PUSH_MARKERS = (*REGISTRY_MARKERS, "gh release", "git push")
# Workflows whose write jobs cannot hang on the release jobs by needs, with the reason.
WRITE_JOB_EXEMPT = {"release-publish.yml": "workflow_run after Release Build, see C-10"}
TRUSTLESS_TRIGGERS = ("workflow_run", "pull_request_target")
RECHECK_STEPS = (
    "Require the current main head again",
    "Require the version tag to be absent again",
)
CI_SCOPE_FLAG = "--ci-release-scope"
BOOTSTRAP_GUARD = (
    "      - name: Never write baselines to main\n"
    "        shell: bash\n"
    "        run: |\n"
    "          set -euo pipefail\n"
    '          [ "$TARGET_BRANCH" != main ] \\\n'
    '            || { echo "::error::baselines are filled on a branch before main, never on main";'
    " exit 1; }\n"
)


def _needs(body: str) -> list[str]:
    """A job's needs, from a scalar, a flow list or a block list."""

    match = re.search(r"^    needs:[ ]*([^\n]*)\n((?:      .*\n)*)", body, re.MULTILINE)
    if match is None:
        return []
    text = match.group(1) + "\n" + match.group(2)
    return re.findall(r"[a-z0-9][a-z0-9-]*", text.replace("needs:", ""))


def _permissions(block: str | None) -> str | dict[str, str] | None:
    """A permissions value: None when absent, a scalar like write-all, or scope -> level."""

    if block is None:
        return None
    scalar = block.strip()
    if scalar and not scalar.startswith("\n") and ":" not in scalar:
        return "" if scalar == "{}" else scalar
    return dict(re.findall(r"^\s+([a-z-]+):\s*([a-z-]+)", block, re.MULTILINE))


def _job_permissions(body: str) -> str | dict[str, str] | None:
    match = re.search(r"^    permissions:[ ]*([^\n]*)\n((?:      .*\n)*)", body, re.MULTILINE)
    if match is None:
        return None
    return _permissions(match.group(1) if match.group(1).strip() else "\n" + match.group(2))


def _workflow_permissions(source: str) -> str | dict[str, str] | None:
    head = source.partition("\njobs:")[0]
    match = re.search(r"^permissions:[ ]*([^\n]*)\n((?:  .*\n)*)", head, re.MULTILINE)
    if match is None:
        return None
    return _permissions(match.group(1) if match.group(1).strip() else "\n" + match.group(2))


def _writes(permissions: str | dict[str, str] | None) -> bool:
    if isinstance(permissions, str):
        return permissions == "write-all"
    return any(level == "write" for level in (permissions or {}).values())


def _steps(body: str) -> list[str]:
    return ["      - " + step for step in re.split(r"^      - ", body, flags=re.MULTILINE)[1:]]


def _pushes(body: str, markers: tuple[str, ...]) -> bool:
    """Whether a job can push: a login, a build-push not literally off, or a push command."""

    for step in _steps(body):
        if "docker/login-action@" in step:
            return True
        if "docker/build-push-action@" in step and not re.search(
            r"^          push: false$", step, re.MULTILINE
        ):
            return True
    return any(marker in body for marker in markers)


def write_jobs(source: str, markers: tuple[str, ...] = PUSH_MARKERS) -> set[str]:
    """
    The write class of a workflow (C-17): a write permission of its own or inherited, a
    registry or release push, a secret, or the release manifest.
    """

    inherited = _writes(_workflow_permissions(source))
    found = set()
    for name, body in _job_blocks(source):
        own = _job_permissions(body)
        if (
            (_writes(own) if own is not None else inherited)
            or _pushes(body, markers)
            or "secrets." in body
            or name == "release-manifest"
        ):
            found.add(name)
    return found


def validate_release_no_continue_on_error(sources: dict[Path, str]) -> None:
    """C-3, release half: a release job that may fail without failing the run proves nothing."""

    for name in ("release.yml", "release-publish.yml"):
        if "continue-on-error" in sources[WORKFLOW_ROOT / name]:
            raise WorkflowContractError(f"{name} may not use continue-on-error")


def validate_release_calls_full_matrix(sources: dict[Path, str]) -> None:
    """C-4: release.yml calls test.yml once, in tests, with a literal full_matrix: true."""

    calls = [
        (path.name, name)
        for path, source in sources.items()
        for name, body in _job_blocks(source)
        if re.search(r"^    uses: \./\.github/workflows/test\.yml$", body, re.MULTILINE)
    ]
    if calls != [("release.yml", "tests")]:
        raise WorkflowContractError(
            "only release.yml:tests may call test.yml, exactly once; found "
            + ", ".join(f"{path}:{name}" for path, name in calls)
        )
    tests = _job_body(sources[WORKFLOW_ROOT / "release.yml"], "tests")
    inputs = re.search(r"^    with:\n((?:      .*\n)*)", tests, re.MULTILINE)
    if inputs is None or inputs.group(1) != "      full_matrix: true\n":
        raise WorkflowContractError(
            "release.yml:tests must pass exactly with: full_matrix: true, as a literal"
        )
    if re.search(r"^    (?:needs|if):", tests, re.MULTILINE):
        raise WorkflowContractError(
            "release.yml:tests may depend on nothing: every push to main gets its tests"
        )


def validate_tests_call_permissions(sources: dict[Path, str]) -> None:
    """C-5: the call reads the repository and nothing else, and hands over no secret."""

    tests = _job_body(sources[WORKFLOW_ROOT / "release.yml"], "tests")
    if _job_permissions(tests) != {"contents": "read"}:
        raise WorkflowContractError(
            "release.yml:tests must hold exactly permissions: contents: read"
        )
    if re.search(r"^    secrets:", tests, re.MULTILINE):
        raise WorkflowContractError("release.yml:tests may hand no secrets to test.yml")


def validate_artifact_edges(sources: dict[Path, str]) -> None:
    """
    C-6: every artifact job needs the release jobs and the tests, and runs on full-success.

    release-gate runs beside the tests (R5) and so does not need them. release-manifest and
    release-complete require the same verdict.
    """

    build = sources[WORKFLOW_ROOT / "release.yml"]
    for name in ARTIFACT_JOBS:
        body = _job_body(build, name)
        missing = ARTIFACT_NEEDS - set(_needs(body))
        if missing:
            raise WorkflowContractError(
                f"release.yml:{name} must need " + ", ".join(sorted(missing))
            )
        terms = _and_terms(_job_condition(body)) or []
        for term in (RELEASE_TERM, VERDICT_TERM):
            if term not in terms:
                raise WorkflowContractError(f"release.yml:{name} must run only on: {term}")
    if "tests" in _needs(_job_body(build, "release-gate")):
        raise WorkflowContractError("release-gate runs beside the tests and may not need them")
    if VERDICT_TERM not in (_and_terms(_job_condition(_job_body(build, "release-manifest"))) or []):
        raise WorkflowContractError("release-manifest must run only on: " + VERDICT_TERM)
    complete = _job_body(build, "release-complete")
    for evidence in (
        "    if: ${{ always() && needs.release-plan.outputs.release == 'true' }}\n",
        "          VERDICT: ${{ needs.tests.outputs.verdict }}\n",
        '          [ "$VERDICT" = full-success ] \\\n',
        '            [ "$MANIFEST" = skipped ] \\\n',
        '            [ "$MANIFEST" = success ] ||',
        "    permissions: {}\n",
    ):
        if evidence not in complete:
            raise WorkflowContractError(f"release-complete is missing: {evidence.strip()}")
    if set(_needs(complete)) != {"release-plan", "tests", *ARTIFACT_JOBS, "release-manifest"}:
        raise WorkflowContractError(
            "release-complete must need the plan, tests and every artifact job"
        )


RELEASE_PLAN_EVIDENCE = (
    '          if [[ ! "$BEFORE" =~ ^[0-9a-f]{40}$ ]] \\\n'
    '            || [ "$BEFORE" = 0000000000000000000000000000000000000000 ] \\\n'
    '            || ! git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then\n'
    '            echo "release=true" >> "$GITHUB_OUTPUT"\n',
    '          if git diff --quiet "$BEFORE" "$GITHUB_SHA" -- VERSION; then\n'
    '            echo "release=false" >> "$GITHUB_OUTPUT"\n'
    "          else\n"
    '            echo "release=true" >> "$GITHUB_OUTPUT"\n',
)


def validate_single_entry(sources: dict[Path, str]) -> None:
    """
    C-7, release half: every push to main enters release.yml, and only release-plan decides.

    Unknown history counts as a release candidate; doubt never costs tests, which hang on
    nothing.
    """

    build = sources[WORKFLOW_ROOT / "release.yml"]
    triggers = build.partition("\njobs:")[0]
    push = re.search(r"^  push:\n((?:    .*\n)*)", triggers, re.MULTILINE)
    if push is None or push.group(1) != "    branches: [main]\n":
        raise WorkflowContractError("release.yml must run on every push to main: branches: [main]")
    plan = _job_body(build, "release-plan")
    for evidence in RELEASE_PLAN_EVIDENCE:
        if evidence not in plan:
            raise WorkflowContractError(f"release-plan is missing its decision: {evidence.strip()}")
    for name, body in _job_blocks(build):
        if name != "release-plan" and re.search(r"echo \"release=", body):
            raise WorkflowContractError(
                f"release.yml:{name} decides release; only release-plan may"
            )


def validate_release_concurrency(sources: dict[Path, str]) -> None:
    """C-8, release half: no group, so a newer push never replaces an older pending run."""

    if re.search(r"^\s*concurrency:", sources[WORKFLOW_ROOT / "release.yml"], re.MULTILINE):
        raise WorkflowContractError(
            "release.yml may have no concurrency: a shared group drops pending runs and their tests"
        )


def validate_dry_run_boundary(sources: dict[Path, str]) -> None:
    """
    C-9: a dry run pushes nothing, signs nothing and creates no manifest.

    Only release-plan reads the input; every other job reads its output.
    """

    build = sources[WORKFLOW_ROOT / "release.yml"]
    triggers = build.partition("\njobs:")[0]
    dispatch = re.search(r"^  workflow_dispatch:\n((?:    .*\n)*)", triggers, re.MULTILINE)
    if (
        dispatch is None
        or "      dry_run:\n" not in dispatch.group(1)
        or triggers.count("dry_run:") != 1
    ):
        raise WorkflowContractError("dry_run must be a workflow_dispatch input and nothing else")
    if build.count("inputs.dry_run") != 1 or "inputs.dry_run" not in _job_body(
        build, "release-plan"
    ):
        raise WorkflowContractError("only release-plan may read inputs.dry_run")
    for name in REGISTRY_JOBS:
        body = _job_body(build, name)
        for step in _steps(body):
            if "docker/login-action@" in step and f"        if: {NOT_DRY_RUN}\n" not in step:
                raise WorkflowContractError(f"release.yml:{name} may log in only outside a dry run")
            if "docker/build-push-action@" in step and (
                f"          push: ${{{{ {NOT_DRY_RUN} }}}}\n" not in step
            ):
                raise WorkflowContractError(f"release.yml:{name} may push only outside a dry run")
    if NOT_DRY_RUN not in (_and_terms(_job_condition(_job_body(build, "release-manifest"))) or []):
        raise WorkflowContractError("release-manifest must never run in a dry run: " + NOT_DRY_RUN)
    context = _job_body(build, "release-context")
    for evidence in (
        "          DRY_RUN: ${{ needs.release-plan.outputs.dry_run }}\n",
        '          [ "$GITHUB_REF" = "refs/heads/main" ] || [ "$DRY_RUN" = true ] \\\n',
    ):
        if evidence not in context:
            raise WorkflowContractError(
                f"release-context is missing its main guard: {evidence.strip()}"
            )


def validate_publish_selection(sources: dict[Path, str]) -> None:
    """
    C-10: Publish acts only on a successful main run of Release Build that built a manifest.

    A second run for a released version stops at the existing checks (F-35-15): an already
    published release, or a draft that points at another revision.
    """

    publish = sources[WORKFLOW_ROOT / "release-publish.yml"]
    select = _job_body(publish, "select")
    for evidence in (
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.head_branch == 'main'",
        '/actions/runs/$RUN_ID/artifacts?name=release-manifest" --jq .total_count',
        '          if [ "$COUNT" = 1 ]; then\n',
        'echo "::error::run $RUN_ID has no release manifest"',
    ):
        if evidence not in select:
            raise WorkflowContractError(f"release-publish select is missing: {evidence.strip()}")
    if _job_permissions(select) != {"actions": "read"}:
        raise WorkflowContractError("release-publish select may only read actions")
    body = _job_body(publish, "publish")
    if (
        _needs(body) != ["select"]
        or _job_condition(body) != "needs.select.outputs.release == 'true'"
    ):
        raise WorkflowContractError(
            "release-publish publish must need select and run only on its release output"
        )
    for evidence in (
        '[ "$HEAD_BRANCH" = main ]',
        '[ "$CONCLUSION" = success ]',
        "is already published",
        "existing draft points at another revision",
        '--json isDraft --jq .isDraft)" = true ]',
        "  group: release-publish\n  cancel-in-progress: false\n",
    ):
        if evidence not in publish:
            raise WorkflowContractError(
                f"release-publish is missing a run check: {evidence.strip()}"
            )
    if publish.count('commits/main" --jq .sha') != 3:
        raise WorkflowContractError("release-publish must check the main head three times")


def validate_release_cache_boundary(sources: dict[Path, str]) -> None:
    """
    C-11: nothing that builds or publishes a release restores a cache another run could write.

    cache-mode: none waits for an actionlint release that knows the key (F-35-16, T-144); until
    then the keyword checks below hold the boundary.
    """

    for path, source in sources.items():
        triggers = source.partition("\njobs:")[0]
        if re.search(r"^  pull_request_target:", triggers, re.MULTILINE):
            raise WorkflowContractError(f"{path.name} may not run on pull_request_target")
        trustless = any(
            re.search(rf"^  {trigger}:", triggers, re.MULTILINE) for trigger in TRUSTLESS_TRIGGERS
        )
        if trustless and re.search(r"cache-mode:\s*(?:write|write-only)\b", source):
            raise WorkflowContractError(
                f"{path.name} has a trustless trigger and may not write caches"
            )
        if trustless and re.search(r"\bcache:|actions/cache|cache-dependency-path", source):
            raise WorkflowContractError(
                f"{path.name} has a trustless trigger and may not use a cache"
            )
    build = sources[WORKFLOW_ROOT / "release.yml"]
    for name in (*ARTIFACT_JOBS, "release-manifest"):
        body = _job_body(build, name)
        if re.search(r"^\s+cache:|actions/cache|cache-dependency-path", body, re.MULTILINE):
            raise WorkflowContractError(
                f"release.yml:{name} builds an artifact and may not use a cache"
            )
        for step in _steps(body):
            if "actions/setup-node@" in step and "package-manager-cache: false" not in step:
                raise WorkflowContractError(
                    f"release.yml:{name} must set package-manager-cache: false on setup-node"
                )


def validate_rerun_rechecks(sources: dict[Path, str]) -> None:
    """C-12: release-manifest checks the main head and the tag again before it downloads."""

    manifest = _job_body(sources[WORKFLOW_ROOT / "release.yml"], "release-manifest")
    steps = _steps(manifest)
    names = [re.match(r"      - name: ([^\n]+)", step) for step in steps[:2]]
    if [match.group(1) if match else "" for match in names] != list(RECHECK_STEPS):
        raise WorkflowContractError(
            "release-manifest must start with: " + ", then ".join(RECHECK_STEPS)
        )
    head, tag = steps[0], steps[1]
    if '[ "$GITHUB_SHA" = "$MAIN_SHA" ]' not in head or 'commits/main" --jq .sha' not in head:
        raise WorkflowContractError("release-manifest must compare the revision with main again")
    if 'grep -qxF "refs/tags/v$VERSION"' not in tag or "exit 1" not in tag:
        raise WorkflowContractError("release-manifest must refuse an existing version tag again")


def validate_ci_release_scope(sources: dict[Path, str]) -> None:
    """
    C-15 (a, b): the reduced preflight runs only in release-gate, and whatever builds on that
    gate also builds on the full test matrix.
    """

    uses = [
        (path.name, name)
        for path, source in sources.items()
        for name, body in _job_blocks(source)
        for _ in range(body.count(CI_SCOPE_FLAG))
    ]
    if uses != [("release.yml", "release-gate")]:
        raise WorkflowContractError(
            f"{CI_SCOPE_FLAG} may appear once, in release.yml:release-gate; found "
            + ", ".join(f"{path}:{name}" for path, name in uses)
        )
    package = (REPO_ROOT / "package.json").read_text(encoding="utf-8")
    if CI_SCOPE_FLAG in package:
        raise WorkflowContractError(f"package.json may not run the preflight with {CI_SCOPE_FLAG}")
    build = sources[WORKFLOW_ROOT / "release.yml"]
    for name, body in _job_blocks(build):
        if "release-gate" in _needs(body) and (
            "tests" not in _needs(body)
            or VERDICT_TERM not in (_and_terms(_job_condition(body)) or [])
        ):
            raise WorkflowContractError(
                f"release.yml:{name} builds on release-gate and so needs tests and {VERDICT_TERM}"
            )


DOC_ANCHORS = {
    ".github/workflows/README.md": (
        "single entry point for every push to `main`",
        "called full test matrix",
        "never treated as release evidence",
        "`full-success`",
        "never runs on `main` by itself",
        "Full test matrix / browser-e2e",
        "`dry_run: true`",
        "The bootstrap never runs on `main`",
        "Re-running a red release",
        "privileges of the actor who",
        "Orphaned hand-off images",
        "--ci-release-scope",
    ),
    "distribution/README.md": ("single entry point for pushes to `main`", "called full"),
    "docs/quality/ci.md": ("Full test matrix / browser-e2e", "verdict=full-success"),
}


def validate_release_docs(
    repo_root: Path | None = None, docs: dict[str, str] | None = None
) -> None:
    """C-14: the documentation names the single-entry flow the workflows implement."""

    root = REPO_ROOT if repo_root is None else repo_root
    for name, anchors in DOC_ANCHORS.items():
        text = (
            docs[name]
            if docs is not None and name in docs
            else (root / name).read_text(encoding="utf-8")
        )
        flat = " ".join(text.split())
        for anchor in anchors:
            if anchor not in flat:
                raise WorkflowContractError(f"{name} must state: {anchor}")


def validate_bootstrap_never_on_main(sources: dict[Path, str]) -> None:
    """C-16: the baseline bootstrap never pushes to main, whether by push or by dispatch."""

    bootstrap = sources[WORKFLOW_ROOT / "visual-baselines-bootstrap.yml"]
    triggers = bootstrap.partition("\njobs:")[0]
    if not re.search(r"^  push:\n    branches-ignore: \[main\]\n", triggers, re.MULTILINE):
        raise WorkflowContractError("visual-baselines-bootstrap.yml must ignore pushes to main")
    gap = _steps(_job_body(bootstrap, "gap"))
    if not gap or gap[0] != BOOTSTRAP_GUARD:
        raise WorkflowContractError("the bootstrap gap job must refuse main in its first step")
    steps = _steps(_job_body(bootstrap, "bootstrap"))
    pushing = [index for index, step in enumerate(steps) if "git push" in step]
    if len(pushing) != 1 or pushing[0] == 0 or steps[pushing[0] - 1] != BOOTSTRAP_GUARD:
        raise WorkflowContractError(
            "the bootstrap must refuse main in the step right before it pushes"
        )


def validate_write_jobs_need_tests_and_gate(sources: dict[Path, str]) -> None:
    """
    C-17: every job that writes, pushes, reads a secret or creates the manifest needs tests and
    release-gate directly and runs only on full-success.

    Directly, because only a direct need is readable in `if:`, and a job in between with
    always() would run after a red one. Publish cannot need across workflows; its select job
    takes that place (WRITE_JOB_EXEMPT, C-10).
    """

    build = sources[WORKFLOW_ROOT / "release.yml"]
    if _writes(_workflow_permissions(build)):
        raise WorkflowContractError("release.yml may grant no write permission at workflow level")
    found = write_jobs(build)
    if not found >= KNOWN_WRITE_JOBS:
        raise WorkflowContractError(
            "release.yml write jobs not recognized: " + ", ".join(sorted(KNOWN_WRITE_JOBS - found))
        )
    if found & {"tests", "release-gate"}:
        raise WorkflowContractError("tests and release-gate may not write, push or read secrets")
    jobs = dict(_job_blocks(build))
    for name in sorted(found):
        body = jobs[name]
        if not {"tests", "release-gate"} <= set(_needs(body)):
            raise WorkflowContractError(
                f"release.yml:{name} writes and must need tests and release-gate"
            )
        condition = _job_condition(body)
        terms = _and_terms(condition)
        if terms is None or VERDICT_TERM not in terms or "always()" in condition:
            raise WorkflowContractError(
                f"release.yml:{name} writes and must run only on {VERDICT_TERM}, with no || "
                "around it and no always()"
            )
    publish = sources[WORKFLOW_ROOT / "release-publish.yml"]
    inherited = _writes(_workflow_permissions(publish))
    for name, body in _job_blocks(publish):
        own = _job_permissions(body)
        writes = _writes(own) if own is not None else inherited
        if name == "select":
            if own is None or _writes(own):
                raise WorkflowContractError(
                    "release-publish select needs its own read-only permissions"
                )
        elif writes and (
            _needs(body) != ["select"]
            or _job_condition(body) != "needs.select.outputs.release == 'true'"
        ):
            raise WorkflowContractError(
                f"release-publish.yml:{name} writes and must run only on select's release output"
            )
    for path, source in sources.items():
        if path.name in {"release.yml", *WRITE_JOB_EXEMPT}:
            continue
        inherited = _writes(_workflow_permissions(source))
        for name, body in _job_blocks(source):
            own = _job_permissions(body)
            if (_writes(own) if own is not None else inherited) and _pushes(body, REGISTRY_MARKERS):
                raise WorkflowContractError(
                    f"{path.name}:{name} pushes to a registry; only release.yml and the "
                    "exempt publisher may"
                )


def validate_dry_run_skips_secrets(sources: dict[Path, str]) -> None:
    """C-19: a dry run reads no secret: every job that does runs only outside one."""

    build = sources[WORKFLOW_ROOT / "release.yml"]
    jobs = dict(_job_blocks(build))
    readers = {name for name, body in jobs.items() if "secrets." in body}
    if not set(jobs) >= SIGNING_JOBS:
        raise WorkflowContractError(
            "release.yml signing jobs missing: " + ", ".join(sorted(SIGNING_JOBS - set(jobs)))
        )
    for name in sorted(readers | SIGNING_JOBS):
        if NOT_DRY_RUN not in (_and_terms(_job_condition(jobs[name])) or []):
            raise WorkflowContractError(
                f"release.yml:{name} reads secrets and must run only on: {NOT_DRY_RUN}"
            )


def _job_condition(body: str) -> str:
    """A job's `if:` as one line, from a plain or a folded scalar, without `${{ }}`."""

    match = re.search(r"^    if: ?([^\n]*)$", body, re.MULTILINE)
    if match is None:
        return ""
    text = match.group(1).strip()
    if text in (">-", ">", "|", "|-"):
        lines = []
        for line in body[match.end() + 1 :].splitlines():
            if not line.startswith("      "):
                break
            lines.append(line.strip())
        text = " ".join(lines)
    if text.startswith("${{") and text.endswith("}}"):
        text = text[3:-2]
    return " ".join(text.split())


def _and_terms(condition: str) -> list[str] | None:
    """
    The top-level `&&` members of a condition, or None when it has a top-level `||`.

    A member must hold for the condition to hold only when nothing outside brackets can bypass
    it, which is why an `||` at the top level makes every member optional.
    """

    terms: list[str] = []
    depth = 0
    start = 0
    index = 0
    while index < len(condition):
        char = condition[index]
        if char == "'":
            index = condition.index("'", index + 1) + 1
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif depth == 0 and condition.startswith("&&", index):
            terms.append(condition[start:index].strip())
            start = index + 2
            index += 2
            continue
        elif depth == 0 and condition.startswith("||", index):
            return None
        index += 1
    terms.append(condition[start:].strip())
    return [term for term in terms if term]


def validate_repository(repo_root: Path = REPO_ROOT) -> None:
    global REPO_ROOT, WORKFLOW_ROOT, ACTION_LOCK, TOOLCHAIN_LOCK
    original = (REPO_ROOT, WORKFLOW_ROOT, ACTION_LOCK, TOOLCHAIN_LOCK)
    try:
        REPO_ROOT = repo_root
        WORKFLOW_ROOT = repo_root / ".github" / "workflows"
        ACTION_LOCK = repo_root / ".github" / "actions.lock.json"
        TOOLCHAIN_LOCK = repo_root / "distribution" / "toolchains.json"
        sources = _workflow_sources(WORKFLOW_ROOT)
        locked_actions = action_lock(ACTION_LOCK)
        validate_actions(sources, locked_actions)
        validate_toolchains(sources, toolchain_lock(TOOLCHAIN_LOCK))
        validate_rust_toolchain_steps(sources)
        validate_job_runtime_setups(sources, locked_actions)
        validate_cargo(sources)
        validate_publication_boundary(sources)
        validate_image_size_guard(sources)
        validate_browser_e2e_sharding(sources)
        validate_cross_platform_browser_sharding(sources)
        validate_playwright_worker_settings(sources)
        validate_product_server_log(sources)
        validate_linux_playwright_install(sources)
        validate_windows_port_range(sources)
        validate_windows_playwright_install(sources)
        validate_full_matrix_switch(sources)
        validate_path_filter(sources)
        validate_frontend_gates_once(sources)
        validate_preflight_coverage(sources)
        validate_test_caches(sources)
        validate_full_matrix_coverage(sources)
        validate_full_matrix_verdict(sources)
        validate_test_triggers(sources)
        validate_test_concurrency(sources)
        validate_no_attempt_dependent_tests()
        validate_full_mode_runs_everything(sources)
        validate_required_step_conditions(sources)
        validate_release_no_continue_on_error(sources)
        validate_release_calls_full_matrix(sources)
        validate_tests_call_permissions(sources)
        validate_artifact_edges(sources)
        validate_single_entry(sources)
        validate_release_concurrency(sources)
        validate_dry_run_boundary(sources)
        validate_publish_selection(sources)
        validate_release_cache_boundary(sources)
        validate_rerun_rechecks(sources)
        validate_ci_release_scope(sources)
        validate_bootstrap_never_on_main(sources)
        validate_release_docs(repo_root)
        validate_write_jobs_need_tests_and_gate(sources)
        validate_dry_run_skips_secrets(sources)
        validate_type_check_extras(sources)
        validate_native_release_targets(sources)
        validate_security_events_scope(sources)
        validate_writing_data(sources)
    finally:
        REPO_ROOT, WORKFLOW_ROOT, ACTION_LOCK, TOOLCHAIN_LOCK = original


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check",))
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            validate_repository()
    except WorkflowContractError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("Workflow dependency and publication contracts are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
