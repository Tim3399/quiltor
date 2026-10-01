# Quiltor project engineering profile

## Adoption

| Field             | Value                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Product           | Quiltor, a local writing workshop with a React/TypeScript frontend, Python hosts and a Rust core                         |
| Kickoff skill     | `project-start` 1.1.0, applied on 2026-09-10                                                                             |
| Adopted baseline  | [Cross-project engineering standard 1.0.0](standards/README.md), retained from the existing repository snapshot          |
| Status            | Formatting and agent workflow integrated; broader startup and build-identity requirements remain partial as listed below |
| Active profiles   | Web, Python, documentation, Rust                                                                                         |
| Developer systems | Windows, Linux and macOS; this adoption is exercised on Windows                                                          |

This is the current operational profile. The dated [engineering history](reference/engineering-history.md)
is context, not current verification. Repeated skill runs must merge changes into this
profile and preserve project extensions. Upgrading the baseline is a separate deliberate change.
Repository rules remain in [CLAUDE.md](../CLAUDE.md), contributor gates in
[CONTRIBUTING.md](../CONTRIBUTING.md), and agent coordination in [AGENTS.md](../AGENTS.md).

## Formatting and toolchains

| Scope                                        | Owner and configuration                    | Pin                                                                                                  |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| JS, JSX, MJS, CJS, TS, TSX, JSON, JSONC, CSS | Biome, `biome.json`                        | 2.5.7 in `package.json`                                                                              |
| Python                                       | Ruff, `pyproject.toml`; target Python 3.12 | 0.16.4 in `distribution/toolchains.json`                                                             |
| Markdown, YAML, HTML                         | Prettier, `.prettierrc`, `.prettierignore` | 3.9.6 in `package.json`                                                                              |
| Rust                                         | rustfmt defaults, `rust-toolchain.toml`    | Rust 1.98.0 with rustfmt and clippy                                                                  |
| Text whitespace                              | `.editorconfig`, `.gitattributes`          | UTF-8, LF, final newline; two spaces, Python/Rust four, Makefile tabs; preserve Markdown hard breaks |

Formatting commands do not run lint fixes or reorder imports. Prettier's embedded-language
formatting is disabled so code blocks remain examples and HTML layout does not gain a second
JavaScript formatter. Generated output, dependencies, caches, environments, local data,
model weights and packaged artifacts are excluded by each owner's configuration. `models/`
contains runtime model assets here, not maintained application source. Package locks keep
their generator's serialization. Do not mass-format unrelated work as part of a feature.

Release runtime authority: `distribution/toolchains.json` pins Node 22.23.2, npm 10.9.8,
CPython 3.12.10 and Rust 1.98.0. `.node-version`, `.python-version`, `rust-toolchain.toml`,
`package.json` and CI carry corresponding selections. `npm run check:distribution` checks
release profiles; `node tools/dev/python.mjs --needs quiltor distribution/tooling/workflow_contract.py check`
checks workflow and toolchain configuration. `npm run doctor` checks installed runtimes.
Python's supported runtime floor is 3.12; release tooling requires exact pins.
`package-lock.json` and `Cargo.lock` are committed; distribution Python closures have
target-specific locks under `distribution/`.

## Command map

Run commands from the repository root, not its parent workspace container.

