# Linting

Every linter in this repository is blocking: the whole tree has zero findings, and any new
finding turns the gate red. There is no baseline. A rule is switched off or downgraded only
with a reason, written as a comment in the tool's configuration where the format allows one,
and in this file otherwise.

## Biome

**What it checks.** `biome lint` with Biome's `recommended` preset, on every file the `files`
section of `biome.json` admits: TypeScript, JavaScript and CSS in `packages/`, `apps/`,
`tests/`, `tools/` and `team/`. Warnings fail the gate as much as errors do
(`--error-on-warnings`); infos are reported and should be fixed too.

**How to run it.**

```bash
npm run lint:biome
```

`npm run check` runs it, so does the `frontend` CI job through `npm run check`. Biome is the
pinned devDependency (2.5.7); nothing else needs installing. Many findings carry a fix:
`npx biome lint <path> --write` applies the safe ones, `--unsafe` the rest -- read the diff
before keeping an unsafe fix, it can change behaviour.

**Single findings.** A finding that is intended is suppressed where it occurs, with the reason
after the colon:

```ts
// biome-ignore lint/correctness/useExhaustiveDependencies: `selectionKey` is a trigger: switching the edited item resets all selection-bound state
```

`useExhaustiveDependencies` in particular is never fixed by adding or removing dependencies
blindly. A dependency that is only a trigger, or a callback that is recreated on every render,
would make the effect fire at a different time. Each such hook carries its reason instead.

**Rules that are off, and why.** `biome.json` is plain JSON -- Biome 2.5.7 accepts comments in
it without complaint, but then silently processes no files at all -- so the reasons live here.

| Rule                            | Scope                                                | Reason                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `style/noDescendingSpecificity` | everywhere                                           | The rule compares any two selectors whose last compound matches (`> div`, `header p`), whether or not they can ever select the same element. Reordering stylesheets to satisfy it moves the cascade without fixing anything. The visual baselines and the design suite are what guard the cascade.                                                    |
| `style/noNonNullAssertion`      | `tests/**`, `**/*.test.{ts,tsx,mjs}`, `**/*.spec.ts` | A test dereferences what it has just asserted to exist -- a Playwright bounding box, a fixture lookup. A `null` there throws and fails the test, which is what an explicit guard would do too, only with a different message. Product code keeps the rule; its one intended assertion (`apps/web/main.tsx`) carries a `biome-ignore` with the reason. |

## zizmor

Security audit of `.github/workflows/*.yml`: template injection, credentials persisted by
`actions/checkout`, dangerous triggers, excessive permissions, unpinned actions and about
forty more audits. It complements `distribution/tooling/workflow_contract.py`, which checks
pinning and runtimes but not what a workflow does with its inputs.

- **Version:** 1.31.1, pinned in `distribution/toolchains.json` (`lintTools.zizmor`) and,
  hash-checked, in `distribution/lint-tools.requirements.txt`. `tools/dev/lint-tool.mjs`
  refuses any other version.
- **Install:**
  `py -3.12 -m pip install --require-hashes --only-binary=:all: -r distribution/lint-tools.requirements.txt`
- **Run:** `npm run lint:zizmor`. Part of `npm run check`, and of the `frontend` CI job.
- **Mode:** `--offline`, default persona. The online audits (`impostor-commit`,
  `known-vulnerable-actions`, `ref-version-mismatch`) need a GitHub token; without one a
  local run and CI would audit different things.
- **Why not `tools/dev/python.mjs`:** the zizmor wheel installs an executable and no Python
  module, so there is nothing for `--needs` to import. The runner looks in the scripts
  directory of the same interpreters `python.mjs` tries, then on PATH.

Exceptions, each with its reason where it is made:

| Where                                                                | Audit                | Why                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-publish.yml`, `workflow_run` trigger                        | `dangerous-triggers` | The hand-off from Release Build. The job re-reads the run through the API, requires `release.yml` on main at the current head, and only then checks out that SHA.                                           |
| `release.yml`, `release-context` checkout                            | `artipacked`         | Keeps the token to fetch `origin/main`; the job uploads no artifact. Written as `persist-credentials: true`.                                                                                                |
| `visual-baselines-bootstrap.yml`, `bootstrap` checkout               | `artipacked`         | Pushes the generated baselines with that token; its upload takes only test results and the Vite log.                                                                                                        |
| `.github/zizmor.yml`, seven lines of the Release Build manifest step | `template-injection` | `tests/python/test_release.py` asserts those `${{ }}` expressions literally. The values are this workflow's own validated job outputs. The ignores are by line, so moving the step makes zizmor fail again. |

Everywhere else the findings were fixed: `persist-credentials: false` on every other
checkout, and step outputs passed to scripts through `env:` instead of `${{ }}`.

## actionlint

Syntax and expression checks for the same workflows: unknown keys, wrong `${{ }}` types,
matrix and `needs` references, runner labels. Every `run:` script goes through shellcheck.

- **Version:** 1.7.12, pinned with download URL and SHA-256 in `distribution/toolchains.json`.
- **Run:** `npm run lint:actionlint`. Locally only when installed; otherwise it prints
  `actionlint not installed, runs in CI` and exits 0. `npm run doctor` shows the
  download line. In CI (`workflow-docker-shell-lint` job) a missing binary is an error.
- **shellcheck inside `run:`:** used when the pinned shellcheck is on PATH; without it the
  runner says that the scripts were skipped. CI always has it.
- **pyflakes:** switched off (`-pyflakes=`). No step uses `shell: python`, and an
  unpinned pyflakes on PATH must not change the result.

In-script exception: `release.yml`, macOS keychain setup, `SC2046` — the existing keychain
list is split into separate arguments on purpose.

## hadolint

Lints `Dockerfile` and `services/backup-server/Dockerfile` (every tracked `Dockerfile`),
including the shell inside `RUN`.

- **Version:** 2.15.1, pinned with download URL and SHA-256 in `distribution/toolchains.json`.
- **Config:** `distribution/containers/hadolint.yaml`, `failure-threshold: info` — every
  finding fails.
- **Run:** `npm run lint:hadolint`. Local and CI behaviour as for actionlint.

Rules switched off:

- **DL3059** (merge consecutive `RUN`), in the config: the separate `RUN` steps are build
  gates that should fail as their own step in the log; they add no files to the runtime.
- **DL3008** (pin apt versions), inline on the web runtime base: the base is pinned by
  digest, and the Ubuntu archive drops superseded versions, so a version pin breaks the
  build on the next security update.
- **DL3066** (numeric `USER`), inline in both Dockerfiles: the user is created by `useradd`
  in the same image; pinning a uid could lock existing `/data` volumes out.

## shellcheck

Lints every tracked `*.sh` (today the two macOS release scripts in
`distribution/desktop/macos/direct/`).

- **Version:** 0.11.0, pinned with download URL and SHA-256 in `distribution/toolchains.json`.
- **Run:** `npm run lint:shellcheck`. Local and CI behaviour as for actionlint.

In-script exception: `smoke-install.sh`, `SC2009` — the process check needs a fixed-string
match on an install path, and `pgrep -f` would read it as a regular expression.

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
