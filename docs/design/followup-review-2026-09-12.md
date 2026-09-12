# Design follow-up · 12 September 2026

The owner authorized autonomous implementation of the remaining points after approving 16px serif
manuscript and 14px monospace technical comparisons. This completes the contextual follow-up to
the [initial implementation review](implementation-review-2026-09-12.md).

## Decisions and resulting behavior

| Concern                  | Resolution                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small working content    | Relationship labels, guest figure names, journey stops and timeline titles now use 12px. Assistant proposals/questions use 14px. Collapsed map names use 14px serif and preserve their authored case.                                                                                    |
| Field and section labels | Field labels, SidePanel headings, writing-aid sections, timeline headings/details and map section headings use shared 12px recipes. Narrow focus helper chips remain 12px.                                                                                                               |
| Technical output         | Assistant trace, snapshot output and changed-file paths use a shared 12px monospace recipe and wrap long paths. The separately approved comparison sizes remain 16px serif and 14px mono.                                                                                                |
| Complete type roles      | Four reused recipes cover working prose, technical output, field labels and section labels, including weight, size, line height and family. Two tracking roles accompany labels. Contextual prose, titles, numeric typography and inherited control fonts remain intentional exceptions. |
| Sheet metaphor           | Manuscript retains its writing sheet; timeline and places retain their spatial work surfaces. Existing behavior already matches this decision.                                                                                                                                           |
| Focus chapter rail       | Retain the compact, on-demand navigation. Browser checks exercise keyboard chapter selection, current-chapter indication, return to editor focus, preserved text and contained helper panels.                                                                                            |
| Element-type colors      | Retain existing icons, shapes, text labels and semantic accents. No extra categorical palette is introduced.                                                                                                                                                                             |

Two inventory classifications were corrected after checking the rendered content: the small number
in WorldOverview is a count (it keeps 10px with a numeric role), and the small text under storyboard
library headings is explanatory metadata (now 12px), rather than a section heading.

All body and section-title legacy 9/10px aliases were removed. Remaining legacy roles belong to
secondary badges, counts, status/measurement metadata and existing dense controls. They are not
a pending blanket enlargement. Screen sizes do not override runtime graph/map zoom or print layout.

The 320px assistant test exposed a real proposal-row overflow: actions required 346px inside a
285px content area. The compact proposal now stacks content and actions. Snapshot endpoint facts
also wrap instead of widening the dialog.

Visual review also exposed squeezed timeline date segments. Detail labels now stand above their
inputs; moment titles and dates use separate lines. Reverting the detail layout reduces the native
date field to about 25px and fails the new 110px minimum-width check. Field headers can wrap their
actions onto a second line, so longer labels such as “Notiz (optional)” retain readable words.

## Verification

All product checks below used the freshly rebuilt application at `http://127.0.0.1:8110` via
`$env:PLAYWRIGHT_BASE_URL="http://127.0.0.1:8110"`. The served HTML was equal to `dist/index.html`;
`/api/version` returned 3.16.3, matching the checkout. Provisional source checks used port 5273.

