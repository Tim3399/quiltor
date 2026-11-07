#!/usr/bin/env python3
"""Retake the README screenshots for a version, against an isolated local server.

    python distribution/tooling/readme_screenshots.py            # for VERSION
    python distribution/tooling/readme_screenshots.py 3.25.0     # for a release about to be set

`set_version.py` calls `refresh_readme_screenshots` with the version it is about to write, so a
release cannot carry pictures taken for an older one: `docs/screenshots/manifest.json` names
the version, `tools/quality/check_readme_screenshots.mjs` compares it with VERSION, and the
release preflight runs that check. The pictures are taken on the machine that prepares the
release (Windows); the Linux release job only verifies them.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from tempfile import mkdtemp

from release_preflight import (
    PreflightError,
    _free_loopback_port,
    _remove_temporary_data,
    _run,
    _stop_server,
    _wait_for_server,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def refresh_readme_screenshots(repo_root: Path, version: str) -> None:
    """Start an isolated server, run capture_readme.mjs and write the manifest for `version`."""

    port = _free_loopback_port()
    data_directory = Path(mkdtemp(prefix="quiltor-readme-screenshots-"))
    server: subprocess.Popen[bytes] | None = None
    try:
        server_environment = os.environ.copy()
        server_environment["QUILTOR_DATA_DIR"] = str(data_directory)
        # The screenshots never call a model; an explicit endpoint keeps an installed one idle.
        server_environment["QUILTOR_AI_URL"] = "http://127.0.0.1:1"
        try:
            server = subprocess.Popen(
                [sys.executable, "apps/web/server.py", str(port), "--no-open"],
                cwd=repo_root,
                env=server_environment,
            )
        except OSError as error:
            raise PreflightError(
                f"The local server for the screenshots could not start: {error}"
            ) from error
        _wait_for_server(server, f"http://127.0.0.1:{port}/api/version")
        environment = os.environ.copy()
        environment["PLAYWRIGHT_BASE_URL"] = f"http://127.0.0.1:{port}"
        environment["QUILTOR_SCREENSHOT_VERSION"] = version
        _run(
            f"README screenshots for {version}",
            ["node", "tools/documentation/capture_readme.mjs"],
            repo_root,
            environment,
        )
    finally:
        try:
            if server is not None:
                _stop_server(server)
        finally:
            _remove_temporary_data(data_directory)


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    version = (
        arguments[0] if arguments else (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    )
    try:
        refresh_readme_screenshots(REPO_ROOT, version)
    except PreflightError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
