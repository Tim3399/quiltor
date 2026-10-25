# Linting

Every linter in this repository is blocking: the whole tree has zero findings, and any new
finding turns the gate red. There is no baseline. A rule is switched off only with a reason,
written next to the switch.

## ruff

`ruff check` lints all Python under `src/`, `apps/`, `tools/`, `distribution/`, `services/`
and `tests/python/`, with the exclusions of `[tool.ruff]` in `pyproject.toml` (Markdown,
build output, runtimes, models). The version is pinned to 0.16.4 in
`distribution/toolchains.json`; CI installs exactly that version.

Run it locally:

```bash
npm run lint:ruff
```

It is part of `npm run check`, so the `frontend` CI job runs it through the same command.
Never call ruff through a bare `python`; `tools/dev/python.mjs --needs ruff` picks an
interpreter that actually has it.

### Rule set

The set is explicit, in `[tool.ruff.lint]`, so a ruff upgrade cannot change what the gate
means: `E4`, `E7`, `E9`, `F`, `B`, `UP`, `RUF`, `PERF`, `SIM`, `I`, `S` and `BLE`.

Switched off, with the reason in `pyproject.toml`:

| Rule           | Where                    | Why                                                                                         |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `S603`, `S607` | everywhere               | every subprocess call passes an argument list to a known tool; `shell=True` is still caught |
| `S310`         | everywhere               | URLs are constants or operator-configured; the backup base URL is scheme-checked            |
| `UP042`        | everywhere               | `StrEnum` changes `str()`/`format()` of members, which is a behaviour change                |
| `PERF401`      | everywhere               | remaining hits are appends in nested, conditional loops; a comprehension reads worse        |
| `S`            | `tests/**`               | tests use `assert`, throwaway credentials, temp paths and subprocesses by design            |
| `SIM117`       | `tests/**`               | nested `with patch(...)` blocks are deliberate grouping in mock-heavy tests                 |
| `BLE001`       | `tests/**`, HTTP routes  | tests catch broadly to assert; a route turns any exception into an error response           |
| `E402`         | four entry-point scripts | they put the source tree on `sys.path` before importing from it                             |

Not selected at all:

- `TRY` — mostly style opinions (`TRY003` alone has over 1000 hits on ordinary messages),
  and `TRY004` would change which exception type callers see.
- `PT` — the suites use `unittest`, not pytest.

Every other exception is a single-line `# noqa: <code> - <reason>`. `BLE001` is selected,
so each remaining `except Exception` in product code says why it is broad.

## pyright

pyright type-checks the Python under `src/quiltor`, `apps/web`, `tools`,
`distribution/tooling` and `tests/python` against Python 3.12, in `standard` mode. It
comes from npm, pinned exactly in `package.json`; the configuration is `[tool.pyright]` in
`pyproject.toml`.

Run it locally:

```bash
npm run lint:pyright
```

Arguments after `--` narrow the run, for example `npm run lint:pyright -- src`. It is part
of `npm run check`.

### Which Python it reads

pyright resolves third-party imports (typer, PyJWT, markdown-it-py) through a Python
interpreter. Left alone it would take the first `python` on PATH, which may be one without
the project's dependencies. `tools/dev/python.mjs --needs typer` picks an interpreter that
can import them, and `tools/dev/run_pyright.py` hands exactly that interpreter to pyright.
In CI the `frontend` job installs the project with `pip install -e .` for this reason.

`extraPaths` puts `src` first, so a worktree is checked against its own sources rather
than the editable install, which points at the main checkout. It also adds
`distribution/tooling` and `distribution/desktop/pyinstaller`, the directories the tests
put on `sys.path` at runtime.

### Settings

| Setting                            | Why                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `typeCheckingMode = "standard"`    | the whole tree passes it; strict would add about 1,200 findings in `domain` and `application` alone    |
| `strict = [...]`                   | the three small helpers added with the gate (`run_pyright.py`, `narrowing.py`, `module_loader.py`)     |
| `enableTypeIgnoreComments = false` | a bare `# type: ignore` is not honoured; a suppression must be `# pyright: ignore[<rule>]` and name it |

No rule is switched off in the configuration.

### Suppressions

There are nine, all `reportMissingImports`, all for imports of optional platform packages
that are not installed where the check runs:

- Per line: `webview` in `hosts/desktop/app.py`, `hosts/desktop/bridge/api.py` and
  `infrastructure/pdf/hidden_window.py` (the `desktop` extra); `playwright` in
  `infrastructure/pdf/system_browser.py` (the `browser-pdf` extra); `AppKit` in
  `infrastructure/platform/adapters/macos.py` (macOS only).
- Per file, with `# pyright: reportMissingImports=false` and the reason above it, for
  modules that are platform code throughout: `infrastructure/pdf/wkwebview.py` and
  `infrastructure/pdf/page_numbers.py` (macOS, pyobjc), `infrastructure/pdf/webkitgtk.py`
  (Linux, PyGObject), and `resources/sidecars/inference/mlx/bridge.py`, which runs only
  inside the MLX sidecar's own environment.

### In tests

Test fakes implement only what a test reaches, so they rarely satisfy a whole port
protocol. Where a fake is handed to a typed constructor it is wrapped in `cast(<Port>, ...)`.
An optional result the test expects to exist goes through `present(...)` from
`tests/python/narrowing.py`, which fails like `assertIsNotNone` and narrows the type.
Arguments that are deliberately wrong, to test rejection, are written `cast(Any, ...)` with
a comment saying so.
