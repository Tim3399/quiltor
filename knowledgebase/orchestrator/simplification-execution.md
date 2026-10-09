# Simplification execution

Started 2026-10-09 following the owner's explicit request to implement the
[reviewed plan](simplification-review-plan.md). Scope is the six accepted narrow
slices only. SIM-07–18 and the deferred normalization/deletion portions remain
outside this implementation.

Target release: **3.22.1 (patch)**. The owner explicitly authorized commit, push
and tag after all local tests pass. Successful publication on the exact release
revision is required; the existing publisher creates the tag after Release Build.
Version preparation uses `npm run set-version -- patch`, never manual edits.

## Ownership and delivery

- Coordinator: final review, phase gates, taskboard and this execution ledger.
- Implementer chat `01a101cc-945d-7d23-80d9-9190d2621c5c`: practical developer
  dispatch, worktree coordination, combined integration/testing evidence.
- Dev 1: phase 1 SIM-04, phase 2 SIM-01, phase 3 local SIM-05.
- Dev 2: phase 1 SIM-03, phase 2 SIM-06, phase 3 SIM-02.
- Dev 3: serial integration, combined verification and release environment.
- Critic: independent review of sensitive implementation slices and final scope.

The coordinator dispatched phase 1 to the Implementer on baseline `0d59a2c`.
Later phases require coordinator review of actual diffs and test evidence. The
existing user-owned developer chats carry explicit authorization to use their
own worktrees. No coordinator worktree was created: automatic approval rejected
that attempted action under the owner's role restriction, and the attempt was
not retried. Practical work follows the independently authorized Dev workflow.

Keep the owner's primary checkout, running local 3.22.0 instance and existing
project data unchanged while development and integration checks run in Dev
checkouts. Production deployment remains outside this task. Final acceptance
requires all six scoped changes, actual-diff review, targeted before/after
characterization, the full supported local preflight and green exact-revision
Test/Release Build/Release Publish workflows with published 3.22.1 verified.

## Progress

The first phase began on verified clean Dev bases at `0d59a2c`. Current
combined base is accepted `e2d5cad`; the Implementer dispatches Phase 3 in
the same existing Dev worktrees. Dev 3 owns the integration branch
`codex/dev3-integration-3.22.1`.

Release 3.22.1 is authorized and awaits accepted implementation plus the supported
patch updater. The coordinator owns release commit/push and publication checks.

| Phase               | Status           | Evidence / next action                                                                  |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| 1: SIM-04 + SIM-03  | Accepted locally | Lead + Critic reviewed actual diffs; integrated c2572be; 25 focused tests pass          |
| 2: SIM-01 + SIM-06  | Accepted locally | Lead + Critic Pass; integrated e2d5cad; 52 Python + 8 TS + contracts pass               |
| 3: SIM-05 + SIM-02  | Patches accepted | Lead + Critic Pass; final integration/build pending                                     |
| Combined acceptance | Planned          | Integrated diff, backend suite, frontend build/tests/contracts, clean delivery revision |

## Phase 1 acceptance

SIM-04: characterization `8ecb0ae`, implementation `8121e77`; SIM-03:
characterization `a191cd6`, implementation `6ee5899`. Separate test commits
passed on unchanged source before the minimal product edits. Afterward the same
15 Storyboard, 1 connection-safety and 9 writing-assistance tests passed.
The coordinator inspected both complete test/product diffs; the
[Critic independently passed both](../critic/simplification-implementation-review-3.22.1.md),
verified the actual Dev import paths and reran all 25 focused tests.

Dev 3 integrated the four commits in
`C:/Users/timra/git/quiltor/quiltor-dev3-integration`, branch
`codex/dev3-integration-3.22.1`, resulting in clean
`c2572beec6c46be72f73237f3279df394af7a9c0`. Integrated content matches the reviewed
workers, and all 25 focused tests pass on the combination. The coordinator
verified the integration HEAD, clean status and four-file scope. Full combined
and release gates remain pending. Phase 2 was dispatched after this acceptance.

## Phase 2 execution clarification

Dev 1 works on branch `codex/dev1-sim01` and Dev 2 on
`dev2/sim-06-chapter-integers`, both based on accepted `c2572be`.
The Implementer corrected an assignment detail against the actual wire contract:
Note-References normalize `from/to`. Unknown `paragraph/offset` extension
fields retain their existing values, including floats. This is preservation of
the reviewed behavior, not an added normalization change.

## Phase 2 acceptance

SIM-01 characterization `13dbe50` and refactor `6d6f104`; SIM-06
characterization `66520e0` and refactor `c54f354`. Coordinator inspected all
source/test/fixture diffs and actual before/after evidence; no findings.
Critic independently passed both, reran 52 Python and 8 TypeScript tests plus
contracts, and regenerated all 20 export archives from immutable old and new
source: complete bytes, counts and manifests match saved baseline artifacts.

Dev 3 integrated to clean `e2d5cadeac13af8e0dbf76c5d7ec1cde7c282303`.
Eight Phase 2 files exactly match accepted worker contents. Own-source imports,
52 combined Python tests, 8 TypeScript differential tests, contract registry and
diff whitespace checks passed with fail-fast exit 0. Coordinator inspected the
actual check outputs. Phase 3 was dispatched after this final acceptance.

## Phase 3 implementation acceptance

SIM-05: characterization `cba0ef8`, refactor `ad57a5f`. Lead inspected
the complete two-file diff and actual before/after output (48 Storage tests).
The local helper accepts only the two fixed table names; SQL algorithm and call
order are unchanged. Real-rowid/dependent-record and owned/borrowed rollback
characterization passed. Critic independently passed this patch.

SIM-02: characterization `7ec8f6e`, refactor `bd7f5a0`. Lead inspected
the complete eight-file diff. The ordinary non-async helper keeps JSON
serialization synchronous and preserves the difference between an omitted signal
and an explicitly supplied undefined signal. Exactly 13 agreed calls changed;
requestJson, world evaluation and decoders remain in their original layers.
Worker reports 169 HTTP tests before extraction and 174 afterward (five new
helper cases), platform/format/diff checks green. Critic independently passed
the patch with 66 directly affected HTTP tests and module-boundary checks.

All six exact worker implementations now pass Lead/Critic review. Final Dev 3
integration, targeted combined verification and the matching frontend build are
in progress. Release 3.22.1 remains unpublished; complete local release checks
run once through the mandatory supported updater after the final clean revision
contains code, generated dist and the coordinator documentation commit. No gate
is waived; redundant full suite execution immediately before that preflight is
not required.
