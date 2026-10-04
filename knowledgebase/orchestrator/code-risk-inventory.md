# Code risk inventory

Reviewed: 2026-10-03. Scope: CODE-AUDIT-01, a narrow review of client world-session
async/error handling and the backend cross-document validation boundary. This record adds
evidence to CRIT 001/002 without replacing the critic register. The initial inventory
was read-only; the correction status and acceptance sections below record subsequent
implementation. On 2026-10-04 the [independent safety review](independent-safety-review.md)
accepted the corrected source and closed both investigations for supported use.
Trigger descriptions, minimal remedies and sequencing below preserve the original
finding history; they are not additional unfinished assignments.

## Reviewed ownership map

| Flow                                | Current owners and boundary                                                                                                                                                                                                                                                                                                | Existing defense                                                                                                                                                                                   | Missing proof or ownership                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open/create/import a world          | `app/world/useWorldSession.ts` selects the shared gateway world, loads three documents and publishes them to `app/Application.tsx`; `platform/http/request.ts` owns one mutable world ID and three revision slots for all HTTP adapters.                                                                                   | `WorldGate.tsx` disables ordinary selection actions while its local `run` is pending. Returning to selection drains all three autosave lanes before `session.close()` (`Application.tsx:308-331`). | The hook has no operation generation or scoped session identity. Current tests cover one successful open/import and one partial Storyboard failure, but no overlapping or stale completion. |
| Document load/save                  | `platform/http/documentTransport.ts` captures the current world in each request URL, then writes response revisions back into shared slots; autosave later reads those slots.                                                                                                                                              | Each save sends `If-Match`; the server checks the revision of the document being saved.                                                                                                            | The revision slot is not keyed by world, and response acceptance is not tied to the currently displayed session.                                                                            |
| Cross-document story-time invariant | `application/documents/use_cases.py` reads the counterpart and calls `story_time_anchor_issue`; `infrastructure/persistence/sqlite/revisions.py` later starts the write transaction and checks only the written aggregate revision. HTTP serialization is owned by `delivery/http/routes/documents.py` through `app.lock`. | One web runtime serializes its document routes. SQLite foreign keys with `ON DELETE RESTRICT` prevent removal of timeline IDs referenced by chapters.                                              | Validation and commit do not share a SQLite snapshot. The lock is process-local and repository/application callers do not carry the lock boundary.                                          |

The target architecture already assigns active-world/draft/revision ownership to one
`WorldEditorSession` and transaction ownership to a scoped commit repository
(`docs/architecture/implementation-plan.md:33,46-53,140,210-245`). The findings below do
not justify implementing the full target model ahead of its gates.

## Prioritized findings

### RISK-FE-001 — stale world loads can detach displayed state from gateway identity

**Priority:** P1 integrity risk at the hook/gateway boundary. Normal selection UI reachability is
constrained; direct hook callers and future callers remain unsafe.

**Status:** corrected by SAFE-SESSION-01 on 2026-10-03. World loads now have hook generations;
only the current generation may select/publish a world or own its load error. Close and unmount
invalidate pending work, including the initial requested-URL load. The HTTP document transport
captures a separate selection generation for each request, resets revisions on every selection
(including same-ID reselection), and accepts load/save revision updates only for the current
world-generation pair. Known `peek()` results retain private selection provenance and
`adoptPersisted()` rejects obsolete results with the existing retryable conflict semantics;
explicit untracked versioned values retain the public adoption behavior.

**Concrete trigger and evidence.** Start `open(A)` and `open(B)` before either finishes. Let A's
`worlds.open` resolve first, so `useWorldSession.ts:33` selects A and dispatches A's three loads.
Let B's open resolve next, selecting B and dispatching B's loads. Finally resolve B's document
loads before A's. The hook publishes B and then late A (`:34-54`), while the shared
`activeWorldId` remains B. `documentTransport.ts:107-110` also accepts every late load revision
into the unkeyed slots in `request.ts:6-11`. The rendered drafts can therefore belong to A while
subsequent autosaves target B. If A and B happen to have equal per-document revisions,
`If-Match` does not distinguish their identities and can accept A's payload for B. A late failed
operation likewise overwrites `loadError` after a newer success and can replace the workshop
with the error boundary.

This is a deterministic state-machine defect; the exact deferred-response regression is absent.
`WorldGate.tsx:70-79,215-216` is the strongest defense because it disables normal repeated
selection while awaiting `onOpen`. Initial URL opening also hides the selection gate. However,
the exported hook methods can overlap, `projectImported` is another load entry point, and the
identity/revision state itself has no defense. UI reachability through two real pointer actions is
therefore **not yet proven** and should not be claimed as a production incident.

