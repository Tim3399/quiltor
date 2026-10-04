# Four-point audit closure

Owner instruction: 2026-10-04. Status: complete. The coordinator delegates
implementation, reviews actual diffs and evidence, and keeps this plan and the
taskboard current. Completion requires all four rows to pass, not merely reports
or a green subset of tests. No publication is implied by this audit assignment.

| ID / owner                                           | Was                                                                                                                                                       | Warum                                                                                        | Wann erledigt                                                                                                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLOSE-01 / `epub_frontend`                           | Resolve three EditorSurface effect-dependency findings and Python DTZ005/SIM117                                                                           | Existing command-line lint exclusions conceal unresolved behavior questions                  | Each finding has a reviewed correction or specific evidence-backed disposition; scoped lint without command-line exclusions, relevant behavior tests and formatting pass                               |
| CLOSE-02 / `epub_browser_tests`                      | Exercise missing import/export preview, history/recovery, confirmation, validation/network-error, populated storyboard, map/distance and 200% zoom states | The first audit covered normal states and cannot establish these flows                       | Explicit theme/viewport/action/result ledger covers every named category; confirmed bugs fixed with meaningful regressions; screenshots reviewed                                                       |
| CLOSE-03 / Coordinator, then browser/platform worker | Accept mobile selector and affected visual references on Windows, Linux and macOS                                                                         | Local Chromium evidence and four absent platform images do not establish platform acceptance | Mobile diff reviewed; reviewed intentional baseline changes generated on their real platforms, all expected files restored, baseline reach and strict screenshot comparison pass for the tested source |
| CLOSE-04 / `independent_safety_review`               | Independently assess CRIT-001/002 and associated session/create/transaction corrections                                                                   | The implementation author's checks are not independent review                                | Actual source and meaningful edge cases reviewed independently; no unresolved actionable defect; critic disposition updated with traceable evidence and deployment-topology limits                     |

## Order and ownership

1. CLOSE-01, CLOSE-02 investigation and CLOSE-04 run independently. No nested
   delegation. Source owners preserve all earlier EPUB/mobile/quality edits.
2. The coordinator prepares platform execution and checks workflow permissions and
   source identity. Platform workflow uses a separate audit branch if required;
   it must not move main, change VERSION or publish a release.
3. UI findings receive explicit file ownership before correction. The original
   safety author receives any independently reproduced safety issue. A worker
   must not accept its own repair as the independent verdict.
4. All product owners freeze before the browser owner rebuilds and executes final
   combined client/browser checks. Backend checks follow relevant Python changes.
5. Platform snapshots are generated only for reviewed intentional differences;
   existing unexplained differences stay failures. Actual platform images and
   strict follow-up comparisons are required; copying Windows files is invalid.
6. The lead reviews changes, checks evidence and updates each original board item
   and the handover. Remaining blockers keep the corresponding point open.

## Evidence locations

- [Code quality](followup-code-quality.md)
- [UI coverage](followup-ui-coverage.md)
- [Platform review](followup-platform-review.md) and [CI evidence](followup-ci-evidence.md)
- [Actual browser zoom](followup-zoom-evidence.md)
- [Independent safety review](independent-safety-review.md)

Temporary logs, snapshots and isolated runtime data stay in OS temporary storage.
Final accepted baselines belong in the existing repository snapshot directory.

## Initial decisions

- Three lint findings arise from unstable helper function identities. Stabilizing
  helpers must preserve chapter/history capture and restoration, not simply expand
  effect dependencies and rerun on every render.
- Persisted restore timestamps require consumer review before changing naive local
  ISO timestamps to aware UTC. The nested context-manager correction preserves
  entry/exit order.
- Existing snapshot workflow runs on pushes, fills missing images only, then runs
  strict verification; it commits generated references back to its target branch.
  Test workflow can be dispatched separately. Release workflows are excluded.

## Final acceptance — 2026-10-04

All four points are **Done**. The coordinator inspected the implementation diffs,
reviewed the evidence and independently confirmed the final remote results.

| Point    | Accepted result                                                                                                                                                          | Evidence                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLOSE-01 | All five code findings corrected without suppressions; stable editor helpers, UTC restore timestamp and equivalent context-manager structure                             | [Code quality](followup-code-quality.md): 18 focused frontend tests, 13 focused backend tests, failing/restored UTC mutation and full Python discovery             |
| CLOSE-02 | Remaining dialog, error, recovery, history, storyboard and map flows accepted; compact conflict-header overflow/navigation collapse and undersized recovery action fixed | [UI coverage](followup-ui-coverage.md): 8 restored browser cases; [actual browser zoom](followup-zoom-evidence.md): 20 surfaces across both themes and two layouts |
| CLOSE-03 | Mobile selector and affected Windows/Linux/macOS images accepted; all native references restored and strict native comparisons plus full supported-platform CI passed    | [Platform review](followup-platform-review.md), [CI ledger](followup-ci-evidence.md)                                                                               |
| CLOSE-04 | Both critic investigations independently closed for supported use; no unresolved actionable defect in the reviewed scope                                                 | [Independent safety review](independent-safety-review.md): 57 frontend tests, 16 backend tests, 20 contended-save trials and generation mutation proof             |

