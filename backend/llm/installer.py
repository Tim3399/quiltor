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
        python3 -m backend.llm.installer
        python3 -m backend.llm.installer --runtime mlx
        python3 -m backend.llm.installer --skip-model
        python3 -m backend.llm.installer --model-repo Qwen/Qwen3-4B-GGUF --model-file Qwen3-4B-Q4_K_M.gguf

By default installs llama.cpp + a GGUF model everywhere, or MLX + an MLX
model on Apple Silicon (materially faster there; backend/llm/select.py
falls back to llama.cpp automatically at runtime if MLX was skipped or
fails). Either way, everything lands under runtime/ and models/ and is
picked up automatically -- no environment variables needed afterwards.

Standard library only for the llama.cpp path. The optional MLX path creates
its own virtual environment (runtime/mlx-venv) and installs a small set of
pinned packages into it -- Quiltor's own backend stays stdlib-only either
way, since it never imports mlx/mlx-lm/llguidance directly.
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
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

from backend import system
from backend.edition import allows_code_download, is_store_build
from backend.llm.runtimes import bundled_runtime_dir, llamacpp
from backend.system import force_utf8_streams, is_apple_silicon

BASE = Path(__file__).resolve().parent.parent.parent
# Where to install the (large, writable) runtime + model files. Defaults to
# BASE for a source checkout / Docker (unchanged behavior); the packaged
# `quiltor` CLI points this at a per-user directory instead, since BASE is
# inside site-packages for a pip/pipx install -- not a place to dump a
# multi-GB download. Shipped, read-only assets (the mlx bridge script below)
# stay BASE-relative regardless.
HOME = Path(os.environ.get("QUILTOR_HOME", str(BASE)))
RUNTIME_DIR = HOME / "runtime"
MODELS_DIR = HOME / "models"
LLAMA_CPP_REPO = "ggml-org/llama.cpp"
DEFAULT_MODEL_REPO = "Qwen/Qwen3-4B-GGUF"
DEFAULT_MODEL_FILE = "Qwen3-4B-Q4_K_M.gguf"
DEFAULT_MLX_MODEL_REPO = "mlx-community/Qwen3-4B-4bit"
MLX_REQUIREMENTS = BASE / "scripts" / "llm-runtime" / "mlx-requirements.txt"
MLX_BRIDGE = BASE / "scripts" / "llm-runtime" / "mlx_bridge.py"
MLX_VENV_DIR = RUNTIME_DIR / "mlx-venv"
MLX_MODELS_DIR = MODELS_DIR / "mlx"


def resolve_runtime(choice: str) -> str:
    if choice != "auto":
        return choice
    # A Store build never auto-selects MLX: install_mlx_runtime() below builds a
    # venv and pip-installs into it, which App Store guideline 2.5.2 forbids.
    if is_store_build():
        return "llamacpp"
    return "mlx" if is_apple_silicon() else "llamacpp"


def _venv_python(venv_dir: Path) -> Path:
    # venv's own layout, not an OS behaviour -- hence the os_name() check here
    # rather than a helper in backend/system/.
    if system.os_name() == "windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python3"


def is_configured() -> bool:
    """True if a runtime is already installed, or explicitly pointed at via env vars."""
    if os.environ.get("QUILTOR_AI_URL") or os.environ.get("QUILTOR_AI_BINARY"):
        return True
    # resolve_binary() prefers a runtime shipped inside the app bundle over the
    # downloaded one, so a Store build counts as configured as soon as the
    # weights are there -- there is no runtime download left to wait for.
    if llamacpp.resolve_binary(HOME).exists() and list(MODELS_DIR.glob("*.gguf")):
        return True
    if _venv_python(MLX_VENV_DIR).exists():
        return True
    return False


def ensure_installed() -> None:
    """Called by server.py at startup. Prompts once, interactively, if nothing is set up yet."""
    if is_configured():
        return
    if sys.stdin is None or not sys.stdin.isatty():
        return  # non-interactive context (piped, a service, CI, a windowed desktop build) -- stay silent
    runtime = resolve_runtime("auto")
    size = "~2,4 GB" if runtime == "mlx" else "~2,5 GB"
    print()
    print("  Kein lokaler KI-Assistent gefunden.")
    try:
        answer = input(f"  Jetzt einrichten ({runtime}-Runtime, {size} Download)? [j/N] ").strip().casefold()
    except (EOFError, KeyboardInterrupt):
        print()
        answer = ""
    if answer not in ("j", "ja", "y", "yes"):
        print("  Übersprungen. Quiltor läuft ohne Assistenten. Später jederzeit mit: python3 -m backend.llm.installer")
        print()
        return
    try:
        install(runtime)
    except (SystemExit, Exception) as exc:
        # Also catches network/subprocess failures (URLError, OSError,
        # CalledProcessError, ...) from download()/install_mlx_runtime() -- a
        # flaky connection during setup must not take the whole server down.
        print(f"  ! Einrichtung fehlgeschlagen: {exc}")
        print("  Quiltor startet trotzdem; der Assistent bleibt bis zur nächsten Einrichtung inaktiv.")
    print()


