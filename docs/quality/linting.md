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

## osv-scanner

Checks every lockfile a release depends on against the OSV advisory database:
`package-lock.json`, `Cargo.lock` and the hash-locked Python release locks listed in
`distribution/dependency-locks.json` (read from there, so a new lock is scanned without a
code change). Any known vulnerability fails the gate, whatever its severity.

- **Version:** 2.7.0, pinned with download URL and SHA-256 in `distribution/toolchains.json`
  (`lintTools["osv-scanner"]`).
- **Run:** `npm run lint:osv`. Local and CI behaviour as for actionlint; in CI it runs in the
  `workflow-docker-shell-lint` job. It needs network access to `osv.dev`.
- **Python locks:** their names end in `.lock`, so the runner passes them as
  `requirements.txt:<path>`; otherwise osv-scanner would not recognise them.
- **A finding:** update the dependency when a fixed version exists. npm: the exact pin in
  `package.json` for a direct dependency, `npm update <name>` for a transitive one. Python:
  regenerate the locks with `distribution/tooling/regenerate_dependency_locks.py`. Only
  when no fix exists, add an exception to `osv-scanner.toml` with the advisory id, a
  reason and an `ignoreUntil` date, and list it below.
- **Python fixes newer than the lock cut-off:** the locks resolve only releases before
  `generator.excludeNewer` in `distribution/dependency-locks.json`. A fix released later
  goes into `generator.excludeNewerPackages`: that one package gets its own cut-off, with
  the fixed version, the reason and the advisory ids beside it. The global cut-off stays,
  so no other dependency moves. `dependency_lock_contract.py` lists the reviewed set
  (`EXPECTED_PACKAGE_EXCEPTIONS`) and checks that every lock pins exactly that version.
  Today: pyjwt 2.15.0, pillow 13.0.0, setuptools 84.1.0. An entry is removed once the
  global cut-off passes its date.
- **npm fixes outside a parent's range:** when the fixed version lies outside the range a
  parent declares, an `overrides` entry in `package.json` pins it. Today: `katex` 0.18.2
  (GHSA-238p-pmpm-9mq7), pulled in by markdownlint-cli2 → markdownlint →
  micromark-extension-math, which declares `^0.16.0`. markdownlint registers only the math
  syntax extension (`math()` in `markdownlint/lib/micromark-parse.mjs`); katex is imported
  solely by the extension's HTML renderer, which markdownlint never calls, so the major
  jump cannot change lint results. Remove the entry once micromark-extension-math accepts a
  fixed katex.

Exceptions (`osv-scanner.toml`): none.

## cargo-deny

Checks the Rust workspace (`Cargo.lock`): RustSec advisories, the licenses of every crate,
duplicate versions and where crates come from.

- **Version:** 0.20.2, pinned with download URL and SHA-256 in `distribution/toolchains.json`
  (`lintTools["cargo-deny"]`).
- **Config:** `deny.toml`, with a comment on every section.
- **Run:** `npm run lint:cargo-deny` (`cargo-deny --locked check`). Local and CI behaviour as
  for actionlint; in CI it runs in the `portable-core` job, which already has the pinned
  Rust toolchain that `cargo metadata` needs.
- **Advisories:** vulnerable, unmaintained, unsound and yanked crates all fail. An exception
  goes into `[advisories] ignore` with id, reason and expiry date.
- **Licenses:** permissive licenses only (MIT, MIT-0, Apache-2.0, BSD-2/3-Clause, ISC,
  Unicode-3.0), the ones `THIRD-PARTY-NOTICES.md` already accepts in the other ecosystems.
  Quiltor's own PolyForm license is allowed for the two workspace crates only. A new
  license needs a decision and a line in `THIRD-PARTY-NOTICES.md`.
- **Sources:** crates.io only; any git dependency or other registry fails.

Rule relaxed:

