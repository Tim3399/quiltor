# Frontend design review implementation · 12 September 2026

This records the initial review and approved comparison implementation. The subsequently authorized
[autonomous follow-up](followup-review-2026-09-12.md) resolves the remaining design and typography points.

## Outcome and decisions

Claude's handover in the ignored `ai/plans/frontend-styleguide-adoption.md` was checked against
the current `092578c` working tree. Its contrast and typography findings were confirmed. Existing
uncommitted engineering-standard, formatter and documentation work was preserved.

- The styleguide now has one source at `docs/design/FRONTEND_STYLEGUIDE.md`, referenced from
  `CLAUDE.md`, `AGENTS.md` and the design-system README. The original prose is unchanged apart
  from the declared formatter. The duplicate under `packages/client/src/design/` was removed.
- The live component inventory now states 35 public folders and includes `StatusBar`. The
  historical 25 August inventory still records its original 34 folders; historical evidence must
  not be rewritten to match today's count.
- `DESIGN.md` records the existing workshop direction and preserves earlier open decisions.
  Its two concrete references are existing Quiltor views; it introduces no new external product
  identity. The comparison typography was explicitly selected by the owner after a preview:
  16px serif for manuscript content, 14px monospace for technical file content. Profile prose
  shares the manuscript presentation.
- The general history dialog uses the existing soft diff backgrounds and readable text roles.
  Insertions retain an underline and deletions a strike-through. This also works when both kinds
  occur in the same unchanged context line, as real Git word diffs do. No palette values changed.
- The [typography inventory](typography-audit.md) covers all 138 original 9/10px uses. Seven
  semantic size-role families now replace numeric size choices in public and feature CSS.
  Outside the approved history change, sizes and other typography properties remain unchanged.
  Small work-content candidates elsewhere remain documented for an explicit, contextual size review.

## Corrections to the handover

The proposed regression test compared hard-coded old tokens. Such a test would remain red after a
consumer-only CSS repair. The implemented test instead reads the actual history word rules, resolves
their text/background aliases and checks both themes. Browser tests independently inspect computed
styles in the real application.

The audit confirms 138 uses but corrects their distribution to 46 at 9px and 92 at 10px. The first
role migration describes sizes; weight, line height, tracking and family remain context-owned.
It does not claim to have introduced complete shared font recipes. A small public-owner contract
test prevents returning to numeric sizes; no exception-ratchet framework was added.

The initial browser fixture used `world` instead of the API's `worldId` for a backup request.
After that fixture correction, a layout assertion sampled the sheet during its entrance animation.
It now waits for the settled position. Neither failure required changing product backup or overlay
behavior.

## Verification

The complete application was started with `npm start`, using API port 8110, Vite port 5273,
`QUILTOR_API_TARGET=http://127.0.0.1:8110`, and separate temporary `QUILTOR_DATA_DIR` and
`QUILTOR_HOME` directories. Tests create and clean up their own worlds. No personal manuscript,
backup destination or installed assistant configuration is used.

Executed commands and evidence:

| Command                                                                                                                              | Result                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `npx prettier --write docs/design/FRONTEND_STYLEGUIDE.md CLAUDE.md AGENTS.md packages/client/src/design/README.md`                   | Applied the declared documentation formatter to changed sources.                                                         |
| `npx prettier --write DESIGN.md`                                                                                                     | Passed.                                                                                                                  |
| `npx prettier --check docs/design/FRONTEND_STYLEGUIDE.md DESIGN.md CLAUDE.md AGENTS.md packages/client/src/design/README.md`         | Passed.                                                                                                                  |
| `node tools/quality/check_design_public_api.mjs`                                                                                     | Passed: 35 folders, 219 product files.                                                                                   |
| `npx vitest run packages/client/src/design/testing/colorContrast.test.ts -t 'history'`                                               | Before the fix: four expected failures, reproducing 3.44, 3.40, 2.52 and 2.66 contrast ratios.                           |
| `npx vitest run packages/client/src/design/testing/colorContrast.test.ts`                                                            | Passed: 66 tests after the fix.                                                                                          |
| `npx vitest run packages/client/src/modules/history/HistoryDialog.test.tsx packages/client/src/design/testing/colorContrast.test.ts` | Passed: 70 tests.                                                                                                        |
| `npm test`                                                                                                                           | Passed: 210 files, 1,275 tests.                                                                                          |
| `npm run check:format`                                                                                                               | Passed: web, Python, documentation and Rust.                                                                             |
| `git -c safe.directory=C:/Users/timra/git/quiltor/quiltor diff --check`                                                              | Passed.                                                                                                                  |
| `npx playwright test tests/e2e/history-design.spec.ts --output="$env:TEMP/quiltor-design-review-01a0960d/product-source-results"`    | Against Vite on 5273: 12 passed across wide, regular and compact views in both themes, before the additional 320px case. |

