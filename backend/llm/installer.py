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
import time
import urllib.request
import zipfile
from pathlib import Path

from backend.llm.runtimes import llamacpp
from backend.llm.shared.platform import force_utf8_streams, is_apple_silicon

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
    return "mlx" if is_apple_silicon() else "llamacpp"


def _venv_python(venv_dir: Path) -> Path:
    if platform.system() == "Windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python3"


def is_configured() -> bool:
    """True if a runtime is already installed, or explicitly pointed at via env vars."""
    if os.environ.get("QUILTOR_AI_URL") or os.environ.get("QUILTOR_AI_BINARY"):
        return True
    if (RUNTIME_DIR / llamacpp.binary_name()).exists() and list(MODELS_DIR.glob("*.gguf")):
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


def install(runtime: str, *, model_repo: str = DEFAULT_MODEL_REPO, model_file: str = DEFAULT_MODEL_FILE, mlx_model_repo: str = DEFAULT_MLX_MODEL_REPO, skip_runtime: bool = False, skip_model: bool = False, skip_smoke_test: bool = False) -> None:
    if runtime == "mlx":
        if not skip_runtime:
            install_mlx_runtime()
        if not skip_model:
            install_mlx_model(mlx_model_repo)
        if not skip_runtime and not skip_model and not skip_smoke_test:
            smoke_test_mlx(MLX_MODELS_DIR / mlx_model_repo.split("/")[-1])
    else:
        if not skip_runtime:
            install_runtime()
        if not skip_model:
            install_model(model_repo, model_file)


def platform_asset_pattern() -> re.Pattern[str]:
    # As of llama.cpp release packaging, Windows ships .zip assets; macOS and
    # Linux ship .tar.gz. Getting the extension wrong means the installer
    # fails outright on that platform (caught in review before this shipped).
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows":
        arch = "arm64" if machine in ("arm64", "aarch64") else "x64"
        return re.compile(rf"win-cpu-{arch}\.zip$")
    if system == "Darwin":
        return re.compile(r"macos-arm64\.tar\.gz$" if is_apple_silicon() else r"macos-x64\.tar\.gz$")
    if system == "Linux":
        arch = "arm64" if machine in ("arm64", "aarch64") else "x64"
        return re.compile(rf"ubuntu-{arch}\.tar\.gz$")
    raise SystemExit(f"Unsupported platform: {system}/{machine}. Set QUILTOR_AI_BINARY to a local llama-server build instead.")


def latest_release_asset(pattern: re.Pattern[str]) -> tuple[str, str]:
    url = f"https://api.github.com/repos/{LLAMA_CPP_REPO}/releases/latest"
    with urllib.request.urlopen(url, timeout=30) as response:
        release = json.load(response)
    for asset in release.get("assets", []):
        if pattern.search(asset["name"]):
            return asset["name"], asset["browser_download_url"]
    raise SystemExit(f"No llama.cpp release asset matched {pattern.pattern!r}. Check https://github.com/{LLAMA_CPP_REPO}/releases/latest")


def download(url: str, dest: Path, label: str) -> None:
    print(f"Downloading {label} ...")

    def report(block_num: int, block_size: int, total_size: int) -> None:
        if total_size <= 0:
            return
        done = block_num * block_size
        pct = min(100, done * 100 // total_size)
        print(f"\r  {pct:3d}% ({done // (1024 * 1024)} MB / {total_size // (1024 * 1024)} MB)", end="", flush=True)

    # Download to a temp file and rename atomically on success, so a
    # partial/interrupted run never gets mistaken for a finished install.
    partial = dest.with_name(dest.name + ".part")
    try:
        urllib.request.urlretrieve(url, partial, reporthook=report)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
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


def install_runtime() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    binary_name = llamacpp.binary_name()
    target = RUNTIME_DIR / binary_name
    if target.exists():
        print(f"runtime already present at {target}, skipping")
        return
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
        download(url, archive, name)
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
        if platform.system() != "Windows":
            target.chmod(target.stat().st_mode | stat.S_IEXEC)
        if platform.system() == "Darwin":
            # macOS quarantines downloaded executables; an unquarantined
            # copy still fails to launch with an unhelpful Gatekeeper
            # dialog if this is skipped.
            subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(RUNTIME_DIR)], capture_output=True)
    print(f"Installed {target}")


def install_model(repo: str, filename: str) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    target = MODELS_DIR / filename
    if target.exists():
        print(f"model already present at {target}, skipping")
        return
    url = f"https://huggingface.co/{repo}/resolve/main/{filename}"
    download(url, target, filename)
    print(f"Installed {target}")


def install_mlx_runtime() -> None:
    if not is_apple_silicon():
        raise SystemExit("MLX is only supported on Apple Silicon Macs. Use --runtime llamacpp instead.")
    if sys.version_info < (3, 10):
        raise SystemExit(f"MLX requires Python 3.10+; this interpreter is {platform.python_version()}. Install a newer Python and re-run.")
    venv_python = _venv_python(MLX_VENV_DIR)
    if venv_python.exists():
        print(f"MLX runtime already present at {venv_python}, skipping")
        return
    print(f"Creating MLX virtual environment at {MLX_VENV_DIR} ...")
    subprocess.run([sys.executable, "-m", "venv", str(MLX_VENV_DIR)], check=True)
    print("Installing MLX runtime packages (mlx, mlx-lm, llguidance) ...")
    subprocess.run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    # --only-binary=:all: turns "no Xcode command line tools" into an
    # immediate, legible pip error instead of a 40-minute failed source build.
    subprocess.run([str(venv_python), "-m", "pip", "install", "--only-binary=:all:", "-r", str(MLX_REQUIREMENTS)], check=True)
    print(f"Installed MLX runtime at {MLX_VENV_DIR}")


def install_mlx_model(repo: str) -> None:
    target_dir = MLX_MODELS_DIR / repo.split("/")[-1]
    if target_dir.exists() and any(target_dir.iterdir()):
        print(f"MLX model already present at {target_dir}, skipping")
        return
    print(f"Fetching file list for {repo} ...")
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}/tree/main", timeout=30) as response:
        entries = json.load(response)
    files = [entry["path"] for entry in entries if entry.get("type") == "file"]
    if not files:
        raise SystemExit(f"No files listed for {repo}; check https://huggingface.co/{repo}")
    target_dir.mkdir(parents=True, exist_ok=True)
    for filename in files:
        dest = target_dir / filename
        if dest.exists():
            print(f"  {filename} already present, skipping")
            continue
        download(f"https://huggingface.co/{repo}/resolve/main/{filename}", dest, filename)
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
