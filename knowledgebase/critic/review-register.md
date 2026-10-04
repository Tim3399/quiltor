# Critic review register

Initial state on 2026-10-03, based on the working tree identified in [project onboarding](project-onboarding.md). No runtime defect is claimed as confirmed by this first familiarization. Investigation priority reflects potential impact, not proven defect severity.

## CRIT 001 World identity during asynchronous operations

**Status:** investigating. **Category:** session ownership and possible concurrency failure. **Investigation priority:** high because saves must remain attached to their originating world.

**Observed evidence:** `packages/client/src/app/world/useWorldSession.ts:28` selects a world before loading its three documents and later publishes the result. `packages/client/src/platform/http/worlds.ts:8` mutates `activeWorldId`. `packages/client/src/platform/http/request.ts:14` and `:19` derive request identity from that mutable state. `platform/http/createHttpApplicationGateway.ts` shares the state between the individual gateways. `docs/architecture/target-component-model.md:64` already records client composition and mutable global client ownership as existing debt.

**Question and possible impact:** Can an overlapping world load, late response or pending autosave outlive its intended session and publish or save under a different active world? The reviewed hook has no explicit load generation check. This observation alone does not establish an externally reachable race or data loss.

**Strongest defense:** `modules/story-world/worlds/WorldGate.tsx:56`, `:72` and `:215` track busy state and disable normal selection during work. Other callers, world-close behavior, save draining and backend revision rejection may prevent the hypothesized failure. Those defenses must be traced before demanding a redesign.

**Required evidence:** Use deferred responses to exercise two overlapping opens, close during an open, a failed load followed by another open, and edits while switching. Trace actual UI reachability and inspect outgoing world IDs, applied responses and revisions. Assert that each response/save belongs to its originating session and that stale operations cannot replace the current document.

**Proportionate remedy if confirmed:** Bind operation identity and response acceptance to a specific session; consider a generation guard or scoped gateway before introducing the full proposed class model. Do not replace the application architecture without evidence that a smaller correction is insufficient.

## CRIT 002 Cross document validation and commit

**Status:** investigating. **Category:** transaction ownership and possible concurrency failure. **Investigation priority:** high because canonical document invariants may span aggregates.

**Observed evidence from the backend source review:** `src/quiltor/application/documents/use_cases.py:81` loads the counterpart document and validates the pair before the repository save at `:100`. `src/quiltor/infrastructure/persistence/adapters/documents.py:52` delegates that save to `sqlite/revisions.py:38`, where the write transaction begins. `src/quiltor/delivery/http/routes/documents.py:89` uses a process-local lock. `docs/architecture/target-component-model.md:69` and `views/application-and-persistence.md:333` already discuss the missing atomic commit owner.

**Question and possible impact:** If two supported hosts or processes write one world, can the counterpart change between validation and commit so the final pair violates the checked invariant? The critical interval is structurally present; a production failure and supported concurrent access path have not been demonstrated.

**Strongest defense:** A single process with complete locking may serialize supported writes, and optimistic revision checks protect the aggregate being written. Runtime restrictions might exclude multiple writers. The exact cross-document invariant and writer topology must be established rather than assumed.

**Required evidence:** Identify a concrete invariant and two valid inputs whose interleaving would break it. Use an isolated temporary database and two independent connections or processes to pause after validation, commit the counterpart and resume. Check whether existing locks/revisions reject the stale operation. Review web, MCP, desktop and background writers for shared enforcement.

**Proportionate remedy if confirmed:** Validate against the same transactional snapshot as the canonical commit or compare all invariant-relevant revisions atomically. A new repository boundary is justified only if it makes this ownership enforceable; merely moving files does not fix the interval.

## Review decisions

- Existing architecture and platform checks passed, but do not close either investigation.
- Existing technical-debt entries are useful context, not independent proof of a defect or authorization for a broad rewrite.
- No product code was changed during onboarding. Future findings must identify the exact current code and distinguish concurrent work from the reviewed snapshot.

## Independent closure disposition — 2026-10-04

This disposition was authored independently during CLOSE-04 after SAFE-SESSION-01,
SAFE-CREATE-01 and SAFE-FIX-01. It supplements the historical observations above; it does
not attribute the later verification or conclusions to the original critic. The complete
source trace, supported-writer analysis, hashes and commands are in the
[independent safety review](../orchestrator/independent-safety-review.md).

- **CRIT-001: closed, current-source pass.** Hook operation generations reject stale world
  publication and errors. HTTP selection generations preserve request world identity across
  A→B→A and same-ID reselection, and late load/save responses cannot publish obsolete
  revisions. Failed creation retains and reopens the created ID instead of creating a
  duplicate. The supported UI drains pending saves before close and exposes selection only
  without an active world. Focused tests passed 57/57; independently disabling selection
  generations reproduced the stale-revision failure and the mutation tool restored the
  reviewed source.
- **CRIT-002: closed, current-source pass.** The canonical SQLite save takes
  `BEGIN IMMEDIATE`, checks the selected revision, loads and validates the counterpart through
  the same connection, then writes the aggregate and revision in that transaction. An
  independent 20-run reproduction with two separately composed services and repositories over
  one database produced exactly one commit and one domain conflict per run, observed both win
  orders, and never persisted an invalid pair. The focused backend suites passed 16/16.
- **Residual unsupported topology limitation.** Whole-world restore and synchronization use
  validated staged file replacement under the supported single-web-process lock. Multiple
  independent web processes sharing one local data directory are not an advertised deployment;
  supporting that topology would require a separate interprocess publication lock. This does
  not reopen the corrected aggregate-save race.