The 67 CSS owners migrated by the implementation worker were formatted with the local Biome CLI;
its role-contract tests passed 2/2. The worker compared resolved typography declarations by selector
against a pre-migration snapshot in 109 non-token stylesheets outside the history change. The lead
reviewed the diff and requested corrections to brand, heading and error-message classifications.

Two counter-checks deliberately restored incorrect styling and automatically restored the fixed
file afterward:

```powershell
node tools/dev/mutate.mjs packages/client/src/modules/history/HistoryDialog.css --from 'background: var(--diff-add);' --to 'background: var(--diff-word-add);' -- npx vitest run packages/client/src/design/testing/colorContrast.test.ts -t history

$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:5273'
node tools/dev/mutate.mjs packages/client/src/modules/history/HistoryDialog.css --from 'font-size: var(--font-size-body-emphasis);' --to 'font-size: var(--font-size-body-legacy-compact);' -- npx playwright test tests/e2e/history-design.spec.ts --project=wide --grep "real manuscript.*light" --output="$env:TEMP/quiltor-design-review-01a0960d/typography-mutation"
```

Both counter-checks succeeded by making the targeted tests fail. The browser counter-check actually
selected both theme cases; both reported expected 16px versus received 10px.

The history tests use an actual local Git snapshot and changed manuscript, plus a labeled technical
diff fixture. They cover text contrast, non-color word markers, type families and sizes, long-line
wrapping, doubled technical text, overlay width, dismissal, focus return and manuscript preservation.
The lead visually inspected the wide light and compact dark history screenshots.

Final integration results:

| Command                                                                                                                                                                                                                               | Result                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`                                                                                                                                                                                                                       | Passed, including contracts, architecture, design, design-system, i18n, platform boundaries, TypeScript and the Vite production build. Tracked `dist/` regenerated.                                                                  |
| `npx playwright test --config playwright.design.config.ts --output="$env:TEMP/quiltor-design-review-01a0960d/design-results"`                                                                                                         | Passed: all 136 design cases.                                                                                                                                                                                                        |
| `npx playwright test tests/e2e/history-design.spec.ts tests/e2e/visual-baseline.spec.ts --grep 'History\|core views\|expanded map' --update-snapshots=none --output="$env:TEMP/quiltor-design-review-01a0960d/product-built-results"` | With `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8110`: 24 passed, including all 12 history cases and all 12 existing visual-reference cases. No reference images changed. The compact technical cases use 320px width and 200% text size. |

The API reported version 3.16.3, matching this checkout's `VERSION`. The served HTML was byte-equal
to the freshly generated `dist/index.html`. This checks the running source/build identity to the
extent currently implemented; the application has no stronger embedded checkout identity. The
lead also visually inspected the final 320px screenshot with doubled technical text: controls and
content fit, and the comparison remains vertically scrollable.

The first sandbox `npm --version` attempt could not access the user's installed npm module;
checks were run successfully with access to the installed toolchain. An initial Git read required
the process-local `safe.directory` option for this user-owned checkout; no global Git configuration
was changed. Neither setup issue remained a blocker.

## Scope limits

No full Python or Rust test suite, complete product E2E suite, release preflight, package installation,
native build, commit, push or deployment was performed. The work does not claim full WCAG conformance.
The additional candidate size changes listed in the typography audit are intentionally not applied;
they require concrete view-level decisions and verification.
