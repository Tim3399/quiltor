# Current handover

Recorded: 2026-10-03, coordinator setup. This is a dated evidence snapshot.

## Current delivery — 2026-10-04

The owner subsequently requested commit, push, tag and local startup. Follow
[release 3.22.0 and local review](release-3.22.0.md) for the active delivery.
The accepted audit below remains its evidence baseline; its earlier no-release
boundary describes that completed assignment, not the newly authorized delivery.

## Completed continuation — 2026-10-04

All [four audit points](four-point-closure.md) are **Done**. The coordinator reviewed
implementation diffs and evidence and independently verified the final remote result:
[Test 37216539640](https://github.com/Tim3399/quiltor/actions/runs/37216539640),
attempt 2, **22/22 jobs successful** on
`c5ba722f2c22b2526a48af2aae4c9f427fb75e05`. The final baseline gap workflow
[37216534438](https://github.com/Tim3399/quiltor/actions/runs/37216534438) also passed
on the same commit; conditional image bootstrap correctly skipped.

Five code findings were corrected. Actual compact conflict handling revealed and
fixed header overflow/navigation collapse and a 43 px recovery target. Eight
expanded audit cases and 20 genuine 200% browser-zoom surfaces passed. The final
build and 1,539 frontend tests passed; local Python discovery passed 1,092 tests
with 7 additional skips. Independent safety review accepted both critic findings
with mutation and two-service contention evidence. All 32 Linux/macOS references
were restored and visually reviewed; native workflow 37213374818 is fully green.

The [CI ledger](followup-ci-evidence.md) retains early formatting failures, the
proved/fixed Sheet-animation measurement race, the Windows HTTP timeout and the
two macOS autosave/pin observations. Windows core passed unchanged in the final
run. Exactly one targeted macOS product rerun passed on the same commit; the two
intermittent observations' root causes remain unproven. No assertion or timeout was
relaxed. This is scoped acceptance, not a guarantee against every intermittent bug.

The accepted implementation, existing EPUB/mobile changes, generated assets and
native references are on remote branch `codex/audit-closure-2026-10-04`. A temporary
index confirmed the local product/test/docs/assets tree exactly matches remote tree
`8152c83d62084d06a3cd0aba2d0e78d51f2ee91a`. The original local branch, HEAD and main
index remain unchanged; the working tree still contains these accepted changes.
Coordinator knowledgebase records remain local and outside the CI candidate.
All agents have returned and temporary application servers/data/profiles are cleaned up.
Final knowledgebase formatting, repository diff whitespace and baseline-reach checks
passed; all 97 relative links across the taskboard and 15 orchestrator records resolve.

No version or release was published, main was not updated, and production was not
deployed by this audit. REL-S16, EXP-03 and DOC-01 remain queued; S17 remains
deferred. No new implementation assignment is active. The sections below are the
**2026-10-03 historical snapshot**, superseded by this continuation where stated.

## Repository and delivery state

- Product checkout: `C:/Users/timra/git/quiltor/quiltor`.
- Inspected HEAD: `36aaa46` (`Bound Windows browser runs with balanced test-level shards`).
- Package version: `3.21.0`.
- Published 3.21.0 evidence from the preceding delivery: Test run `37113154094`,
  Release Build `37113154172`, Release Publish `37114974875`, visual baseline run
  `37113154091` succeeded for
  `36aaa46a39ceec5bd3c6fe0b8f65b291affe590d`.
  [Published release](https://github.com/Tim3399/quiltor/releases/tag/v3.21.0).
  These remote results were not queried again for this documentation setup.
- Production deployment was last verified at **3.20.0 on 2026-10-02**. A newer
  published release does not establish that production was upgraded.
- Existing uncommitted changes include EPUB S16, mobile project selection, the
  code/frontend quality campaign and their generated `dist/` assets. Do not reset, overwrite or accidentally absorb
  those changes into a coordination-only commit.

## S16: implementation accepted locally, publication outstanding

The new EPUB option uses revision-bound review, explicit omission acknowledgement,
saved title/author/language and a bounded reflowable serializer. It preserves ordered
chapters, text and supported bold/italic without changing source manuscript data.

Evidence lives in [S16 acceptance](../../docs/plans/roadmap-followup-sprints.md#s16-epub-export-and-acceptance):

- `npm run build` passed, repeated after the final locale copy change.
- `npm test`: 228 files, 1,526 tests passed before that copy-only change; scoped
  i18n/format checks and the browser download passed afterwards.
- `.venv-desktop/Scripts/python.exe -m unittest discover -s tests/python -t tests/python`:
  1,095 total, 1,088 successful, 7 skipped. An initial Windows socket abort passed
  unchanged on focused rerun and on the final full run.
- DOCX/EPUB browser verification: 20 applicable cases passed across the original
  combined run and a corrected metadata-fixture rerun; 10 duplicate cases skipped.
- EPUBCheck 5.4.0: actual download and edge fixtures passed with zero errors/warnings.
  This was local acceptance, not a pinned CI/release gate or physical-reader test.
- Formatting, scoped lint/contracts and the EPUB guard mutation check passed.
- No release, version bump, commit or push was performed for S16.

Detailed commands, failures and coverage limits remain in the acceptance source;
do not rewrite them as a fresh verification result. Temporary artifacts were under
`%TEMP%/quiltor-epub-s16`; they are disposable, not durable release evidence.
The test launcher was stopped and its isolated catalogue cleared.

## Mobile project selector: separate pending integration

Pre-existing changes affect `WorldSessionBoundary.tsx`, `WorldGate.tsx` / `.css`,
`tests/e2e/world-gate-responsive.spec.ts` and compact world-gate visual baselines.
Windows images are updated. Four affected Linux/macOS images are absent pending
the designated baseline workflow. Previous local checks were reported in the
mobile task; this setup has not independently accepted or released that work.

## Agent ownership at this handover

| Agent                | Previous bounded responsibility                                               | Current state                                        |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `epub_serializer`    | Code-risk inventory, transactional validation, world identity and retry fixes | Returned; locally accepted                           |
| `epub_frontend`      | Design inventory, shared control corrections and readable chapter titles      | Returned; locally accepted                           |
| `epub_browser_tests` | Rendered audit, regression proof and final integrated verification            | Returned; locally accepted; isolated runtime stopped |
| Coordinator          | `knowledgebase/**`, decomposition, review and integration                     | Maintains the taskboard                              |

Agent names identify this session only. On resume, inspect actual availability;
do not assume an old worker is still running or owns new files.

## Active coordination action

The board was reconciled against the independent inventory and reviewed without
material discrepancies. Document formatting and relative links passed. The owner's
subsequent instruction prioritizes the [code/frontend quality campaign](frontend-quality-campaign.md).
Three bounded agent assignments cover source design drift, rendered behavior and
code risks. The coordinator owns prioritization, review and integration rather than
substantial implementation. The release queue remains open; S17 remains deferred.
No participant recruitment or synthetic pilot results are authorized.

The campaign now includes local corrections to Timeline control sizing/ownership,
figure/place pressed-state appearance, readable chapter titles, atomic story-time
validation and stale world-session/revision ownership with safe create retry.
Lead review caught and returned title composition/caret issues before acceptance.
Backend final discovery passed 1,098 total tests (1,091 successful, 7 skipped);
the final build passed and the frontend suite passed 228 files / 1,539 tests.
Nine targeted browser cases plus one measurement capture passed, with two intended
project skips. The lead reviewed source changes and final screenshots/measurements.
The initial correction batch is accepted locally; all product workers have returned.
Exact commands, mutation history and final served bundle identity are recorded in
the [visual audit](frontend-visual-audit.md) and [code inventory](code-risk-inventory.md).
The isolated server is stopped, ports released and temporary runtime data removed.

Next coordination work remains on the taskboard: extend dialog/error/enlarged-text
coverage, investigate existing lint findings and review cross-platform visual
baselines before delivery. Existing EPUB/mobile work remains preserved. No version
bump, commit, push, CI run, release or production upgrade was performed in this
quality campaign; local acceptance must not be reported as publication readiness.

The concurrently created `knowledgebase/critic/` belongs to the independent critic.
Its register contains asynchronous world identity and cross-document validation
investigations. Both are indexed on the taskboard. Independent campaign reproductions
and locally accepted corrections are now available in the code inventory; the
critic's own review disposition has not been changed by the coordinator.
