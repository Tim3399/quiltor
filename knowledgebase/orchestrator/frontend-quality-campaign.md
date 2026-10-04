# Code inventory and frontend quality campaign

Started: 2026-10-03. Owner request: analyze bugs and code quality, then optimize;
focus on inconsistent buttons and misaligned elements. The lead coordinates and
reviews; implementation and hands-on investigation belong to assigned agents.

The 2026-10-04 continuation is tracked in the [four-point closure plan](four-point-closure.md).
That record and the taskboard carry the current acceptance state; this document
preserves the original campaign scope and initial assignments.

## Was

Inventory concrete defects and design-system drift in the five workspaces,
project entry and representative dialogs. Inspect the implementation and rendered
behavior separately. Correct confirmed, bounded findings through implementation
agents. Maintain a coverage ledger, including untested states and unresolved risks.

## Warum

The owner reports visibly inconsistent controls and alignment. Static checks and
previous accepted design work do not guarantee consistent behavior in every
product state. Fix the actual user-facing defects and their causes without using
this request as a reason for a new visual identity or a broad architecture rewrite.

## Wann erledigt

The initial pass is complete when the inspected scope and evidence are recorded,
confirmed findings have prioritized board entries, the selected correction batch
has been reviewed in source and rendered behavior, and applicable combined checks
pass. Remaining investigations and untested states stay explicit on the board.
Do not claim an exhaustive absence of bugs or a published release from a local pass.

## Assignments and ownership

| ID            | Agent                | Exclusive output / responsibility                                                                                                                |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI-AUDIT-01   | `epub_frontend`      | `frontend-controls-audit.md`; control/design-system source inventory, then a separately scoped correction batch                                  |
| UI-AUDIT-02   | `epub_browser_tests` | `frontend-visual-audit.md`; isolated launcher, runtime identity, screenshots and geometry evidence; sole build/server owner during initial audit |
| CODE-AUDIT-01 | `epub_serializer`    | `code-risk-inventory.md`; async/session and cross-document boundary evidence, no product mutations                                               |
| UI-COORD-01   | Coordinator          | This plan, taskboard, dependency decisions, actual diff review and final acceptance                                                              |

All output paths above are relative to `knowledgebase/orchestrator`. Raw screenshots
and logs belong in `%TEMP%/quiltor-ui-audit`; useful accepted evidence is summarized
durably in the audit records. Agents preserve existing EPUB/mobile edits, do not
delegate further and do not commit or release. Product file ownership is allocated
only after findings establish the correction scope.

## Review method

1. Distinguish confirmed behavior defects, code-supported design violations,
   visual hypotheses and optional taste preferences. Record location, state,
   impact, source rule and expected correction.
2. Prioritize loss/corruption and inaccessible actions before cosmetic inconsistency.
   Review the critic's existing hypotheses without assuming a production defect.
3. Prefer approved design primitives and semantic tokens. Fix the owning component
   or layout relationship instead of adding scattered offsets or weakening gates.
4. Select small batches with exclusive ownership. Coordinate shared files and
   serialize builds so browser evidence matches the intended code.
5. Inspect actual diffs and relevant screenshots/measurements. Verify keyboard,
   focus, light/dark and compact behavior where affected. Prove bug regressions
   fail without the fix when applicable; avoid tests that merely mirror CSS text.
6. Obtain `npm run build`, `npm test` and relevant scoped/browser checks after
   integration. Reuse valid evidence for unchanged code. Record failures and gaps.

The latest owner instruction makes this campaign the immediate priority. The
previous release queue remains open; no deferred pilot or unrelated roadmap
feature is restarted by this assignment.

## Lead review decisions

- The source and rendered inventories agree on a 34 px Timeline date action that
  fails the compact 44 px contract, indistinguishable pressed priority toggles,
  and hard-clipped chapter titles. Primary toolbars across the five workspaces
  did not show the reported general misalignment in the inspected matrix.
- Timeline segmented controls worked in the checked states; removing their
  duplicate feature recipe is design debt cleanup, not a claimed behavior fix.
- SAFE-FIX-01 is accepted locally: lead inspected the transaction/adapter/loader
  changes and deterministic two-order regression. Final backend discovery ran
  1,098 tests: 1,091 successful and 7 skipped. Disabling the atomic check makes both
  interleavings fail. Detailed commands belong to the code-risk inventory.
- Initial title implementation required rework: local IME draft must not reach
  canonical autosave state until composition ends, and a deferred paste caret
  update must not affect another chapter. The independent review caught these
  before acceptance. Stable observer dependencies were verified by the lead;
  an earlier missing-dependency observation read a transient snapshot.
- Build serialization matters: a post-freeze source refinement raced the first
  build and produced a parser failure. An intermediate build passed, but title
  rework explicitly revoked the freeze. Only checks against the final frozen
  source and identified served bundle count as integrated acceptance.
- Browser regressions must assert visible geometry and behavior. A title test
  initially failed on the implementation-specific element tag; that assertion was
  removed. Its final regression proof must concern readable layout.
- Title review additionally caught paste bypassing the local composition draft.
  The correction keeps composing paste local and publishes only the normalized
  final title. Focused title tests pass; final rendered acceptance remains separate.
- The remaining session findings are included as the next bounded correction in
  this campaign: generation-owned load publication and transport revision updates,
  plus retrying the already-created world after an initial document-load failure.
  This avoids leaving the identified code-boundary risks as an unactioned report.
  The final build and frontend suite wait for both frontend source owners to freeze.
- Session correction source is now reviewed and frozen: 57 focused tests and five
  targeted mutation scenarios passed. Hook operations and transport selections use
  separate generations; create recovery reopens the known ID. Tracked stale peek
  adoption rejects with the existing conflict error while explicit adoption remains
  compatible. Existing autosave recovery checks the reviewed draft identity before
  replacement/resolution, so no Application-wide rewrite was required.

## Final local acceptance — 2026-10-03

The initial delegated batch is accepted. The lead inspected actual source diffs,
returned title IME/caret issues for correction and reviewed final rendered evidence.
No primary-toolbar alignment defect was reproduced in the inspected five-workspace
matrix; the accepted UI fixes address the specific title, inline-action and pressed
state findings. Segmented-control cleanup removes duplicate design ownership.

- Final build passed using the installed npm CLI directly; frontend tests passed
  228 files / 1,539 tests.
- Backend discovery passed 1,098 total tests: 1,091 successful and 7 skipped.
- Nine targeted product browser cases and one measurement capture passed; two
  intentional browser project skips remain explicit.
- Browser mutation evidence detects the title's visible clipping when auto-height
  is disabled. Safety mutations detect the removed transaction/session/retry guards.
- Final compact date actions measure 44 px, wide actions 36 px; pressed priority
  controls remain visually distinct after blur; the long title has no hidden overflow.

Exact command lines, failure/rework history and final bundle SHA-256 are in the
[visual audit](frontend-visual-audit.md) and [code inventory](code-risk-inventory.md).
The isolated runtime was stopped and disposable runtime data removed; screenshots
remain under `%TEMP%/quiltor-ui-audit` and are summarized in the durable records.

AUDIT-COVERAGE-02 and AUDIT-LINT-01 remain open. Platform visual baselines require
review, including four earlier missing Linux/macOS mobile images. No claim is made
of exhaustive UI coverage, a fully clean repository lint, fresh cross-platform CI
or publication. No commit, version bump, push or release was performed for this
campaign. The release queue and owner-deferred S17 pilot retain their prior status.