def install(runtime: str, *, model_repo: str = DEFAULT_MODEL_REPO, model_file: str = DEFAULT_MODEL_FILE, mlx_model_repo: str = DEFAULT_MLX_MODEL_REPO, skip_runtime: bool = False, skip_model: bool = False, skip_smoke_test: bool = False, on_progress: Callable[[str, int], None] | None = None) -> None:
    if runtime == "mlx":
        if not skip_runtime:
            install_mlx_runtime(on_progress)
        if not skip_model:
            install_mlx_model(mlx_model_repo, on_progress)
        if not skip_runtime and not skip_model and not skip_smoke_test:
            if on_progress:
                on_progress("Smoke test", 0)
            smoke_test_mlx(MLX_MODELS_DIR / mlx_model_repo.split("/")[-1])
    else:
        if not skip_runtime:
            install_runtime(on_progress)
        if not skip_model:
            install_model(model_repo, model_file, on_progress)


def platform_asset_pattern() -> re.Pattern[str]:
    # llama.cpp's own release asset naming, which is why this lives here rather
    # than in backend/system/: it is a third-party convention that happens to
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
    raise SystemExit(f"Unsupported platform: {os_name}/{arch}. Set QUILTOR_AI_BINARY to a local llama-server build instead.")


def latest_release_asset(pattern: re.Pattern[str]) -> tuple[str, str]:
    url = f"https://api.github.com/repos/{LLAMA_CPP_REPO}/releases/latest"
    with urllib.request.urlopen(url, timeout=30) as response:
        release = json.load(response)
    for asset in release.get("assets", []):
        if pattern.search(asset["name"]):
            return asset["name"], asset["browser_download_url"]
    raise SystemExit(f"No llama.cpp release asset matched {pattern.pattern!r}. Check https://github.com/{LLAMA_CPP_REPO}/releases/latest")


