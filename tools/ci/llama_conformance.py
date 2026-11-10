#!/usr/bin/env python3
"""Run the local-AI conformance suite against a real llama-server (T-179 part 4).

CI is the only place this downloads anything (D-94). The script fetches the pinned llama-server
and a small model with the product's own installer (digest-checked, the same code a user's
install runs), starts the server with the product's own start-up arguments
(`runtimes.llamacpp.start`), waits for `/health`, runs `test_local_ai_conformance.py` in its
"llama" mode, keeps the raw answers as an artifact, and grades the result against the list of
known deviations for the release.

A red case is red. The grade only says whether every red case is one that is already named:

- conformant: nothing failed;
- conformant-with-known-deviations: every failed case is on the release's list;
- not-conformant: a case failed that nobody has named (exit code 1).

Locally, without a download: `--server-url` grades an already running server (the bridge with
fakes, say) and starts nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import re
import socket
import sys
import tempfile
import time
import traceback
import unittest
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PINS_PATH = Path(__file__).resolve().with_name("llama-conformance-pins.json")
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "tests" / "python")]

CONFORMANT = "conformant"
KNOWN_DEVIATIONS = "conformant-with-known-deviations"
NOT_CONFORMANT = "not-conformant"
SHA256_RE = re.compile(r"[0-9a-f]{64}")
CASE_RE = re.compile(r"\.test_c(\d+)_")
READY_TIMEOUT_SECONDS = 180


class PinError(Exception):
    """A model that may not be used: not pinned, outside a spike."""


@dataclass(frozen=True)
class CaseOutcome:
    case: str
    status: str  # "pass", "fail" or "skip"
    detail: str = ""


@dataclass(frozen=True)
class Verdict:
    verdict: str
    failed: tuple[str, ...]
    unexpected: tuple[str, ...]
    known: dict[str, list[str]]
    stale: tuple[str, ...]
    skipped: tuple[str, ...]


def _last_line(err: Any) -> str:
    """The last line of a failure's traceback: the exception and its message."""
    return "".join(traceback.format_exception(*err)).strip().splitlines()[-1]


class _Collector(unittest.TestResult):
    """Test outcomes keyed by case number instead of by test name."""

    def __init__(self) -> None:
        super().__init__()
        self.outcomes: list[CaseOutcome] = []

    def _add(self, test: unittest.TestCase | str, status: str, detail: str = "") -> None:
        match = CASE_RE.search(str(test.id() if isinstance(test, unittest.TestCase) else test))
        self.outcomes.append(CaseOutcome(f"C{match.group(1)}" if match else "*", status, detail))

    def addSuccess(self, test: unittest.TestCase) -> None:
        super().addSuccess(test)
        self._add(test, "pass")

    def addFailure(self, test: unittest.TestCase, err: Any) -> None:
        super().addFailure(test, err)
        self._add(test, "fail", _last_line(err))

    def addError(self, test: unittest.TestCase, err: Any) -> None:
        super().addError(test, err)
        self._add(test, "fail", _last_line(err))

    def addSkip(self, test: unittest.TestCase, reason: str) -> None:
        super().addSkip(test, reason)
        self._add(test, "skip", reason)


# --- Pins --------------------------------------------------------------------------------------


# The only model whose download the user approved (T-179, D-4c, D-4d): SmolLM2 135M, about 145 MB,
# as the imatrix quantisation by bartowski (HuggingFaceTB publishes no GGUF), at one revision.
# The pins must name exactly this one; any other model -- a second candidate, a fallback -- is
# refused before anything is downloaded. Adding one is the user's decision, not a pins edit.
APPROVED_MODELS = {
    "smollm2-135m-instruct": (
        "bartowski/SmolLM2-135M-Instruct-GGUF",
        "SmolLM2-135M-Instruct-Q8_0.gguf",
        "09816acd5d99df7be770d85ea30822623dab342c",
    ),
}