- **`bans.wildcards = "allow"`**: the only wildcard is `quiltor-ffi`'s path dependency on
  `quiltor-core`. `allow-wildcard-paths` would cover it only if both crates said
  `publish = false`. A registry wildcard cannot change the build unnoticed, because every
  Cargo gate runs with `--locked`. Back to `deny` once the crates carry `publish = false`.

## CodeQL

Static analysis of Quiltor's own code in `.github/workflows/codeql.yml`: JavaScript and
TypeScript, Python, Rust, and the workflows themselves (`actions`). It runs on push to
`main`, on every pull request and weekly (Monday 04:17 UTC), with the default query suite.

- **Version:** `github/codeql-action` v4.39.1, pinned by SHA in `.github/actions.lock.json`.
- **Build mode:** `none` for all four languages. Nothing is built or installed, so no
  project code runs in the job.
- **Permissions:** `permissions: {}` at workflow level. The `analyze` job has
  `contents: read` and `security-events: write`, the latter only to upload the results.
- **Excluded:** `dist/`. It is built from `packages/client/src`, which is analysed itself.
- **Not local:** CodeQL has no npm script. Results appear under _Security → Code scanning_
  on GitHub. For a private repository that needs GitHub Advanced Security (Code Security)
  to be enabled in the repository settings; without it the upload step fails.

## stylelint

**What it checks.** Every `.css` file outside generated output, with `stylelint-config-recommended`
as the base. `dist/` is committed build output and is ignored, together with the other vendored
or generated folders Biome skips (`stylelint.config.mjs`). No stylistic rule is enabled:
formatting belongs to Biome, so none can disagree with it.

**How to run it.**

```bash
npm run lint:stylelint
```

It is part of `npm run check` and so of the `frontend` CI job. Both packages are exact-pinned
devDependencies. `npx stylelint "<glob>" --fix` applies the safe fixes; read the diff, because
a fix can move a declaration across the cascade.

**Biome comparison.** Biome's CSS rules are active and cover most of the recommended preset. A
stylelint rule that does the same job is switched off in `stylelint.config.mjs`, next to the
Biome rule that replaces it, so a finding is never reported twice:

| stylelint rule                                      | Biome rule (active)                                |
| --------------------------------------------------- | -------------------------------------------------- |
| `at-rule-no-unknown`                                | `suspicious/noUnknownAtRules`                      |
| `block-no-empty`                                    | `suspicious/noEmptyBlock`                          |
| `custom-property-no-missing-var-function`           | `correctness/noMissingVarFunction`                 |
| `declaration-block-no-duplicate-custom-properties`  | `suspicious/noDuplicateCustomProperties`           |
| `declaration-block-no-duplicate-properties`         | `suspicious/noDuplicateProperties`                 |
| `declaration-block-no-shorthand-property-overrides` | `suspicious/noShorthandPropertyOverrides`          |
| `font-family-no-duplicate-names`                    | `suspicious/noDuplicateFontNames`                  |
| `font-family-no-missing-generic-family-keyword`     | `a11y/useGenericFontNames`                         |
| `keyframe-block-no-duplicate-selectors`             | `suspicious/noDuplicateSelectorsKeyframeBlock`     |
| `keyframe-declaration-no-important`                 | `suspicious/noImportantInKeyframe`                 |
| `media-feature-name-no-unknown`                     | `correctness/noUnknownMediaFeatureName`            |
| `media-type-no-deprecated`                          | `complexity/noDeprecatedMediaType`                 |
| `named-grid-areas-no-invalid`                       | `correctness/noInvalidGridAreas`                   |
| `no-duplicate-at-import-rules`                      | `suspicious/noDuplicateAtImportRules`              |
| `no-invalid-position-at-import-rule`                | `correctness/noInvalidPositionAtImportRule`        |
| `no-irregular-whitespace`                           | `suspicious/noIrregularWhitespace`                 |
| `property-no-unknown`                               | `correctness/noUnknownProperty`                    |
| `selector-anb-no-unmatchable`                       | `correctness/noUnmatchableAnbSelector`             |
| `selector-pseudo-class-no-unknown`                  | `correctness/noUnknownPseudoClass`                 |
| `selector-pseudo-element-no-unknown`                | `correctness/noUnknownPseudoElement`               |
| `selector-type-no-unknown`                          | `correctness/noUnknownTypeSelector`                |
| `no-descending-specificity`                         | `style/noDescendingSpecificity` (off in Biome too) |

