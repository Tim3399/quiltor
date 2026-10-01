# Design release integration for 3.20.0

The owner authorized committing, pushing and publishing the completed design work as the
next minor release, with completion conditional on a green pipeline and a published version.
The earlier review records describe the original 3.16.3 checkout. Release integration starts
from main `87322755de920a2fc6e28ee02b3aea8a1eaf1499`, which already shipped 3.19.0.

Only the reviewed design changes, their documentation and regression coverage were transferred
into an isolated release worktree. Unrelated local engineering and formatter work was preserved
in its original checkout. The 3.19 inline chapter comparison, format-change legends and print
preview remain intact; their added typography references use the corresponding semantic roles
without changing rendered sizes or printed page-number dimensions.

## Integration evidence

- `npm ci` and `npm run doctor` passed with the pinned toolchains.
- `npm run build` passed, including contracts, architecture, design, design-system, i18n,
  platform checks and TypeScript. The committed frontend was rebuilt from the integration.
- `npm test`: 216 files and 1,329 tests passed.
- `npm run check:format`: web, Python and documentation formatting passed.
- `npx playwright test tests/e2e/visual-baseline.spec.ts --update-snapshots=none --output="$env:TEMP/quiltor-release-3.20.0/baseline-final"`:
  the unchanged specification passed all 13 applicable Windows cases; two existing performance
  cases intentionally skip the smaller viewports.
- `npx playwright test tests/e2e/history-design.spec.ts tests/e2e/assistant-output-design.spec.ts tests/e2e/workspace-reading-design.spec.ts --output="$env:TEMP/quiltor-release-3.20.0/product-design"`:
  28 passed, eight intentionally skipped viewport duplicates. The server served the fresh
  production build on port 8110 with isolated temporary application data.

The initial Windows visual comparison retained the old references. A temporary `expect.soft`
mutation collected every difference, producing ten expected failing cases with 26 changed
images. The specification was restored. Actual images and pixel differences were reviewed in
both themes and all three viewports: changes were confined to the intended reading labels,
assistant typography and responsive timeline layout. The 26 reviewed Windows references were
accepted; the corresponding 52 Linux/macOS references were retired according to `CLAUDE.md`
so the existing baseline workflow can capture them on their own platforms.

## Release preflight and platform follow-up

`npm run set-version -- minor` first stopped at the unavailable local Docker engine after
passing the earlier gates; all version files remained unchanged. Four stale, empty Docker
runtime sockets were cleared after stopping only the failed startup processes. Docker settings,
images, volumes and unrelated processes were preserved; `docker version` and `docker info`
then succeeded.

The complete command was rerun without skipping gates and passed: 928 backend tests with five
environment-dependent skips, four CLI tests, Rust formatting/lints/tests, 1,329 frontend tests,
all production build checks, wheel/sdist builds and isolated package smoke tests, both container
builds and runtime checks including Chromium PDF generation, 259 product browser cases with
161 intentional skips, and all 144 design-gallery cases. Only then did the updater write 3.20.0
to `VERSION`, both npm manifests and both Cargo manifests.

The baseline workflow regenerated exactly 26 references each for Linux and macOS. The generated
views were sampled across both themes and all viewport sizes, and
`node tools/quality/check_visual_baseline_reach.mjs` passed. All GitHub design jobs and Linux
browser shards passed. The macOS product run exposed an existing editor restoration ordering
issue: after returning to Text, a later CodeMirror measurement shifted the saved outer scroll
position from 5880 to 5862. Its exact-position assertion remains the acceptance criterion for
the focused follow-up. The initial workflow and its diagnostics are available in
[Test run 34713668769](https://github.com/Tim3399/quiltor/actions/runs/34713668769).

The follow-up keeps the saved position exact and makes the one-time restore wait through the
additional post-measure animation frame. Both queued frames remain cancellable, and moving
focus elsewhere still prevents the late restore. The existing unit regression now injects the
observed 18px shift after the first post-measure frame. Reverting the scheduling correction makes
that test fail at 303 instead of 321; the corrected editor/session suites pass all 39 cases.
The product E2E assertion and its timeout were left unchanged.

The Windows product run had two independent runner failures: requests for lazy-loaded editor
and figure chunks failed with `net::ERR_NO_BUFFER_SPACE`, followed by failed dynamic imports.
The workspaces could not mount, so increasing assertion timeouts would not fix either failure.
Those E2E tests remain unchanged and are rerun on a fresh runner with the corrected integration.

Publication requires the final integration to pass the exact-commit GitHub test, release-build
and release-publication workflows. A successful reference-generation run alone is not evidence
that visual comparison passed.
