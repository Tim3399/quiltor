# Repository tooling

`tools/` contains developer-facing automation that is never imported by the
application and never shipped as product runtime code.

- `quality/` owns architecture, contract, design, localisation and platform
  gates.
- `evaluation/assistant/` owns local assistant scenarios, seeders and their
  fixtures.
- `documentation/` owns reproducible documentation assets such as README
  screenshots.

Artifact assembly, signing and publication tooling remains beside the target
definitions under `distribution/tooling/`. Executable helpers that ship with
Quiltor are sidecars under `src/quiltor/resources/sidecars/`, not repository
tools.

Application modules must not import this directory. Add a new top-level tooling
category only when it has one clear owner and lifecycle.