**Minimal remedy.** Give `loadWorld` a monotonically increasing generation and accept documents,
errors and `setWorld` only for the latest generation. Bind each document request/revision to the
selected world (a small world-keyed session state or scoped document gateways) before autosave
is enabled. A generation guard alone prevents stale publication but does not make shared late
revision writes safe.

**Meaningful regression.** In `useWorldSession.test.tsx`, use deferred open and document promises
for two IDs, resolve them in both opposite orders, and assert exactly one latest publication,
latest error ownership, and selected ID. At the HTTP adapter boundary, resolve A's load after B's
and assert B's save uses B's revision and world query. A mutation check should remove the
generation/world key and make the regression fail.

**Bounded implementation ownership:** one frontend worker owns
`app/world/useWorldSession.ts`, its tests, and the smallest necessary world-scoping change in
`platform/http/{request,documentTransport}.ts` plus their tests. Do not combine this with the
planned broad client-composition rewrite.

### RISK-BE-001 — concurrent valid saves can commit an invalid story-time range

**Priority:** P1 canonical-integrity boundary defect. Repository-level reproduction is confirmed;
whether two independent canonical writers are a supported deployed topology remains **unproven**.

**Status:** corrected by SAFE-FIX-01 on 2026-10-03. `revisions.save_with_revision` now acquires
`BEGIN IMMEDIATE`, checks the selected aggregate revision, loads the counterpart through that
same caller-owned connection and validates the proposed pair before writing. The adapter maps the
persistence conflict back to the existing `InvalidChapterStoryTime` code and params. The external
multi-runtime reachability remains unproven; this correction is a canonical-boundary defense, not
evidence of a production incident.

**Concrete trigger and evidence.** Begin with moments `past(time=-10)` and `future(time=10)` and
an unanchored manuscript. Writer F validates a figures update that swaps the two times against
the still-unanchored manuscript. Concurrent writer M validates a manuscript range
`past -> future` against the old timeline. Pause both after validation and release both repository
saves. Both independent expected revisions are `0`, both commits succeed as revision `1`, and the
final `story_time_anchor_issue` is `reversed_range` for chapter `range`.

This was reproduced with a temporary SQLite database, two `DocumentUseCases.save` calls and a
barrier immediately before `SQLiteDocumentRepository.save`; observed output was:

```text
revisions 1 1
final_issue reversed_range range
```

The structural interval is `use_cases.py:82-101`; `revisions.py:45-46` begins the transaction
after validation and compares only `revision(kind)`. The strongest defenses narrow impact:

- HTTP reads/writes use one process-local `app.lock` (`routes/documents.py:37,89`).
- chapter foreign keys reject deletion of referenced moments
  (`sqlite/schema.py:34-35`; covered in `test_chapter_story_time.py`).
- MCP is read/proposal-only, and cloud synchronization uses the web runtime's local lock around
  local mutation.

Those defenses do not protect two web processes sharing a data directory or direct application
service callers. The repository accepts both writes, so the boundary is unsafe even though the
supported external multi-writer topology still needs an explicit product disposition.

**Minimal remedy.** Execute the cross-document check inside the same `BEGIN IMMEDIATE`
transaction that writes the selected document and revision. The repository can load the
transactional counterpart and validate the resulting pair before commit. Merely comparing the
counterpart revision outside that transaction leaves another check/write interval. This focused
operation can precede a generalized `WorldCommitRepository`.

**Meaningful regression.** Add the barrier interleaving above to
`tests/python/test_chapter_story_time.py` using two independent connections/services. Assert that
one operation rejects or retries and that the final pair has no issue. Keep the existing foreign
key deletion test because it proves a separate defense. A mutation moving validation back before
`BEGIN IMMEDIATE` must fail the new test.

SAFE-FIX-01 added that two-order regression. Both stale-validation orders now leave one winning
revision at `1`, one rejected revision at `0`, and a valid persisted pair. Disabling the
transactional validation produced two expected test failures before the mutation tool restored the
source.

**SAFE-FIX-01 acceptance evidence.** The accepted source was frozen in
`sqlite/{revisions,manuscript,story_world}.py`, `persistence/adapters/documents.py` and
`tests/python/test_chapter_story_time.py`. Verification on that exact source was:

- `.venv-desktop\Scripts\python.exe -m unittest discover -s tests/python -t tests/python`:
  `Ran 1098 tests in 224.161s`, `OK (skipped=7)` — 1,098 total, 1,091 executed
  successfully and 7 skipped.
- `.venv-desktop\Scripts\python.exe -m unittest tests.python.test_chapter_story_time tests.python.test_document_transaction_safety -v`:
  15 tests passed. The adjacent persistence selection (`test_document_transaction_safety`,
  `test_chapter_story_time`, `test_storage_failures`, `test_storyboards_storage`) passed 27 tests.
