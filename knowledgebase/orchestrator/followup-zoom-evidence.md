# CLOSE-02-ZOOM browser zoom evidence

Review date: 2026-10-04. This review uses Chromium's browser zoom API through an
isolated Manifest V3 extension. It does not treat `pageScaleFactor`, viewport reduction or
doubled CSS font sizes as browser zoom.

## Actual zoom mechanism

The temporary extension requests the `tabs` permission. The Playwright audit launches an
isolated persistent Chromium profile with only that extension, finds the Quiltor tab, calls
`chrome.tabs.setZoom(tabId, 2)`, and confirms the result with `chrome.tabs.getZoom(tabId)`.

The first probe used Chromium's own un-emulated window. Before and after zoom, the extension
reported the same tab and the browser window remained 1280 × 720. Page measurements changed as
follows:

| Measurement                       |       100% |       200% |
| --------------------------------- | ---------: | ---------: |
| `chrome.tabs.getZoom`             |          1 |          2 |
| `window.outerWidth × outerHeight` | 1280 × 720 | 1280 × 720 |
| `window.innerWidth × innerHeight` | 1280 × 720 |  640 × 360 |
| `visualViewport.width`            |       1280 |        640 |
| `visualViewport.scale`            |          1 |          1 |
| `devicePixelRatio`                |          1 |          2 |

The unchanged outer window plus halved CSS viewport establishes browser tab zoom. The unchanged
`visualViewport.scale` distinguishes it from pinch zoom.

The acceptance matrix keeps zoom at 2.0 and changes the Playwright render surface to exercise
two effective layouts:

- 1800 × 1200 physical pixels → 900 × 600 CSS pixels at 200% zoom.
- 780 × 1200 physical pixels → 390 × 600 CSS pixels at 200% zoom.

Each matrix case re-queries `getZoom` and asserts it remains exactly 2.

## Provisional matrix on the pre-fix candidate

The first full matrix ran against `index-COztUI0L.js`, SHA-256
`e5399336d512b80a92138e0dbc78c1d8bc8471b506256298714e8540c62a72d8`. It passed all four
theme/layout combinations:

| Theme | Effective layout | World picker | Manuscript | DOCX import | DOCX export | EPUB export |
| ----- | ---------------- | ------------ | ---------- | ----------- | ----------- | ----------- |
| Light | 900 × 600        | Pass         | Pass       | Pass        | Pass        | Pass        |
| Light | 390 × 600        | Pass         | Pass       | Pass        | Pass        | Pass        |
| Dark  | 900 × 600        | Pass         | Pass       | Pass        | Pass        | Pass        |
| Dark  | 390 × 600        | Pass         | Pass       | Pass        | Pass        | Pass        |

For every surface, the audit asserted:

- the document and inspected root had no unintended horizontal overflow;
- visible text with hidden/clip overflow was not truncated;
- the primary world-open, import, export-menu, DOCX-download and EPUB-download actions could be
  scrolled into the CSS viewport and remained horizontally contained;
- the full world title remained the primary action's accessible name. Selection cards use the
  existing intentional visual ellipsis at compact width;
- actual zoom remained 2 after navigation, reload, theme changes and physical viewport changes.

The separate compact conflict/recovery header defect discovered by the browser owner is outside
this matrix and has separate frontend ownership. This provisional pass does not close that defect.
The post-fix acceptance below supersedes this provisional result.

## Screenshots

The audit produced 20 screenshots in the external evidence directory:

`C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/screenshots/`

Representative captures:

- [Dark compact world picker](C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/screenshots/dark-compact-picker-zoom200.png)
- [Light compact manuscript import](C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/screenshots/light-compact-import-zoom200.png)
- [Light compact manuscript editor](C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/screenshots/light-compact-editor-zoom200.png)
- [Dark compact EPUB export](C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/screenshots/dark-compact-epub-zoom200.png)
- [Light wide manuscript editor](C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/screenshots/light-wide-editor-zoom200.png)

Machine-readable measurements and every screenshot path are in
`C:/Users/timra/.codex/visualizations/2026/09/12/01a0960d-ae07-7783-8599-052dad04cecd/zoom-evidence/zoom-audit-results.json`.

## Commands and outcomes

```text
node C:\Users\timra\.codex\visualizations\2026\09\12\01a0960d-ae07-7783-8599-052dad04cecd\zoom-evidence\zoom-probe.mjs http://127.0.0.1:8132/
PASS — extension zoom 1 → 2; physical browser window stayed 1280 × 720; CSS viewport changed 1280 × 720 → 640 × 360.

node C:\Users\timra\.codex\visualizations\2026\09\12\01a0960d-ae07-7783-8599-052dad04cecd\zoom-evidence\zoom-audit.mjs http://127.0.0.1:8132
PASS — pre-fix bundle hash matched; four theme/layout cases and 20 representative surfaces passed overflow, clipping and action-reachability assertions.
```

Two early harness runs failed before product assertions: one used a CSS selector that assumed
`aria-label` instead of the dialog's `aria-labelledby`, and one counted the intentional 1-pixel
screen-reader-only chapter-title label as visible clipping. The harness was corrected to evaluate
the located dialog and exclude `.sr-only` elements. Neither failure identified a product defect.

## Final post-fix acceptance

**Pass.** The complete matrix was rerun after the separately owned compact header/touch-target
correction against `dist/assets/index-aUSy44Mh.js`, SHA-256
`f0b6ebea6adc6290f0e668e5ac7f6fed9f12f7e1c29f4c1c4e85d19e99ca0464`.

The runtime bundle hash matched before any UI assertion. `getZoom` again reported 1 → 2;
1800 × 1200 outer dimensions remained unchanged while the CSS viewport became 900 × 600,
`devicePixelRatio` became 2 and `visualViewport.scale` remained 1. All 20 final surfaces passed
in light/dark and 900 × 600/390 × 600 effective layouts. The rerun overwrote the screenshots and
machine-readable result with final-candidate evidence. Visual inspection of the final compact
editor and dark compact import also found no clipping or unreachable control.

Final command:

```text
node C:\Users\timra\.codex\visualizations\2026\09\12\01a0960d-ae07-7783-8599-052dad04cecd\zoom-evidence\zoom-audit.mjs http://127.0.0.1:8132
PASS — final bundle hash matched; genuine tab zoom 2; 4 theme/layout cases and 20 surfaces passed.
```

The created test worlds were deleted and purged after each run. All temporary Chromium profiles
were removed after final acceptance; the extension source, audit scripts, JSON measurements and
screenshots remain in the external evidence directory. No product or test source was changed by
this review.