| Operation                | Command                                                                                                            | Scope                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| JavaScript setup         | `npm ci`                                                                                                           | Committed npm dependency graph                                                                                     |
| Python development setup | `python -m pip install -e . ruff==0.16.4`                                                                          | Selected Python 3.12 environment; see README setup instructions                                                    |
| Browser setup            | `npx playwright install chromium`                                                                                  | Product/design browser tests and source PDF renderer                                                               |
| Diagnostics              | `npm run doctor`                                                                                                   | Exact release runtime versions                                                                                     |
| Complete local start     | `npm start`                                                                                                        | Python API and Vite, no implicit installation or build                                                             |
| Frontend development     | `npm run dev`                                                                                                      | Vite only; API must already run on the configured target                                                           |
| Format / check           | `npm run format` / `npm run check:format`                                                                          | Web, Python, documentation and Rust, matching scopes                                                               |
| Rust format / check      | `npm run format:rust` / `npm run check:format:rust`                                                                | `cargo fmt --all` / `cargo fmt --all -- --check`                                                                   |
| Static gates             | `npm run check`                                                                                                    | Contracts, architecture, design, design system, i18n, platform boundaries, formatting; includes quality-tool tests |
| Production frontend      | `npm run build`                                                                                                    | Project static gates, TypeScript and Vite; writes tracked `dist/`                                                  |
| Client unit tests        | `npm test`                                                                                                         | Vitest; separate from static gates                                                                                 |
| Python tests             | `node tools/dev/python.mjs --needs quiltor -m unittest discover -s tests/python -t tests/python`                   | Set `PYTHONPATH=src`; use an interpreter with project dependencies                                                 |
| Rust lint / tests        | `cargo clippy --locked --workspace --all-targets -- -D warnings` / `cargo test --locked --workspace --all-targets` | Native core, separate from `npm run check`                                                                         |
| Product and design tests | `npm run test:e2e`                                                                                                 | Build first, start a fresh Python server on 8010; design suite starts its own Vite server                          |
| Distribution contracts   | `npm run check:distribution`                                                                                       | Release profiles and source configuration                                                                          |
| Release preflight        | `npm run release:preflight`                                                                                        | Exact toolchains and full applicable release gates, including packaging and containers                             |
| Version preparation      | `npm run set-version -- patch`                                                                                     | Also `minor`, `major` or explicit increasing stable version; clean tree and preflight required                     |

`npm run check` does not run client, backend, Rust or browser suites or the production build.
Contributor gates are `npm run build` and `npm test`; add checks relevant to changed behavior.
GitHub Actions implements frontend, Python, native and distribution gates in
`.github/workflows/`. The frontend job runs the same aggregate formatting check.

## Local runtime

| Service/mode                   | Default                 | Configuration and evidence                                                       |
| ------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| API through `npm start`        | `http://127.0.0.1:8010` | `QUILTOR_API_PORT`; launcher probes `/api/version`                               |
| Vite through `npm start`       | `http://127.0.0.1:5173` | `QUILTOR_DEV_PORT`; strict port, loopback; launcher probes `/`                   |
| Vite proxy                     | `http://127.0.0.1:8010` | `QUILTOR_API_TARGET` in `vite.config.ts`; set explicitly for alternate API ports |
| Built frontend/product tests   | `http://127.0.0.1:8010` | Python serves `dist/`; `PLAYWRIGHT_BASE_URL` selects test target                 |
| Installed application / Docker | Port 8000               | Separate product deployment configuration                                        |

The existing launcher resolves the checkout from its script location and starts API before
Vite. Each readiness loop has 60 attempts with 1.5-second HTTP timeouts and one-second delays;
the wall-clock deadline can therefore exceed 60 seconds. HTTP success currently does not prove
launch or checkout identity. Validate the API version against `VERSION` and inspect the actual
served frontend when reporting a smoke test; do not claim embedded build identity exists.

Ctrl+C/failure cleanup targets owned child process trees on Windows; POSIX currently signals
direct children. The backend does not reload imported Python modules: restart after edits.
Default source data is `<checkout>/data`; `QUILTOR_DATA_DIR` overrides it. `QUILTOR_HOME` also
affects legacy runtime/model locations. Avoid shared writable data when running concurrently.

Example alternate session in PowerShell, with disposable data outside the checkout:

```powershell
$env:QUILTOR_API_PORT = "8110"
$env:QUILTOR_API_TARGET = "http://127.0.0.1:8110"
$env:QUILTOR_DEV_PORT = "5273"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:8110"
$env:QUILTOR_DATA_DIR = Join-Path $env:TEMP ("quiltor-session-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $env:QUILTOR_DATA_DIR | Out-Null
npm start
```

Create the data directory before launch: an installed inference runtime can open its log before
the application creates the directory. For a smoke test without installed local AI resources,
also set `QUILTOR_HOME` to a separate temporary directory; the writing UI works without a model.
Set the same test target in the separate test terminal. This explicit configuration is a
workaround for missing automatic propagation, not verified concurrent-worktree support.

## Version and release

`VERSION` is authoritative (3.16.3 at adoption). The existing updater synchronizes it with
`package.json`, both root npm lock entries, the Cargo workspace version and local crate lock
entries. Python metadata reads `VERSION`. Stable semantic versions only: patch for compatible
fixes, minor for compatible functionality, major for incompatible public contracts.
The updater validates its manifest set and rolls back replacement failures. It requires a
clean tree and rejects non-increasing versions. It does not commit, push, tag or publish.

