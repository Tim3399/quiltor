# Simplification review and implementation plan

Requested 2026-10-09: the coordinator and Critic review the existing six proposals;
plan implementation only for proposals that pass. This request does not start
implementation. Review baseline: `a7ce672`; product source equals released
`a8e9e69` / 3.22.0. The initial working tree was clean.

## Coordinator review

This records the independent initial assessment. Where it differs from the
Critic, the final disposition below supersedes this provisional scope.

The coordinator inspected the actual implementations, callers and focused test
coverage independently while the Critic reviewed in parallel. These are static
design judgments; no new product tests or benchmarks were run for this review.
The green release tests establish the unchanged baseline, not equivalence of a
future refactor. No performance improvement is claimed without measurement.

| Proposal | Coordinator judgment                         | Evidence and strongest counterargument                                                                                                                                                                                                                                                                                                                                     | Required boundary                                                                                                                                                                                                    |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SIM-01   | Pass only with narrower scope                | `exporting/docx.py:442–466` and `epub.py:454–478` duplicate the three pure UTF-16 helpers exactly. Chapter/mark normalization also resembles each other, but error text differs; DOCX `_marks` has an extra sequence guard, and format-local limits are patched by existing tests. A generalized validator would add policy parameters and risk changing error precedence. | Initially extract only UTF-16 length, boundary and Python-index conversion into a private export-local module. Leave normalization, exceptions, limits, package budgets and public `ExportChapter` imports in place. |
| SIM-02   | Pass only with narrower scope, last priority | Worlds has five matching JSON POST initializers, writing assistance four and backup four. The repeated three-field setup has a clear bounded extraction, but a new transport wrapper could obscure signal/error behavior or defer reading mutable world state.                                                                                                             | A small request-initializer helper only, rather than a new async transport layer. Keep `requestJson`, route construction, decoders and `withWorldBody` evaluation at callers. Do not migrate unrelated adapters.     |
| SIM-03   | Pass                                         | `providers/freedict.py:14–18` calls `_text` twice for each retained XML element. Rewriting a very short parser can nevertheless reduce readability or accidentally share yielded mutable lists.                                                                                                                                                                            | Compute each selected element's text once, keep lazy first nonempty POS selection and quote-to-tr fallback; every head retains its own values list and stable deduplication order.                                   |
| SIM-04   | Pass, first priority                         | `sqlite/storyboards.py:226–232` duplicates `connection.py:30–39`; a caller-owned connection takes a separate early-return path. Replacing that latter path with the context manager would unexpectedly commit/rollback/close another owner's transaction.                                                                                                                  | Change only the owned-connection path. Prove commit, rollback and release after failure, plus untouched borrowed-connection ownership.                                                                               |
| SIM-05   | Pass as two small sequential changes         | The two `_delete_missing_rows` functions differ only by an unused-generalization ID-column parameter; row-order routines duplicate the same algorithm over two fixed tables. A general persistence framework would cost more than it removes, and SQL reordering/cascade behavior is sensitive.                                                                            | First the local two-table ordering helper, then shared deletion with fixed internal table names and `id`. Preserve SQL operation order and transaction ownership. No schema migration or rowid algorithm change.     |
| SIM-06   | Pass                                         | `document_wire_v1.py:221–250` repeats the same chapter transformations in active and trash branches, with different surrounding traversal. Extracting too broadly could reorder which invalid field fails first or normalize fields previously ignored.                                                                                                                    | One chapter-level helper only; retain traversal guards/order, `deepcopy`, trash `treeItem` handling and extension-field behavior.                                                                                    |

### Specific proof requirements identified by the coordinator

- **SIM-01:** non-BMP characters, empty text, start/end and surrogate boundaries,
  sparse requested indexes; byte-for-byte before/after DOCX and EPUB archives.
  Fix EPUB `modified` in fixtures because its default uses the current clock.
  Keep format-specific negative cases and early limit rejection tests unchanged.
- **SIM-02:** compare all 13 scoped requests' URL, method, headers and exact
  body, including `{}`; identity and cancellation remain at the same call time.
  Preserve the exact signal object and error propagation. Existing worlds tests
  inspect parsed bodies, so they do not alone establish exact transport equality.
- **SIM-03:** blank quotes must fall back to `tr`, nested XML text, empty/duplicate
  heads/translations, first nonempty POS and independent yielded values lists.
