# Deployment & Packaging Concept

Quiltor is a **local-first** app: a stdlib-only Python server (`server.py`) + a
static frontend build (`dist/`) + a **GPU-bound local LLM** (llama.cpp/Metal or
MLX on Apple Silicon). The inference is the only "heavy" part and the one
constraint everything else follows from.

## Core constraint: GPU inference must run natively

Docker Desktop on Apple Silicon runs a Linux VM with **no Metal passthrough**,
so a containerised model would run CPU-only — unusable for interactive
inference. **The LLM must run natively on the host.** (On Linux/NVIDIA hosts,
Docker + `nvidia-container-toolkit` gives real GPU passthrough; that path is
fine there, but not on macOS.)

## The enabling seam: `QUILTOR_AI_URL`

When `QUILTOR_AI_URL` is set, `server.py` does **not** spawn its own
`llama-server` — it talks to any OpenAI-compatible endpoint
(`backend/llm/select.py`). This decouples the app from inference and is what
makes every deployment shape below possible. Same pattern as `ai-relay`.

## Chosen distribution

### 1. Primary — pip / pipx wheel (cross-platform, native GPU)

- Backend is stdlib-only; frontend ships as static `dist/`. Runs natively → full
  Apple-Silicon GPU, no VM.
- The ~2.5 GB GGUF model + per-platform llama.cpp binaries are **not** bundled in
  the wheel; `ensure_installed()` fetches them on **first run** into a user
  cache dir. Wheel stays small.
- UX: `pipx install quiltor` → `quiltor` → first launch fetches runtime+model →
  browser opens.

### 2. Secondary — app-layer Docker image (hybrid / Linux)

- Containerise only the app (`python:slim` + code + `dist/`), started with
  `QUILTOR_AI_URL` pointing at a **native** inference server on the host
  (`host.docker.internal:11435`) or an `ai-relay` gateway.
- Not a GPU-inference image on macOS — the app layer only.

## The one enabling refactor (prerequisite for both)

Today `BASE = repo root` holds **both** the code and the mutable dirs
(`runtime/`, `models/`, `data/`). After `pip install`, `BASE` points into
`site-packages` (read-only; nobody wants 2.5 GB models there).

**Decouple the mutable dirs from the package** → a user cache dir (default
`~/Library/Application Support/Quiltor` / `~/.local/share/quiltor`, overridable
by env; `QUILTOR_DATA_DIR` already exists for `data/`). The code already threads
`base`/`data` through the runtime/installer chain
(`AssistantRuntime(base, data)` → `installer` → `select` → `llamacpp`), so this
is one contained seam, not a sweeping change.

## Build tasks

| Deliverable | Effort |
|---|---|
| `pyproject.toml` + entry point (`quiltor` → `server.main`) | small |
| Decouple `runtime/`/`models/`/`data/` → user cache dir (default + env override) | **medium** — the real work |
| Ship `dist/` as package data, resolve at runtime (`importlib.resources`) | small |
| Build step: `npm run build` before `python -m build` | small |
| Slim app-layer `Dockerfile` (`QUILTOR_AI_URL` required) | small |

Estimate: ~½–1 focused day for a clean wheel tested on a fresh environment plus
a slim app image.

## Sandbox / isolation

The assistant only emits **proposals** (no code/shell execution) and treats all
retrieved context as untrusted data, so classic untrusted-code sandboxing is not
the need. What to isolate instead:

- **Inference process** — already a separate child with parent-bound lifetime;
  further confinable via `sandbox-exec`/seatbelt (macOS) or a systemd unit with
  `ProtectSystem`/`PrivateTmp`/no-network-except-model-download (Linux).
- **Per-user data** — via `QUILTOR_DATA_DIR`.
- **Reproducibility** — pin binary + model + checksums in a runtime manifest
  (see `ai-relay`'s `runtime-manifest-v1.json`).

The right "environment" is an OS service (launchd/systemd) running native
inference + app, confined by the service manager — **not** a container for the
inference.
