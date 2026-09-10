# Book typesetting

The manuscript's optional `bookLayout` field stores the V1 global book style.
Older manuscripts resolve to the 6 × 9 inch Quiltor novel defaults. The client
wire validator, manuscript JSON schema and Python validator accept the same
fields and bounds. SQLite stores the field in the manuscript's existing
`extra_json` envelope; no database schema migration is required.

## One book renderer

`BookContent` produces semantic title-page, chapter, paragraph, inline-mark and
scene-break content. `BookDocument` loads the selected bundled font and paginates
that content through Paged.js. `PrintDocument.css` and `bookStyles()` supply the
same physical typography to the editor preview and every PDF host.

The preview scales completed page boxes. Its zoom, scrolling and chapter
navigation never feed into typesetting. Layout edits are debounced by 250 ms.
Pagination runs only while the preview or export view is mounted. Jobs are
serialized, and obsolete asynchronous results cannot replace the current book.
Unloading a result releases its page template and generated styles.

The editor remains mounted and inert while the preview is open. Preview chapter
navigation has independent state. Closing the preview restores the original
editor selection, scroll offset and writing focus.

## PDF boundary

`renderBookPdf()` returns a Blob; `saveBookPdf(blob)` saves it through the platform
gateway. `bookPdf()` remains a compatibility composition. The caller saves pending
manuscript changes before rendering.

The PDF endpoint opens a one-use authenticated render URL with `bookRender=1`.
This mode mounts the same `BookDocument` without preview controls. Renderers wait
for `.print-document[data-book-ready="true"]` and at least one `.pagedjs_page`.
A `data-book-error="true"` result fails the export. Native paper dimensions come
from `data-book-width-mm` and `data-book-height-mm`.

Physical page numbers are placed in the final DOM, including chapter-start and
frontmatter suppression. Native hosts must not stamp another set of numbers.
Print CSS sets the final paper size and removes printer margins; Chromium keeps
`preferCSSPageSize` enabled. The application status bar is excluded from printing.

## Scope and extension points

V1 provides three presets, five bundled book fonts, format and mirror-margin
settings, body and chapter typography, scene separators, title-page metadata,
page numbers and a single-page preview. The page metadata includes physical page
number, chapter identity, chapter-start status and intentional blank pages.

Running heads, chapter overrides, custom saved presets, Roman frontmatter
numbering, facing-page presentation and complete preflight diagnostics are later
work. Paragraphs remain derived from chapter text and UTF-16 mark offsets;
persistent paragraph-specific formatting would require stable paragraph IDs.

Book boilerplate follows the manuscript's supported German language, independent
of the device's interface language. Font files and their licenses ship with the
built client. Sharing fonts and pagination code removes separate layout
implementations; cross-engine typography still requires native host verification.

## Verification

Unit tests cover layout defaults/presets, wire validation and cloning, semantic
rendering, pagination lifecycle, number placement, inspector input and PDF
render/save separation. Python tests cover validation, persistence and host
readiness/geometry.

`tests/e2e/print-preview.spec.ts` exercises real preview pages, zoom, editor
restoration, saved A5 settings, and matching PDF page counts/dimensions.
`tests/e2e/book-pagination-performance.spec.ts` checks a 200+ page manuscript for
paragraph preservation, right-hand chapter starts and stable page DOM after zoom.
Build before running product tests against the Python server's committed
`dist/`. Native WKWebView, WebView2 and WebKitGTK print paths require their host
environments and are not proven by Chromium browser tests.

### Windows verification, 2026-09-10

The following commands ran from the isolated feature worktree. The product
server used port 8120 and a disposable data directory under
`%LOCALAPPDATA%/CodexWork/quiltor-buchsatz/`.

| Command                                                                                | Result                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                        | Passed, including contract, architecture, design, i18n, platform and TypeScript gates; rebuilt committed `dist/`. Vite reports the lazy Paged.js chunk at 510 kB before gzip. |
| `npm test`                                                                             | 208 files, 1,217 tests passed after the final navigation change.                                                                                                              |
| `npm run check:format`                                                                 | Passed for web, Python and documentation.                                                                                                                                     |
| `$env:PYTHONPATH='src'; py -3.12 -m unittest discover -s tests/python -t tests/python` | 918 tests ran successfully; five skipped. Explicit `PYTHONPATH` selects this worktree instead of the machine's existing editable checkout.                                    |
| `node --check src/quiltor/resources/sidecars/pdf/render-book-pdf.mjs`                  | Passed after correcting the Playwright readiness timeout argument.                                                                                                            |
| `git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-buchsatz diff --check`       | Passed.                                                                                                                                                                       |

