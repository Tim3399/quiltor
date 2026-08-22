# Bundled local model

`python3 apps/web/server.py` downloads the default model into this directory automatically on first launch, after asking once. To trigger it explicitly: `PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer`.

Quiltor release packages place one model here per runtime it ships: a GGUF file for llama.cpp directly in this directory, and an MLX model directory under `mlx/` for Apple Silicon. Both pair the same base weights, `Qwen3-4B` (`Qwen3-4B-Q4_K_M.gguf` for llama.cpp, `mlx-community/Qwen3-4B-4bit` for MLX) — the quantization method differs, but not the underlying model, to keep Windows/Linux and Mac behaviour as close as one variable allows.

The model boundary is editorial rather than consumer-oriented: lawful fictional violence, sex, crime, horror, abuse, politics, religion, and other difficult material must remain analysable. Before a model is shipped, it must pass Quiltor's refusal evaluation — separately for each quantization, since quantization quality is not purely cosmetic. Community “uncensored” derivatives are not shipped without separate provenance and commercial-license review.

Model files are deliberately excluded from Git because release assets, not source control, own multi-gigabyte model payloads. `QUILTOR_AI_MODEL` can select another local GGUF (llama.cpp) or MLX model directory without changing the application.
