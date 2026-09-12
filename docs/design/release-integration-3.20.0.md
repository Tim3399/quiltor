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

The release must still pass the declared version updater's full preflight and the exact-commit
GitHub test, release-build and release-publication workflows. A successful reference-generation
run alone is not evidence that visual comparison passed.
