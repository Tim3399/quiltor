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

All six patches passed coordinator/Critic review and were integrated in Dev 3's
authorized checkout. Final source/dist/documentation candidate `90332ab`
passed the complete supported local release gate after the launcher recovery
documented below. Release commit `9695cd4` is on main and publisher-created tag
v3.22.1. Publication and all exact-revision release workflows are successful.
All six accepted slices are complete; later sections retain historical gate states.

| Phase                       | Status   | Evidence                                                                                        |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| 1: SIM-04 + SIM-03          | Accepted | Integrated c2572be; 25 focused tests                                                            |
| 2: SIM-01 + SIM-06          | Accepted | Integrated e2d5cad; 52 Python + 8 TS + contracts                                                |
| 3: SIM-05 + SIM-02          | Accepted | Integrated bf1bbf2; 48 Storage + 174 HTTP + platform                                            |
| Combined local release gate | Passed   | Complete supported retry; native and launcher exit 0                                            |
| Publication                 | Complete | Exact commit 9695cd4; Test 37961937563 attempt 2: 22/22; Build 37961937425; Publish 37965077220 |

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

## Integrated candidate and complete local release gate

All reviewed source changes are integrated at `bf1bbf2`. Actual combined
48 Storage / 174 HTTP tests and platform checks passed. `npm run build`
passed with persistent exit 0; generated dist is committed at `c3aee2b`.
The existing large-chunk warning remains nonfatal. Build evidence:
`C:/Users/timra/AppData/Local/CodexWork/quiltor/dev3-builds/20261009T154513384Z-48d2e887547149a0baa604abb8160ef2`.

Documentation-only commit `1915904` was merged normally, retaining its
ancestry. Final clean candidate: `90332abc2cd19b6b2554441756350b529b467ea3`.
The coordinator inspected actual source/merge/targeted-test/build outputs and
the full external updater launcher. Dev 3 is authorized to run the unchanged
supported `npm run set-version -- patch` on this exact revision, with durable
stdout/stderr and an exact native exit file. The full preflight is pending; no
release commit/push/tag or publication has yet occurred for 3.22.1.

### First full preflight: gates passed, launcher completion failed

Run directory:
`C:/Users/timra/AppData/Local/CodexWork/quiltor/dev3-version-updater/20261009T155634649Z-4e7b16a2b8f1457a88e27584e5400854`.
The actual complete logs show all release preflight gates passed: 1,134 Python
tests (6 Windows skips), 4 CLI tests, Rust 2+1, 1,598 frontend tests in 230 files,
338 product browser tests (193 configured skips), and 144 design tests. Python
packages, PDF smoke, both containers and committed-dist checks also passed.
The supported updater changed exactly VERSION/package.json/package-lock.json/
Cargo.toml/Cargo.lock from 3.22.0 to 3.22.1, reviewed by the coordinator.

However, the external PowerShell launcher failed while recording its native
exit status: line 130 observed a null LASTEXITCODE and wrote launcher-error.txt.
There is no updater.exitcode.txt. Do not invent a native exit 0 or mark delivery
complete. Implementer/Dev3 own diagnosis and a reliable exit-capture correction;
Critic independently reviews the recovery plan for target 3.22.1. Existing logs
and generated manifest changes are preserved. No release commit/push occurred.

### Approved recovery and full retry

Orchestrator and Critic accepted the bounded recovery for 3.22.1. The launcher
now retains the native process handle and reads Process.ExitCode after waiting,
using hidden execution and separate stdout/stderr files. Coordinator inspected
the actual correction and recorded controlled probe values 0 and 7.
Implementer reports byte-for-byte backups, hashes and a complete Git patch of
the five generated manifests before restoring only those paths to `90332ab`.
The launcher's clean-status, exact-revision and 3.22.0 guards passed again.

Full retry started 2026-10-09 16:26:51 UTC on unchanged `90332ab`:
`C:/Users/timra/AppData/Local/CodexWork/quiltor/dev3-version-updater/20261009T162651457Z-3f86d27848a8481ea9e725e149a14547`.
Completion and publication remain pending. The first run's missing native exit
is never relabeled as zero; the retry must supply its own complete evidence.

## Local release acceptance and publication started

The complete retry finished successfully with recorded native exit 0 and
launcher exit 0. Coordinator inspected the actual exit file, full-log summaries,
clean accepted source and exact five-manifest 3.22.1 diff. Results: 1,134 Python
tests (6 skips), 4 CLI, Rust 2+1, 1,598 frontend tests / 230 files, 338 product
browser tests (193 configured skips), 144 design tests; every package, PDF,
container, architecture, formatting and committed-dist gate passed.

Release commit: `9695cd4e72091a782377912a8bff08bab5f4f6d0`.
Pushed fast-forward to remote main after checking current main ancestry and
absence of v3.22.1. Remote main matches exactly. Test/Release Build/automatic
Release Publish are now being monitored for this exact revision. No manual tag
was created; publication evidence remains pending. Integration source is frozen.

