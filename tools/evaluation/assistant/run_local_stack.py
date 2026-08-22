#!/usr/bin/env python3
"""Start an isolated Quiltor + llama.cpp stack and run the real-model evaluation."""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVALUATION_ROOT = Path(__file__).resolve().parent


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for(url: str, process: subprocess.Popen[str], timeout: int, label: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{label} exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"{label} did not become ready within {timeout} seconds")


def stop(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def tail(path: Path, lines: int = 40) -> str:
    if not path.exists():
        return ""
    return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=1, choices=range(1, 4), metavar="1..3")
    parser.add_argument(
        "--case", action="append", dest="cases", help="Run only this evaluation case; repeatable."
    )
    parser.add_argument("--model", type=Path, default=ROOT / "models" / "Qwen3-4B-Q4_K_M.gguf")
    parser.add_argument(
        "--runtime",
        type=Path,
        default=ROOT / "runtime" / ("llama-server.exe" if os.name == "nt" else "llama-server"),
    )
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=ROOT / "reports" / "assistant-eval",
        help="Directory for persistent JSON run/comparison reports.",
    )
    args = parser.parse_args()
    if not args.runtime.is_file() or not args.model.is_file():
        raise SystemExit(
            "Bundled llama.cpp runtime/model missing. Run: python3 -m quiltor.infrastructure.inference.installer --runtime llamacpp"
        )

    runtime_process: subprocess.Popen[str] | None = None
    app_process: subprocess.Popen[str] | None = None
    with tempfile.TemporaryDirectory(prefix="quiltor-assistant-eval-") as temporary:
        data = Path(temporary)
        runtime_log, app_log = data / "runtime.log", data / "server.log"
        runtime_port, app_port = free_port(), free_port()
        env = {
            **os.environ,
            "QUILTOR_DATA_DIR": str(data),
            "QUILTOR_AI_URL": f"http://127.0.0.1:{runtime_port}",
        }
        try:
            world_id = subprocess.check_output(
                [sys.executable, str(EVALUATION_ROOT / "seed_synthetic_world.py")],
                cwd=ROOT,
                env=env,
                text=True,
            ).strip()
            runtime_stream = runtime_log.open("w")
            runtime_process = subprocess.Popen(
                [
                    str(args.runtime),
                    "-m",
                    str(args.model),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(runtime_port),
                    "-c",
                    "8192",
                    "--jinja",
                ],
                cwd=ROOT,
                stdout=runtime_stream,
                stderr=subprocess.STDOUT,
                text=True,
            )
            wait_for(
                f"http://127.0.0.1:{runtime_port}/health", runtime_process, 120, "llama.cpp runtime"
            )
            app_stream = app_log.open("w")
            app_process = subprocess.Popen(
                [
                    sys.executable,
                    str(ROOT / "apps" / "web" / "server.py"),
                    str(app_port),
                    "--no-open",
                ],
                cwd=ROOT,
                env=env,
                stdout=app_stream,
                stderr=subprocess.STDOUT,
                text=True,
            )
            wait_for(
                f"http://127.0.0.1:{app_port}/api/version", app_process, 30, "Quiltor test server"
            )
            command = [
                sys.executable,
                str(EVALUATION_ROOT / "run_scenarios.py"),
                "--base",
                f"http://127.0.0.1:{app_port}",
                "--world",
                world_id,
            ]
            for case in args.cases or []:
                command.extend(["--case", case])
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            run_results = []
            for run in range(1, args.runs + 1):
                print(f"\n=== Local assistant evaluation {run}/{args.runs} ===", flush=True)
                output = args.report_dir / f"{stamp}-run-{run}.json"
                subprocess.run([*command, "--output", str(output)], cwd=ROOT, env=env, check=True)
                run_results.append(json.loads(output.read_text()))
            comparison = {
                "createdAt": datetime.now().isoformat(),
                "runs": args.runs,
                "allPassed": all(
                    item["passed"] == item["total"] and item["worldStateUnchanged"]
                    for item in run_results
                ),
                "passed": [item["passed"] for item in run_results],
                "totals": [item["total"] for item in run_results],
                "validProposalWithoutRepairRates": [
                    item["validProposalWithoutRepairRate"] for item in run_results
                ],
                "averageScenarioSeconds": [
                    round(
                        sum(report["seconds"] for report in item["reports"])
                        / max(1, len(item["reports"])),
                        2,
                    )
                    for item in run_results
                ],
                "runReports": [f"{stamp}-run-{run}.json" for run in range(1, args.runs + 1)],
            }
            comparison_path = args.report_dir / f"{stamp}-comparison.json"
            comparison_path.write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n")
            print(f"\nComparison report: {comparison_path}", flush=True)
        except Exception as exc:
            print(f"\nEvaluation failed: {exc}", file=sys.stderr)
            print(f"\n--- runtime.log ---\n{tail(runtime_log)}", file=sys.stderr)
            print(f"\n--- server.log ---\n{tail(app_log)}", file=sys.stderr)
            raise SystemExit(1) from exc
        finally:
            stop(app_process)
            stop(runtime_process)


if __name__ == "__main__":
    main()
