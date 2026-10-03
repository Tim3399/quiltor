# Roadmap follow-up after 3.20.0

Baseline: published release `3.20.0`, source `bb204af`, deployed on 2026-10-02.
This plan records the next bounded delivery, rather than treating every historical
roadmap checkbox as an unimplemented feature.

## Owner decisions and delivery order

- On 2026-10-02 the owner selected the existing public status page as sufficient
  operational visibility for now. Separate push/email alerts and receiver setup
  are deferred; do not treat them as a blocker for the next product sprint.
- `https://status.bananenban.de` already lists **Quiltor Webzugriff**. Its public
  endpoint-status API and live Gatus configuration were checked on 2026-10-02:
  a 60-second check requires HTTP 200 and `ok: true`; current results pass.
  This is status-page visibility, not an implemented notification channel.
- The next product slice is external manuscript import, starting with DOCX and
  creation of a new project. Portable `.quiltor` project transfer already exists.
- Commercial cloud decisions, native signing accounts and broader automatic
  synchronization remain separate roadmap items.

| Sprint                                    | Scope                                                                                          | Acceptance                                                                                                                                 | Status                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| S12 Roadmap and status                    | Reconcile proven 3.20 capabilities; verify existing public status entry; record alert deferral | Stale items corrected with evidence, no duplicate status entry or invented alert delivery                                                  | Accepted              |
| S13 DOCX import                           | Safe conversion, reviewable chapter plan, explicit loss warnings, atomic new-project import    | Preview does not write; text/order/bold/italic survive; bad input leaves catalogue unchanged; retries do not duplicate a committed project | Accepted locally      |
| S14 Text formats and chapter organization | Markdown/TXT through the same import boundary; richer split correction and folder mapping      | Format-specific fixtures, counts and author-controlled hierarchy                                                                           | Accepted locally      |
| S15 Editor export                         | DOCX and Normseite presets; verify exported text and formatting                                | Export counts and round-trip fixtures; explicit unsupported-content handling                                                               | Accepted locally      |
| S16 EPUB                                  | EPUB 3 with bounded presets and package validation                                             | Validated package, chapter order and semantic structure                                                                                    | Planned               |
| S17 Author pilot                          | Fixed first-use tasks with authors; prioritize observed friction                               | Recorded task outcomes and targeted corrections                                                                                            | Requires participants |

## S13 acceptance and boundaries

Use project selection and the established dialog patterns. Keep the existing five
workspaces. DOCX parsing is deterministic and local to the current host; no model,
cloud subscription, office application or remote conversion service is required.

- Accept a bounded DOCX archive; reject malformed, encrypted, unsafe or excessive
  ZIP/XML input. Never follow document relationships to external resources.
- Heading 1 starts a chapter; a document without it becomes one chapter. Preserve
  run text, paragraph order and bold/italic with canonical UTF-16 mark offsets.
  Keep existing scene-break text rather than guessing meaning from arbitrary glyphs.
- Preview chapters, source/result counts and unsupported-content categories before
  writing. The author may edit titles and merge adjacent proposed chapters, then
  review an updated preview before committing. Retain merged chapter headings in
  the body so changing the split does not silently discard source text.
- Nonrepresentable content requires an explicit warning acknowledgement. Ambiguous
  revision content or unsupported body structures may fail closed with an actionable
  message; the importer must never advertise full Word fidelity.
- Commit reparses the original file, validates the reviewed selection and source
  digest, and atomically publishes one new owner-scoped project. Existing projects
  remain unchanged. A stable request ID makes an uncertain network retry idempotent.
- Persist source filename, format, digest, import time, counts and warning categories
  as explicit import provenance; do not retain the uploaded file as a hidden attachment.
- Cover stale preview responses, cancelled selection, publish failure and failure
  to open an already committed project. A retry must reopen that project.

Appending to an existing project, tracked-change re-import, embedded manuscript
images, arbitrary Word layout, Scrivener and automatic world extraction are later
slices. Unsupported content must be identified rather than silently omitted.

## Frozen HTTP boundary for S13

Both authenticated endpoints use the existing bounded JSON request reader. File
bytes are base64 inside JSON; the decoded file limit is 8 MiB. This stays below
the existing 16 MiB request limit. No endpoint requires an already open project.

