# Follow-up platform visual review

Status: Windows, Linux, and macOS baselines reviewed on 2026-10-04. Native baseline workflows are
green; the complete existing Test workflow remains outstanding.

## Was

Review the frozen frontend against the checked-in Windows visual baselines, accept only differences
caused by the title and shared-control corrections, and identify the exact Linux/macOS regeneration
set. This closes the local platform portion of the
[frontend visual audit](frontend-visual-audit.md).

## Warum

Visual baselines are platform-specific because browser font and control rasterization differs. A
local `--update-snapshots` pass would obscure unrelated drift, so each failure was exposed by a
normal comparison and inspected before its Windows image was replaced.

## Wann erledigt

Fourteen Windows images were accepted:

- `light` and `dark` expanded-map `wide` and `regular`: only the two place priority buttons changed.
  `NodePriorityActions` now uses the shared secondary Button pressed contract instead of local
  primary/active paint; labels, handlers, and placement remain unchanged. The initial comparison
  reported 650 and 649 differing pixels across these four cases.
- `light` and `dark` Timeline `wide`, `regular`, and `compact`: the relationship mode uses the shared
  SegmentedControl appearance instead of the feature-owned radio recipe. Initial and follow-up
  comparisons reported 4,944 / 2,620 pixels at wide and 3,793 / 1,445 / 7,171 / 1,140 pixels at
  regular and compact.
- `light` and `dark` manuscript `regular` and `compact`: the chapter title is now the shared
  auto-growing TextArea. Regular changed by 206 / 185 pixels. Compact changed by 977 / 931 threshold
  pixels; exact old/new inspection confined the light pixel delta to the second body-text glyph row
  (`x=46..288`, `y=332..350`) while title and element geometry were identical. Six repeated compact
  core runs (three per theme, one worker) passed against the accepted result, classifying this as a
  stable platform raster difference rather than reflow or overflow.

The strict final Windows comparison completed all downstream views, so figures, places, search
dialog, assistant, World Gate, and the remaining viewport/theme combinations retained their prior
baselines. It passed 13 tests with 2 expected non-wide performance skips. Existing World Gate
baseline work in the shared checkout was outside this review and was neither accepted nor reverted
here.

Equivalent Linux and macOS images to regenerate are these stems, each with the platform suffix:

- `{light,dark}-expanded-map-{wide,regular}`
- `{light,dark}-manuscript-{regular,compact}`
- `{light,dark}-timeline-{wide,regular,compact}`

This is 14 images per remote platform. Windows inspection cannot approve their raster output; the
workflow must generate them and a reviewer must inspect the resulting platform artifacts.

## Linux native acceptance

Workflow `37213374818` generated Linux baselines for source candidate
`2853e01745d2740582e58b21c5c5daa131b1770a`; imported baseline commit
`4f5c6fc51d84cc81e102cfe6f79767ce71935dd1` passed its strict Linux comparison. Human review then
compared all 16 imported images with prior `HEAD` Linux images and the accepted Windows intent:

- `light-world-gate-compact-linux.png` and `dark-world-gate-compact-linux.png` — accepted. The new
  two-column compact import/create grid and world row stay inside 390px, preserve readable labels,
  and show no overlap or clipped action. [Dark example](../../tests/e2e/visual-baseline.spec.ts-snapshots/dark-world-gate-compact-linux.png).
- `light-expanded-map-{wide,regular}-linux.png` and
  `dark-expanded-map-{wide,regular}-linux.png` — all four accepted. Prior differences are confined
  to the two priority controls (`2,015` changed pixels per light image and `2,044` per dark image,
  with bounding boxes in the inspector action area). The map, inspector fields, footer, minimap,
  and chrome retain their positions; shared Button pressed styling is readable in both themes.
  [Light wide example](../../tests/e2e/visual-baseline.spec.ts-snapshots/light-expanded-map-wide-linux.png).
- `light-manuscript-{regular,compact}-linux.png` and
  `dark-manuscript-{regular,compact}-linux.png` — all four accepted. Both regular images are
  pixel-identical to prior Linux `HEAD`. Light compact changes only the second body-text glyph row
  (`x=46..244`, `y=332..350`), while title, card, toolbar, and status geometry remain unchanged.
  Dark compact also retains identical geometry and visible content; its larger exact-pixel surface
  difference is paper-texture recomposition (full-image mean channel delta below `0.68`), not
  reflow, clipping, or a color-role change. [Light compact example](../../tests/e2e/visual-baseline.spec.ts-snapshots/light-manuscript-compact-linux.png).
- `light-timeline-{wide,regular,compact}-linux.png` and
  `dark-timeline-{wide,regular,compact}-linux.png` — all six accepted. Each imported image shows the
  same selected relationship mode, label order, and card structure as Windows. The segmented
  control stays within the relationship panel at every viewport; surrounding inputs, headings,
  toolbar actions, and status line do not shift or clip. [Dark compact example](../../tests/e2e/visual-baseline.spec.ts-snapshots/dark-timeline-compact-linux.png).

No imported Linux image contains an unexplained shift, overlap, missing control, theme inversion, or
cropped text. This acceptance covers the 14 shared-control/title stems plus the two compact World
Gate images.

## macOS native acceptance

Workflow `37213374818` generated macOS baselines for the same source candidate
`2853e01745d2740582e58b21c5c5daa131b1770a`; imported baseline commit
`272b7db4b4c9194ed47ca02fc0c2d8e88740a313` passed its strict macOS comparison. Human review
compared all 16 imported images with prior `HEAD` macOS images and the accepted Windows/Linux
intent:

