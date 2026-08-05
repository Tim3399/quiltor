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

## Installing & running (implemented)

Path decoupling (`backend/paths.py`) separates the read-only `package_root()`
(code + shipped `dist/` and `scripts/`) from a writable `home()` (`runtime/`,
`models/`, `data/`). In a source checkout `home()` is the repo root, so dev is
unchanged; installed it is a per-user app-data dir. Override with `QUILTOR_HOME`
(whole tree) or `QUILTOR_DATA_DIR` (just worlds).

```bash
npm run build                       # build the frontend into dist/ first
pipx install .                      # or: pip install .   (backend is stdlib-only)
quiltor install                     # fetch the runtime + generation model
quiltor install --with-embeddings   # optional: add the embedding model
quiltor doctor                      # check paths, models, connectivity
quiltor run                         # start on :8000 and open a browser
```

Build a wheel with `python -m build --wheel --outdir build/wheel` (a custom
outdir is required — the default `dist/` collides with the frontend build).

App-layer Docker image (`Dockerfile`, `.dockerignore`): carries only the app,
points at native inference via `QUILTOR_AI_URL` (Docker on Apple Silicon can't
run the model). `docker build -t quiltor .` then run with
`-e QUILTOR_AI_URL=http://host.docker.internal:11435 -v quiltor-data:/data`.

## Environment variables (for the setup CLI to manage)

| Variable | Purpose |
|---|---|
| `QUILTOR_DATA_DIR` | writable data dir (worlds, backups, digests, vectors) |
| `QUILTOR_AI_URL` | external generation endpoint; unset = spawn bundled llama-server |
| `QUILTOR_EMBED_URL` | external embedding endpoint; unset = spawn bundled embedding server (port 11436) |
| `QUILTOR_EMBED_MODEL` | path to a specific embedding GGUF (else auto-pick from `models/embed/`) |
| `QUILTOR_EMBED_POOLING` | `mean` (default) / `cls` / `last`, per the embedding model |
| `QUILTOR_EMBED_QUERY_PREFIX` / `QUILTOR_EMBED_DOC_PREFIX` | query/document prefixes some embedding models require |

**Model choice is not a user-facing decision.** The maintainer pre-selects the
generation and embedding models (the defaults in `installer.py`); a user only
ever (a) takes the pre-selected model, or (b) points `QUILTOR_AI_URL` /
`QUILTOR_EMBED_URL` at their own endpoint. There is no model picker. The
`--*-model-repo` installer flags exist only for the maintainer/CI when choosing
what the pre-selected default *is*, not as an end-user choice.

Because users cannot swap it, the pre-selected embedding model must suit the
product's content (multilingual, since manuscripts are often non-English).
Semantic retrieval is optional; without an embedding model, retrieval falls back
to lexical automatically. The `quiltor` CLI wraps setup into `install`
(generation + embedding models) and env management — again presenting only
"use pre-selected" or "use a URL".

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
