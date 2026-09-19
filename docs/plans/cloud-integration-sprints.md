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

| Sprint                    | Tasks                                                                                             | Acceptance                                                                                          | Status                         |
| ------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| S7 Integration            | Capture dirty/untracked files; reconstruct snapshot; merge QF; review conflicts                   | Original fingerprints identical; both parents retained; combined build and targeted regression      | Accepted                       |
| S8 Cloud endpoint         | Atomic sync head; immutable validation; account identity; quota/access policy; expiry maintenance | Real HTTP races, isolation, quota, retries and failure boundaries                                   | Accepted                       |
| S9 Device synchronization | Semantic baseline; upload/pull; conflict preview/resolution; safety copies; recovery              | Two independent local roots, offline delete/edit, stale decisions, interruption, local independence | Accepted                       |
| S10 Author workflow       | Existing-menu cloud dialog; login, status, usage, preview, confirmation, reload guard             | Typed boundary checks and component safety tests; light/dark and narrow browser inspection          | Accepted                       |
| S11 Integrated acceptance | Merge cloud changes; rebuild; run required suites; operator docs; hand off in original workspace  | Clean integrated working tree with original edits preserved and honest capability/launch limits     | Checks passed; handoff pending |

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
- `52363f3` contains the reviewed cloud implementation. Merging it into the integration
  branch conflicted only in generated `dist/` files; a fresh combined build resolved them.
- Initial worker Python attempts did not execute because its sandbox could not discover
  the interpreter. The final backend run used the installed Python 3.12 runtime and
  process-local source path successfully.

## Final acceptance

The following checks ran on the combined sources in `quiltor-cloud-integration/` on
2026-09-19. npm commands used `npm_config_prefix=C:/Program Files/nodejs`; Python used
`PYTHONPATH=C:/Users/timra/git/quiltor/quiltor-cloud-integration/src`.

| Command                                                                                                                                                       | Result                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                                                                                               | Passed all contract, architecture, design, design-system, i18n, platform and TypeScript gates; regenerated production assets. Existing large-chunk advisory remains. |
| `npm test -- --reporter=dot`                                                                                                                                  | 225 files, 1,443 tests passed. Existing test-double/DOM warnings do not represent failures.                                                                          |
| `py -3.12 -m unittest discover -s tests/python -t tests/python`                                                                                               | 1,022 tests run in 215.562 seconds: 1,016 passed, 6 skipped. Includes the real reference-server/two-root sync and local-save-during-remote-wait cases.               |
| `npm run check:format`                                                                                                                                        | Passed web, Python, documentation and Rust profiles.                                                                                                                 |
| `node node_modules/@playwright/test/cli.js test tests/e2e/cloud-workflow.spec.ts --reporter=line`                                                             | 9 passed: unconfigured and light/dark conflict cases at wide, regular and compact widths. Dialog axe checks passed.                                                  |
| `node node_modules/@playwright/test/cli.js test tests/e2e/editor-session-state.spec.ts tests/e2e/competition-findings.spec.ts --project=wide --reporter=line` | 11 passed: 5 editor-session and 6 competition workflow cases.                                                                                                        |
| `node node_modules/@playwright/test/cli.js test tests/e2e/history-design.spec.ts --project=wide --reporter=line --output=test-results/history-final`          | 4 passed; no visual baseline update.                                                                                                                                 |
| `git diff --cached --check`                                                                                                                                   | Passed after resolving generated output.                                                                                                                             |

The browser run started the full application with `npm start`, isolated temporary data/runtime
home, API port 8132, Vite port 5275 and explicit API target. `/api/version` matched `VERSION`
at 3.20.0; served index and entry bundle were byte-identical to local `dist/`. No embedded
source-identity metadata is claimed. All owned processes were stopped and both ports released.

There are **24 distinct passing browser cases**. The cloud capture rerun with
`--output=test-results/cloud-final` passed the same 9 cases and does not inflate that total.
Cloud wide/compact light/dark captures were inspected, including 16px serif comparison text,
stacking, scrolling and contrast. Cloud transport is stubbed in browser conflict cases;
real authenticated HTTP synchronization is covered by the Python integration cases, not
misrepresented as a browser test against a commercial service.

Review corrections cover post-swap rollback, pending-pull recovery, postcommit status failures,
real mid-upload quota propagation, account/head validation and mandatory reload after uncertain
recovery. The backend mutation removed the pull fingerprint guard and failed the concurrent-edit
test as intended. The frontend counter-check also failed at the missing reload action, then
restored the source byte-for-byte:

```powershell
node tools/dev/mutate.mjs packages/client/src/modules/cloud/CloudDialog.tsx --from 'setReloadRequired(true);' --to '/* recovery reload guard removed */' -- node node_modules/vitest/vitest.mjs run packages/client/src/modules/cloud/CloudDialog.test.tsx --reporter=dot
```

Corrected attempts are retained as evidence: an initial cloud build caught a forbidden direct
platform check, and the first browser run caught a test fixture with no storyboard (invalid
under the existing contract). Both were fixed before the passing final runs. An early worker
npm launcher path was unavailable; the final commands used the installed npm prefix. No
failed attempt is counted as a pass.

Logs are retained in the OS temporary directory as `quiltor-integrated-{build,client,backend,format,mutation}.log`.
Screenshots remain in the integration worktree's ignored `test-results/cloud-final/` and
`test-results/history-final/` directories.

Limits: Windows Chromium is the tested browser host. Six backend tests were skipped,
including the cloud purge's actual symlink case without Windows symlink permission. Native
macOS/mobile, full browser/design suites, Docker image builds and release preflight were not
run for this delivery. The container contract checker passed separately. Windows directory
metadata durability has the documented standard-library limitation. No billing or public
deployment was activated; commercial terms remain in the separate pricing/release documents.
