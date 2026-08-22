#!/usr/bin/env python3
"""Run every portable release gate and artifact build before a version changes.

This deliberately does not call ``set_version.py``: the dependency points in one
direction only, so invoking the bump directly or through npm can never recurse.
Docker, ``build`` and ``hatchling`` are required deliberately: wheel, sdist and
both OCI images are portable release artifacts, not post-version best efforts.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from importlib import metadata
from pathlib import Path
from tempfile import TemporaryDirectory

from container_contract import reference as container_base_image

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLCHAIN_LOCK = REPO_ROOT / "distribution" / "toolchains.json"
_TOOLCHAINS = json.loads(TOOLCHAIN_LOCK.read_text(encoding="utf-8"))
_RELEASE_TOOLCHAINS = _TOOLCHAINS["releaseToolchains"]
PYTHON_PACKAGE_PLAYWRIGHT = _TOOLCHAINS["artifactRuntimes"]["pythonPackage"]["playwright"]
PINNED_PYTHON_BUILD_TOOLS = {
    name: _TOOLCHAINS["pythonBuildTools"][name] for name in ("build", "hatchling", "ruff")
}


class PreflightError(RuntimeError):
    """A release gate could not run or did not pass."""


def _npm_executable() -> str:
    executable = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if executable is None:
        raise PreflightError("npm is required for the frontend release gates but was not found.")
    return executable


def _cargo_executable() -> str:
    executable = shutil.which("cargo.exe" if os.name == "nt" else "cargo") or shutil.which("cargo")
    if executable is None:
        raise PreflightError(
            "Rust/Cargo is required for the portable-core release gates. "
            "Install a Rust toolchain before raising Quiltor's version."
        )
    return executable


def _docker_executable() -> str:
    executable = shutil.which("docker.exe" if os.name == "nt" else "docker") or shutil.which(
        "docker"
    )
    if executable is None:
        raise PreflightError(
            "Docker is required to build both portable release containers before raising "
            "Quiltor's version. Install Docker and start its engine."
        )
    return executable


def _require_pinned_python_build_tools() -> None:
    """Reject local release builds that use a drifting packaging toolchain."""

    for package, expected in PINNED_PYTHON_BUILD_TOOLS.items():
        try:
            installed = metadata.version(package)
        except metadata.PackageNotFoundError as error:
            raise PreflightError(
                f"{package}=={expected} is required for release builds but is not installed."
            ) from error
        if installed != expected:
            raise PreflightError(
                f"{package}=={expected} is required for release builds; found {installed}."
            )


def _version_output(command: list[str], label: str) -> str:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True)
    except OSError as error:
        raise PreflightError(f"Cannot inspect the {label} release toolchain: {error}") from error
    if result.returncode:
        raise PreflightError(f"Cannot inspect the {label} release toolchain.")
    return (result.stdout or result.stderr).strip()


def _require_pinned_runtime_toolchains(cargo: str) -> None:
    """A local version bump must use the same exact runtimes as release CI."""

    expected_python = _RELEASE_TOOLCHAINS["python"]
    if platform.python_version() != expected_python:
        raise PreflightError(
            f"Python {expected_python} is required for release preflight; "
            f"found {platform.python_version()}."
        )
    node = shutil.which("node.exe" if os.name == "nt" else "node") or shutil.which("node")
    if node is None:
        raise PreflightError("Node.js is required for release preflight but was not found.")
    actual_node = _version_output([node, "--version"], "Node.js").removeprefix("v")
    if actual_node != _RELEASE_TOOLCHAINS["node"]:
        raise PreflightError(
            f"Node.js {_RELEASE_TOOLCHAINS['node']} is required for release preflight; "
            f"found {actual_node}."
        )
    actual_npm = _version_output([_npm_executable(), "--version"], "npm")
    if actual_npm != _RELEASE_TOOLCHAINS["npm"]:
        raise PreflightError(
            f"npm {_RELEASE_TOOLCHAINS['npm']} is required for release preflight; "
            f"found {actual_npm}."
        )
    cargo_output = _version_output([cargo, "--version"], "Rust/Cargo")
    match = re.match(r"cargo\s+([0-9]+\.[0-9]+\.[0-9]+)\b", cargo_output)
    if match is None or match.group(1) != _RELEASE_TOOLCHAINS["rust"]:
        found = match.group(1) if match else cargo_output
        raise PreflightError(
            f"Rust/Cargo {_RELEASE_TOOLCHAINS['rust']} is required for release preflight; "
            f"found {found}."
        )


def _run(
    label: str,
    command: list[str],
    repo_root: Path,
    env: dict[str, str] | None = None,
) -> None:
    print(f"\n==> {label}", flush=True)
    print("    " + " ".join(command), flush=True)
    try:
        result = subprocess.run(command, cwd=repo_root, env=env, check=False)
    except OSError as error:
        raise PreflightError(f"{label} could not start: {error}") from error
    if result.returncode:
        raise PreflightError(f"{label} failed with exit code {result.returncode}.")


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _wait_for_server(process: subprocess.Popen[bytes], url: str, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise PreflightError(
                f"The local server for Playwright exited early with code {process.returncode}."
            )
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:  # noqa: S310 - loopback only
                if response.status < 500:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    raise PreflightError(f"The local server for Playwright did not become ready at {url}.")


def _stop_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _remove_preflight_images(docker: str, tags: list[str], repo_root: Path) -> None:
    """Best-effort cleanup of only the uniquely named images this run created."""

    try:
        subprocess.run(
            [docker, "image", "rm", "--force", *tags],
            cwd=repo_root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        pass


def _built_wheel(directory: str | Path) -> Path:
    wheels = list(Path(directory).glob("*.whl"))
    if len(wheels) != 1:
        raise PreflightError("Python package build did not produce exactly one wheel.")
    return wheels[0]


def _run_portable_artifact_builds(
    repo_root: Path,
    *,
    python: str,
    docker: str,
    environment: dict[str, str],
) -> None:
    """Build and inspect every release artifact that is host-independent."""

    with TemporaryDirectory(prefix="quiltor-package-preflight-") as package_directory:
        _run(
            "Build Python wheel and source distribution",
            [
                python,
                "-m",
                "build",
                "--no-isolation",
                "--outdir",
                package_directory,
            ],
            repo_root,
            environment,
        )
        _run(
            "Verify packaged Python runtime contracts",
            [
                python,
                "distribution/tooling/artifact_profile.py",
                package_directory,
                "--profile",
                "python-package",
            ],
            repo_root,
            environment,
        )
        wheel = _built_wheel(package_directory)
        smoke_environment = Path(package_directory) / "wheel-smoke"
        _run(
            "Create isolated Python wheel smoke environment",
            [python, "-m", "venv", str(smoke_environment)],
            repo_root,
            environment,
        )
        smoke_python = (
            smoke_environment / "Scripts" / "python.exe"
            if os.name == "nt"
            else smoke_environment / "bin" / "python"
        )
        _run(
            "Install isolated Python wheel without checkout imports",
            [
                str(smoke_python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-deps",
                str(wheel),
            ],
            repo_root,
            environment,
        )
        isolated_environment = environment.copy()
        isolated_environment.pop("PYTHONPATH", None)
        _run(
            "Smoke installed Python wheel resources and unavailable PDF fallback",
            [
                str(smoke_python),
                "-c",
                (
                    "from quiltor import resources; "
                    "from quiltor.infrastructure.pdf import "
                    "python_package_renderer, unavailable; "
                    "assert resources.version_file().is_file(); "
                    "assert resources.web_assets().is_dir(); "
                    "assert resources.sidecar_asset('pdf/render-book-pdf.mjs').is_file(); "
                    "assert resources.license_file().is_file(); "
                    "assert resources.third_party_notices().is_file(); "
                    "assert resources.mcp_tools_contract().is_file(); "
                    "assert python_package_renderer() is unavailable.render"
                ),
            ],
            repo_root,
            isolated_environment,
        )
        _run(
            "Install isolated wheel browser PDF extra",
            [
                str(smoke_python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--only-binary=:all:",
                f"quiltor[browser-pdf] @ {wheel.resolve().as_uri()}",
            ],
            repo_root,
            isolated_environment,
        )
        _run(
            "Smoke installed wheel browser PDF selector",
            [
                str(smoke_python),
                "-c",
                (
                    "from importlib import metadata; "
                    "from quiltor.infrastructure.pdf import "
                    "python_package_renderer, system_browser; "
                    f"assert metadata.version('playwright') == "
                    f"{PYTHON_PACKAGE_PLAYWRIGHT!r}; "
                    "assert python_package_renderer() is system_browser.render"
                ),
            ],
            repo_root,
            isolated_environment,
        )

    identifier = uuid.uuid4().hex
    version = (repo_root / "VERSION").read_text(encoding="utf-8").strip()
    playwright_base = container_base_image("playwright")
    node_base = container_base_image("nodeBuild")
    app_image = f"quiltor-release-preflight-app:{identifier}"
    backup_image = f"quiltor-release-preflight-backup:{identifier}"
    try:
        _run(
            "Build self-hosted app container",
            [
                docker,
                "build",
                "--build-arg",
                f"QUILTOR_VERSION={version}",
                "--build-arg",
                f"PLAYWRIGHT_BASE_IMAGE={playwright_base}",
                "--build-arg",
                f"NODE_BASE_IMAGE={node_base}",
                "--tag",
                app_image,
                ".",
            ],
            repo_root,
            environment,
        )
        _run(
            "Verify self-hosted image runtime contract",
            [
                docker,
                "run",
                "--rm",
                "--entrypoint",
                "python3",
                app_image,
                "-c",
                (
                    "import json, os, pathlib; "
                    "p=json.load(open('/app/src/quiltor/infrastructure/platform/"
                    "quiltor-build-profile.json')); "
                    "assert p['id']=='web-self-hosted'; "
                    "assert pathlib.Path('/app/LICENSE').is_file(); "
                    "assert pathlib.Path('/app/THIRD-PARTY-NOTICES.md').is_file(); "
                    "assert pathlib.Path('/app/VERSION').read_text().strip(); "
                    "assert os.getuid()!=0"
                ),
            ],
            repo_root,
            environment,
        )
        _run(
            "Build backup-service container",
            [
                docker,
                "build",
                "--file",
                "services/backup-server/Dockerfile",
                "--tag",
                backup_image,
                ".",
            ],
            repo_root,
            environment,
        )
        _run(
            "Verify backup-service container payload and user",
            [
                docker,
                "run",
                "--rm",
                "--entrypoint",
                "python3",
                backup_image,
                "-c",
                (
                    "import json, os, pathlib, py_compile; "
                    "p=pathlib.Path('/app/server.py'); assert p.is_file(); "
                    "c=pathlib.Path('/app/quiltor/application/backup_manifest.py'); "
                    "assert c.is_file(); py_compile.compile(str(p), doraise=True); "
                    "a=json.load(open('/app/quiltor-backup-service.json')); "
                    "assert a['id']=='quiltor-backup-service'; "
                    "assert a['role']=='backup-service'; "
                    "files={str(p.relative_to('/app')).replace('\\\\','/') for p in "
                    "pathlib.Path('/app').rglob('*') if p.is_file()}; "
                    "assert files==set(a['payload']); "
                    "__import__('quiltor.application.backup_manifest'); assert os.getuid()!=0"
                ),
            ],
            repo_root,
            environment,
        )
    finally:
        _remove_preflight_images(docker, [app_image, backup_image], repo_root)


def run_preflight(repo_root: Path = REPO_ROOT) -> None:
    """Run all cross-platform test suites and builds, raising on the first failure."""

    npm = _npm_executable()
    cargo = _cargo_executable()
    docker = _docker_executable()
    _require_pinned_runtime_toolchains(cargo)
    _require_pinned_python_build_tools()
    python = sys.executable
    check_environment = os.environ.copy()
    source_root = str(repo_root / "src")
    existing_python_path = check_environment.get("PYTHONPATH", "")
    check_environment["PYTHONPATH"] = source_root + (
        os.pathsep + existing_python_path if existing_python_path else ""
    )
    checks = [
        (
            "Immutable workflow dependencies and publication boundary",
            [python, "distribution/tooling/workflow_contract.py", "check"],
        ),
        (
            "Digest-bound container bases and payloads",
            [python, "distribution/tooling/container_contract.py", "check"],
        ),
        (
            "Hash-pinned release dependency locks",
            [python, "distribution/tooling/dependency_lock_contract.py", "check"],
        ),
        (
            "Versioned cross-runtime contracts",
            [npm, "run", "check:contracts"],
        ),
        (
            "Distribution profiles, entitlements and release versions",
            [python, "distribution/tooling/profile_contract.py", "check-release"],
        ),
        (
            "Backend suite",
            [
                python,
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests/python",
                "-t",
                "tests/python",
                "-v",
            ],
        ),
        (
            "CLI dependency availability",
            [
                python,
                "-c",
                (
                    "from importlib.metadata import version; import typer; "
                    "assert tuple(map(int, version('typer').split('.')[:2])) >= (0, 12), "
                    "'typer>=0.12 is required'"
                ),
            ],
        ),
        (
            "CLI host suite with declared dependencies",
            [
                python,
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests/python",
                "-t",
                "tests/python",
                "-p",
                "test_cli_*.py",
                "-v",
            ],
        ),
        ("Repository formatting", [npm, "run", "check:format"]),
        ("Portable core formatting", [cargo, "--locked", "fmt", "--check"]),
        (
            "Portable core lints",
            [
                cargo,
                "--locked",
                "clippy",
                "--workspace",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ],
        ),
        (
            "Portable core tests",
            [cargo, "--locked", "test", "--workspace", "--all-targets"],
        ),
        ("Frontend unit suite", [npm, "run", "test"]),
        ("Frontend gates and production build", [npm, "run", "build"]),
        (
            "Committed dist matches the production build",
            ["git", "diff", "--exit-code", "--", "dist"],
        ),
    ]
    for label, command in checks:
        _run(label, command, repo_root, check_environment)

    _run_portable_artifact_builds(
        repo_root,
        python=python,
        docker=docker,
        environment=check_environment,
    )

    port = _free_loopback_port()
    base_url = f"http://127.0.0.1:{port}"
    server_command = [python, "apps/web/server.py", str(port), "--no-open"]
    print("\n==> Start local server for browser suite", flush=True)
    print("    " + " ".join(server_command), flush=True)
    with TemporaryDirectory(prefix="quiltor-release-preflight-") as data_directory:
        server_environment = os.environ.copy()
        server_environment["QUILTOR_DATA_DIR"] = data_directory
        try:
            server = subprocess.Popen(
                server_command,
                cwd=repo_root,
                env=server_environment,
            )
        except OSError as error:
            raise PreflightError(
                f"The local server for Playwright could not start: {error}"
            ) from error
        try:
            _wait_for_server(server, f"{base_url}/api/version")
            environment = os.environ.copy()
            environment["PLAYWRIGHT_BASE_URL"] = base_url
            _run("Playwright browser suite", [npm, "run", "test:e2e"], repo_root, environment)
        finally:
            _stop_server(server)

    print("\nAll release preflight gates passed.", flush=True)


def main() -> int:
    try:
        run_preflight()
    except PreflightError as error:
        print(f"\nerror: release preflight stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