`POST /api/manuscript-import/preview`:

```text
{ fileName, dataBase64, selection?: { title, chapters: [{ sourceIndexes, title }] } }
-> { ok: true, preview: {
  format: "docx", fileName, sourceSha256, title,
  chapters: [{ sourceIndexes: number[], title, body, marks: [{ from, to, kind }] }],
  counts: { sourceWords, sourceParagraphs, importedWords, importedParagraphs },
  warnings: [{ code, count }]
} }
```

`POST /api/manuscript-import/import`:

```text
{ fileName, dataBase64, sourceSha256, title,
  chapters: [{ sourceIndexes, title }], acknowledgedWarnings: string[], requestId }
-> HTTP 201 { ok: true, world: <existing WorldInfo contract> }
```

`sourceIndexes` partitions the original chapter sequence exactly once, in order.
Each group is contiguous; only adjacent merging is supported in this slice.
After editing a selection, the UI must obtain and display its updated preview
before enabling import. Warning codes are a shared finite contract: `images`,
`hyperlinks`, `headers_footers`, `footnotes_endnotes`, `comments`, `numbering`,
`fields`, and `formatting`. Warnings carry positive counts and require explicit
acknowledgement. Raw XML and filenames are never rendered as trusted HTML.
Source content stays untrusted data.

Counts cover the main document text, including source chapter headings. In the
result, a source heading represented by a chapter title still counts as one
paragraph; a merged-away heading counts in the retained body. A generated title
for an unheaded document is excluded. Editing a source chapter title may change
the result's word count. Unsupported ancillary parts, such as footnotes and
headers, are reported separately rather than included in these text counts.

Import provenance is the optional manuscript extension
`importSource: { version: 1, fileName, format: "docx", sourceSha256, importedAt,
counts, warnings }`. `importedAt` is UTC. Ordinary saves and project transfer must
preserve this record; the uploaded binary is not stored.

Error prefix: `manuscript_import`; suffixes: `invalid_file`, `limit_exceeded`,
`unsupported_content`, `invalid_selection`, `preview_mismatch`,
`warnings_unacknowledged`, `conflicting_request`, `publication_failed`.

## Verification

Run focused parser/security, publication/idempotency, HTTP, gateway and dialog
tests. Include Unicode outside the BMP, style inheritance, malformed archives,
warnings, unchanged existing worlds and failed publication. Demonstrate that a
relevant regression test fails with its fix removed. Then run `npm run build`,
`npm test`, backend checks and the actual browser import flow against fresh built
assets and a restarted backend. Inspect light/dark and a narrow viewport.

### Integrated acceptance — 2026-10-02

The lead reviewed the actual parser, publisher, HTTP and frontend changes. An
independent parser review found and resolved dropped content-control text,
character-style inheritance, visible hyphen/symbol handling and unreported
unsupported formatting, including document defaults. Unsupported body structures
fail closed. Publication validates all three staged documents and compares the
saved chapter titles, text, order, marks and provenance before making the world
visible. A final wire review aligned provenance validation between Python and
TypeScript and added malformed-warning-code coverage.

Required checks and targeted evidence:

- `npm run build` — passed, including contracts, architecture, design, i18n,
  platform boundaries, all TypeScript configurations and regenerated tracked
  `dist/`. The existing large-chunk advisory remains non-fatal.
- `npm test` — 227 files, 1,469 tests passed on the final frontend source.
- `.venv-desktop\Scripts\python.exe -m unittest discover -s tests/python -t tests/python`
  — 1,046 tests total, 1,039 successful and 7 skipped. After the final narrow
  malformed-provenance correction,
  `.venv-desktop\Scripts\python.exe -m unittest tests.python.test_manuscript_import.ManuscriptImportRepositoryTests.test_import_provenance_is_validated_at_the_document_wire_boundary tests.python.test_document_wire_v1`
  passed all 20 targeted regressions. The full backend suite was not repeated
  after that isolated validation correction.
- `npm run check:format` — passed for web, Python, documentation and Rust.
  Changed Python also passed Ruff checks; changed final files passed their
  formatters and `git diff --check`.