| Command                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                                                                                                                                                                                                                                   | Passed after the final CSS changes, including all repository build gates. Tracked `dist/` regenerated.                                                                                                        |
| `npm test`                                                                                                                                                                                                                                                                                        | 210 files, 1,276 tests passed.                                                                                                                                                                                |
| `npm run check:format`                                                                                                                                                                                                                                                                            | Passed across web, Python, documentation and Rust formatting.                                                                                                                                                 |
| `npx playwright test --config playwright.design.config.ts --output="$env:TEMP/quiltor-design-followup-01a0960d/design-results"`                                                                                                                                                                   | All 144 design-gallery cases passed.                                                                                                                                                                          |
| `npx playwright test --config playwright.design.config.ts --grep "chunk 0[456]\|chunk 1[12]\|Reading labels\|action and field" --output="$env:TEMP/quiltor-design-followup-01a0960d/design-field-final"`                                                                                          | After the final Field header wrapping adjustment, all 52 affected gallery cases passed again.                                                                                                                 |
| `npx playwright test tests/e2e/history-design.spec.ts tests/e2e/assistant-output-design.spec.ts tests/e2e/workspace-reading-design.spec.ts tests/e2e/graph-edge-presentation.spec.ts tests/e2e/design-product-matrix.spec.ts --output="$env:TEMP/quiltor-design-followup-01a0960d/product-final"` | 30 passed, 12 intentionally skipped duplicates. Covers both themes, explicit 320px cases, enlarged text, keyboard navigation, graph interaction, output wrapping and the product accessibility/layout matrix. |
| `npx playwright test tests/e2e/workspaces.spec.ts --grep "Focus\|text margin\|timeline strip plays" --output="$env:TEMP/quiltor-design-followup-01a0960d/existing-focus-timeline"`                                                                                                                | 9 passed, 6 pre-existing viewport skips. Includes menu/focus contracts, focus helpers, stable writing-surface geometry and timeline playback.                                                                 |
| `npx playwright test tests/e2e/visual-baseline.spec.ts --update-snapshots=none --output="$env:TEMP/quiltor-design-followup-01a0960d/baseline-final"`                                                                                                                                              | Final Windows pixel comparison and performance smoke: 13 passed, 2 pre-existing performance skips.                                                                                                            |
| `node tools/quality/check_visual_baseline_reach.mjs`                                                                                                                                                                                                                                              | Expected failure until platform regeneration: 28 missing images each for Linux and macOS, including six already absent expanded-map references per platform.                                                  |

The initial visual comparison deliberately retained the old references and reported 26 changed
images across ten tests. Assertions were temporarily softened through `tools/dev/mutate.mjs` solely
to collect every view's difference in one run; the specification was restored afterwards and remains
unchanged. The lead reviewed the actual views and differences, including the final timeline label
wrapping adjustment, before copying the 26 reviewed Windows images into the reference directory.
Unchanged Windows images were not rewritten. As required by `CLAUDE.md`, the 44 corresponding stale
Linux/macOS images were removed. The existing **Generate visual baselines** workflow fills missing
references on the next push; cross-platform CI is not yet complete.

Two regression counter-checks exercised the fixes:

- The worker temporarily restored 10px assistant proposal text through `tools/dev/mutate.mjs` and
  ran the command below. The selected light cases
  failed at expected 14px versus received 10px; the source was restored.
- The lead restored `grid-template-columns: auto minmax(0, 1fr)` specifically in the layout block
  of `.timeline-detail-field` through the same mutator, then ran
  `npx playwright test tests/e2e/workspace-reading-design.spec.ts --project=wide --grep Workspace --output="$env:TEMP/quiltor-design-followup-01a0960d/timeline-mutation-fixed"`
  against port 5273. Both reading cases failed at a 24.86px date field; both map cases passed.
  The source was restored. An earlier selector matched a different block and made no effective
  change; that passing attempt was discarded as evidence and the selector was corrected.

Exact worker counter-check, from the product repository:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5273'; node tools/dev/mutate.mjs packages/client/src/modules/assistant/AssistantConversation.css --from '  font: var(--font-work-body);' --to '  font: 400 10px / 1.55 var(--ui);' -- .\node_modules\.bin\playwright.cmd test tests/e2e/assistant-output-design.spec.ts --project=wide --workers=1 --grep 'light mode at desktop'
```

Early source-only test failures also corrected fixture assumptions (expanded versus collapsed map
tools, selection cleared by compact inspector dismissal, and the initially open timeline). The
320px proposal and date-width failures were real layout findings and drove the fixes above.

No full Python/Rust suite, complete product E2E suite, native build, release preflight, commit, push
or deployment was performed. Temporary test worlds were isolated from the user's application data.
There are no remaining design decisions from this follow-up awaiting owner input.
