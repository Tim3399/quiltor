# Third-party notices

Quiltor's own source is licensed as described in [LICENSE](LICENSE). This file
covers third-party software and model weights distributed alongside it. Their
licenses are independent of Quiltor's and are not affected by it — in
particular, the Apache-2.0 license on the bundled model applies only to the
model weights, not to Quiltor's source code, and Quiltor's license does not
apply to the model.

## Bundled at setup time (`runtime/`, `models/` — not committed to Git)

`backend/llm/installer.py` downloads these on demand — either automatically
on first launch of `server.py`, or explicitly via
`python3 -m backend.llm.installer`; they ship in release packages.

- **llama.cpp** (`llama-server` / `llama-server.exe` and its `ggml*`/`llama*`
  libraries) — MIT License. Copyright (c) 2023-2026 The ggml authors.
  <https://github.com/ggml-org/llama.cpp>
- **Qwen3-4B** (`Qwen3-4B-Q4_K_M.gguf`) — Apache License 2.0.
  <https://huggingface.co/Qwen/Qwen3-4B-GGUF>
- **MLX** (Apple Silicon only, `runtime/mlx-venv/`) — `mlx` and `mlx-lm`,
  MIT License, <https://github.com/ml-explore/mlx>,
  <https://github.com/ml-explore/mlx-lm>; **llguidance**, MIT License,
  <https://github.com/guidance-ai/llguidance>.
- **Qwen3-4B, MLX quantization** (`models/mlx/Qwen3-4B-4bit/`, Apple Silicon
  only) — Apache License 2.0. <https://huggingface.co/mlx-community/Qwen3-4B-4bit>

## Bundled in the built client (`dist/`, committed to Git)

- **React** and **React DOM** — MIT License. Copyright (c) Meta Platforms, Inc. and affiliates.
- **@xyflow/react** — MIT License.
- **lucide-react** — ISC License.

Full license texts for these are available from their respective npm
packages and repositories; `npm ls` and each package's own `LICENSE` file are
authoritative.

## A note on `libomp140.x86_64.dll`

The Windows `llama-server` runtime bundle includes `libomp140.x86_64.dll` (an
LLVM OpenMP runtime redistributable). If you build or repackage the runtime
yourself, verify its license and redistribution terms for your use case
before distributing it further.