### CI attempt 1 and bounded retry plan

Test run `37961937563` attempt 1 has two independently inspected failures:
Windows Product shard 5 job `113928073943` failed at npm ci cache rename
(EEXIST/ENOENT), before tests; Windows Core job `113926686234` timed out
after five seconds in ServerAssistantRouteTests.setUp while creating a world,
before the authorization/progress assertion. The latter backend summary is
1,134 tests, one error and three skips. Neither original failure is relabeled
as success, and underlying causes are not proven. In particular, unchanged
HTTP route/test files do not rule out transitive storage/timing effects.

Coordinator read actual raw logs; Critic accepted one complete same-SHA retry
for these two jobs after every other failure is classified. Dev 3 owns that
one CI action, preserving attempt-1 evidence. Repetition of either failure
requires new diagnosis; no timeout increase, skipped test, cache manipulation,
source change or moving tag is authorized by this recovery. Main stays at
`9695cd4` and exact-revision publication acceptance is still pending.

## Final acceptance: 3.22.1 published

The one authorized retry completed successfully on the unchanged release SHA
`9695cd4e72091a782377912a8bff08bab5f4f6d0`. Coordinator independently queried
`gh run view 37961937563 --repo Tim3399/quiltor --json status,conclusion,attempt,headSha,jobs`
and asserted completed/success, exact SHA, 22 jobs and 22 successful conclusions.
Attempt 2 retained the 20 prior successful jobs. Replacement Windows Core job
`113934726156` passed the complete Backend suite and Portable core; replacement
Windows Product shard 5 job `113934727983` passed installation, unit tests and
the Product suite. Only failure-diagnostics upload was conditionally skipped.
No source, assertion or timeout was changed to obtain this result. Original
failure causes remain unresolved observations, not proven infrastructure defects.

| Delivery gate                                                                               | Result                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Test 37961937563](https://github.com/Tim3399/quiltor/actions/runs/37961937563)             | Success, attempt 2, all 22 jobs                         |
| [Release Build 37961937425](https://github.com/Tim3399/quiltor/actions/runs/37961937425)    | Success                                                 |
| [Release Publish 37965077220](https://github.com/Tim3399/quiltor/actions/runs/37965077220)  | Success                                                 |
| [Visual baselines 37961937427](https://github.com/Tim3399/quiltor/actions/runs/37961937427) | Success                                                 |
| [Public v3.22.1](https://github.com/Tim3399/quiltor/releases/tag/v3.22.1)                   | Published 2026-10-09 17:17:01 UTC; not draft/prerelease |

Remote main, publisher-created tag and release target all identify the exact
release SHA. Native macOS/Windows installers remain disabled in this source
revision; their conditional packaging skips are expected. Selected portable
Python and self-hosted OCI release targets were published. No production
deployment was performed.

### Independent public-artifact verification

Coordinator downloaded all three public assets to
`C:/Users/timra/AppData/Local/Temp/quiltor-3.22.1-release-audit-bfe9e371440e43afb8ad2b8903b32416`.
Assertions passed with exit 0 for schema-6 manifest version/source revision,
wheel/sdist hashes against the manifest and manifest hash against the GitHub
asset digest. Actual public bytes:

| Asset                             | Bytes   | SHA-256                                                            |
| --------------------------------- | ------- | ------------------------------------------------------------------ |
| `quiltor-3.22.1-py3-none-any.whl` | 3368486 | `88e3b0af90698290456bd8acdd91fe76a3d88c1bb2ed312d677edd8ad5cba3f5` |
| `quiltor-3.22.1.tar.gz`           | 3217899 | `cb5ac4895436fc919008c43af2fbbd47f638cabefffe7daf717c3f2a11094362` |
| `release-manifest.json`           | 3969    | `175ca80ae25fa31874760989f47b831a990bd8f4547c3856897a7611cf9ac0ac` |

Read-only registry inspection of both version tags exited 0 and matched the
manifest's OCI index digests:

- `ghcr.io/tim3399/quiltor:3.22.1`:
  `sha256:fa085308aa4eb41e0dba293b0a7016d37fe19ec93596cd2ea010183a835d1e66`.
- `ghcr.io/tim3399/quiltor-backup:3.22.1`:
  `sha256:4df3650dca4f3546a413711b27d5b00c6da8739d067b1cf20b2d979bd4c09835`.

Release acceptance is complete. SIM-01–06 are published; SIM-07–18, shared
normalization, cross-module deletion and S17 remain outside this assignment.
The standing versioned-plan/Lead-and-Critic approval rule remains in effect.
Final coordinator records are committed separately on `codex/roadmap-followup`;
they do not move the accepted main/tag revision or change the primary 3.22.0
product sources and existing project data.