- With `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8113`,
  `node node_modules/@playwright/test/cli.js test tests/e2e/manuscript-import.spec.ts --output "$env:TEMP/quiltor-docx-accepted"`
  — 7 passed, 2 intentionally skipped duplicate viewport cases for the network
  retry. All six light/dark × wide/regular/compact import paths passed against
  final built assets and a restarted backend. The real lost-response test
  commits on the server, aborts its response, retries with the same request ID
  and verifies the same world ID. Source project content stays unchanged;
  imported metadata survives reopening and an ordinary editor save.
- Earlier targeted compatibility command:
  `node node_modules/@playwright/test/cli.js test tests/e2e/manuscript-import.spec.ts tests/e2e/competition-findings.spec.ts --grep 'DOCX import|Project transfer previews' --output "$env:TEMP/quiltor-docx-e2e"`
  — all 6 existing project-transfer cases and the lost-response case passed.
  The 6 new import cases initially failed because the test incorrectly expected
  `/` to reopen a world automatically after reload. The corrected test explicitly
  reopens the imported world from the existing project selector; final results
  are recorded above.
- Axe reported no WCAG A/AA violations in the six reviewed import previews.
  Rendered light/dark desktop and compact screenshots were inspected. A separate
  320-pixel check verified focus containment, Escape and returned focus. A real
  text-enlargement check measured paragraph text increasing from 14 to 28 pixels,
  with readable fields/actions and no horizontal overflow in the dialog panels.
  These are browser checks, not a screen-reader or author-pilot study.
- Mutation command:
  `node tools/dev/mutate.mjs src/quiltor/infrastructure/importing/docx.py --from '    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:' --to '    if False:' -- .venv-desktop\Scripts\python.exe -m unittest tests.python.test_manuscript_import.DocxParserTests.test_rejects_utf16_dtd_and_excessive_xml_depth`
  — the encoded-DTD regression failed as intended, and the parser was restored.

The documented `npm start` launcher ran API port 8113 and Vite port 5276 with
isolated temporary data and home directories. API version matched `VERSION`;
served HTML and the JavaScript entry matched the current `dist/` bytes. No
embedded frontend source-identity mechanism is claimed. npm commands used the
local `npm_config_prefix=C:/Program Files/nodejs` workaround. A sandbox Python
launcher failure was resolved by using the existing project virtual environment
for backend checks; the actual local server used `py -3.12`.

Resolved check failures also included two TypeScript errors in new tests and
unformatted contract JSON. Their subsequent build, focused-test and format checks
passed. There was no version bump, release, push or production deployment in this
delivery. Linux/macOS and native packaging were not rerun for this local sprint;
S14–S17 and the explicitly deferred cloud/commercial items remain open.

## Format references

WordprocessingML separates document paragraphs, text runs and run properties.
The importer uses the primary format documentation rather than assuming that a
paragraph's text is stored in one XML node:
[Microsoft: document structure](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document),
[Microsoft: run properties](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.runproperties).

## S14 contract and acceptance

The UI uses new `/api/manuscript-import/v2/preview` and `/v2/import` routes.
The existing DOCX v1 routes and their chapter-index semantics remain unchanged.
V2 accepts `.docx`, `.md`, `.markdown` and `.txt` files, with the same 8 MiB
upload bound. Text decoding accepts strict UTF-8, an optional UTF-8 BOM, or
UTF-16 with a BOM; malformed encodings and binary input fail explicitly.
Newline normalization uses LF. Markdown is parsed locally with the explicit,
locked `markdown-it-py==4.2.0` dependency, without rendering HTML or fetching
resources. Raw HTML and unsupported text-bearing structures fail closed.
Visible link/image text and code are retained with applicable loss warnings.
Markdown has additional bounds of 2,000,000 decoded source characters,
300,000 tokens including inline children, and 64 supported nesting levels.
TXT paragraph boundaries use two consecutive LF characters; whitespace on
otherwise blank lines and trailing blank paragraphs are retained. Formatting
in chapter titles is reported as a loss; body bold/italic is retained.

