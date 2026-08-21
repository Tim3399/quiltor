#!/usr/bin/env python3
"""Run every portable release gate before a version number is changed.

This deliberately does not call ``set_version.py``: the dependency points in one
direction only, so invoking the bump directly or through npm can never recurse.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parent.parent


class PreflightError(RuntimeError):
    """A release gate could not run or did not pass."""


def _npm_executable() -> str:
    executable = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if executable is None:
        raise PreflightError("npm is required for the frontend release gates but was not found.")
    return executable


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


def run_preflight(repo_root: Path = REPO_ROOT) -> None:
    """Run all cross-platform test suites and builds, raising on the first failure."""

    npm = _npm_executable()
    python = sys.executable
    checks = [
        (
            "Backend suite",
            [
                python,
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests/backend",
                "-t",
                "tests/backend",
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
                "tests/backend",
                "-t",
                "tests/backend",
                "-p",
                "test_cli_*.py",
                "-v",
            ],
        ),
        ("Frontend unit suite", [npm, "run", "test"]),
        ("Frontend gates and production build", [npm, "run", "build"]),
        (
            "Committed dist matches the production build",
            ["git", "diff", "--exit-code", "--", "dist"],
        ),
    ]
    for label, command in checks:
        _run(label, command, repo_root)

    port = _free_loopback_port()
    base_url = f"http://127.0.0.1:{port}"
    server_command = [python, "server.py", str(port), "--no-open"]
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
