# Quiltor taskboard

Updated: 2026-10-09. Maintainer: coordinator. Published product baseline: 3.22.0
(`a8e9e69`). See [handover](orchestrator/handover.md) for evidence limits.

This is the coordination index for open, assigned, reviewed and completed work.
Detailed requirements remain in their linked sources. Roadmap rows are grouped
workstreams, not implementation-sized assignments: split them into stable child IDs
before delegating. No unscheduled row implies an agent is actively working on it.

## Status and ownership

- **Open**: unassigned work; the coordinator owns prioritization and scoping.
- **In progress**: a named agent is actively assigned.
- **Review**: a result exists but lead acceptance is outstanding.
- **Blocked**: work cannot continue; name the dependency and next action.
- **Deferred**: deliberately not scheduled; record the reopening condition.
- **Mitigated**: tested prevention/diagnostics are accepted, while the
  original incident's exact cause or production resolution is still unconfirmed.
- **Done**: the stated scope has passed acceptance. Delivery is separately labelled
  local, published or deployed; one never implies the others.

For every row, **Was** defines scope, **Warum** its purpose, and **Wann erledigt**
the observable acceptance condition. All open rows currently have **no assigned
implementation agent**; their owner is the coordinator until assignment. Priority
follows the source roadmap, not the order of the entire table. Calendar deadlines
are unset. Preserve completed rows as history.

Source key (line references are the 2026-10-03 inventory, not permanent anchors):

- **R** — [Product roadmap](../docs/TODO.md).
- **S** — [Follow-up sprints and acceptance](../docs/plans/roadmap-followup-sprints.md).
- **A** — [Architecture implementation plan](../docs/architecture/implementation-plan.md).
- **P** — [Project profile](../docs/PROJECT_PROFILE.md).
- **QF** — [Competition acceptance ledger](../docs/plans/competition-findings-sprints.md),
  [54-row matrix](../docs/plans/competition-findings-acceptance.md).
- **C** — [Cloud integration delivery](../docs/plans/cloud-integration-sprints.md).

## Completed code and frontend quality campaign