The preview adds ordered source `units: [{index, text, marks, isHeading}]`.
Each selected chapter has `{sourceIndexes, title, folderPath}`; the indices
partition every source paragraph unit exactly once in original order. The user
can split at a paragraph boundary, merge adjacent chapters, edit titles and map
chapters into folders. A leading source heading is represented by the chapter
title; interior headings remain in its text. Every edit requires a fresh server
preview before import. Counts describe parsed visible text, not Markdown syntax.

Folder paths contain up to eight nonblank titles, each at most 1,000 characters;
an empty path means the root. Shared prefixes reuse the same folder. Paths that
would change the chapter order, such as `A`, root, `A`, are rejected in preview.
The staged SQLite round trip verifies chapters, marks, provenance and structure.
V2 provenance uses `importSource.version: 2` and the selected format; existing
version 1 DOCX provenance remains readable. Request fingerprints bind the API
version, preventing a retry from crossing incompatible selection semantics.

Acceptance covers all three formats, malformed input, Unicode marks, loss
acknowledgements, paragraph splits and merges, nested folder persistence,
unchanged existing projects and idempotent publication. The lead owns dependency
locks, integrated browser evidence and roadmap reconciliation; separate bounded
workers own backend/contracts and frontend/locales. Required contributor gates
are `npm run build` and `npm test`, supplemented by backend, formatting and
browser checks against fresh built assets and a restarted isolated server.

### S14 integrated acceptance — 2026-10-03

The lead reviewed the parser, DOCX paragraph extraction, publisher, versioned
contracts, HTTP adapter, dialog, provenance validation and dependency changes.
Review corrections preserve whitespace-only TXT lines and formatted image alt
text, reject empty DOCX bodies explicitly, bound Markdown complexity, canonicalize
overlapping marks, and report title-formatting loss. Invalid folder sequences
cannot reorder text. A staged, wire-valid change to a folder title prevents
publication, and provenance survives ordinary saves and portable transfer.

The split action now focuses the newly created chapter title. A browser regression
first demonstrated horizontal overflow at 320 pixels with doubled text, then
passed after the dialog header, import grid and action labels were corrected.
`Button` exposes an explicit `labelOverflow="wrap"` mode; existing buttons retain
their default truncation behavior. Shared component changes passed their targeted
design-gallery compatibility checks.

Final verification:

- `npm run build` — passed all prescribed static gates, TypeScript and production
  output. Tracked `dist/` is current; the pre-existing large-chunk advisory remains.
- `npm test` — 227 files and 1,487 tests passed on the final source.
- `.venv-desktop\Scripts\python.exe -m unittest discover -s tests/python -t tests/python`
  — 1,062 total, 1,056 successful and 6 skipped. An earlier full run exposed the
  native-host `python -S` bootstrap probe: importing Markdown eagerly required
  site packages before parsing began. Lazy parser loading fixed it; the exact
  host regression and 60 focused tests passed, followed by this full green run.
- With `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8113`,
  `node node_modules/@playwright/test/cli.js test tests/e2e/manuscript-import.spec.ts tests/e2e/manuscript-import-text.spec.ts --output "$env:TEMP/quiltor-s14-e2e-accepted"`
  — 16 passed, 8 intentionally skipped duplicate viewport cases. Coverage includes
  all three formats, light/dark at three widths, paragraph splits, nested folders,
  folder-conflict recovery, malformed encoding, UTF-16, reopening, ordinary edits,
  unchanged existing projects and a real committed-but-lost response retry.
- `node node_modules/@playwright/test/cli.js test --config playwright.design.config.ts --grep 'action and field primitives|menu stress states' --workers=2 --output "$env:TEMP/quiltor-s14-design"`
  — all 8 existing shared-component cases passed across four viewport profiles.
- Axe found no WCAG A/AA violations in the 12 import preview cases. Light/dark
  desktop and compact screenshots were inspected. A separate 320-pixel keyboard
  check verified split focus, containment across 45 Tab presses, Escape and focus
  return. Enlarged text was measured at 14 to 28 pixels with transitions disabled
  for settled measurement; the final screenshot shows complete titles/actions.
- `npm run check:format`, scoped Ruff checks, the contract registry, dependency-lock
  validation and `git diff --check` passed. The new Markdown fixture initially
  failed Prettier and was formatted before final browser acceptance.