`dist/` is intentionally committed because Python wheels and containers serve it. Rebuild
after frontend source changes. CI compares tracked output; detecting newly generated untracked
assets remains pending. `/api/version` identifies the backend product version, not the loaded
frontend. Deterministic frontend source-content metadata is not implemented yet.

A version change reaching `main` triggers release building; an eligible successful build can
trigger automatic publication. Release publication verifies the exact revision and artifact
digests and promotes existing artifacts without rebuilding. See
[the release workflow boundary](../.github/workflows/README.md).

## Exceptions and pending work

| Requirement                                    | Actual behavior / reason                                                                            | Next step or review condition                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete startup identity and failure contract | HTTP status probes, no launch token; port validation and failure handling incomplete                | Implement shared validated configuration, owned-instance probes and missing-dependency/occupied-port/early-exit/cleanup fixture tests in a launcher change |
| Shared Python selection                        | Startup checks Python version; command resolver checks imports but does not enforce runtime version | Consolidate version and required-import checks when changing launcher/resolver                                                                             |
| Cross-platform cleanup and isolation           | Windows process-tree cleanup; POSIX direct-child signaling; manual alternate ports/data             | Add bounded process-group cleanup and concurrent-session tests                                                                                             |
| Frontend build identity                        | Backend version alone cannot identify served frontend sources                                       | Embed version, mode and deterministic source digest excluding tracked generated output; extend updater transaction to rebuild/restore versioned assets     |
| Tracked generated output                       | Required by wheel/container distribution                                                            | Retain until distribution stops consuming committed `dist/`; add untracked-output freshness detection                                                      |
| Other file formats                             | TOML, shell, PowerShell, Dockerfile and XML/SVG have whitespace rules but no automatic layout owner | Retained existing convention; choose compatible formatter and exact pin before adding these types to the aggregate                                         |
| Full release validation                        | No release/version change requested; requires packaging tools and clean source tree                 | Run release preflight when preparing a release                                                                                                             |

## Verification

2026-09-10, `project-start` 1.1.0 with repository baseline 1.0.0.

| Command / check                                                                             | Result                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run doctor`                                                                            | Passed; all four release runtimes match                                                                                                                                                                                                                                                   |
| `npm run build`                                                                             | Passed, including TypeScript and production Vite output                                                                                                                                                                                                                                   |
| `npm test`                                                                                  | Passed: 205 files, 1,223 tests                                                                                                                                                                                                                                                            |
| `npm run check:distribution`                                                                | Passed: nine distribution profiles                                                                                                                                                                                                                                                        |
| `node tools/dev/python.mjs --needs quiltor distribution/tooling/workflow_contract.py check` | Passed; includes changed frontend rustfmt setup                                                                                                                                                                                                                                           |
| `npm run check:format:python`                                                               | Passed: 309 files                                                                                                                                                                                                                                                                         |
| `npm run check:format:rust`                                                                 | Passed                                                                                                                                                                                                                                                                                    |
| `npm run check`                                                                             | Passed, including all four formatting profiles                                                                                                                                                                                                                                            |
| `node "$env:TEMP\quiltor-start-smoke.cjs"` (disposable verification script)                 | Passed: `npm start` on 8110/5273, explicit proxy, isolated data/runtime home, API version 3.16.3, rendered dev and production world-opening screens without page errors, served HTML and entry bundle byte-identical to local `dist/`; owned process tree removed and both ports released |

Initial `npm run doctor`, `npm run build` and `npm test` attempts inside the sandbox could not
access the user npm installation; reruns with access to installed tools passed. Initial
`npm run check:format:web`, `npm run check:format` and `npm run check` reported formatting drift
in the concurrently edited `tests/e2e/support/expanded-map-fixture.ts`. That file was subsequently
formatted by the concurrent work; this adoption did not modify it. An intermediate documentation
check caught the unfinished profile; the profile was formatted before final verification.
The first isolated startup attempt exposed the need to create the data directory before an
installed inference runtime opens its log. A second smoke assertion expected mixed-case branding
instead of the actual uppercase heading; the final smoke checks the visible world-opening screen.

No fresh dependency installation, full Python/Rust test suite, product/design E2E suite, native
build, container build or release preflight was run for this configuration/documentation change.
No launcher or version helper was changed, so their broader failure/rollback contracts remain
pending rather than inferred from this smoke. Existing application edits were preserved; the
frontend build regenerated the current checkout's committed-output directory.