The owner's four-point closure assignment is complete. The
[four-point closure plan](orchestrator/four-point-closure.md) records ownership,
dependencies and acceptance: CLOSE-01 code findings, CLOSE-02 remaining UI states,
CLOSE-03 actual platform baselines/mobile review, CLOSE-04 independent safety review.
All four points are **Done**, including independent review, lead diff/evidence
inspection and the complete supported-platform CI. [Test 37216539640](https://github.com/Tim3399/quiltor/actions/runs/37216539640)
passed all 22 jobs on `c5ba722f2c22b2526a48af2aae4c9f427fb75e05` (attempt 2).
The implementation is on `codex/audit-closure-2026-10-04`; publication remains a
separate queued task. Earlier failed attempts and their evidence limits are
preserved in the [CI ledger](orchestrator/followup-ci-evidence.md).

| ID / status     | Was                                                        | Warum                                                        | Wann erledigt / accepted evidence                                                                                        |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| CLOSE-01 · Done | Resolve five editor/Python code findings                   | Remove unresolved lint and behavior risks                    | Reviewed corrections, scoped checks without suppressions, mutation proof and full contributor/CI gates passed            |
| CLOSE-02 · Done | Verify remaining rendered states and fix confirmed defects | Normal-state inspection omitted dialogs, recovery and zoom   | Eight audit cases, 20 actual zoom surfaces and negative regression controls passed; compact conflict-header fix accepted |
| CLOSE-03 · Done | Accept mobile selector and native platform references      | Windows-only evidence omitted supported platforms            | Windows/Linux/macOS images reviewed, native strict comparisons and all final Test jobs passed                            |
| CLOSE-04 · Done | Independently assess both safety investigations            | Implementation-author checks were insufficiently independent | Independent source, contention and mutation evidence accepted; critic register closed within supported topology          |

Owner priority: 2026-10-03. See [campaign scope and acceptance](orchestrator/frontend-quality-campaign.md).
The coordinator leads review and integration; agents investigate and implement.

| ID / status / owner                       | Was                                                                                | Warum                                                             | Wann erledigt                                                                                                           | Next action                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| UI-AUDIT-01 · Done · `epub_frontend`      | Inventory buttons, controls and alignment implementation across workspaces/dialogs | Find concrete drift from the approved design system               | Coverage and prioritized file-level findings distinguish defects from visual hypotheses and propose bounded corrections | Source findings reviewed; selected corrections accepted below                     |
| UI-AUDIT-02 · Done · `epub_browser_tests` | Inspect rendered wide/compact light/dark workflows                                 | Confirm what users actually see and can operate                   | Reproducible state/viewport and screenshot or geometry evidence; coverage gaps recorded                                 | Final source and rendered evidence accepted; further coverage tracked below       |
| CODE-AUDIT-01 · Done · `epub_serializer`  | Investigate async/session and cross-document risks                                 | Separate substantive bugs from architectural speculation          | New guard/reproduction evidence, prioritized findings and minimal regression/fix plans                                  | Code findings reproduced; bounded corrections accepted below                      |
| UI-COORD-01 · Done · Coordinator          | Prioritize, delegate corrections and review integrated results                     | Keep ownership clear and prevent superficial or conflicting fixes | Initial findings triaged, selected correction batch accepted with relevant checks, remaining work accurately recorded   | Initial local batch accepted; remaining coverage, lint and delivery work retained |

Accepted correction **UI-FIX-01 · Done locally · `epub_frontend`**:

- **Was:** normalize Timeline date actions, Timeline mode segments and figure/place
  priority toggles by removing competing feature-level control recipes; retain
  product layout and existing behavior.
- **Warum:** source inspection confirms duplicated visual ownership over public
  Button/SegmentedControl primitives. Timeline date actions measured 34 px before
  correction and now meet 36 px wide / 44 px compact; pressed states are distinct.
- **Wann erledigt:** narrow diff reviewed, relevant behavior checks pass and the
  browser worker verifies affected controls on the rebuilt bundle in relevant
  themes/viewports. No global token or public API redesign.
- **Ownership:** `MomentTimeFields`, `StateChangePanels`, `NodePriorityActions`,
  their targeted tests, `StoryGraph.css` and `PlaceInspector.css`. Build/server
  ownership remains with `epub_browser_tests`; capture baseline before rebuild.

Accepted safety correction **SAFE-FIX-01 · Done locally · `epub_serializer`**:

- **Was:** validate manuscript/timeline story-time references in the same SQLite
  transaction that checks the document revision and commits the change.
- **Warum:** the independent code inventory reproduced two individually valid saves
  committing an invalid reversed chapter range. Supported multi-process deployment
  reachability remains unproven; the repository-level failure is concrete.
- **Wann erledigt:** concurrent regression and mutation proof, preserved error
  contract, no partial writes/revision increments on rejection, relevant backend
  checks and lead diff review pass.
- **Ownership:** revisioned persistence seam, adapter error mapping and focused
  story-time tests. No broad transaction architecture or frontend edits.

Additional accepted corrections:

- **UI-TITLE-01 · Done locally · `epub_frontend` / `epub_browser_tests`:** compact
  chapter-title input clips the visible title at rest, without losing stored data.
  Frontend agent owns `EditorSurface.tsx/.css` and unit coverage; browser agent owns
  `chapter-title-style.spec.ts`. Done when full long titles wrap, single-line storage,
  IME/paste/keyboard/save behavior and wide typography remain correct, and a browser
  regression proves the visible failure before correction.
- **SAFE-SESSION-01 · Done locally · `epub_serializer`:** stale overlapping world loads/revisions
  can detach displayed documents from gateway identity at the code boundary.
  Confirm a focused regression and preserve existing UI guards; ordinary double-click
  reachability is not proven. See [code inventory](orchestrator/code-risk-inventory.md).
- **SAFE-CREATE-01 · Done locally · `epub_serializer`:** partial document load after world creation
  is swallowed as successful completion. Define recovery that does not create duplicate
  worlds on retry; verify failure feedback and retained context before acceptance.

Lead review accepted the title, session and retry corrections after focused tests,
mutation evidence and integration checks. Session operations and transport revisions
are generation-bound; create retry reuses the created world ID. Existing mobile
WorldGate work remains separately tracked. All campaign implementation workers have
returned; no product assignment is currently active.

Initial campaign local acceptance (2026-10-03): build passed, 228 frontend files / 1,539 tests passed;
backend discovery ran 1,098 tests (1,091 successful, 7 skipped); 9 targeted browser
cases and 1 measurement capture passed, with 2 intended browser project skips.
Exact commands, final bundle identity, screenshots and limits are recorded in the
[visual audit](orchestrator/frontend-visual-audit.md) and
[code inventory](orchestrator/code-risk-inventory.md). This does not establish CI,
publication or cross-platform visual-baseline acceptance. The 2026-10-04 follow-up
adds one UTC regression (1,099 backend tests total), eight expanded browser cases,
20 actual browser-zoom surfaces and accepted native baselines on all three systems;
the complete final CI result is recorded in the four-point closure plan.

- **AUDIT-COVERAGE-02 · Done locally · `epub_browser_tests` (CLOSE-02):** extend rendered inspection to the
  explicitly untested dialog/error/recovery states and enlarged-text cases in the
  [visual coverage ledger](orchestrator/frontend-visual-audit.md). Done when the
  selected next matrix is inspected and actionable findings are triaged; do not
  infer coverage from normal-state toolbar checks.
- **AUDIT-LINT-01 · Done locally · `epub_frontend` (CLOSE-01):** investigate three pre-existing
  `EditorSurface` session/history exhaustive-dependency findings and the two
  retained Python lint findings (`DTZ005`, `SIM117`). Determine behavior risk before
  changing dependencies; done when each is corrected or explicitly justified with
  evidence. Scoped ignores/check limits are recorded, not counted as a clean full
  repository lint run.

  Closure: all five findings corrected without command-line/source suppressions;
  source reviewed, focused checks and full Python discovery passed. See
  [code-quality evidence](orchestrator/followup-code-quality.md), including the
  failing/restored UTC mutation. Shared final frontend build and tests passed under CLOSE-02;
  full platform CI is accepted under CLOSE-03.

## Newly reported release blockers

See [release blockers](orchestrator/release-blockers-2026-10-04.md) for agent ownership and acceptance. Corrections passed the full preflight and exact-revision CI and are published in 3.22.0. Production deployment remains separate.

| ID / status                                 | Was                                                                        | Warum                                                                    | Wann erledigt                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-MAP-DELETE-01 · Done · Published        | Refuse occupied-map deletion and preserve valid empty-place cleanup        | Prevent invisible places, invalid drafts and inaccessible mobile actions | Guards, reference cleanup, true compact interaction, screenshots and direct-dist save/reload checks accepted; published in 3.22.0                                 |
| BUG-IMAGE-UPLOAD-01 · Mitigated · Published | Diagnose upload rejection; prevent oversized requests and explain failures | Production parser failures had no useful feedback or reason logging      | Prevention/diagnostics published in 3.22.0; proxy rejection excluded; exact historical parser condition remains unconfirmed and no production deployment occurred |

## Current integration and coordination queue

| ID / status / owner                    | Was                                                                                 | Warum                                                               | Wann erledigt                                                                                                                                     | Source / dependency / next action                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| COORD-01 · Done · Coordinator          | Establish durable coordination memory, taskboard and Was/Warum/Wann briefs          | Preserve decisions and prevent lost or duplicate work across agents | Source-linked board covers the inventory, local links resolve, formatting passes and the lead reviews the written records                         | Owner request 2026-10-03; inventory review, scoped formatting and local-link checks passed |
| COORD-02 · Done · `epub_browser_tests` | Independently inventory current roadmap states                                      | Separate open work from history, partial delivery and non-goals     | Return source locations, grouped open/completed/deferred work and conflicting text; no source edits                                               | Read-only inventory returned and reviewed 2026-10-03; incorporated below                   |
| DOC-01 · Open · Coordinator            | Reconcile stale “next delivery” text and partial umbrella checkboxes                | Readers currently receive contradictory sequencing                  | R/S introductions match S13–S16 evidence; completed format slices remain credited and remaining requirements stay explicit                        | R:368–369, 506–523; S:21–23; update narrowly, preserve historical evidence                 |
| MOBILE-01 · Done · Coordinator         | Accept existing responsive project-selector changes                                 | Compact project selection must remain usable                        | Source and behavior reviewed; Windows/Linux/macOS references restored and reviewed; native strict comparison and full CI passed                   | Accepted in CLOSE-03; publication separately tracked in REL-S16                            |
| REL-S16 · Done · Coordinator           | Integrate and publish the next minor delivery containing locally accepted EPUB work | Users cannot install uncommitted functionality                      | 3.22.0 committed/pushed/tagged; exact-revision Test/Build/Publish green; public assets verified; local app running with all ten existing projects | Release a8e9e69; see orchestrator/release-3.22.0.md; EXP-03 remains separate               |
| OPS-UPGRADE · Open · Coordinator       | Reconcile deployed server with the chosen release target                            | Published packages do not establish production state                | Record current deployed version; when deployment is in scope, verify backup, migration, application and public access for the chosen version      | Last verified production 3.20.0; published baseline 3.22.0; scope deployment separately    |

The active campaign above supersedes the earlier release-first queue ordering at
the owner's request. Other chats' execution states have not been checked. Preserve
the existing release work and select bounded corrections rather than opening
unrelated product features.

## Read-only simplification candidates — 2026-10-09

The Simplifier returned SIM-01–03 against `f3d4c4f` and SIM-04–06 against
`93e0f30` without edits or behavioral tests.
They are unassigned proposals, not accepted implementation. See the
[scoped candidate record](orchestrator/simplification-candidates.md).

| ID / status   | Was                                                                    | Warum                                         | Wann erledigt                                                                                                                                |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SIM-01 · Open | Share narrowly duplicated export normalization/UTF-16 helpers          | Reduce divergent maintenance in DOCX and EPUB | Characterization and regression tests preserve archives, rejection order, messages and public imports; lead reviews diff                     |
| SIM-02 · Open | Consider a narrow internal JSON POST helper                            | Reduce repeated adapter plumbing              | Preserve URLs, world selection, decoders, options and cancellation; excluded transport cases remain unchanged; focused tests and review pass |
| SIM-03 · Open | Normalize FreeDict text once per relevant value                        | Remove redundant text processing              | Blank-quote fallback, nested text, multiple heads and duplicates retain behavior; focused tests and review pass                              |
| SIM-04 · Open | Reuse the Storyboard transaction context manager for owned connections | Remove duplicate connection management        | Own commit/rollback/close and untouched caller-owned transactions proven; focused storage tests and review pass                              |
| SIM-05 · Open | Consolidate narrowly duplicated SQLite deletion/order synchronization  | Reduce divergent persistence maintenance      | Preserve ordering, rowids, references and transactions; cover empty/presence/save-deletion cases; serialize with SIM-04                      |
| SIM-06 · Open | Share active/trash chapter normalization                               | Keep chapter normalization rules consistent   | Paired edge-case tests preserve types, bounds, ordering, extensions and input immutability; review passes                                    |

## Independent critic investigations

The [critic register](critic/review-register.md) preserves its initial observations
and now contains a dated independent closure by `independent_safety_review`.
Both items are **Done** for the reviewed supported composition; see the
[independent review](orchestrator/independent-safety-review.md) for source
fingerprints, actual contention/mutation checks and supported deployment limits.
The coordinator accepted the source and evidence without changing the original
critic's historical attribution. No broad rewrite follows from either investigation.

| ID       | Was                                                                                        | Warum                                                                  | Wann erledigt                                                                                                                                                    | Source / next action                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CRIT-001 | Investigate session/world identity for overlapping opens, late responses and pending saves | A reachable identity race could apply data to the wrong world          | Reachability and controlled delayed-response cases establish correct session binding or reproduce a defect; disposition and any required regression fix reviewed | Done: independent source review, 57 focused tests and failing/restored generation mutation; see linked review             |
| CRIT-002 | Investigate cross-document validation and commit under concurrent writers                  | Separate validation and commit could admit inconsistent document pairs | A concrete invariant and supported writer topology are established; isolated interleaving proves rejection or reproduces a defect; disposition reviewed          | Done: independent source review, 16 focused tests and 20 two-service contention trials; supported-topology limit recorded |

## Open product workstreams

All rows below are **Open**, owned by the coordinator for scoping. Acceptance
includes source-specific requirements and relevant repository checks, not only the
short condition printed here. “Before assignment” names the next action/dependency.

| ID             | Was                                                                                                       | Warum                                                              | Wann erledigt                                                                                                                    | Source / before assignment                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| IMP-01         | Decide RTF usefulness and scope Scrivener import separately                                               | Support authors migrating richer projects                          | Each selected format has bounded parsing, review, integrity checks and explicit loss reporting                                   | R:391–393; decide RTF need, then split by format                                      |
| IMP-02         | Detect scene/page boundaries; preserve native hierarchy and stable source references                      | Keep source structure and provenance during richer imports         | Fixtures retain text/order, reviewed boundaries and resolvable source identities                                                 | R:401, 408–409; define richer-format contract                                         |
| IMP-03         | Append import into an existing manuscript with a prior snapshot and one undo step                         | Extend manuscripts without risking existing work                   | Cancel/failure leave existing data intact; accepted append and undo preserve notes, structure and prior content                  | R:414–415; review transactional design first                                          |
| IMP-04         | Offer world update after import with visible scan progress                                                | Avoid manually re-entering imported world knowledge                | Explicitly started scan keeps editing usable and produces the established author-reviewed proposals                              | R:419–421; reuse discovery service                                                    |
| IMP-05         | Review an editor's DOCX changes against existing chapters                                                 | Support editorial round trips without replacing linked author data | Reviewable differences preserve notes, references, story-time anchors and folders; cancellation is safe                          | R:423–427; define tracked-change semantics first                                      |
| UX-01          | Reconcile remaining heuristic, terminology, disclosure, empty-state and no-model requirements             | Reduce first-use confusion                                         | Every scoped workspace finding has evidence and an accepted fix or explicit disposition; first writing needs no world/AI setup   | R:458–469; compare existing QF/design acceptance before proposing changes             |
| UX-02          | Inventory and reduce manual bookkeeping                                                                   | Remove repeated entry without taking authorship away               | Tasks classified; selected automation/proposals are safe; before/after step counts recorded and review remains manageable        | R:471–482; use existing discovery/review behavior                                     |
| EXP-01         | Add common print trim sizes and readable world-data export                                                | Cover publishing and portable world-reference needs                | Selected output preserves ordered source content, handles unsupported data explicitly and opens correctly in the chosen consumer | R:495–502; split print and world-data scopes                                          |
| EXP-02         | Finish export presets/options and fidelity across remaining formats                                       | Keep export understandable and consistent                          | Remaining presets expose few clear options, reviewed output and specified chapter/title/format/scene behavior                    | R:504–514; credit shipped DOCX and local EPUB slices                                  |
| EXP-03         | Add pinned EPUB release validation and remaining export count checks                                      | Catch invalid deliverables before distribution                     | CI/release validates generated EPUB fixtures and fails on invalid packages; counts cover each scoped format                      | R:516–523; local EPUBCheck is already accepted, external CI integration is still open |
| STORY-01       | Add bounded Storyboard reference detection, lookup, canon comparison and promotion proposals              | Connect planning to world knowledge without making plans canon     | Exact references resolve; comparison is explicit; promotion needs author confirmation; no prose generation                       | R:715–725; reuse resolver and evidence model                                          |
| EVID-01        | Carry revision/span provenance and navigate exact evidence                                                | Make AI proposals and findings inspectable                         | Valid links open actual source spans, stale revisions are marked and manual facts remain distinguishable                         | R:855–878; assess existing partial implementations before scoping                     |
| STATE-01       | Extend temporal facts to ownership, membership, knowledge, belief, status and attributes                  | Model continuity beyond presence and relationships                 | Temporal/unknown/conflict semantics tested; objective facts, beliefs and knowledge remain distinct                               | R:884–914; resolve domain and migration design first                                  |
| REALITY-01     | Add current/selected-chapter deterministic and bounded semantic checks                                    | Reveal continuity problems without rewriting prose                 | Evidence-backed findings explain issues and navigate sources; supported conflicts and non-errors pass; no replacement prose      | R:918–959; EVID-01, relevant STATE-01 slices and benchmark fixtures                   |
| FIND-01        | Persist findings with stable fingerprints and review state                                                | Preserve author decisions across repeated scans                    | Evidence/canon links remain valid; unchanged conflicts retain dismissal; fixes navigate rather than rewrite                      | R:963–978; EVID-01 and finding contract                                               |
| RET-01         | Benchmark retrieval, evaluate FTS5/BM25 and conditional embeddings                                        | Improve source retrieval based on measured benefit                 | German/English Recall@k evidence compares candidates; filters/graph expansion work; embeddings adopted only if justified         | R:984–1021; benchmark before implementation choice                                    |
| ANALYSIS-01    | Incrementally analyze changed manuscript scopes                                                           | Avoid expensive whole-book work on every change                    | Hash/revision dependencies invalidate correctly; incremental and full rebuild converge; caches remain disposable                 | R:1025–1035; source revision and finding dependencies                                 |
| LANG-01        | Extend writing-language packs, English first                                                              | Offer local writing assistance beyond German                       | Per-language capabilities, graceful gaps, checksums/licensing and regression tests are verified                                  | R:1039–1053; choose supported capabilities                                            |
| TIME-01        | Add story durations, constraints, unknown dates and travel assumptions                                    | Express chronology the current coordinates cannot fully capture    | Supported constraints yield deterministic results including simultaneous and unknown cases                                       | R:1057–1069; also assess later calendar projections from R:210–211                    |
| SERIES-01      | Share canon across books with explicit retcons                                                            | Support series continuity without conflating manuscripts           | Book-specific order, effective canon revisions, retcons and downstream invalidation round-trip correctly                         | R:1073–1082; evidence/state foundation                                                |
| MCP-01         | Expose bounded story intelligence reads and proposals                                                     | Reuse verified app behavior through external tools                 | Each selected tool shares app authorization/domain policy; evidence resolves and mutations still require confirmation            | R:1086–1099; app services must exist first                                            |
| SYNC-01        | Add per-document sync, non-overlapping chapter merge and changed-unit transfer                            | Improve multi-device use beyond manual whole-project snapshots     | Concurrent/offline fixtures converge safely; ambiguous overlap is reviewed; local writing remains independent                    | R:1110–1146; BACKUP-01 and explicit merge contract                                    |
| BACKUP-01      | Deliver canonical snapshot units v3 with compatibility and contracts                                      | Deduplicate changes and enable smaller transfers                   | Round-trip/fresh-machine restore preserves all units; one chapter edit adds only affected units/index; v1/v2 remain readable     | R:1173–1226; freeze storage contract and history boundary                             |
| BACKUP-02      | Add safe retention and automatic local snapshots                                                          | Bound history growth while retaining recovery points               | Retention edge fixtures pass; thinning is locked; comparisons find retained predecessors; auto-snapshots are bounded             | R:1228–1252; preserve existing 40 rotating SQLite copies                              |
| BACKUP-03      | Add encrypted envelopes, recovery keys and retryable upload queue                                         | Keep server storage unreadable while permitting recovery           | Cross-client vectors and fresh-machine recovery pass; server receives no plaintext; interruption/retry is safe                   | R:1124, 1254–1303; BACKUP-01, reviewed threat/key-recovery design                     |
| BACKUP-04      | Add server retention, race-safe GC, quota/usage and confirmed deletion                                    | Control remote storage without losing live snapshots               | Retention/GC race tests pass; usage is accurate; deletion is explicitly confirmed                                                | R:1305–1321; BACKUP-03 protocol                                                       |
| SUB-01         | Define renewal/cancellation and complete local data after subscription expiry                             | Preserve author ownership throughout paid-service lifecycle        | Renewal/cancellation flow is clear and worlds remain complete/editable locally after expiry                                      | R:1126, 1340–1342; DEF-COMMERCIAL decision before implementation                      |
| HOST-SAFETY-01 | Warn about data/backup folders in external sync services                                                  | Reduce unsafe concurrent filesystem synchronization                | Supported synced-folder paths produce an actionable warning without blocking normal local writing                                | R:1345–1348; define detection support per platform                                    |
| P3-01          | Productize with sample project, first-run paths, AI onboarding and signing                                | Make mature core workflows easier to adopt and install             | Scoped onboarding paths work, sample demonstrates real behavior, required artifacts satisfy selected signing gates               | R:1371–1383; signing credentials are external dependencies; pilot is DEF-S17          |
| P3-MAP-01      | Add uploaded Places backgrounds with anchored resize/scale and backup                                     | Let authors use their own map artwork                              | Image and anchors persist/restore; resizing retains place alignment and measured distances                                       | R:1385–1391; P3 only, preserve core priorities                                        |
| QUALITY-01     | Build continuity benchmark with errors and expected non-errors                                            | Measure reliability rather than trusting plausible AI output       | Evidence links all resolve; deterministic outcomes reproduce; quality metrics recorded; no unconfirmed canon/prose mutation      | R:1395–1431; feed relevant REALITY/RET slices                                         |
| CAND-01        | Triage authorship history, passage search, timeline answers, performance, support and maintenance signals | Address evidence-backed competitor pain points                     | Each candidate is scoped, credited if already delivered, prioritized or explicitly deferred with evidence                        | R:1435–1460; split into individual tasks before feature work                          |

## Open engineering workstreams

All are **Open**, with coordinator ownership until a bounded assignment is sent.

| ID           | Was                                                                         | Warum                                                                | Wann erledigt                                                                                                              | Source / dependency / next action                                                  |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ENG-ARCH     | Reconcile and deliver remaining architecture phases                         | Folder cutover does not prove application/persistence/core evolution | Each assigned vertical slice meets its own exit gate and preserves existing public contracts                               | A phase gates; R:45–49; inspect current implementation per phase before scheduling |
| ENG-START    | Validate startup config, owned probes, Python selection and process cleanup | Avoid stale/wrong servers and unsafe concurrent sessions             | Missing dependencies, occupied ports, early exits, cleanup and isolated concurrent sessions have passing platform fixtures | P:85–112, 137–139; separate configuration and platform ownership                   |
| ENG-BUILD-ID | Embed deterministic frontend identity and detect all stale generated output | Backend version alone cannot identify served client code             | Sources/mode/version identify built frontend; updater rollback works; stale tracked and untracked assets fail checks       | P:123–126, 140–141; retain committed dist until distribution changes               |
| ENG-FORMAT   | Decide formatter ownership for remaining file types                         | Keep formatting reproducible without unrelated churn                 | Selected compatible formatter is exactly pinned and scoped checks pass; unsupported types retain documented conventions    | P:142; conditional on changing those formats                                       |

Full release preflight is part of REL-S16 and every future release task, not a
separate claim of delivered functionality. Existing broad-lint findings mentioned
in S16 evidence need confirmation before creating a bug-fix assignment.

## Deferred / decisions needed

| ID / status / owner                            | Was                                           | Warum                                                                   | Wann erledigt                                                                                                       | Source / reopening condition                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEF-S17 · Deferred · Owner decision            | Real-author pilot and observed friction fixes | Automated tests cannot establish first-use understanding                | Actual participant outcomes and linked verified corrections recorded; protocol differences resolved before sessions | Owner 2026-10-03; [unrun pilot proposal](../docs/plans/author-pilot.md), R:442–456, P3 closed pilot; reopen only when owner resumes                             |
| DEF-NOTIFY · Deferred · Owner decision         | Extra operational notification channels       | Add alerts only when they meet an actual operating need                 | Requested channels have verified routing and useful failure notification                                            | S:14–20; current public status page accepted as sufficient                                                                                                      |
| DEF-COMMERCIAL · Deferred · Owner decision     | Managed hosting/billing/subscription offer    | Product and operational commitments need explicit decisions             | Price period, storage, retention, hosting and launch terms chosen; separate delivery gates satisfied                | C:21–24; [pricing concept](../docs/plans/cloud-pricing-concept.md), [release gates](../docs/plans/cloud-release-gates.md); no implementation assumed authorized |
| HOSTED-AI-01 · Deferred · Conditional proposal | Evaluate a stronger hosted assistant          | Determine whether measured benefit justifies optional remote processing | Benchmarks show benefit; opt-in/privacy/local independence and proposal-only boundaries are verified                | R:1352–1367; quality/retrieval evidence and owner product decision                                                                                              |

## Completed work and scope of completion

These are grouped historical deliveries, not a fabricated commit-by-commit archive.
Use the source acceptance ledgers for their individual findings and detailed checks.

| ID / status                      | Was                                                                                           | Warum                                                      | Wann erledigt / recorded outcome                                                 | Evidence / delivery scope                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| DONE-P0-ARCH · Done              | Repository architecture cutover and enforced boundaries                                       | Separate product, host, platform and distribution concerns | Cutover checklist accepted; future phases remain ENG-ARCH                        | R:43–64; repository baseline                                                                                |
| DONE-P0-DOMAIN · Done            | Product invariants, temporal canon/calendars, world state, resolution and resolve-first tools | Ground safe story intelligence in deterministic state      | Listed P0 acceptance met, unknown state and author control preserved             | R:149–282; later generalized facts remain STATE-01                                                          |
| DONE-P0-DISCOVERY · Done         | Manuscript-to-world scans and proposal review                                                 | Reduce duplicate author bookkeeping                        | Bounded scans resolve entities and preserve explicit claim/canon review          | R:286–346                                                                                                   |
| DONE-P1-WRITER · Done            | Shared Notes, figure workspace, core Storyboard and chapter organization/navigation           | Connect everyday author workflows                          | Foundational delivery accepted; later Storyboard intelligence remains open       | R:362–366, 530–851                                                                                          |
| DONE-QF · Done                   | Safety, workflow and design follow-up                                                         | Correct observed friction and protect author data          | Seven sprint outcomes and 54-row matrix accepted                                 | QF final integrated acceptance 2026-09-19 supersedes earlier pending notes                                  |
| DONE-CLOUD-MANUAL · Done         | Manual project synchronization and conflict review                                            | Offer explicit cross-device transfer                       | S7–S11 accepted within manual snapshot/head scope                                | C:9–34; shipped 3.20.0; no automatic sync/billing claim                                                     |
| DONE-OPS-320 · Done              | Deploy 3.20.0 and verify migration/backup                                                     | Operate the accepted server release safely                 | App/backup version, public access, backups and migrated copies verified          | R:12–17; deployed 2026-10-02 only                                                                           |
| DONE-S12 · Done                  | Reconcile status and roadmap                                                                  | Establish an accurate delivery baseline                    | Existing status-page scope accepted and delivery facts separated                 | S:14–20, 29–31                                                                                              |
| DONE-S13 · Done                  | Safe reviewed DOCX import                                                                     | Let authors bring existing manuscripts                     | Bounded parsing, counts/loss review and atomic new-world publication accepted    | S13 acceptance; published 3.21.0                                                                            |
| DONE-S14 · Done                  | Markdown/TXT import with reviewed splits/folders                                              | Support text workflows with controlled chapter structure   | Text/order/format/source integrity and reviewed hierarchy accepted               | S14 acceptance; published 3.21.0                                                                            |
| DONE-S15 · Done                  | DOCX editor and Normseite export                                                              | Exchange manuscripts with editors                          | Revision-bound export, warning review and Normseite calibration accepted         | S15 acceptance; published 3.21.0                                                                            |
| S16 · Done · Published           | Reviewed EPUB export                                                                          | Produce portable reflowable reading copies                 | Package/browser tests and local EPUBCheck passed; source preserved               | Published in 3.22.0; pinned external EPUB CI validation remains EXP-03                                      |
| DONE-WEBSITE · Done on test site | B825 Quiltor project showcase                                                                 | Present the product and its downloads                      | Project page, images and repository/release links verified in prior website task | [Test site](https://webside-test.bananenban.de/projekte/quiltor); regular-domain TLS issue remains external |

## Coverage and guardrails

- Every unchecked product requirement in R is represented by the open/deferred
  groups above or by the constraints below. Nested examples belong to their parent
  group. Detailed source checklists remain authoritative for that group's scope.
- R:729–732 describes story/prose generators under “do not build”; R:1101–1106
  prohibits manuscript-writing and unrestricted mutation tools. These are permanent
  non-goals, not forgotten implementation tasks.
- R:1249 preserves 40 rotating SQLite copies; R:1391 preserves map-background P3
  priority. Neither is a separate feature request.
- R milestones A–F summarize dependencies. Do not create duplicate tasks for the
  same underlying deliverables. The older author-study list and S17 protocol must
  be reconciled when DEF-S17 resumes, not silently combined now.
- P's 3.16.3 value is explicitly historical “at adoption,” not today's version.
  Earlier QF pending notes are likewise historical. Broad unchecked export/UX
  requirements do not erase the accepted DOCX/EPUB/design slices.
- Exact-revision Linux/macOS/Windows CI and release pipelines passed for 3.22.0.
  No physical-reader EPUB validation or production upgrade above 3.20.0 is claimed.

## Change log

- 2026-10-09: Published 3.22.0 after the complete supported preflight and green
  exact-revision Test/Release Build/Release Publish workflows. Verified public
  assets and local startup with all ten original projects. Recorded the published
  map fix and upload mitigation; production deployment remains separate. Queued
  three read-only Simplifier candidates without assigning implementation.

- 2026-10-03: Accepted the initial delegated quality batch locally after source,
  rendered and regression review. Retained additional coverage, lint, platform
  baselines and publication as separate unfinished work.
- 2026-10-03: Created from current source documents, prior acceptance evidence and
  independent read-only agent inventory. Established ownership and completion
  semantics; preserved S17 deferral and separated local work from publication.