- The pinned `uv==0.12.5` generator regenerated all four lock files with the original
  cutoff; a second regeneration in check mode reproduced them. Only the web lock
  gained `markdown-it-py==4.2.0` and `mdurl==0.1.2`; native locks stayed unchanged.
  Installing the six hash-locked web dependencies into an isolated environment
  successfully imported the real parser and web bootstrap without desktop extras.
- `node tools/dev/mutate.mjs packages/client/src/platform/http/manuscriptImport.ts --from 'flattenedIndexes.length !== units.length ||' --to 'false ||' -- node node_modules/vitest/vitest.mjs run packages/client/src/platform/http/manuscriptImport.test.ts`
  — the first run revealed missing coverage. The added omitted-final-unit case
  then failed under mutation, the tool restored the source, and all 29 gateway
  tests passed. The 320-pixel regression also failed against the old build before
  passing against the corrected one.

The documented `npm start` launcher used API 8113/Vite 5276 with separate temporary
data and home directories. `/api/version` matched `VERSION`; served HTML and
`/assets/index-DG91eNe2.js` matched the local build byte for byte. The entry SHA-256
was `4928b0326d26ecc6bf2b92387466d4c548d093da35c7791751b52f9fd743c7b1`.
This verifies the served files, not an embedded source-identity feature. npm used
the existing local `npm_config_prefix=C:/Program Files/nodejs` workaround.
After verification, the isolated catalogue and trash both contained zero projects;
the owned launcher was stopped and test ports 8113, 5276 and 4174 were no longer listening.

No version bump, commit, push, release or production deployment was performed.
Linux/macOS execution, native packaging, the complete design suite and an author
pilot were not rerun for this local sprint. RTF/Scrivener, automatic scene/page-break
detection, source-native hierarchy and persistent source-boundary evidence remain
open. S15 editor export was the next planned delivery at this acceptance point.

## S15 editor export and acceptance

Implemented locally on 2026-10-03 with separate serializer and frontend workers
and lead review of the actual changes. Both DOCX actions live in the existing book
export menu. The authenticated export reads the current saved manuscript, includes
only book chapters in flattened binder order, and never publishes another project.

The review dialog compares active-manuscript and export chapter/body-word counts,
shows chapter titles and text excerpts, and explains which notes, links, folder
headings, set-aside chapters and extension data are omitted. Those warnings require
acknowledgement. Saves must finish before preview and download; revision, preset
and source digest must still match the reviewed snapshot. Native file cancellation
stays neutral. Pending results cannot download after the workspace unmounts.

The standard-library OOXML writer preserves title/body text, paragraph breaks,
soft line breaks, tabs, author-supplied numbering, scene-separator text and visible
bold/italic using UTF-16 ranges. It contains no macros or external relationships.
The application consumes canonical wire data, including valid integral legacy
offsets. Invalid content fails explicitly. Input and ZIP/XML limits are bounded;
XML byte accounting stops expansion during generation, before constructing an
oversized formatted manuscript. No new runtime dependency was introduced.

Presets:

- Editor manuscript: A4, Times New Roman 12 pt, 1.5 line spacing, one-inch margins,
  chapter starts on a new page and page-number footers.
