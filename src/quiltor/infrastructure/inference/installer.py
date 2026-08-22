"""
Installs the local LLM runtime (llama.cpp or MLX) for Quiltor's assistant.

Used two ways:
  - Automatically: server.py calls ensure_installed() once at startup. If
    nothing is installed yet and the console is interactive, it asks once
    before downloading anything; if declined, or the console isn't
    interactive (piped, a service, CI), it stays silent and the assistant
    simply reports itself unavailable, same as today.
  - Directly, for explicit control (CI, troubleshooting, picking a non-
    default model, forcing a backend):
        python3 -m quiltor.infrastructure.inference.installer
        python3 -m quiltor.infrastructure.inference.installer --runtime mlx
        python3 -m quiltor.infrastructure.inference.installer --skip-model
        python3 -m quiltor.infrastructure.inference.installer --model-repo Qwen/Qwen3-4B-GGUF --model-file Qwen3-4B-Q4_K_M.gguf

By default installs llama.cpp + a GGUF model everywhere, or MLX + an MLX
model on Apple Silicon (materially faster there; src/quiltor/infrastructure/inference/select.py
falls back to llama.cpp automatically at runtime if MLX was skipped or
fails). Either way, everything lands under runtime/ and models/ and is
picked up automatically -- no environment variables needed afterwards.

The assistant installer itself uses the standard library for the llama.cpp
path. The optional MLX path creates its own virtual environment
(runtime/mlx-venv) and installs a small set of pinned packages into it; Quiltor
never imports mlx/mlx-lm/llguidance directly.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from quiltor import resources
from quiltor.infrastructure.inference.archive import extract_archive, locate_expected_files
from quiltor.infrastructure.inference.install_manifest import (
    ArtifactManifest,
    github_release_api_url,
    github_runtime_artifact,
    huggingface_artifacts,
    huggingface_model_api_url,
    huggingface_repository_revision,
    huggingface_tree_api_url,
    safe_relative_path,
)
from quiltor.infrastructure.inference.runtimes import bundled_runtime_dir, llamacpp
from quiltor.infrastructure.inference.transfer import download, read_json
from quiltor.infrastructure.platform import capabilities, system
from quiltor.infrastructure.platform.runtime_target import is_store_distribution
from quiltor.infrastructure.platform.system import force_utf8_streams, is_apple_silicon

BASE = resources.source_root()
DEFAULT_MODEL_REPO = "Qwen/Qwen3-4B-GGUF"
DEFAULT_MODEL_FILE = "Qwen3-4B-Q4_K_M.gguf"
DEFAULT_MLX_MODEL_REPO = "mlx-community/Qwen3-4B-4bit"
MLX_REQUIREMENTS = resources.sidecar_asset("inference/mlx/requirements.lock")
MLX_BRIDGE = resources.sidecar_asset("inference/mlx/bridge.py")


@dataclass(frozen=True, slots=True)
class InstallerPaths:
    """Writable installer destinations owned by one composed application."""

    home: Path
    runtime: Path
    models: Path
    mlx_venv: Path
    mlx_models: Path

    @classmethod
    def from_home(cls, home: Path) -> "InstallerPaths":
        root = home.expanduser().resolve()
        runtime = root / "runtime"
        models = root / "models"
        return cls(root, runtime, models, runtime / "mlx-venv", models / "mlx")


def installer_paths(home: Path | None = None) -> InstallerPaths:
    selected = home or Path(os.environ.get("QUILTOR_HOME", str(BASE)))
    return InstallerPaths.from_home(selected)


def resolve_runtime(choice: str) -> str:
    if choice != "auto":
        return choice
    # A Store build never auto-selects MLX: install_mlx_runtime() below builds a
    # venv and pip-installs into it, which App Store guideline 2.5.2 forbids.
    if is_store_distribution():
        return "llamacpp"
    return "mlx" if is_apple_silicon() else "llamacpp"


def _venv_python(venv_dir: Path) -> Path:
    # venv's own layout, not an OS behaviour -- hence the os_name() check here
    # rather than a helper in src/quiltor/infrastructure/platform/adapters/.
    if system.os_name() == "windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python3"


def is_configured(home: Path | None = None) -> bool:
    """True if a runtime is already installed, or explicitly pointed at via env vars."""
    if os.environ.get("QUILTOR_AI_URL") or os.environ.get("QUILTOR_AI_BINARY"):
        return True
    # resolve_binary() prefers a runtime shipped inside the app bundle over the
    # downloaded one, so a Store build counts as configured as soon as the
    # weights are there -- there is no runtime download left to wait for.
    paths = installer_paths(home)
    if llamacpp.resolve_binary(paths.home).exists() and list(paths.models.glob("*.gguf")):
        return True
    if _venv_python(paths.mlx_venv).exists():
        return True
    return False


def ensure_installed(home: Path | None = None) -> None:
    """Called by server.py at startup. Prompts once, interactively, if nothing is set up yet."""
    if is_configured(home):
        return
    if sys.stdin is None or not sys.stdin.isatty():
        return  # non-interactive context (piped, a service, CI, a windowed desktop build) -- stay silent
    runtime = resolve_runtime("auto")
    size = "~2,4 GB" if runtime == "mlx" else "~2,5 GB"
    print()
    print("  Kein lokaler KI-Assistent gefunden.")
    try:
        answer = (
            input(f"  Jetzt einrichten ({runtime}-Runtime, {size} Download)? [j/N] ")
            .strip()
            .casefold()
        )
    except (EOFError, KeyboardInterrupt):
        print()
        answer = ""
    if answer not in ("j", "ja", "y", "yes"):
        print(
            "  Übersprungen. Quiltor läuft ohne Assistenten. Später jederzeit mit: python3 -m quiltor.infrastructure.inference.installer"
        )
        print()
        return
    try:
        install(runtime, home=home)
    except (SystemExit, Exception) as exc:
        # Also catches network/subprocess failures (URLError, OSError,
        # CalledProcessError, ...) from download()/install_mlx_runtime() -- a
        # flaky connection during setup must not take the whole server down.
        print(f"  ! Einrichtung fehlgeschlagen: {exc}")
        print(
            "  Quiltor startet trotzdem; der Assistent bleibt bis zur nächsten Einrichtung inaktiv."
        )
    print()


def install(
    runtime: str,
    *,
    home: Path | None = None,
    model_repo: str = DEFAULT_MODEL_REPO,
    model_file: str = DEFAULT_MODEL_FILE,
    mlx_model_repo: str = DEFAULT_MLX_MODEL_REPO,
    skip_runtime: bool = False,
    skip_model: bool = False,
    skip_smoke_test: bool = False,
    on_progress: Callable[[str, int], None] | None = None,
) -> None:
    paths = installer_paths(home)
    if runtime == "mlx":
        if not skip_runtime:
            install_mlx_runtime(on_progress, paths=paths)
        if not skip_model:
            install_mlx_model(mlx_model_repo, on_progress, paths=paths)
        if not skip_runtime and not skip_model and not skip_smoke_test:
            if on_progress:
                on_progress("Smoke test", 0)
            smoke_test_mlx(paths.mlx_models / mlx_model_repo.split("/")[-1], paths=paths)
    else:
        if not skip_runtime:
            install_runtime(on_progress, paths=paths)
        if not skip_model:
            install_model(model_repo, model_file, on_progress, paths=paths)


def platform_asset_pattern() -> re.Pattern[str]:
    # llama.cpp's own release asset naming, which is why this lives here rather
    # than in src/quiltor/infrastructure/platform/adapters/: it is a third-party convention that happens to
    # vary by OS, not an OS behaviour. As of current packaging, Windows ships
    # .zip assets; macOS and Linux ship .tar.gz. Getting the extension wrong
    # means the installer fails outright on that platform (caught in review
    # before this shipped).
    os_name, arch = system.os_name(), system.machine_arch()
    if os_name == "windows":
        return re.compile(rf"win-cpu-{arch}\.zip$")
    if os_name == "macos":
        return re.compile(rf"macos-{arch}\.tar\.gz$")
    if os_name == "linux":
        return re.compile(rf"ubuntu-{arch}\.tar\.gz$")
    raise SystemExit(
        f"Unsupported platform: {os_name}/{arch}. Set QUILTOR_AI_BINARY to a local llama-server build instead."
    )


def latest_release_asset(pattern: re.Pattern[str], binary_name: str) -> ArtifactManifest:
    """Resolve one asset from the deliberately pinned, digest-bearing release."""

    release = read_json(github_release_api_url())
    if not isinstance(release, dict):
        raise ValueError("llama.cpp release metadata must be an object.")
    return github_runtime_artifact(release, pattern, expected_files=(binary_name,))


def _model_artifacts(repository: str, revision: str = "main") -> dict[str, ArtifactManifest]:
    metadata = read_json(huggingface_model_api_url(repository, revision))
    commit = huggingface_repository_revision(metadata)
    entries = read_json(huggingface_tree_api_url(repository, commit))
    return huggingface_artifacts(repository, entries, revision=commit)


def _runtime_payload_files(directory: Path, binary_name: str) -> list[Path]:
    """Allow only the server executable and its runtime libraries."""

    os_name = system.os_name()
    patterns = {
        "windows": re.compile(
            r"(?:llama-server\.exe|(?:ggml|llama|mtmd)[A-Za-z0-9_.-]*\.dll)",
            re.IGNORECASE,
        ),
        "macos": re.compile(
            r"(?:llama-server|lib(?:ggml|llama|mtmd)[A-Za-z0-9_.-]*\.dylib)",
        ),
        "linux": re.compile(
            r"(?:llama-server|lib(?:ggml|llama|mtmd)[A-Za-z0-9_.-]*\.so(?:\.[0-9]+)*)",
        ),
    }
    selected = patterns.get(os_name)
    if selected is None:
        raise ValueError(f"Unsupported runtime payload platform: {os_name}")
    payload = [
        item
        for item in directory.iterdir()
        if item.is_file() and not item.is_symlink() and selected.fullmatch(item.name)
    ]
    if not any(item.name == binary_name for item in payload):
        raise ValueError("Runtime payload does not contain the expected server executable.")
    return sorted(payload, key=lambda item: item.name.casefold())


def install_runtime(
    on_progress: Callable[[str, int], None] | None = None,
    *,
    paths: InstallerPaths | None = None,
) -> None:
    selected = paths or installer_paths()
    binary_name = llamacpp.binary_name()
    bundled = bundled_runtime_dir()
    if bundled is not None and (bundled / binary_name).exists():
        # Shipped inside the app bundle (Mac App Store build): there is nothing to
        # download, and downloading an executable here is precisely what guideline
        # 2.5.2 forbids. Model weights are still fetched by install_model().
        print(f"runtime shipped with the app at {bundled / binary_name}, skipping download")
        if on_progress:
            on_progress("Runtime", 100)
        return

    selected.runtime.mkdir(parents=True, exist_ok=True)
    target = selected.runtime / binary_name
    if target.exists():
        print(f"runtime already present at {target}, skipping")
        if on_progress:
            on_progress("Runtime", 100)
        return

    # Past this point we would fetch an executable off the network and run it.
    # The check above -- "is a runtime bundled?" -- happens to prevent that for a
    # correctly built Store package, but it answers a different question, and a
    # build that simply forgot to bundle the binary would sail past it straight
    # into a 2.5.2 violation. Ask the edition directly instead, so the guarantee
    # holds because of the rule rather than by coincidence.
    if not capabilities.allows_code_download():
        raise SystemExit(
            f"This build must not download a runtime (App Store guideline 2.5.2), and no "
            f"llama-server ships inside it. Expected one in {bundled_runtime_dir() or 'the app bundle'}; "
            f"see distribution/README.md on bundling and signing it."
        )

    pattern = platform_asset_pattern()
    artifact = latest_release_asset(pattern, binary_name)
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        # Download and extraction must live in separate directories: several
        # llama.cpp release zips extract flat with no wrapping folder, so if
        # the archive sat in the same directory it would get "found" as a
        # sibling file and copied into runtime/ right along with the binary.
        download_dir, extract_dir = tmp / "download", tmp / "extracted"
        download_dir.mkdir()
        extract_dir.mkdir()
        archive = download_dir / artifact.filename
        download(artifact, archive, artifact.filename, on_progress)
        extract_archive(archive, extract_dir)
        # Match the exact binary name only — a loose "llama-server*" prefix
        # also matches sibling libs like llama-server-impl.dll and can pick
        # the wrong (non-executable) file depending on directory order.
        expected = locate_expected_files(extract_dir, artifact.expected_files)
        found = expected[binary_name]
        # Copy every file next to the binary, not just the binary itself —
        # llama-server is a thin launcher that depends on sibling shared
        # libraries (ggml*/llama* .dll/.so files) to run at all. Copying
        # only the executable produces a file that looks installed but
        # can't start. Skip files that fail to copy (e.g. an antivirus
        # transiently locking a freshly extracted .exe) rather than aborting
        # the whole install over an unrelated debug/bench tool.
        for item in _runtime_payload_files(found.parent, binary_name):
            try:
                shutil.copy2(item, selected.runtime / item.name)
            except OSError as exc:
                print(f"  ! skipped {item.name}: {exc}")
        if system.os_name() != "windows":
            target.chmod(target.stat().st_mode | stat.S_IEXEC)
        system.strip_quarantine(selected.runtime)
    print(f"Installed {target}")


def install_model(
    repo: str,
    filename: str,
    on_progress: Callable[[str, int], None] | None = None,
    *,
    paths: InstallerPaths | None = None,
) -> None:
    selected = paths or installer_paths()
    relative = safe_relative_path(filename)
    if len(relative.parts) != 1:
        raise ValueError("GGUF model filename must not contain directories.")
    artifacts = _model_artifacts(repo)
    artifact = artifacts.get(filename)
    if artifact is None:
        raise ValueError(f"Model file {filename!r} is not published by {repo}.")
    selected.models.mkdir(parents=True, exist_ok=True)
    target = selected.models / relative.name
    if target.exists():
        print(f"model already present at {target}, skipping")
        if on_progress:
            on_progress("Model", 100)
        return
    download(artifact, target, filename, on_progress)
    print(f"Installed {target}")


def install_mlx_runtime(
    on_progress: Callable[[str, int], None] | None = None,
    *,
    paths: InstallerPaths | None = None,
) -> None:
    selected = paths or installer_paths()
    if is_store_distribution():
        # Creating a venv and pip-installing into it downloads and runs executable
        # code, which App Store guideline 2.5.2 forbids outright. Refuse loudly
        # rather than let a Store build ship something that fails review -- the
        # bundled llama.cpp runtime covers Apple Silicon here, just more slowly.
        raise SystemExit(
            "The Mac App Store build cannot install the MLX runtime (App Store guideline 2.5.2). Use --runtime llamacpp."
        )
    if not is_apple_silicon():
        raise SystemExit(
            "MLX is only supported on Apple Silicon Macs. Use --runtime llamacpp instead."
        )
    if sys.version_info < (3, 10):
        raise SystemExit(
            f"MLX requires Python 3.10+; this interpreter is {platform.python_version()}. Install a newer Python and re-run."
        )
    venv_python = _venv_python(selected.mlx_venv)
    if venv_python.exists():
        print(f"MLX runtime already present at {venv_python}, skipping")
        if on_progress:
            on_progress("Runtime", 100)
        return
    if on_progress:
        on_progress("Runtime", 0)
    print(f"Creating MLX virtual environment at {selected.mlx_venv} ...")
    subprocess.run([sys.executable, "-m", "venv", str(selected.mlx_venv)], check=True)
    print("Installing MLX runtime packages (mlx, mlx-lm, llguidance) ...")
    subprocess.run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    # --only-binary=:all: turns "no Xcode command line tools" into an
    # immediate, legible pip error instead of a 40-minute failed source build.
    subprocess.run(
        [
            str(venv_python),
            "-m",
            "pip",
            "install",
            "--only-binary=:all:",
            "-r",
            str(MLX_REQUIREMENTS),
        ],
        check=True,
    )
    print(f"Installed MLX runtime at {selected.mlx_venv}")
    if on_progress:
        on_progress("Runtime", 100)


def install_mlx_model(
    repo: str,
    on_progress: Callable[[str, int], None] | None = None,
    *,
    paths: InstallerPaths | None = None,
) -> None:
    selected = paths or installer_paths()
    # Resolving metadata validates the repository identifier and pins its
    # mutable branch name to a concrete commit before any file URL is built.
    repository_leaf = safe_relative_path(repo.split("/")[-1]).name
    target_dir = selected.mlx_models / repository_leaf
    if target_dir.exists() and any(target_dir.iterdir()):
        print(f"MLX model already present at {target_dir}, skipping")
        if on_progress:
            on_progress("Model", 100)
        return
    print(f"Fetching file list for {repo} ...")
    artifacts = _model_artifacts(repo)
    files = sorted(artifacts)
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, filename in enumerate(files):
        relative = safe_relative_path(filename)
        dest = target_dir.joinpath(*relative.parts)
        if dest.exists():
            print(f"  {filename} already present, skipping")
            continue
        # Coarse per-file progress (no aggregate byte count across all files known
        # upfront) -- good enough to show the UI something is happening.
        base_pct = index * 100 // len(files)
        download(
            artifacts[filename],
            dest,
            filename,
            (lambda label, pct, base=base_pct: on_progress(label, base + pct // len(files)))
            if on_progress
            else None,
        )
    print(f"Installed MLX model at {target_dir}")


def smoke_test_mlx(
    model_dir: Path,
    timeout: float = 120,
    *,
    paths: InstallerPaths | None = None,
) -> None:
    # Starting the process is not the same as it working -- this project has
    # already shipped a runtime that "started" but couldn't actually do
    # anything twice in one session (a wrong binary, an unenforced schema).
    # Run one real, schema-constrained request before declaring success.
    port = 18732
    venv_python = _venv_python((paths or installer_paths()).mlx_venv)
    print("Smoke-testing the MLX bridge (this loads the model once, may take a minute) ...")
    process = subprocess.Popen(
        [
            str(venv_python),
            str(MLX_BRIDGE),
            "--model",
            str(model_dir),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.monotonic() + timeout
        ready = False
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise SystemExit(
                    f"MLX bridge exited during startup (code {process.returncode}):\n{output}"
                )
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/health", timeout=1
                ) as response:
                    if response.status == 200:
                        ready = True
                        break
            except Exception:
                pass
            time.sleep(1)
        if not ready:
            raise SystemExit(
                f"MLX bridge did not become healthy within {timeout:.0f}s. Check data/mlx-server.log once server.py is running, or re-run with --skip-smoke-test to skip this check."
            )
        schema = {
            "type": "object",
            "required": ["ok"],
            "additionalProperties": False,
            "properties": {"ok": {"type": "boolean"}},
        }
        payload = {
            "model": "local",
            "stream": False,
            "max_tokens": 50,
            "messages": [
                {
                    "role": "user",
                    "content": 'Reply with the JSON object {"ok": true} and nothing else. /no_think',
                }
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "smoke_test", "strict": True, "schema": schema},
            },
        }
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        content = json.loads(result["choices"][0]["message"]["content"])
        if content != {"ok": True}:
            raise SystemExit(
                f"MLX bridge responded but not with the schema-constrained value expected: {content!r}"
            )
        print("MLX bridge smoke test passed: model loaded and schema-constrained output verified.")
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def _cli() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--runtime",
        choices=["auto", "llamacpp", "mlx"],
        default="auto",
        help="which backend to install (default: mlx on Apple Silicon, llama.cpp everywhere else)",
    )
    parser.add_argument("--skip-runtime", action="store_true", help="do not download the runtime")
    parser.add_argument("--skip-model", action="store_true", help="do not download the model")
    parser.add_argument(
        "--skip-smoke-test",
        action="store_true",
        help="skip the post-install MLX verification request (llama.cpp path has no smoke test)",
    )
    parser.add_argument(
        "--model-repo",
        default=DEFAULT_MODEL_REPO,
        help="Hugging Face repo id holding the GGUF file (llama.cpp path)",
    )
    parser.add_argument(
        "--model-file",
        default=DEFAULT_MODEL_FILE,
        help="GGUF filename inside the model repo (llama.cpp path)",
    )
    parser.add_argument(
        "--mlx-model-repo",
        default=DEFAULT_MLX_MODEL_REPO,
        help="Hugging Face repo id holding the MLX model (mlx path)",
    )
    args = parser.parse_args()

    runtime = resolve_runtime(args.runtime)
    print(f"Runtime: {runtime}" + (" (auto-detected)" if args.runtime == "auto" else ""))
    install(
        runtime,
        model_repo=args.model_repo,
        model_file=args.model_file,
        mlx_model_repo=args.mlx_model_repo,
        skip_runtime=args.skip_runtime,
        skip_model=args.skip_model,
        skip_smoke_test=args.skip_smoke_test,
    )
    print("\nDone. Start Quiltor with: python3 apps/web/server.py")


if __name__ == "__main__":
    force_utf8_streams()
    try:
        _cli()
    except KeyboardInterrupt:
        sys.exit(130)
