# Development and quality

The [project engineering profile](PROJECT_PROFILE.md) is the operational reference for
formatter ownership, startup, agent instructions and pending requirements. After setup, `npm start`
runs the complete local application (API on 8010, Vite on 5173). `npm run format` formats web,
Python, documentation and Rust; `npm run check:format` checks the same scopes without writing.
Run `npm run check`, `npm run build` and `npm test` for the separate static, build and unit gates.
The profile includes alternate-port and isolated-data configuration.

Set up the editable Python environment and npm dependencies described under
[Development](operations/installation.md#development). Exact release toolchains are recorded in
[`distribution/toolchains.json`](../distribution/toolchains.json): currently Node 22.23.2,
npm 10.9.8, CPython 3.12.10, and Rust 1.98.0. `npm run doctor` reports deviations and
installation hints; release preflight and version bumps require the pinned versions.
The Python formatter is needed separately, in the Ruff version pinned there.

Run the independent gates from the repository root:

```bash
npm ci
npm run doctor
npm run check
npm test
npm run build
PYTHONPATH=src python -m unittest discover -s tests/python -t tests/python -v
cargo test --locked --workspace --all-targets
npm run check:distribution
```

For the backend suite inside the activated environment on Windows PowerShell:

```powershell
$env:PYTHONPATH = "src"
python -m unittest discover -s tests/python -t tests/python -v
```

Use the interpreter from the environment in which you installed the project dependencies.
Inside an activated virtual environment, `python` refers to that environment. For a
launcher-based installation outside a virtual environment, use `py -3.12` for both
dependency installation and the test command.

Among other things, the gates check:

- TypeScript
- design-token rules
- i18n key parity
- hard-coded visible UI text
- the built client
- versioned API, storage and native-bridge contracts
- architecture and platform boundaries and the public design-system API

`npm run check` validates contracts, architecture, design rules, i18n, platform boundaries,
and formatting. It runs the quality tools' own tests, but **does not run the client unit,
Python backend, or browser suites**. `npm run build` additionally checks TypeScript and
produces the web client; `npm test` runs the client unit tests.

The product browser suite needs a Python server on **8010**:

```bash
python3 apps/web/server.py 8010 --no-open
```

Then, in a second terminal:

```bash
npm run test:e2e
```

`npm run test:e2e` runs the product suite followed by the design suite. The design suite
can also run independently with `npm run test:design`; it starts its own Vite server.

**`dist/` is committed and the product suite tests those built files.** After a change
under `packages/client/src`, run `npm run build` before product E2E tests and include the
updated `dist/` in the change; CI checks that the sources and `dist/` agree. Restart the Python server after backend changes because
an existing process keeps its imported modules. Unit tests and the design suite use source
files, so passing them does not verify the built application.

Browser/E2E tests cover core workspaces, desktop/compact layouts, light/dark mode, autosave, conflicts, and accessibility.

## Developer tools

| Command                                                 | What for                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`                                             | Bring up both halves (API on 8010, Vite on 5173) and stop them together.                                                                              |
| `npm run check`                                         | All gates in a row, without building.                                                                                                                 |
| `npm run doctor`                                        | Shows which of the four pinned runtimes deviates from `distribution/toolchains.json`. Without them, `npm run set-version` refuses the version change. |
| `npm run probe -- "<expression>"`                       | Evaluates an expression in the running application and returns the result as JSON. Optional `--places`, `--storyboard`, `--compact` …                 |
| `npm run mutate -- <file> --from X --to Y -- <command>` | Undoes a fix and checks whether the test notices. Success means the command fails.                                                                    |

`probe` measures through Playwright on purpose, not in the embedded browser window: a hidden
window does not paint, no `ResizeObserver` fires there, and measurements taken there look like
findings without being any.

```bash
# Inspect the actual browser layout with an isolated fixture world; requires npm start.
npm run probe -- --places --compact "document.querySelectorAll('.react-flow__node').length"

# Verify that a regression test fails when the fix is temporarily undone.
node tools/dev/mutate.mjs <file> --from "<fixed text>" --to "<previous text>" -- <test command>

# Compare committed Windows, Linux, and macOS visual baselines.
node tools/dev/baseline-sheet.mjs
```

The mutation helper restores the file afterwards and succeeds only if the test command
fails. The baseline contact sheet serves on port 4180. Platform-specific screenshots are
kept separately because font rasterisation differs; changed baselines need visual review.

## Language and internationalization

Developer-facing code, identifiers, comments, docstrings, logs, errors, test titles, and
diagnostics should be **English**, as specified in [`CLAUDE.md`](../CLAUDE.md). German UI
strings, assertions that quote that UI, and German manuscript fixtures are intentional.
The repository still contains some developer-facing German text; the i18n check validates
UI localization and is **not** a general audit of comments, logs, or test titles.

```bash
npm run check:i18n
```

Visible UI text and new translation packs belong in the deliberately prominent root directory:

```text
locales/{de,en,...}/*.ts
```

Adding Spanish, for example, requires exactly one prominent catalog import and `localePackages`
entry in [`locales/index.ts`](../locales/index.ts). No other registry or UI code change is needed;
the i18n check automatically enforces directory-to-registry parity. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

The seven README screenshots come from a fixed example world at 1440 × 900 pixels, taken in German and in English, each language with its own interface and its own example world: the base of the test world in `tests/world/`, as shipped in `src/quiltor/resources/example_world/` (`npm run world:update` writes it). They are retaken automatically with every release: `npm run set-version` starts an isolated server for it and writes `docs/screenshots/<language>/manifest.json` per language (version, a checksum per image, a checksum of the script and demo data); the release preflight and `npm run check` refuse images that do not match `VERSION`. By hand:

```bash
npm run screenshots:readme
```

The images are valid for Windows, where releases are prepared; font rendering differs per system, and the Linux release job only verifies the manifest. `node tools/documentation/compare_readme_screenshots.mjs <directory-a> <directory-b>` compares two runs of one version (output directory via `QUILTOR_SCREENSHOT_DIR`); a few edge pixels can differ, and the tool allows at most 0.05 % differing pixels per image. The script checks API responses and deletes the demo world afterward. The demo data lives under [`tools/documentation/`](../tools/documentation/).
