#!/usr/bin/env python3
"""Validate the immutable CI and release-workflow dependency boundary."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

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


def validate_toolchains(sources: dict[Path, str], contract: dict[str, object]) -> None:
    release_toolchains = contract["releaseToolchains"]
    if not isinstance(release_toolchains, dict):
        raise WorkflowContractError("the release runtime toolchain lock is incomplete")
    node = str(release_toolchains["node"])
    npm = str(release_toolchains["npm"])
    python = str(release_toolchains["python"])
    rust = str(release_toolchains["rust"])
    tools = contract["pythonBuildTools"]
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
    runner_values = re.findall(r"runs-on:\s*([^\s#]+)", "\n".join(sources.values()))
    expected_runners = {str(value) for value in hosted_runners.values()}
    if set(runner_values) != expected_runners or any("latest" in value for value in runner_values):
        raise WorkflowContractError(
            f"workflow runners must use exactly {sorted(expected_runners)}; "
            f"found {sorted(set(runner_values))}"
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