def load_pins(path: Path = PINS_PATH) -> dict[str, Any]:
    pins = json.loads(path.read_text(encoding="utf-8"))
    named = [(m["name"], m["repo"], m["file"], m.get("revision")) for m in pins["models"]]
    approved = [(name, *source) for name, source in APPROVED_MODELS.items()]
    if named != approved:
        raise ValueError(
            f"the pins must list exactly the approved models {approved}, not {named}; "
            "a download beyond them needs the user's approval"
        )
    for model in pins["models"]:
        sha = model["sha256"]
        if sha is not None and SHA256_RE.fullmatch(sha) is None:
            raise ValueError(f"model {model['name']}: sha256 is not a lowercase hex digest")
    return pins


def require_pin(model: dict[str, Any], *, spike: bool) -> None:
    """A model with no digest in the pins file runs only in a spike, which reports its digest."""
    if model["sha256"] is None and not spike:
        raise PinError(
            f"model {model['name']} has no pinned sha256; run once with spike=true, "
            "then pin the digest the run prints"
        )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


# --- Grading -----------------------------------------------------------------------------------


def grade(outcomes: list[CaseOutcome], known: dict[str, list[str]]) -> Verdict:
    """Grade the outcomes against the deviations already named for this release.

    A failed case that is not on the list makes the run not conformant. A listed case that now
    passes is reported as stale, so the list does not keep claiming a deviation that is gone.
    """
    failed = tuple(sorted(o.case for o in outcomes if o.status == "fail"))
    passed = {o.case for o in outcomes if o.status == "pass"}
    skipped = tuple(sorted(o.case for o in outcomes if o.status == "skip"))
    unexpected = tuple(case for case in failed if case not in known)
    stale = tuple(sorted(case for case in known if case in passed))
    if unexpected:
        verdict = NOT_CONFORMANT
    elif failed:
        verdict = KNOWN_DEVIATIONS
    else:
        verdict = CONFORMANT
    return Verdict(
        verdict, failed, unexpected, {c: known[c] for c in failed if c in known}, stale, skipped
    )


def run_suite(url: str, *, key: str | None, artifact: Path | None) -> list[CaseOutcome]:
    """The suite's llama mode against `url`, outcome by case."""
    variables = {
        "QUILTOR_CONFORMANCE_LLAMA_URL": url,
        "QUILTOR_CONFORMANCE_LLAMA_KEY": key or "",
        "QUILTOR_CONFORMANCE_ARTIFACT": str(artifact) if artifact else "",
    }
    previous = {name: os.environ.get(name) for name in variables}
    os.environ.update(variables)
    try:
        suite = importlib.import_module("test_local_ai_conformance")

        collector = _Collector()
        unittest.defaultTestLoader.loadTestsFromTestCase(suite.LlamaConformanceTests).run(collector)
        return collector.outcomes
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def render_summary(
    *,
    release: str,
    model: dict[str, Any] | None,
    model_digest: str | None,
    verdict: Verdict,
    outcomes: list[CaseOutcome],
    spike: bool,
) -> str:
    lines = [f"## llama-server {release}: {verdict.verdict}", ""]
    if model:
        lines.append(
            f"Model `{model['name']}` ({model['repo']}/{model['file']}), "
            f"licence {model['license']}, about {model['approximate_bytes'] // 1_000_000} MB."
        )
    if spike and model_digest:
        lines += [
            "",
            f"**Spike: pin this model.** sha256 `{model_digest}` "
            f"(set it in tools/ci/llama-conformance-pins.json).",
        ]
    lines += ["", "| case | result | note |", "|---|---|---|"]
    for outcome in sorted(outcomes, key=lambda o: o.case):
        note = outcome.detail.replace("|", "\\|")[:200]
        if outcome.case in verdict.known:
            note = f"known: {', '.join(verdict.known[outcome.case])}. {note}"
        lines.append(f"| {outcome.case} | {outcome.status} | {note} |")
    if verdict.unexpected:
        lines += ["", f"**Not on the list of known deviations:** {', '.join(verdict.unexpected)}"]
    if verdict.stale:
        lines += ["", f"Listed as deviating but passing now: {', '.join(verdict.stale)}"]
    return "\n".join(lines) + "\n"


# --- Fetching and starting ---------------------------------------------------------------------


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_ready(url: str, process: Any, timeout: int = READY_TIMEOUT_SECONDS) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"llama-server exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001 - any failure means "not ready yet"
            time.sleep(0.5)
    raise RuntimeError(f"llama-server was not ready within {timeout} seconds")


