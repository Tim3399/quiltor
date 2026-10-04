# Independent safety review — CLOSE-04

Reviewed 2026-10-04 against the dirty shared checkout after SAFE-SESSION-01,
SAFE-CREATE-01 and SAFE-FIX-01. This is an independent disposition of CRIT-001 and
CRIT-002. It does not rewrite the original critic observations and makes no claim that a
production incident occurred.

## Disposition

| Investigation                                            | Disposition                                                             | Basis                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRIT-001 — world identity during asynchronous operations | **Pass; close the investigation for the supported client composition.** | Stale session publication and shared revision adoption are guarded by independent generations. Create retry retains the created identity without duplicating the world. Focused tests and a mutation check exercise overlapping loads, close/error invalidation, A→B→A, same-ID reselection, late save/load revisions and stale conflict adoption. |
| CRIT-002 — cross-document validation and commit          | **Pass; close the identified canonical-save race.**                     | The repository now takes SQLite's writer lock before loading and validating the counterpart, then writes the selected aggregate and its revision in that transaction. An independent two-service reproduction ran 20 contended saves; every final pair was valid and each run had exactly one commit and one domain conflict.                      |

No actionable defect remains in the reviewed corrections. The residual constraints below are
real boundaries to preserve, rather than evidence that either correction failed.

## CRIT-001 evidence

`useWorldSession` increments one hook-owned generation for open, create, import and close.
Selection results, document publication and errors are accepted only while that generation is
current; unmount and close invalidate outstanding work
(`packages/client/src/app/world/useWorldSession.ts:27-28,43-51,70,106-107,115-141,194-215`).
A successful create records its returned world before loading documents. A retry with the same
title and backup URL opens that ID, while a new operation, close or unmount clears it. Therefore
a document-load failure rejects to the still-open create sheet without issuing a second create.

The HTTP state increments `selectionGeneration` and resets all revisions on every selection,
including A→B→A and A→A (`platform/http/request.ts:24-39`). Each load/save captures
`{worldId, generation}` before issuing its request. Its URL therefore remains attached to the
originating world, and a late successful response updates the shared revision only if the pair is
still current (`platform/http/documentTransport.ts:61-62,91-128,138-150`). A pending save also
captures its expected revision at invocation (`:154`); switching worlds cannot redirect that
already-issued request or publish its late revision.

Conflict inspection has the same provenance rule. Values returned by `peek()` are tracked by
identity, and `adoptPersisted()` rejects a tracked result from an obsolete selection with the
existing retryable `document.revision_conflict`. Explicit caller-constructed versioned values
retain the established public adoption behavior (`documentTransport.ts:21-31,56,143-151`). The
application passes the exact tracked object during recovery.

The supported UI does not expose an in-editor world switch. `WorldSessionBoundary` mounts the
selection gate only without a current world (`WorldSessionBoundary.tsx:59`), gate actions share
the `busy` exclusion (`WorldGate.tsx:56,73,128,215`), and returning to selection drains all three
autosave lanes before `session.close()` (`Application.tsx:308-331`). This establishes the
supported pending-save topology rather than assuming arbitrary callers.

The focused frontend run passed all 57 tests. The relevant regressions are at
`useWorldSession.test.tsx:87-278`, `documents.test.ts:663-766`, and
`worlds.test.ts:84-101`. Independently mutating selection generation to remain constant made the
A→B→A revision test use revision 10 instead of the current revision 30; two tests failed and the
mutation tool restored the source.

### CRIT-001 residual constraints

- The HTTP document gateway associates data with the world selected when `save()` is called. It
  cannot infer that an arbitrary model object originated in an earlier world. Any future direct
  world-switch entry point must keep the existing flush-before-select rule or introduce a scoped
  session gateway. The current application composition satisfies that rule.
- Provenance on `peek()` is intentionally object-identity based so explicit untracked adoption
  remains compatible. New recovery code must pass the returned object itself, as the current
  application does, rather than clone it before adoption.

These are API usage constraints. Neither is reachable as silent cross-world persistence through
the reviewed UI flows.

## CRIT-002 evidence

`save_with_revision` opens the connection, executes `BEGIN IMMEDIATE`, checks the selected
aggregate revision, loads the manuscript/figures counterpart through that same connection,
validates the proposed pair, and only then writes the selected aggregate and revision
(`sqlite/revisions.py:46-80`). Both document loaders accept and preserve a caller-owned
connection (`sqlite/manuscript.py:16-17,65-71`; `sqlite/story_world.py:18-19,505-513`). The
adapter maps the persistence conflict to `InvalidChapterStoryTime` without losing its document,
reason, chapter or moment parameters (`persistence/adapters/documents.py:60-72`). Exceptions
leave the connection context to roll back the transaction.

The accepted regression runs both commit orders and asserts one revision remains zero plus a
valid final pair (`tests/python/test_chapter_story_time.py:266-326`). The adjacent transaction
suite also covers rollback after mid-document failure and same-revision writers. The focused
backend run passed 16 tests.

For independent reproduction, a temporary script constructed two distinct `DocumentUseCases`
instances and two distinct `SQLiteDocumentRepository` instances over the same temporary
database. Both passed outer validation before a barrier and then contended with separate SQLite
connections. Across 20 runs, the figures write won 9 times and the manuscript write won 11 times;
every run produced exactly one revision-1 commit, one `InvalidChapterStoryTime`, and no final
`story_time_anchor_issue`. The temporary script was removed after the run.