- **SIM-04/05:** use temporary databases, inject failure after a real write and
  inspect persisted state, not just mock call counts. Include unchanged-order
  no-write behavior, presence reordering and Storyboard removal through `save()`.
  Preserve existing rowids on unchanged order; actual reordering deliberately
  assigns new rowids. Require stable logical IDs and dependent records during
  reordering, not globally immutable rowids.
  Borrowed connections must retain the caller's ability to roll back preceding
  writes after success and after a caught synchronization failure.
- **SIM-06:** paired active/trash payloads for integer-valued floats, booleans,
  missing/null/invalid types, bounds 0/1 and safe-integer limits. Preserve invalid
  input handling, ordering, note-mark sorting and input immutability. Shared
  differential fixtures must still agree with the TypeScript runtime.

## Independent review and final disposition

The [Critic's independent report](../critic/simplification-review-2026-10-09.md)
is accepted after the coordinator read its source evidence and test results.
The original proposals are not approved wholesale. Final planning decisions:

| Proposal | Final disposition                   | Reconciliation                                                                                                                                                                                                                                                                                       |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SIM-01   | Planned, narrowed                   | Both reviews accept only the three identical UTF-16 primitives. Common chapter/mark normalization is deferred.                                                                                                                                                                                       |
| SIM-02   | Planned, narrowed                   | Adopt the Critic's ordinary `postJson<T>(url, body, signal?)` function delegating to existing `requestJson`; no generic options-merging API. This supersedes the coordinator's provisional initializer-only preference. Serialization remains synchronous before delegation; no extra async wrapper. |
| SIM-03   | Planned                             | Both reviews pass the local parser change with behavioral characterization first.                                                                                                                                                                                                                    |
| SIM-04   | Planned                             | Both reviews pass the owned-connection branch only. Also preserve `conn` precedence over `db_path`.                                                                                                                                                                                                  |
| SIM-05   | Planned for local order helper only | Accept the Critic's stronger cost/risk objection: the cross-module deletion helper adds abstraction for too little proven benefit. Defer that portion until a concrete maintenance need justifies reopening it.                                                                                      |
| SIM-06   | Planned                             | Both reviews pass a private chapter-level helper. Explicitly assert actual integer types, encode and decode, note-mark heading levels, and input immutability after rejection as well as success.                                                                                                    |

For SIM-05, unchanged-order no-write means no **rowid updates by the ordering
helper**, not a write-free save. Existing saves still perform upserts. Actual
reordering deliberately changes rowids; retain the existing transition behavior,
logical IDs and dependent records. This correction supersedes imprecise stable-rowid
wording in the initial candidate inventory and coordinator draft.

The Critic ran seven existing focused Python suites (98 tests) and four existing
HTTP TypeScript suites (28 tests), all passing after documented sandbox/runtime
restrictions were resolved. Exact commands, failed environmental attempts and
unrun gates are in the report. No new characterization cases were implemented.
No developer has received an implementation assignment.

Additional findings received during finalization are recorded separately in the
[unreviewed intake](simplification-intake-2026-10-09.md). They do not expand this
six-candidate decision or inherit its test evidence.

## Execution sequence

The sequence incorporates both reviews. Developer labels identify future
ownership, not active assignments. The
coordinator sends one bounded Was/Warum/Wann brief at a time; workers do not
delegate or edit another owner's files. The coordinator owns integration and
generated `dist/`, so no parallel builds write the same checkout.

| Phase                       | Planned owner | Task / Was                                                                 | Warum                                                                         | Wann erledigt                                                                                                                                 |
| --------------------------- | ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                           | Dev 1         | SIM-04: replace only the owned Storyboard connection lifecycle             | Remove proven duplicate transaction scaffolding with existing semantics       | Ownership/commit/rollback characterization passes before and after; focused storage suites and lead/Critic acceptance                         |
| 1, parallel                 | Dev 2         | SIM-03: evaluate FreeDict text once without changing output                | Remove repeated XML extraction in a small isolated parser                     | Edge-case fixtures preserve values/order/fallback and list independence; focused provider suite and lead acceptance                           |
| 2, after phase 1 acceptance | Dev 1         | SIM-01: extract only three pure UTF-16 helpers                             | Remove exact duplicate offset algorithms without merging serializer policy    | Both format suites pass; fixed-time byte comparison and unchanged public imports/errors/limits verified; lead acceptance                      |
| 2, parallel                 | Dev 2         | SIM-06: unify chapter normalization after adding paired active/trash cases | Keep the same wire rules in both traversal paths                              | Python and TypeScript differential corpora agree, negative cases and input immutability hold; lead/Critic acceptance                          |
| 3, after phase 2 acceptance | Dev 1         | SIM-05: local two-table order helper only                                  | Reduce local duplication without creating a cross-module SQL abstraction      | Required storage characterization, existing rowid transitions, logical-ID/dependent-record and caller-rollback proofs; lead/Critic acceptance |
| 3, parallel                 | Dev 2         | SIM-02: one ordinary JSON POST function at 13 named call sites             | Reduce repeated transport setup while retaining the existing request executor | Exact request, cancellation, identity and decoder/error assertions pass; lead acceptance and integrated frontend gates                        |

### File ownership for later briefs

- **Dev 1 / SIM-04:** `src/quiltor/infrastructure/persistence/sqlite/storyboards.py`,
  `tests/python/test_storyboards_storage.py`; focused ownership regressions may
  extend `tests/python/test_sqlite_connection_safety.py`. Existing `connection.py`
  is reused without changing its contract.
- **Dev 1 / SIM-05:** `src/quiltor/infrastructure/persistence/sqlite/story_world.py`
  and `tests/python/test_storage.py` only. No shared deletion utility, new module,
  migration/revision/restore changes or edits to `storyboards.py`.
- **Dev 2 / SIM-03:** `src/quiltor/modules/writing_assistance/providers/freedict.py`
  and `tests/python/test_writing_assistance.py` only.
- **Dev 2 / SIM-06:** `src/quiltor/application/document_wire_v1.py`,
  `tests/python/test_document_wire_v1.py`, manuscript differential fixtures and
  `packages/client/src/platform/contracts/v1/documentDifferential.test.ts` only
  if required to consume new cases. No production TypeScript normalization change.
- **Dev 1 / SIM-01:** `src/quiltor/infrastructure/exporting/docx.py`, `epub.py`,
  one private UTF-16 helper module, and their two named export test files.
- **Dev 2 / SIM-02:** `packages/client/src/platform/http/{request,worlds,writingAssistance,backup}.ts`
  and their four tests. Add the internal helper to `request.ts` without changing
  existing `requestJson` behavior. Keep synchronization, binary transfer and all
  other gateways unchanged; no public platform export.

### Verification and integration gates

1. Characterization cases must first pass on the existing implementation; then
   perform the scoped refactor and rerun the same cases. These are refactors,
   so an unchanged-baseline pass is intentional. A behavior correction discovered
   during work becomes a separate bug task with failing regression/mutation proof.
2. Use repository-selected Python 3.12 and the package scripts. Focused backend
   commands follow `py -3.12 -m unittest discover -s tests/python -t tests/python -p
"<test-file>.py"`, with the owned test files listed above. SIM-06 additionally
   runs `npx vitest run packages/client/src/platform/contracts/v1/documentDifferential.test.ts`.
   SIM-02 runs `npx vitest run packages/client/src/platform/http` and
   `npm run check:platform`.
3. Integrate accepted changes serially. Run the full Python suite after the
   combined backend changes, plus the required `npm run build` and `npm test`
   on the combined final source; format only owned files and run the contract/
   architecture checks included by build. Review and commit regenerated `dist/`
   if the client build changes. Do not repeat unchanged gates without cause.
4. Before any product-browser verification, use a fresh dist served by a newly
   started isolated Python server and temporary data. Preserve the owner's
   running local 3.22.0 instance and existing projects. Broaden browser checks
   only if a transport/rendering concern or changed behavior requires them.
5. Any broadened abstraction, changed error precedence, new dependency, schema
   migration, output difference or unavoidable cross-owner edit stops that slice
   for coordinator review. Do not absorb it as incidental cleanup. A refactor
   whose helper/parameters make its callers less clear is rejected or narrowed.
6. Completion is reviewed implementation with valid combined checks and updated
   taskboard. This plan does not authorize a version bump, tag, production
   deployment or new release; those are separate delivery decisions.