Browser commands and results:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:8120'; npx playwright test tests/e2e/print-preview.spec.ts tests/e2e/book-pagination-performance.spec.ts tests/e2e/visual-baseline.spec.ts --grep 'Print preview|Book settings|Every bundled|200|core views' --workers=2 --output="$env:TEMP\quiltor-buchsatz-browser-final"
# 11 passed, four repeated viewport cases skipped. This grep excludes the long-book test.

$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:8120'; npx playwright test tests/e2e/print-preview.spec.ts tests/e2e/book-pagination-performance.spec.ts --project=wide --grep 'settings survive|Long book' --workers=1 --output="$env:TEMP\quiltor-buchsatz-contract-final"
# Two passed: 202 pages with all 500 paragraphs preserved, and the actual A5 PDF endpoint.

npx playwright test --config="$env:TEMP\quiltor-book-edge.config.mjs" --output="$env:TEMP\quiltor-buchsatz-edge"
# Three passed. The temporary configuration selects installed msedge, 1440 × 900,
# de-DE, Europe/Berlin, port 8120 and print-preview.spec.ts.
```

The browser tests confirm all five bundled fonts load, zoom leaves pagination
unchanged, returning to the editor restores typing at the original caret, and
preview/export page text and counts agree. The 6 × 9 PDF has a 432 × 648 point
MediaBox; A5 is within one printer point of 148 × 210 mm. The long-book test's
initial measured pagination was 5,064 ms. Windows screenshots were visually
reviewed in light/dark themes and all three viewport sizes.

Earlier failed checks led to corrections: `npm run build` initially caught an
orphan CSS import and design ownership violations; browser tests exposed an
extra PDF page from the application footer and a lost editor focus. The A5 test
was corrected to allow printer-unit rounding. `npm run check:format` found two
Python formatting differences, which were fixed. A Python discovery run without
`PYTHONPATH` imported the other checkout; the correctly scoped full run above
passes after adding the missing dependency notice versions.

The first visual-baseline run failed on the six deliberately changed manuscript
toolbar images. After reviewing and accepting the Windows images, all six core
view cases passed. Per `CLAUDE.md`, the corresponding six Linux and six macOS
images were removed for the **Generate visual baselines** workflow to refill.
At the initial feature commit, `node tools/quality/check_visual_baseline_reach.mjs`
failed with exactly those twelve missing images. They were subsequently generated
and checked during the integration for 3.18.0; the reach check now passes.

The complete `npm run test:e2e`/design-gallery suites, branded Google Chrome,
native WKWebView/WebView2/WebKitGTK printing and packaged release checks were
not run. Chromium and installed Microsoft Edge cover the available browser
paths; native cross-engine equivalence remains a host verification task.

### Integration for 3.18.0

The feature was integrated with main `81bed76` (3.17.0), retaining the editor's
session selection and post-measurement scroll restoration. A browser regression
opens print preview, selects another preview chapter, switches to Figures and
back to Text, then checks the original chapter, nonzero scroll and typing at the
saved caret.

The initial full `npm run set-version -- minor` preflight passed 1,298 frontend
tests, 922 Python tests (five skipped), Rust gates, wheel/sdist checks and both
container builds. Its product browser suite found four failures: the expanded
toolbar exceeded its 320px action strip, the display-contents editor wrapper
confused the grid containment invariant at wide/regular sizes, and the old PDF
test expected an eager hidden print document. The toolbar now wraps below 380px
with every action accessible, the editor has a bounded grid item, and the PDF
test waits for the explicit render route. Targeted regressions cover these
corrections without relaxing the layout or PDF geometry requirements. The version
updater runs the complete release preflight again before writing any version file.

Release preparation uses process-local Git `safe.directory` configuration for
this isolated worktree. The first updater invocation without that configuration
stopped at `git status`; no version files changed.