### Supported writer topology

- Web document reads and writes are serialized by the one `WebApplication` lock
  (`delivery/http/routes/documents.py:37,89-92`). The server is threaded, but one application and
  lock are constructed per process (`bootstrap/web.py:304-327`;
  `hosts/web/server.py:629,670`). Source, CLI and desktop launches use this web host.
- SQLite is the canonical cross-process arbiter for document saves. Even two independently
  composed application services using the same database are safe at this boundary, as the
  independent reproduction demonstrates. The product does not advertise multiple web processes
  sharing one local data directory, so broader file-replacement coordination is not assumed.
- MCP is retrieval/proposal-only and does not write SQLite (`hosts/mcp/README.md:1-3`).
- Manuscript and project imports publish a new staged world. Project archives validate the
  manuscript/figures pair before and after staging
  (`persistence/project_archive.py:327,444-447`); manuscript import creates an unanchored
  manuscript with an empty story world and validates all three wire documents before publication
  (`persistence/manuscript_import.py:191-268`).
- Local restore validates staged document wires and the story-time pair before replacement
  (`persistence/backup_validation.py:14-28`; `sqlite/restore.py:72-131`). Manual synchronization
  validates remote documents in a temporary world before taking the local lock and restoring
  (`application/synchronization/use_cases.py:480-535,618-659`). Backup, sync and import routes use
  the same process lock. These whole-world publication paths are distinct from the aggregate save
  transaction and do not introduce a second uncovered canonical aggregate writer in the supported
  process.

### CRIT-002 residual constraints

Whole-world restore/synchronization uses staged file replacement rather than the aggregate-save
transaction. It is protected by the supported single-web-process lock and its own validation and
rollback protocol. Running multiple independent Quiltor web processes against one data directory
would require a separate interprocess publication lock before that topology could be supported.
That deployment is not advertised, and it is outside the confirmed aggregate race closed here.

## Commands and outcomes

```text
node_modules\.bin\vitest.cmd run packages/client/src/app/world/useWorldSession.test.tsx packages/client/src/platform/http/documents.test.ts packages/client/src/platform/http/worlds.test.ts
PASS — 3 files, 57 tests.

.venv-desktop\Scripts\python.exe -m unittest tests.python.test_chapter_story_time tests.python.test_document_transaction_safety -v
PASS — 16 tests.

node tools/dev/mutate.mjs packages/client/src/platform/http/request.ts --from "  state.selectionGeneration += 1;" --to "  state.selectionGeneration += 0;" -- node_modules\.bin\vitest.cmd run packages/client/src/platform/http/documents.test.ts packages/client/src/platform/http/worlds.test.ts
EXPECTED INNER FAILURE — 2 failed, 46 passed; mutation restored. The late A load overwrote revision 30 with revision 10 when A→B→A generations were disabled.

.venv-desktop\Scripts\python.exe knowledgebase\orchestrator\.close04_backend_repro.py
PASS — 20 valid final states; outcomes were figures-conflict/manuscript-win 11 times and figures-win/manuscript-conflict 9 times. Temporary artifact removed.
```

No production build, browser suite or full repository suite was run by this review. Those gates
cover the larger shared checkout; the commands above directly exercise the two critic
investigations.

## Reviewed-source fingerprint

The disposition above applies to these SHA-256 values:

```text
ebafa65c432e784e5e83e86064313116af764bcf41fef3ab858652ede1c7ee08  packages/client/src/app/world/useWorldSession.ts
3b590c81d97f210bdd44bb7f08835e7d40f163018f7fdafa76fddfcef6bbda16  packages/client/src/app/world/useWorldSession.test.tsx
885853270cdd5501d55ea6a4dd8a55605bd756e68f585cf0750ce797bec1b990  packages/client/src/platform/http/request.ts
9d40cfb86065309fd7ff6af56f35b301d0482a66bcbf77866d09bbf84c92d6a8  packages/client/src/platform/http/documentTransport.ts
cb9d8c82a6c9d19b86d226cfb00020284e3b931a2fb11a385c27cf9b8bd4b307  packages/client/src/platform/http/documents.test.ts
6e0d50ec9e91febb097bfb6008be89d837f72f19569ea48f20fbf885deb92bb6  packages/client/src/platform/http/worlds.ts
a204509925b25636887f0d4caa7883142190e42ddc85006b79535aa6f23f955a  packages/client/src/platform/http/worlds.test.ts
8d9da0fccde872b8620884a410376fd7f0a7a1fd8062c00740a5d0c98da198b7  src/quiltor/infrastructure/persistence/sqlite/revisions.py
71116deb549e7e104f805eaaa41f1fc1ff46217be6b4ccfec99d93b8a0634e16  src/quiltor/infrastructure/persistence/sqlite/manuscript.py
c0e3cf875eca1ade05ef6e64dd77b2220dab42977204ae933c3f829b555fcd51  src/quiltor/infrastructure/persistence/sqlite/story_world.py
a044721f2e3bd628ea039b8666e6726597aadb6feb7fd8e9a15da2fad0513bd9  src/quiltor/infrastructure/persistence/adapters/documents.py
39ded6e1bcf1d95ffeb01bcb99f1427f124736af453a6d5b12ec4da18006aad7  tests/python/test_chapter_story_time.py
```