- `node tools/dev/mutate.mjs src/quiltor/infrastructure/persistence/sqlite/revisions.py --from '        if kind in {"manuscript", "figures"}:' --to '        if False:' -- .venv-desktop\Scripts\python.exe -m unittest tests.python.test_chapter_story_time.ChapterStoryTimePersistenceTests.test_cross_document_validation_and_save_share_one_transaction`:
  both ordered subtests failed because `InvalidChapterStoryTime` was not raised; the mutation tool
  restored the source and reported that the test bites.
- Ruff formatting passed for all five Python files. Scoped Ruff checking passed with
  `--ignore DTZ005,SIM117`; those ignores cover an existing `datetime.now()` in restore revision
  handling and an existing nested `with` in the test file, neither changed by SAFE-FIX-01.
  `git diff --check` also passed for the owned files.

This evidence establishes the repository-boundary correction and its regression protection. It
does not establish that multiple runtimes sharing a data directory are a supported or reachable
deployment topology, and it is not evidence of a production incident.

**Bounded implementation ownership:** one backend worker owns the document repository/use-case
transaction seam and `test_chapter_story_time.py`. Exclude synchronization redesign, generic
commit plans and unrelated aggregate migrations.

### RISK-FE-002 — failed initial load after creation is reported as successful completion

**Priority:** P2 recovery/feedback bug.

**Status:** corrected by SAFE-CREATE-01 on 2026-10-03. Once creation succeeds, the hook retains
the created identity while its initial document load is recoverable. A failed load now rejects so
the existing create sheet remains open with its actionable error; a retry with the same title and
backup URL opens that retained ID instead of creating another world. A newer operation, close or
unmount clears the recovery identity, so stale creation cannot revive or seed a later retry.

**Concrete trigger and evidence.** `useWorldSession.create()` calls `loadWorld` with the default
`rejectOnFailure=false` (`useWorldSession.ts:28-29,89-92`). If world creation succeeds but any of
the three document loads fails, `loadWorld` sets `loadError` and resolves (`:55-58`). The create
form awaits that resolved promise and closes its sheet (`WorldGate.tsx` create submit callback),
although no world was opened. The world may now exist, leaving the author at selection with a
generic load error and no retained creation context.

The strongest defense is that `projectImported` explicitly requests rejection and remains open on
load failure (`useWorldSession.ts:143-150`); partial-world tests also prove documents are not
published when one load fails. No corresponding create-failure test exists. This finding follows
directly from promise semantics; a browser reproduction was not run in this read-only audit.

**Minimal remedy.** Preserve the identity returned by successful world creation and retry opening
that same world when document loading fails. Merely switching `create` to the rejecting load form
would keep the sheet open but allow a naive submit retry to create a duplicate world. Replace the
boolean mode with an explicit created/opening result or otherwise separate creation from retryable
loading, while preserving the existing author-facing `loadError` assignment.

**Meaningful regression.** Add a hook test where `worlds.create` succeeds and one document load
rejects, plus a `WorldGate` integration test asserting that retry reuses the returned world ID,
does not call `worlds.create` twice, and opens after document loading recovers. Mutation back to
the swallowing mode must lose that recovery state and fail the test.

**Bounded implementation ownership:** the frontend session worker may take this alongside
RISK-FE-001 because it owns the same two files; keep the patch independently reviewable.

## Disposition and sequencing

SAFE-SESSION-01 and SAFE-CREATE-01 close RISK-FE-001 and RISK-FE-002 at the reviewed hook and HTTP
transport boundaries. SAFE-FIX-01 closes the identified repository-boundary gap for RISK-BE-001
without resolving the separate deployment-topology question. These corrections do not implement
the broader planned `WorldEditorSession` architecture.

The focused acceptance run
`node_modules\.bin\vitest.cmd run packages/client/src/app/world/useWorldSession.test.tsx packages/client/src/platform/http/documents.test.ts packages/client/src/platform/http/worlds.test.ts`
passed 57 tests. Before implementation, the added regressions produced five failures across
session publication/create retry, load/save revision ownership and same-ID reselection. Mutations
that disabled close invalidation, late-load revision gating, late-save revision gating, stale-peek
rejection and created-ID reuse each made their corresponding regression fail before the mutation
tool restored the source. Scoped Biome checking and
`node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json` passed. No build, server or full frontend
suite was run; integrated build/test remained with the browser owner.

1. Fix RISK-FE-001 before adding new world-switch entry points. Its smallest safe slice is stale
   response rejection plus world-keyed revision ownership.
2. Decide whether multiple web runtimes may share one data directory. Regardless of that product
   answer, place the story-time check in the write transaction before exposing another canonical
   writer; the confirmed repository race is a narrow Phase 2 safety item.
3. Correct RISK-FE-002 with the session work or as a separate small patch.

No broad `WorldEditorSession`, command bus or generalized commit-plan migration is warranted by
this audit alone. The concrete risks come from two missing ownership checks and one inconsistent
promise contract.
