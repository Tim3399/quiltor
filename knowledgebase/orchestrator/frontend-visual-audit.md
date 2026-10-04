# Frontend visual audit

Status: local correction verified, 2026-10-03. Findings below distinguish the unchanged S16 bundle from the final locally built bundle. This is not release or CI evidence.

The subsequent [four-point closure](four-point-closure.md) adds dialog/error/recovery,
actual browser zoom and native platform acceptance. This dated ledger preserves
the initial audit; its historical coverage gaps are reconciled in that continuation.

## Baseline and method

- Served bundle: `dist/assets/index-D5wnEFIX.js`, SHA-256 `310585ccd4d57eeda6501055766dfda3fb250e52c4adc98fcdcb79dda1707037`.
- Isolated runtime: API `8124`, Vite `5284`, data and home under `%TEMP%/quiltor-ui-audit`; no personal world data was used.
- Browser matrix: Chromium at 1440 x 900 and 390 x 844, light and dark themes. A fixture supplied long world and chapter names, one figure, one place, one timeline moment, and a manuscript.
- Evidence: `%TEMP%/quiltor-ui-audit/{light,dark}-{wide,compact}-*.png`, matching `*-geometry.json`, and `baseline-{wide,compact}-control-candidates.json`.
- Automated WCAG A/AA checks reported no violations in the captured primary states. This does not cover the visual truncation finding below.

## Confirmed findings

### UI-TITLE-01: compact chapter titles hide readable content

At 390 x 844 in both themes, a long active chapter title is hard-clipped in the manuscript paper heading. The control is a single-line HTML input in the baseline. A focused keyboard user can move the caret to scroll horizontally, so the stored value is intact, but an unfocused or touch user has no indication or way to scan the full title.

- Reproduce: open a chapter titled `Die Ankunft mit einem bewusst längeren Kapiteltitel` at the compact viewport. Compare the title with the wrapped manuscript body.
- Evidence: `light-compact-manuscript.png` and `dark-compact-manuscript.png`.
- Owners: `packages/client/src/modules/manuscript/EditorSurface.tsx` and `EditorSurface.css`.
- Narrow correction: use the shared auto-growing text area for the title, wrap long words, suppress Enter/newlines outside IME composition, and preserve the existing accessible name and save path.
- Regression: `tests/e2e/chapter-title-style.spec.ts` covers compact spaced and unbroken text, visible wrapping, page overflow, Enter behavior, value persistence, and reload. The baseline screenshot records the clipped geometry; the test's acceptance criteria depend on visible layout and behavior rather than the element type.

### UI-CONTROL-01: timeline end controls miss the compact target size

`Ende hinzufügen` and `Ende entfernen` compute to 34 px high at both viewports. At 390 px they remain 34 px instead of the project's 44 px compact interaction target. The declaration wins the primitive cascade in the rendered bundle.

- Evidence: `baseline-{wide,compact}-timeline-{add,remove}-end.png` and candidate JSON. Wide: 34 px; compact: 34 px.
- Owners: `packages/client/src/modules/story-world/timeline/MomentTimeFields.tsx` and its CSS.
- Narrow correction: keep the shared regular `Button` geometry and allow the public compact rule to supply 44 px.
- Regression: `tests/e2e/control-consistency.spec.ts` checks 36 px wide, 44 px compact, and keyboard activation for both actions. The wide baseline fails at 34 px.

### UI-CONTROL-02: active priority toggles are visually indistinguishable

Figure important and place favorite controls correctly expose `aria-pressed` and change their labels, but the baseline feature CSS overrides the primitive primary appearance. After activation, background `rgb(252, 246, 237)`, border `rgb(213, 193, 166)`, and text `rgb(23, 21, 15)` match the inactive control in the measured light state. Active and inactive priority controls therefore lack a persistent visual state once focus or hover is removed.

- Evidence: `baseline-{wide,compact}-{figure,place}-priority-{inactive,active}.png` and candidate JSON.
- Owners: `packages/client/src/modules/story-world/NodePriorityActions.tsx`, `StoryGraph.css`, and `places/PlaceInspector.css`.
- Narrow correction: let the shared pressed-state recipe own color and border; keep local CSS to layout only. A toggle should not use the create-action primary appearance as its state API.
- Regression: `tests/e2e/control-consistency.spec.ts` uses keyboard activation, verifies `aria-pressed`, removes transient focus, and compares the settled visual state in light and dark themes.

### UI-CONTROL-03: timeline mode CSS duplicates the segmented primitive

The timeline state-change mode renders and behaves correctly in the tested states: 30 px radio targets wide, 44 px compact, correct checked-state movement with ArrowRight, and a 2 px destination focus outline. Local `.state-change-mode` rules still duplicate primitive padding, border, radius, background, and radio state styling. This is design-system debt rather than a confirmed user-facing defect.