def install(home: Path, release: str, model: dict[str, Any]) -> Path:
    """The pinned runtime and the model, fetched by the product's own installer."""
    from quiltor.infrastructure.inference import install_manifest, installer

    install_manifest.LLAMA_CPP_RELEASE = release
    installer.LLAMA_CPP_RELEASE = release
    paths = installer.InstallerPaths.from_home(home)
    installer.install_runtime(paths=paths)
    installer.install_model(model["repo"], model["file"], paths=paths, revision=model["revision"])
    return paths.models / model["file"]


def start_server(home: Path, port: int, key: str) -> tuple[Any, Path]:
    """llama-server started the way the product starts it."""
    from quiltor.infrastructure.inference.runtimes import llamacpp

    started = llamacpp.start(home, home, f"http://127.0.0.1:{port}", None, None, key)
    if started is None:
        raise RuntimeError("no llama-server binary or model was found to start")
    return started


def stop(process: Any) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except Exception:  # noqa: BLE001 - a stuck child is killed, whatever it was doing
            process.kill()


def tail(path: Path, lines: int = 40) -> str:
    if not path.exists():
        return ""
    return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", help="llama.cpp release tag (default: the product's pin)")
    parser.add_argument("--artifact", type=Path, help="file for the raw answers, one line per case")
    parser.add_argument("--summary", type=Path, help="file the markdown summary is appended to")
    parser.add_argument("--spike", action="store_true", help="allow a model with no pinned digest")
    parser.add_argument("--model", help="use only this candidate (default: try them in order)")
    parser.add_argument("--home", type=Path, help="install folder (default: a temporary one)")
    parser.add_argument(
        "--server-url", help="grade a running server; nothing is fetched or started"
    )
    args = parser.parse_args(argv)

    from quiltor.infrastructure.inference.install_manifest import LLAMA_CPP_RELEASE

    release = args.release or LLAMA_CPP_RELEASE
    pins = load_pins()
    known = pins["known_deviations"].get(release, {})
    summary = args.summary or (
        Path(os.environ["GITHUB_STEP_SUMMARY"]) if os.environ.get("GITHUB_STEP_SUMMARY") else None
    )

    def finish(
        model: dict[str, Any] | None, digest: str | None, outcomes: list[CaseOutcome]
    ) -> int:
        verdict = grade(outcomes, known)
        text = render_summary(
            release=release,
            model=model,
            model_digest=digest,
            verdict=verdict,
            outcomes=outcomes,
            spike=args.spike,
        )
        print(text)
        if summary:
            with summary.open("a", encoding="utf-8") as handle:
                handle.write(text)
        return 1 if verdict.verdict == NOT_CONFORMANT else 0

    if args.server_url:
        return finish(
            None, None, run_suite(args.server_url.rstrip("/"), key=None, artifact=args.artifact)
        )

    candidates = [m for m in pins["models"] if args.model in (None, m["name"])]
    if not candidates:
        print(f"no model candidate named {args.model!r}", file=sys.stderr)
        return 2
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as scratch:
        home = args.home or Path(scratch)
        for model in candidates:
            process = None
            try:
                require_pin(model, spike=args.spike)
                model_path = install(home, release, model)
                digest = file_sha256(model_path)
                if model["sha256"] is not None and digest != model["sha256"]:
                    raise PinError(f"model {model['name']}: sha256 {digest} is not the pinned one")
                port, key = free_port(), os.urandom(16).hex()
                process, log = start_server(home, port, key)
                url = f"http://127.0.0.1:{port}"
                try:
                    wait_ready(url, process)
                except RuntimeError as error:
                    raise RuntimeError(f"{error}\n{tail(log)}") from error
                outcomes = run_suite(url, key=key, artifact=args.artifact)
                return finish(model, digest, outcomes)
            except (PinError, RuntimeError, ValueError, OSError) as error:
                # The spike's question: does this model start with --jinja at all? Say why not,
                # and try the next one.
                failures.append(f"{model['name']}: {error}")
                print(f"model {model['name']} unusable: {error}", file=sys.stderr)
            finally:
                if process is not None:
                    stop(process)
    print("no model candidate could be used:\n" + "\n".join(failures), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