- Normseite: A4, Courier New 12 pt, exact 24 pt lines, left aligned without
  automatic hyphenation. The nominal 60-character width uses a measured two-twip
  tolerance (8,642 twips); body height remains 14,400 twips. A footer distance of
  598 twips avoids Word's hidden footer clearance removing the thirtieth line.
  These values were calibrated against actual Word output, not assumed from XML.
  The [VdÜ definition](https://literaturuebersetzer.de/berufspraktisches/rechtliches/normseite/)
  describes a maximum 30-by-60 layout; character count divided by 1,800 is not used
  as a page count.

The dialog is a content preview, not a page-layout renderer. Existing print layout,
world data, history and trash are outside DOCX manuscript export. Optional title
pages and generated chapter numbers remain future preset options. Empty chapter
titles remain empty in the file; the existing importer substitutes `Kapitel N`
when reading an empty heading. Formatting of paragraph separator characters is
not represented as character marks on re-import; visible text formatting remains
equivalent. Re-import reports generated page/footer formatting as expected losses.

Verification evidence:

- `npm run build` passed on final frontend sources, including contracts,
  architecture, design, i18n, platform, TypeScript and regenerated tracked `dist/`.
  The existing large-chunk advisory remains.
- `npm test` passed: 228 files, 1,514 tests.
- `.venv-desktop/Scripts/python.exe -m unittest discover -s tests/python -t tests/python`
  passed on final Python sources: 1,081 total, 1,074 successful and 7 skipped.
- Focused serializer tests cover text/formatting round trips, overlapping UTF-16
  ranges, optional marks, empty headings, deterministic archives, invalid content,
  measured layout settings and early resource rejection. Application/HTTP tests
  exercise owner isolation, read-only exports, binder inclusion/order, warning
  acknowledgement, snapshot conflicts and canonical legacy offsets.
- The actual browser download was re-imported for both presets in light/dark at
  1,440, 900 and 390 pixels. Additional cases cover stale-preview recovery,
  keyboard focus/Escape and 320-pixel reflow with doubled text. Axe reported no
  violations in all 12 preview combinations.
  A follow-up run after clearer omission wording and preserved excerpt line
  breaks exposed a non-focusable scrolling preview and narrow enlarged-text
  overflow. The same tests reproduced both failures; the preview now has a named
  keyboard focus target and long text can wrap within the dialog.
  Final command with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8113`:
  `node node_modules/@playwright/test/cli.js test tests/e2e/manuscript-export.spec.ts --output "$env:TEMP/quiltor-s15-e2e-accepted"`
  — 14 passed; 4 duplicate viewport cases intentionally skipped.
- Microsoft Word opened and rendered both generated fixtures and actual browser
  downloads. Unicode, bold, italic, chapter starts and footers were inspected in
  PDF page images. The calibration document produced 30, 30 and 9 body lines over
  three pages. PDF extraction retained all 65 rows of 60 digits and wrapped 121
  consecutive `W` characters as 60/60/1. The initial nominal dimensions failed this
  test with 59 characters and 29 lines and were corrected before acceptance.
- Removing the digest comparison with
  `node tools/dev/mutate.mjs src/quiltor/application/manuscript_export.py --from 'payload["sourceSha256"] != preview["sourceSha256"]' --to 'False' -- .venv-desktop\Scripts\python.exe -m unittest tests.python.test_manuscript_export_routes.ManuscriptExportUseCaseTests.test_source_revision_digest_and_preset_cannot_drift_after_review`
  made the body, preset and note drift assertions fail; source was restored and
  the targeted suite passed. Two earlier mutation launches did not reach tests
  because Windows command resolution/interpreter discovery failed; those runs
  are not counted as regression proof. A serializer-margin mutation also failed
  its property test; stale Python bytecode from that run was removed before the
  next green run.
- `npm run check:format` passed with host tools; the first sandbox attempt could
  not discover Ruff. Scoped Ruff, contract validation and diff whitespace checks
  passed. npm used the existing `npm_config_prefix=C:/Program Files/nodejs`
  workaround. The sandbox Word COM probe could not open a logon session; the
  isolated hidden host Word instance successfully rendered only temporary files.

The documented `npm start` launcher used separate temporary data/home directories
and API 8113/Vite 5276. It was restarted after the final Python changes. The final
served HTML and `/assets/index-BT-UAuFc.js` matched local `dist/` byte for byte;
entry SHA-256: `7af986449d2a404d78b8e621bd2b3ef7b0ba939a7c17628911b88642b35f79fd`.
The version remained 3.20.0; served-file identity is verified, not an embedded
source-identity feature. After acceptance the isolated catalogue and trash were
both empty. The owned launcher was stopped; no listeners remained on 8113/5276.

No version bump, commit, push, release or production deployment was performed.
Linux/macOS execution, LibreOffice/Pages pagination, native packaging and the full
design-gallery suite were not rerun. The Normseite calibration is for the tested
Word/Courier New environment; other font substitutions/readers may paginate
differently. S16 EPUB is the next planned product sprint; S17 still needs authors.