- Owner: `packages/client/src/modules/story-world/timeline/StateChangePanels.tsx` and its CSS.
- Suggested correction: retain composition layout locally and rely on `SegmentedControl` for control geometry and states.

## Coverage ledger

| Surface                | Wide light/dark | Compact light/dark | Result                                                                                                            |
| ---------------------- | --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Project entry          | Captured        | Captured           | Four entry actions align; compact uses a coherent 2 x 2 layout; long world names ellipsize without page overflow. |
| Manuscript             | Captured        | Captured           | Primary toolbar wraps without clipping; compact chapter-title defect confirmed.                                   |
| Manuscript export menu | Captured        | Captured           | Menu stays in the viewport and Escape closes it. Export preview dialogs were not part of this visual pass.        |
| Figures                | Captured        | Captured           | Primary toolbar has no clipping or horizontal overflow; priority inspector defect confirmed.                      |
| Timeline               | Captured        | Captured           | Primary toolbar aligns and wraps; inline target defect confirmed; segmented keyboard behavior checked.            |
| Places                 | Captured        | Captured           | Primary toolbar has no clipping or horizontal overflow; priority sheet defect confirmed.                          |
| Storyboard             | Captured        | Captured           | Primary toolbar and library fit without document overflow; library-result ellipsis is intentional.                |

Across all five workspaces, no primary-toolbar button label clipped, no toolbar required horizontal scrolling, and no genuine alignment fault appeared in the tested matrix. Compact toolbar controls measured at least 44 px; the 34 px timeline actions are in the moment editor rather than its toolbar.

## Remaining visual coverage

Import previews beyond the targeted DOCX cases, history/recovery, destructive confirmations, validation and network-error states, populated storyboard editing, map creation and distance measurement, browser zoom at 200%, and export preview dialogs remain untested in this pass. No release or deployment conclusion follows from this local audit.

## Final local evidence

The final served entry asset is `dist/assets/index-BeEH6y6A.js`, SHA-256 `083261C4E0439899A0461C84EE91C65AC6C11410CCC6F28D8C417F68FD28F7D8`.

- Compact title: 298 px client and scroll width, 150 px client and scroll height, 151 px border-box height. The full long value wraps without hidden overflow. Wide title: 664 px client and scroll width, 104 px client and scroll height.
- Priority toggle, settled and unfocused in light mode: inactive border/background `rgb(213, 193, 166)` / `rgb(252, 246, 237)`; active border/background `rgb(146, 92, 20)` / `rgba(23, 21, 15, 0.09)`. `aria-pressed` changes from `false` to `true`; wide/compact heights remain 36/44 px.
- Timeline end actions: both add and remove measure 36 px wide and 44 px compact.
- Final screenshots and measurements: `%TEMP%/quiltor-ui-audit/final-{wide,compact}-*.png` and `final-{wide,compact}-control-candidates.json`. The add/remove screenshots explicitly scroll the audited action into view.

The title regression was mutation-proven on the same corrected source: changing only the auto-height condition from `scrollHeight > 0` to the impossible `scrollHeight < 0` caused the compact browser test to fail on visible geometry (`47.5 px`, required more than `51.75 px`). The exact source line was restored before the final build. An initial `if (false)` mutation did not compile because TypeScript no longer preserved the title null narrowing; it produced no product finding and was replaced by the buildable equivalent.

Final checks:

- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build` — passed all build gates and generated the asset above. Plain `npm run build` was unusable in this sandbox because the machine npm shim pointed to a missing roaming `npm-cli.js`; the repository-local command was run through the installed Node npm CLI directly.
- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test` — 228 files and 1,539 tests passed.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8124` with `chapter-title-style.spec.ts` and `control-consistency.spec.ts`, projects wide and compact — 4 passed, 2 intentional project skips.
- The same base URL with `world-gate-responsive.spec.ts` and `manuscript-import.spec.ts`, project wide — 5 passed, including both themes and lost committed-response retry without duplicate creation.
- Disposable final measurement spec — 1 passed.
- Prettier check for the two browser specs and this record — passed.

## Visual-baseline follow-up

The checked-in manuscript, figures, and timeline product snapshots were not overwritten. Manuscript snapshots need review because the title control and height calculation changed even when a short fixture happens to retain similar geometry. Timeline snapshots are expected to differ where the state-change segmented control is visible: its measured wide container changed from about 272 x 40 px to 260 x 38 px and now uses the shared primitive surface. Default figure snapshots do not open the priority inspector, so no difference is expected there; selected-inspector screenshots intentionally differ in the pressed state and primitive geometry.

Platform owners must review and accept any affected Windows, Linux, and macOS baselines through the normal baseline workflow. Four Linux/macOS compact images already missing from the earlier mobile work remain separate prior-work debt; this audit neither created nor resolved those gaps. Local checks here do not establish release, CI, fresh-platform, or deployment readiness.
