"""Quiltor with OIDC against a fake Keycloak, for the browser tests in tests/e2e-oidc (T-58 P7b).

Starts tests/python/fake_issuer.FakeIssuer on a fixed loopback port and the real Quiltor server
on another, signed in through it. The server uses only switches the product already has:
QUILTOR_OIDC_ISSUER, QUILTOR_OIDC_CLIENT_ID, QUILTOR_PUBLIC_URL and
QUILTOR_OIDC_ALLOW_INSECURE_LOOPBACK (http is accepted for loopback addresses only).

The fake's /authorize grants a code at once, so a browser signs in without a form; its
POST /test/end-sessions ends every session the way an administrator would in Keycloak. That
path exists in the fake alone.

Runs until it is stopped; Playwright's webServer starts and stops it.
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests" / "python"))

from fake_issuer import FakeIssuer  # noqa: E402 -- the fake lives with the Python tests

CLIENT_ID = "quiltor-desktop"


def _refuse_taken(port: int, what: str) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            sys.exit(
                f"oidc_stack: port {port} for the {what} is already in use. Stop whatever listens "
                f"there, or pick other ports with QUILTOR_OIDC_E2E_PORT / "
                f"QUILTOR_OIDC_E2E_ISSUER_PORT."
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True, help="Quiltor's port")
    parser.add_argument("--issuer-port", type=int, required=True, help="the fake issuer's port")
    parser.add_argument(
        "--access-ttl",
        type=int,
        default=2,
        help="seconds an access token lives; short, so an ended session shows within a test",
    )
    args = parser.parse_args()
    _refuse_taken(args.port, "Quiltor server")
    _refuse_taken(args.issuer_port, "fake issuer")

    issuer = FakeIssuer()
    issuer.access_ttl = args.access_ttl
    issuer.sign_in_as("e2e-author", "author@example.test", "E2E Autorin")
    issuer.start(args.issuer_port)

    data = Path(tempfile.mkdtemp(prefix="quiltor-oidc-e2e-"))
    environment = {
        **os.environ,
        "PYTHONPATH": str(ROOT / "src"),
        "QUILTOR_DATA_DIR": str(data),
        "QUILTOR_OIDC_ISSUER": issuer.url,
        "QUILTOR_OIDC_CLIENT_ID": CLIENT_ID,
        "QUILTOR_OIDC_ALLOW_INSECURE_LOOPBACK": "1",
        "QUILTOR_PUBLIC_URL": f"http://127.0.0.1:{args.port}",
    }
    for name in ("QUILTOR_OIDC_CLIENT_SECRET", "QUILTOR_AI_URL", "QUILTOR_AI_KEY"):
        environment.pop(name, None)
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "apps" / "web" / "server.py"), str(args.port), "--no-open"],
        env=environment,
        cwd=ROOT,
    )
    print(f"oidc_stack: issuer {issuer.url}, Quiltor http://127.0.0.1:{args.port}, data {data}")
    try:
        while server.poll() is None:
            time.sleep(0.5)
        sys.exit(f"oidc_stack: the Quiltor server stopped with exit code {server.returncode}")
    except KeyboardInterrupt:
        pass
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        issuer.stop()


if __name__ == "__main__":
    main()