- `light-world-gate-compact-darwin.png` and `dark-world-gate-compact-darwin.png` — accepted. The
  compact two-column action grid, locale/theme controls, world row, chevron, and delete action are
  fully visible at 390px in both themes. The new composition matches the reviewed Linux and Windows
  layout without overlap or horizontal clipping. [Light example](../../tests/e2e/visual-baseline.spec.ts-snapshots/light-world-gate-compact-darwin.png).
- `light-expanded-map-{wide,regular}-darwin.png` and
  `dark-expanded-map-{wide,regular}-darwin.png` — all four accepted. Each prior comparison changes
  about two thousand pixels and visually confines the material change to the two priority controls.
  Light wide also contains 34 ancillary antialias pixels around the minimap, without a geometry or
  content shift. Map nodes, scale/footer, minimap, inspector fields, and toolbar remain aligned and
  unclipped. [Dark wide example](../../tests/e2e/visual-baseline.spec.ts-snapshots/dark-expanded-map-wide-darwin.png).
- `light-manuscript-{regular,compact}-darwin.png` and
  `dark-manuscript-{regular,compact}-darwin.png` — all four accepted. Regular differences are limited
  to the body-text glyph row (`366` light / `373` dark pixels); light compact is likewise confined to
  that second line (`x=47..289`, `y=331..352`). Dark compact preserves identical card and text
  geometry; its broad exact-pixel paper surface delta has a full-image mean channel difference below
  `0.57`, consistent with the reviewed texture recomposition rather than reflow or a theme change.
  [Light compact example](../../tests/e2e/visual-baseline.spec.ts-snapshots/light-manuscript-compact-darwin.png).
- `light-timeline-{wide,regular,compact}-darwin.png` and
  `dark-timeline-{wide,regular,compact}-darwin.png` — all six accepted. The shared segmented control
  has the intended selected state and stays inside the relationship panel in every viewport. Form
  fields, headings, toolbar controls, cards, and status line remain stable, readable, and unclipped.
  [Dark wide example](../../tests/e2e/visual-baseline.spec.ts-snapshots/dark-timeline-wide-darwin.png).

No imported macOS image contains an unexplained shift, overlap, missing control, theme inversion, or
cropped text. Together with the strict native run and Linux/Windows reviews, this accepts all 16
macOS images without changing any generated PNG during review.

## Native workflow completion

- [Native baseline workflow 37213374818](https://github.com/Tim3399/quiltor/actions/runs/37213374818)
  completed successfully for all four jobs: `gap`, `ubuntu-24.04`, `macos-15`, and `windows-2025`.
  This covers platform baseline generation, strict comparison, and the cross-platform baseline-gap
  check for the reviewed image set.
- [Gap-only workflow 37214194029](https://github.com/Tim3399/quiltor/actions/runs/37214194029)
  also completed successfully on commit
  [`449dcf91c37b4b34f10fd8ef6beb1726440775fb`](https://github.com/Tim3399/quiltor/commit/449dcf91c37b4b34f10fd8ef6beb1726440775fb).

These successful native runs support the independently completed review of all 32 imported Linux
and macOS images. The complete [Test workflow 37216539640](https://github.com/Tim3399/quiltor/actions/runs/37216539640)
subsequently passed all 22 jobs, attempt 2, on
`c5ba722f2c22b2526a48af2aae4c9f427fb75e05`. The final
[baseline gap check 37216534438](https://github.com/Tim3399/quiltor/actions/runs/37216534438)
passed on the same commit; bootstrap skipped because no images were missing.
Earlier failures, bounded corrections and the single macOS product retry are retained
in [CI evidence](followup-ci-evidence.md). CLOSE-03 is complete; no release is implied.

## Verification

An isolated Vite source server was started without rebuilding `dist/`:

- `node .\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5288 --strictPort`

The same comparison command used a fresh temporary output directory on each pass:

- `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5288'; .\node_modules\.bin\playwright.cmd test tests/e2e/visual-baseline.spec.ts --output "$env:TEMP\quiltor-close03-first-escalated"`
  — first pass: 3 passed, 10 failed at reviewed snapshots, 2 skipped.
- The same command with output `quiltor-close03-second` — 9 passed, 4 later Timeline snapshots
  failed, 2 skipped. These later failures became reachable after accepting the first mismatch in
  each core scenario.
- The same command with output `quiltor-close03-third` — strict pass: 13 passed, 2 skipped in 38.0
  seconds.
- The same command with output `quiltor-close03-post-chrome`, after the scoped compact error-state
  AppShell correction — strict pass: 13 passed, 2 skipped in 37.0 seconds. Normal-state baselines
  therefore remained stable.
- The same command with output `quiltor-close03-final-frozen`, after the final scoped 44px recovery
  target correction — strict pass: 13 passed, 2 skipped in 36.7 seconds. This is the final Windows
  result against the frozen AppShell source.
- `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5288'; .\node_modules\.bin\playwright.cmd test tests/e2e/visual-baseline.spec.ts --project=compact --grep "core views" --repeat-each=3 --workers=1 --output "$env:TEMP\quiltor-close03-compact-repeat"`
  — 6 passed in 35.1 seconds.

The local comparison covers Windows Chromium and the route-mocked source suite. Native Linux and
macOS artifact generation and strict comparisons ran in workflow `37213374818`; this document adds
the human visual review. These checks do not replace the integrated `dist/` build or product server
run owned by the lead.