What stylelint adds on top, because Biome has no active rule for it: `no-duplicate-selectors`
(Biome's `noDuplicateSelectors` is a nursery rule and not enabled), `property-no-deprecated`,
`declaration-property-value-keyword-no-deprecated`, `declaration-property-value-no-unknown`,
`at-rule-no-deprecated`, `function-calc-no-unspaced-operator`, `media-query-no-invalid`,
`color-no-invalid-hex` and the other recommended rules not listed above.

**Rules that are off, and why.** Everything in the table is off because Biome already reports
it. The one rule that is off in both tools is `no-descending-specificity`, for the reason given
in the Biome section: it compares selectors that can never match the same element, and
reordering stylesheets to satisfy it moves the cascade without fixing anything.

**Corrections made when the gate was introduced** (none changes what is rendered):

- `clip: rect(0, 0, 0, 0)` in four visually-hidden rules became `clip-path: inset(50%)`, the
  replacement for the deprecated property; the box is 1px, `overflow: hidden`, so it hides the
  same pixels.
- `word-break: break-word` was dropped where `overflow-wrap: anywhere` sits next to it; the
  deprecated keyword is defined as exactly that.
- Duplicate selectors were merged where no rule in between could target the same element with
  equal specificity; one dead `color` in `FigureInspector.css` (always overridden by a later
  rule of the same selector) was removed.

## markdownlint

**What it checks.** The structure of every Markdown file: heading levels and a single title,
fenced code blocks with a language, blank lines around lists and fences, bare URLs, inline HTML.
It runs `markdownlint-cli2` with the default rule set.

**How to run it.**

```bash
npm run lint:markdown
```

It is part of `npm run check` and of the `frontend` CI job. Configuration is in
`.markdownlint-cli2.jsonc`, with a reason next to every deviation.

**Files that are not linted.** `.claude/agents`, `.claude/output-styles` and `team/roles`:
`team/sync.mjs` generates them from role sources, and `.prettierignore` skips them for the same
reason. Nothing else is excluded; German texts pass because the rules look at structure, not at
language.

**Rules that are off, and why.**

| Rule                   | Setting         | Reason                                                                                                  |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `MD013` line length    | off             | Prettier never rewraps prose, and table rows and URLs cannot be wrapped; a fixed limit only adds noise. |
| `MD060` table style    | off             | Prettier formats and pads tables, which this rule reads as a different style.                           |
| `MD024` duplicate head | `siblings_only` | The same heading under different parents is fine.                                                       |
| `MD026` punctuation    | `,;:` only      | Headings are sometimes full sentences ending in a full stop.                                            |
| `MD033` inline HTML    | `<a>` allowed   | `<a id="...">` creates the named anchors other documents link to; Markdown has no syntax for it.        |
| `MD036` emphasis       | off             | A bold line on its own is a tagline or a version line here, not a pseudo-heading.                       |

**Corrections made when the gate was introduced.** In `docs/TODO.md`, `README.md` and
`README.en.md` the extra `#` headings (several top-level parts in one file) moved one level
down, with their sub-headings; heading text is unchanged, so anchors stay the same. `<code>`
in two architecture views became backticks, two fences in `CLAUDE.md` got a language, the
blank line between consecutive quotes in `docs/plans/author-pilot.md` became a quote
continuation, and a bare e-mail address became an autolink.