def download(url: str, dest: Path, label: str, on_progress: Callable[[str, int], None] | None = None) -> None:
    """Downloads to a `.part` file and renames it atomically on success, so a
    partial/interrupted run never gets mistaken for a finished install.

    Resumes a leftover `.part` file via an HTTP Range request instead of
    restarting from byte 0 -- these are multi-GB downloads (the model alone is
    ~2.5GB), so a closed app, a dropped connection, or a killed process used to
    mean every retry re-downloaded the whole thing from scratch, forever, if it
    kept getting interrupted before finishing.
    """
    print(f"Downloading {label} ...")
    partial = dest.with_name(dest.name + ".part")
    resume_from = partial.stat().st_size if partial.exists() else 0

    request = urllib.request.Request(url)
    if resume_from:
        request.add_header("Range", f"bytes={resume_from}-")
    with urllib.request.urlopen(request, timeout=30) as response:
        # A server/redirect that ignores Range sends the full content back with
        # status 200 instead of 206 -- appending that to the existing bytes would
        # corrupt the file, so treat it as a fresh download instead.
        resumed = bool(resume_from) and response.status == 206
        if resume_from and not resumed:
            resume_from = 0
        remaining = int(response.headers.get("Content-Length") or 0)
        total = resume_from + remaining if remaining else 0
        done = resume_from
        with open(partial, "ab" if resumed else "wb") as f:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if total:
                    pct = min(100, done * 100 // total)
                    print(f"\r  {pct:3d}% ({done // (1024 * 1024)} MB / {total // (1024 * 1024)} MB)", end="", flush=True)
                    if on_progress:
                        on_progress(label, pct)
    print()
    partial.replace(dest)


def _extract_archive(archive: Path, dest: Path) -> None:
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(dest)
    elif archive.name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:gz") as tf:
            if sys.version_info >= (3, 12):
                tf.extractall(dest, filter="data")
            else:
                tf.extractall(dest)
    else:
        raise SystemExit(f"Don't know how to extract {archive.name}")


def install_runtime(on_progress: Callable[[str, int], None] | None = None) -> None:
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

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    target = RUNTIME_DIR / binary_name
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
    if not allows_code_download():
        raise SystemExit(
            f"This build must not download a runtime (App Store guideline 2.5.2), and no "
            f"llama-server ships inside it. Expected one in {bundled_runtime_dir() or 'the app bundle'}; "
            f"see packaging/README.md on bundling and signing it.")

    pattern = platform_asset_pattern()
    name, url = latest_release_asset(pattern)
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        # Download and extraction must live in separate directories: several
        # llama.cpp release zips extract flat with no wrapping folder, so if
        # the archive sat in the same directory it would get "found" as a
        # sibling file and copied into runtime/ right along with the binary.
        download_dir, extract_dir = tmp / "download", tmp / "extracted"
        download_dir.mkdir()
        extract_dir.mkdir()
        archive = download_dir / name
        download(url, archive, name, on_progress)
        _extract_archive(archive, extract_dir)
        # Match the exact binary name only — a loose "llama-server*" prefix
        # also matches sibling libs like llama-server-impl.dll and can pick
        # the wrong (non-executable) file depending on directory order.
        found = next((p for p in extract_dir.rglob(binary_name) if p.is_file()), None)
        if not found:
            raise SystemExit(f"{binary_name} not found inside the downloaded archive")
        # Copy every file next to the binary, not just the binary itself —
        # llama-server is a thin launcher that depends on sibling shared
        # libraries (ggml*/llama* .dll/.so files) to run at all. Copying
        # only the executable produces a file that looks installed but
        # can't start. Skip files that fail to copy (e.g. an antivirus
        # transiently locking a freshly extracted .exe) rather than aborting
        # the whole install over an unrelated debug/bench tool.
        for item in found.parent.iterdir():
            if not item.is_file():
                continue
            try:
                shutil.copy2(item, RUNTIME_DIR / item.name)
            except OSError as exc:
                print(f"  ! skipped {item.name}: {exc}")
        if system.os_name() != "windows":
            target.chmod(target.stat().st_mode | stat.S_IEXEC)
        system.strip_quarantine(RUNTIME_DIR)
    print(f"Installed {target}")


def install_model(repo: str, filename: str, on_progress: Callable[[str, int], None] | None = None) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    target = MODELS_DIR / filename
    if target.exists():
        print(f"model already present at {target}, skipping")
        if on_progress:
            on_progress("Model", 100)
        return
    url = f"https://huggingface.co/{repo}/resolve/main/{filename}"
    download(url, target, filename, on_progress)
    print(f"Installed {target}")


def install_mlx_runtime(on_progress: Callable[[str, int], None] | None = None) -> None:
    if is_store_build():
        # Creating a venv and pip-installing into it downloads and runs executable
        # code, which App Store guideline 2.5.2 forbids outright. Refuse loudly
        # rather than let a Store build ship something that fails review -- the
        # bundled llama.cpp runtime covers Apple Silicon here, just more slowly.
        raise SystemExit("The Mac App Store build cannot install the MLX runtime (App Store guideline 2.5.2). Use --runtime llamacpp.")
    if not is_apple_silicon():
        raise SystemExit("MLX is only supported on Apple Silicon Macs. Use --runtime llamacpp instead.")
    if sys.version_info < (3, 10):
        raise SystemExit(f"MLX requires Python 3.10+; this interpreter is {platform.python_version()}. Install a newer Python and re-run.")
    venv_python = _venv_python(MLX_VENV_DIR)
    if venv_python.exists():
        print(f"MLX runtime already present at {venv_python}, skipping")
        if on_progress:
            on_progress("Runtime", 100)
        return
    if on_progress:
        on_progress("Runtime", 0)
    print(f"Creating MLX virtual environment at {MLX_VENV_DIR} ...")
    subprocess.run([sys.executable, "-m", "venv", str(MLX_VENV_DIR)], check=True)
    print("Installing MLX runtime packages (mlx, mlx-lm, llguidance) ...")
    subprocess.run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    # --only-binary=:all: turns "no Xcode command line tools" into an
    # immediate, legible pip error instead of a 40-minute failed source build.
    subprocess.run([str(venv_python), "-m", "pip", "install", "--only-binary=:all:", "-r", str(MLX_REQUIREMENTS)], check=True)
    print(f"Installed MLX runtime at {MLX_VENV_DIR}")
    if on_progress:
        on_progress("Runtime", 100)


def install_mlx_model(repo: str, on_progress: Callable[[str, int], None] | None = None) -> None:
    target_dir = MLX_MODELS_DIR / repo.split("/")[-1]
    if target_dir.exists() and any(target_dir.iterdir()):
        print(f"MLX model already present at {target_dir}, skipping")
        if on_progress:
            on_progress("Model", 100)
        return
    print(f"Fetching file list for {repo} ...")
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}/tree/main", timeout=30) as response:
        entries = json.load(response)
    files = [entry["path"] for entry in entries if entry.get("type") == "file"]
    if not files:
        raise SystemExit(f"No files listed for {repo}; check https://huggingface.co/{repo}")
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, filename in enumerate(files):
        dest = target_dir / filename
        if dest.exists():
            print(f"  {filename} already present, skipping")
            continue
        # Coarse per-file progress (no aggregate byte count across all files known
        # upfront) -- good enough to show the UI something is happening.
        base_pct = index * 100 // len(files)
        download(f"https://huggingface.co/{repo}/resolve/main/{filename}", dest,
                  filename, (lambda label, pct, base=base_pct: on_progress(label, base + pct // len(files))) if on_progress else None)
    print(f"Installed MLX model at {target_dir}")


def smoke_test_mlx(model_dir: Path, timeout: float = 120) -> None:
    # Starting the process is not the same as it working -- this project has
    # already shipped a runtime that "started" but couldn't actually do
    # anything twice in one session (a wrong binary, an unenforced schema).
    # Run one real, schema-constrained request before declaring success.
    port = 18732
    venv_python = _venv_python(MLX_VENV_DIR)
    print("Smoke-testing the MLX bridge (this loads the model once, may take a minute) ...")
    process = subprocess.Popen([str(venv_python), str(MLX_BRIDGE), "--model", str(model_dir), "--host", "127.0.0.1", "--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.monotonic() + timeout
        ready = False
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise SystemExit(f"MLX bridge exited during startup (code {process.returncode}):\n{output}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as response:
                    if response.status == 200:
                        ready = True
                        break
            except Exception:
                pass
            time.sleep(1)
        if not ready:
            raise SystemExit(f"MLX bridge did not become healthy within {timeout:.0f}s. Check data/mlx-server.log once server.py is running, or re-run with --skip-smoke-test to skip this check.")
        schema = {"type": "object", "required": ["ok"], "additionalProperties": False, "properties": {"ok": {"type": "boolean"}}}
        payload = {
            "model": "local", "stream": False, "max_tokens": 50,
            "messages": [{"role": "user", "content": "Reply with the JSON object {\"ok\": true} and nothing else. /no_think"}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "smoke_test", "strict": True, "schema": schema}},
        }
        request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        content = json.loads(result["choices"][0]["message"]["content"])
        if content != {"ok": True}:
            raise SystemExit(f"MLX bridge responded but not with the schema-constrained value expected: {content!r}")
        print("MLX bridge smoke test passed: model loaded and schema-constrained output verified.")
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


# Background install for the desktop/web UI's "set up now" button (server.py's
# /api/assistant/install routes) -- CLI usage above stays synchronous and doesn't
# touch this. One install at a time process-wide; a second call while one is
# already running just returns False so the caller keeps polling the existing run
# instead of racing a second download into the same directories.
_async_lock = threading.Lock()
_async_state: dict[str, Any] = {"running": False, "phase": "", "percent": 0, "error": ""}


def install_async(runtime: str = "auto") -> bool:
    with _async_lock:
        if _async_state["running"]:
            return False
        _async_state.update(running=True, phase="", percent=0, error="")
    resolved = resolve_runtime(runtime)

    def on_progress(phase: str, percent: int) -> None:
        with _async_lock:
            _async_state.update(phase=phase, percent=percent)

    def run() -> None:
        try:
            install(resolved, on_progress=on_progress)
            with _async_lock:
                _async_state.update(running=False, phase="", percent=100, error="")
        except (SystemExit, Exception) as exc:
            # Also catches network/subprocess failures the installer surfaces as
            # SystemExit (e.g. an unsupported platform) -- see ensure_installed().
            with _async_lock:
                _async_state.update(running=False, error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return True


def read_install_state() -> dict[str, Any]:
    with _async_lock:
        return dict(_async_state)


def _cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runtime", choices=["auto", "llamacpp", "mlx"], default="auto", help="which backend to install (default: mlx on Apple Silicon, llama.cpp everywhere else)")
    parser.add_argument("--skip-runtime", action="store_true", help="do not download the runtime")
    parser.add_argument("--skip-model", action="store_true", help="do not download the model")
    parser.add_argument("--skip-smoke-test", action="store_true", help="skip the post-install MLX verification request (llama.cpp path has no smoke test)")
    parser.add_argument("--model-repo", default=DEFAULT_MODEL_REPO, help="Hugging Face repo id holding the GGUF file (llama.cpp path)")
    parser.add_argument("--model-file", default=DEFAULT_MODEL_FILE, help="GGUF filename inside the model repo (llama.cpp path)")
    parser.add_argument("--mlx-model-repo", default=DEFAULT_MLX_MODEL_REPO, help="Hugging Face repo id holding the MLX model (mlx path)")
    args = parser.parse_args()

    runtime = resolve_runtime(args.runtime)
    print(f"Runtime: {runtime}" + (" (auto-detected)" if args.runtime == "auto" else ""))
    install(runtime, model_repo=args.model_repo, model_file=args.model_file, mlx_model_repo=args.mlx_model_repo, skip_runtime=args.skip_runtime, skip_model=args.skip_model, skip_smoke_test=args.skip_smoke_test)
    print("\nDone. Start Quiltor with: python3 server.py")


if __name__ == "__main__":
    force_utf8_streams()
    try:
        _cli()
    except KeyboardInterrupt:
        sys.exit(130)
