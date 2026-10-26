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
            job = jobs[match.end() : end]
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

    entries = re.findall(
        r"^\s+- slot: ([1-9][0-9]*)\n"
        r'^[ \t]+product_shard: "([0-9/]*)"\n'
        r'^[ \t]+design_shard: "([0-9/]+)"$',
        shards,
        re.MULTILINE,
    )
    expected = {
        ("1", "1/3", "1/4"),
        ("2", "2/3", "2/4"),
        ("3", "3/3", "3/4"),
        ("4", "", "4/4"),
    }
    if len(entries) != 4 or set(entries) != expected:
        raise WorkflowContractError(
            "normal CI must cover exactly product 1/3..3/3 and design 1/4..4/4 "
            "across four browser matrix slots"
        )

    required_shard_evidence = (
        "needs: [plan, frontend]",
        "fail-fast: false",
        "if: matrix.product_shard != ''",
        "PRODUCT_SHARD: ${{ matrix.product_shard }}",
        "DESIGN_SHARD: ${{ matrix.design_shard }}",
        "set +e",
        "product_status=0",
        "PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_FULLY_PARALLEL=1 npx playwright test",
        'npx playwright test --shard="$PRODUCT_SHARD" --output=test-results/product',
        "PLAYWRIGHT_WORKERS=2 npx playwright test --config playwright.design.config.ts",
        "npx playwright test --config playwright.design.config.ts",
        '--shard="$DESIGN_SHARD" --output=test-results/design',
        "product_status=$?",
        "design_status=$?",
        'if [ "$product_status" -ne 0 ] || [ "$design_status" -ne 0 ]; then',
        "if: failure()",
        "name: browser-e2e-slot-${{ matrix.slot }}-of-4-diagnostics",
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
        'exit "$status"',
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
        r"^[ \t]+label: ([^\n]+)\n"
        r'^[ \t]+product_shard: "([0-9/]+)"\n'
        r'^[ \t]+design_shard: "([0-9/]+)"\n'
        r"^[ \t]+diagnostics: ([^\n]+)$",
        browser,
        re.MULTILINE,
    )
    expected = {
        (
            os,
            f"{os} / slot {slot} of {count}",
            f"{slot}/{count}",
            f"{slot}/{count}",
            f"{os}-{slot}-of-{count}",
        )
        for os, count in (("macos-15", 2), ("windows-2025", 8))
        for slot in range(1, count + 1)
    }
    if len(entries) != len(expected) or set(entries) != expected:
        raise WorkflowContractError(
            "the full cross-platform matrix must run product and design shards 1/2..2/2 on "
            "macOS and 1/8..8/8 on Windows, one pair per slot, with unique diagnostics"
        )

    required_evidence = (
        "name: Browser on ${{ matrix.label }}",
        "needs: [plan, frontend]",
        FULL_MATRIX_GUARD,
        "fail-fast: false",
        "if: startsWith(matrix.product_shard, '1/')",
        "run: npx vitest run",
        "PLAYWRIGHT_WORKERS: ${{ matrix.os == 'windows-2025' && '1' || '2' }}",
        "PRODUCT_SHARD: ${{ matrix.product_shard }}",
        "DESIGN_SHARD: ${{ matrix.design_shard }}",
        "set +e",
        'PLAYWRIGHT_FULLY_PARALLEL=1 npx playwright test --shard="$PRODUCT_SHARD" --output=test-results/product --reporter=line',
        "product_status=$?",
        "npx playwright test --config playwright.design.config.ts",
        '--shard="$DESIGN_SHARD" --output=test-results/design',
        "design_status=$?",
        'if [ "$product_status" -ne 0 ] || [ "$design_status" -ne 0 ]; then',
        "name: cross-platform-browser-${{ matrix.diagnostics }}-diagnostics",
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
    '            python "$base/distribution/tooling/path_filter.py" plan --repository .'
    ' --merge HEAD --output "$GITHUB_OUTPUT"\n'
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

    body = _job_body(workflow, "workflow-docker-shell-lint")
    scripts = json.loads(package_json)["scripts"]
    commands = [body]
    for name in re.findall(r"\bnpm run ([\w:.-]+)", body):
        if name not in scripts:
            raise WorkflowContractError(
                f"the lint job runs npm run {name}, which package.json lacks"
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
    if sorted(listed) != sorted(["plan", *FILTERED_JOBS]):
        raise WorkflowContractError("browser-e2e must need the plan and every filtered job")
    for evidence in (
        "    if: always()\n",
        "          PLAN_RESULT: ${{ needs.plan.result }}\n",
        '          require plan "$PLAN_RESULT" true\n',
        '            if [ "$2" = "success" ]; then\n',
        '            elif [ "$2" = "skipped" ] && [ "$3" = "false" ]; then\n',
        "              status=1\n",
        '          exit "$status"\n',
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
        if job_guard not in native_job:
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
        validate_job_runtime_setups(sources, locked_actions)
        validate_cargo(sources)
        validate_publication_boundary(sources)
        validate_image_size_guard(sources)
        validate_browser_e2e_sharding(sources)
        validate_cross_platform_browser_sharding(sources)
        validate_full_matrix_switch(sources)
        validate_path_filter(sources)
        validate_frontend_gates_once(sources)
        validate_test_caches(sources)
        validate_type_check_extras(sources)
        validate_native_release_targets(sources)
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
