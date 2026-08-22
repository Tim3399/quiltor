# Shipped sidecars

These files are subprocess assets that ship with Quiltor but do not run inside
the Python process:

- `pdf/render-book-pdf.mjs` drives the supported browser PDF renderer.
- `inference/mlx/bridge.py` exposes the constrained local MLX runtime.
- `inference/mlx/requirements.lock` pins that optional runtime's dependencies.

Every executable asset must be allowlisted by `quiltor.resources.sidecar_asset`.
Application and domain modules may only obtain sidecars through that resolver;
they must not construct repository paths. Distribution profiles decide whether
a target may ship or install an optional sidecar runtime.

Repository-only checks and evaluation automation belong under `tools/`, never in
this package resource directory.