The compact conflict correction preserves direct error/retry/recovery actions and
44 px touch targets at 320/390/719 px; navigation remains reachable through local
scrolling. Assistant and Search use the existing More menu only in compact error
mode. A deliberately undersized recovery target failed the regression before
restoration. Actual browser zoom was verified separately from doubled-text reflow.

Final local contributor gates passed: build, 228 frontend files / 1,539 tests,
and Python discovery with 1,099 total tests (1,092 successful, 7 skipped). Exact
commands, failed attempts and scope limits remain in the linked ledgers.

## Accepted candidate and pipeline

- Remote branch: `codex/audit-closure-2026-10-04`.
- Commit: `c5ba722f2c22b2526a48af2aae4c9f427fb75e05`.
- Tree: `8152c83d62084d06a3cd0aba2d0e78d51f2ee91a`.
- [Test 37216539640](https://github.com/Tim3399/quiltor/actions/runs/37216539640):
  **success**, attempt 2, all **22 jobs successful** on that exact commit.
- [Native baseline 37213374818](https://github.com/Tim3399/quiltor/actions/runs/37213374818):
  Windows, Linux, macOS and gap jobs successful. Linux commit
  `4f5c6fc51d84cc81e102cfe6f79767ce71935dd1` and macOS commit
  `272b7db4b4c9194ed47ca02fc0c2d8e88740a313` each restored 16 expected images.
  All 32 imported images received independent visual review and lead spot checks.
- [Final baseline check 37216534438](https://github.com/Tim3399/quiltor/actions/runs/37216534438):
  success on the final commit; gap passed and conditional bootstrap correctly
  skipped because no images were missing.

The lead compared the candidate tree with the current product, tests, contracts,
locales, docs, assets and references through a temporary index: an exact match.
Final entry asset `index-aUSy44Mh.js` has SHA-256
`F0B6EBEA6ADC6290F0E668E5AC7F6FED9F12F7E1C29F4C1C4E85D19E99CA0464`.
The final audit test has SHA-256
`EBA0803E3DF6B8B47BBB068A37D1879A66F776C5F87F40E115C71AAAC4BEFCBE`.

## CI corrections and evidence limits

The [CI ledger](followup-ci-evidence.md) preserves every failed and superseded run.
Two early attempts were blocked by test-file formatting; the complete format
contract subsequently passed. A macOS history measurement sampled the Sheet's
entrance animation. The reviewed 12-line test-only correction waits for the existing
containment contract without raising timeout or tolerance. Deterministic proof
reproduced the old failure, accepted an ending animation and still rejected permanent
overflow; the restored eight-case matrix passed locally and remotely. The remote
trace download was incomplete, so the diagnosis rests on logs, independent source
review and this behavioral proof.

A Windows HTTP timeout did not recur in the final core run. The first final-run
attempt also failed two existing macOS autosave/pin tests that had passed on identical
product code. Source/fixture review did not establish their root causes. Exactly one
authorized macOS product-job rerun on the unchanged commit passed; there was no
second retry, relaxed assertion or timeout increase. These observations are retained
as evidence limits, not asserted to prove the absence of intermittent bugs.

The independent reviewer found no additional material acceptance gap beyond the
then-pending full CI and coordinator reconciliation; both are now complete.
Multiple independent web processes sharing one data directory remain outside the
supported safety-review topology. This is scoped acceptance, not an exhaustive
claim that all possible program behavior is bug-free.

## Handover and delivery boundary

All implementation/review agents have returned. Isolated application servers,
runtime data and temporary browser profiles were cleaned up; final source,
references and durable reports remain.

The original checkout branch, HEAD
`36aaa46a39ceec5bd3c6fe0b8f65b291affe590d` and main index were preserved. Its
working tree still contains the accepted changes; coordinator knowledgebase files
remain local, outside the remote test candidate. The candidate also includes the
existing EPUB/mobile work needed by the shared build.

The audit does not publish a version, update main or deploy production. REL-S16,
external EPUB CI validation and roadmap reconciliation remain separately queued.
The author's S17 pilot remains deferred. No new implementation task is active.
