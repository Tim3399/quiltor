# Integration and cloud delivery

Authorized by the owner on 2026-09-19, following completion of QF-01 through QF-09.
This extends the earlier local delivery; it does not retroactively claim that cloud sync
was implemented in that delivery.

## Scope and decisions

- Preserve the original dirty workspace exactly before integrating the completed QF branch.
- Implement **manual, per-project synchronization** on top of authenticated immutable
  remote backups. Automatic background synchronization and collaborative text merging
  are not part of this protocol.
- Publish a separate versioned head using compare-and-swap. Backups remain recoverable
  independently of the current head and synchronized chapter deletions.
- Persist device baselines per endpoint and authenticated account. A semantic content
  fingerprint excludes device-local ownership/revision metadata.
- Conflicting edits or deletion/edit combinations retain both versions. Resolution requires
  a real remote preview and an explicit choice checked against the reviewed state.
- Enforce operator-configured quota and read-only/expiry policy remotely. Local writing,
  trash, restoration and export remain independent of that policy.
- The owner's updated price concept is **EUR 2.50 net**, not the earlier EUR 2.99.
  The billing period, meaning before/after marketplace fees, storage allowance, retention
  and production hosting remain undecided. No checkout, published price or deployment
  is authorized by that concept alone.

## Sprints

| Sprint                    | Tasks                                                                                             | Acceptance                                                                                          | Status                  |
| ------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| S7 Integration            | Capture dirty/untracked files; reconstruct snapshot; merge QF; review conflicts                   | Original fingerprints identical; both parents retained; combined build and targeted regression      | Reviewed isolated merge |
| S8 Cloud endpoint         | Atomic sync head; immutable validation; account identity; quota/access policy; expiry maintenance | Real HTTP races, isolation, quota, retries and failure boundaries                                   | Implementing            |
| S9 Device synchronization | Semantic baseline; upload/pull; conflict preview/resolution; safety copies; recovery              | Two independent local roots, offline delete/edit, stale decisions, interruption, local independence | Implementing            |
| S10 Author workflow       | Existing-menu cloud dialog; login, status, usage, preview, confirmation, reload guard             | Typed boundary checks and component safety tests; light/dark and narrow browser inspection          | Implementing            |
| S11 Integrated acceptance | Merge cloud changes; rebuild; run required suites; operator docs; hand off in original workspace  | Clean integrated working tree with original edits preserved and honest capability/launch limits     | Planned                 |

## Integration evidence

The original worktree is `quiltor/`, branch `feature/editor-session-state`, base `092578c`.
The isolated integration worktree is `quiltor-cloud-integration/`, branch
`feature/qf-cloud-integration`.

- `508deaa` preserves the original tracked and untracked workspace content.
- `e8c110c` merges that snapshot with exact completed QF commit `e3144dc`.
- Fingerprint/status comparisons before copying, after copying and after merging found no
  differences across 263 original paths. Capture files and a binary patch are retained in
  the OS temporary directory, `quiltor-cloud-integration-capture-20260919/`.
- Lead reviewed the actual conflict result, including semantic chapter-diff styling and
  preserved formatting/CI additions. Built assets were regenerated from combined sources.
- Build passed. Eight targeted frontend test files passed, 63 tests.
- Initial worker Python attempts did not execute because its sandbox could not discover
  the interpreter. The final backend run must use the actual pinned interpreter and
  process-local source path; this is not counted as a passing check.

## Final acceptance

Pending combined implementation and checks. Record exact commands, results and platform
limits here before marking this delivery complete.
