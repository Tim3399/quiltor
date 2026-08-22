# Bundled inference runtime

`python3 apps/web/server.py` installs a runtime here automatically on first launch,
after asking once. It picks llama.cpp everywhere, or MLX on Apple Silicon;
run `PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer --runtime llamacpp`
or `--runtime mlx` to install explicitly or override the default.
`quiltor.infrastructure.inference.select`
prefers MLX when it's installed and falls back to llama.cpp automatically if
it isn't — a Mac never ends up without a working assistant just because the
MLX step was skipped.

## llama.cpp (`llama-server`, `llama-server.exe`)

Quiltor starts it on loopback port 11435 and terminates the child process
when the application server stops. No model endpoint is exposed beyond the
local machine. If the assistant reports itself unavailable, check
`data/llama-server.log` — the bundled server's stdout/stderr is captured
there instead of being discarded.

## MLX (`mlx-venv/`, Apple Silicon only)

A dedicated virtual environment holding `mlx`, `mlx-lm`, and `llguidance`
(the JSON-schema-constrained decoding engine — see
`src/quiltor/resources/sidecars/inference/mlx/bridge.py`). Quiltor spawns that
packaged sidecar from inside this venv, the same way it
spawns `llama-server`. Its log is `data/mlx-server.log`.

## Overrides

During development, `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL`, or
`QUILTOR_AI_URL` can point at an existing local runtime, and
`QUILTOR_AI_RUNTIME=llamacpp|mlx` forces a specific backend instead of the
platform default. Setting `QUILTOR_AI_URL` tells Quiltor an endpoint already
exists elsewhere and it will not spawn its own server.
