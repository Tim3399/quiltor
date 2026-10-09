# Independent simplification review

Reviewed on 2026-10-09 against `a7ce672c74545c97e0c0d23437216564860a216a` in `C:/Users/timra/git/quiltor/quiltor`. The requested scope is SIM-01 through SIM-06 in `knowledgebase/orchestrator/simplification-candidates.md`. No product implementation, test mutation, commit, release or server operation is part of this review. The coordinator owns the implementation plan and taskboard.

The initial working tree was clean. `git diff --stat a8e9e69 HEAD -- src packages contracts tests` produced no differences. The coordinator subsequently created `knowledgebase/orchestrator/simplification-review-plan.md`; this review leaves it untouched. References below are source line numbers at the reviewed revision, not permanent anchors.

## Decision

Three candidates pass for implementation planning; three need narrower scope. None is an approval of a future implementation diff. Existing passing tests establish a baseline, not equivalence of code that has not been written.

| Candidate | Verdict | Accepted scope                                                                                                     |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| SIM-01    | Narrow  | Share only the three identical UTF-16 primitives first; defer common chapter/mark normalization                    |
| SIM-02    | Narrow  | One internal JSON POST function for the 13 matching calls; no generic request-options or endpoint abstraction      |
| SIM-03    | Pass    | Evaluate normalized text once per visited element; preserve parser ordering, fallback and independent result lists |
| SIM-04    | Pass    | Replace only the owned-connection branch with the existing context manager                                         |
| SIM-05    | Narrow  | Consider the local two-table order helper after characterization; defer the cross-module deletion helper           |
| SIM-06    | Pass    | Extract one private chapter integer-normalization function; retain traversal and validation order                  |

## SIM 01 Export helpers

**Evidence.** `src/quiltor/infrastructure/exporting/docx.py:442,446,454` and `epub.py:454,458,466` define `_utf16_len`, `_utf16_boundary` and `_python_indexes`. A read-only text comparison confirmed that all three complete functions are identical, not just `_python_indexes`.

Chapter/mark normalization is less interchangeable. DOCX validates option fields before chapters at `docx.py:82-91`; EPUB validates its option object type, then chapters, then option fields at `epub.py:54-59`. Errors differ, including `A DOCX chapter` versus `An EPUB chapter` and the equivalent mark wording. DOCX `_marks` also checks the sequence shape at `docx.py:171-174`; EPUB `_marks` relies on the caller's check at `epub.py:123-129`. Both modules own independently patchable resource limits. EPUB currently imports `ExportChapter` from DOCX at `epub.py:20`.

**Strongest counterargument.** Three small duplicates are easy to read locally, and a new shared module adds an import hop. Sharing all validation would remove more lines, but would require a format/error/limit policy interface whose cost is not justified by this proposal. The stronger reason to share the primitives is that both formats must interpret the same UTF-16 offsets, not a line-count target.

**Allowed implementation.** A narrowly named module under `infrastructure/exporting/` may own the pure offset functions. Leave serializers, normalization, budgets, public imports, `ExportChapter`, exceptions and format-specific messages in place. Do not tighten the helper inputs or change what happens for offsets that are not valid boundaries. No base class or format switch.

**Characterization and acceptance.** Cover empty text, BMP text, astral characters before/inside a marked span, start/end offsets and surrogate-splitting rejection through both public serializers. Preserve merged mark behavior and cross-paragraph formatting. Compare the old and new DOCX archives byte-for-byte; do the same for EPUB with explicit `modified` and deterministic metadata. Check exception type/message and competing invalid-input precedence; existing invalid-input tests mainly assert exception class. Retain the DOCX limit-before-mark-normalization test at `test_manuscript_export.py:201`. Run both serializer suites. Identical results with less duplicated offset logic justify the bounded extraction; they do not justify a common normalization framework.

## SIM 02 JSON POST adapters

**Evidence.** Repeated method/header/stringification appears in `packages/client/src/platform/http/worlds.ts:24-60` (five calls), `writingAssistance.ts:17-53` (four calls), and `backup.ts:115-156` (four calls). `request.ts:179` already owns fetch, `cache: "no-store"`, JSON reading and HTTP error mapping. Decoders are deliberately adapter-owned. Lookup and grammar calls carry an `AbortSignal`. Backup uses both world-in-body and world-in-query conventions. `synchronization.ts` and binary transfer differ and are excluded.

**Strongest counterargument.** The existing request objects are explicit and unsurprising; a helper that also selects worlds, merges arbitrary headers, supplies decoder callbacks or invents endpoint descriptors would hide more than it removes. A single `postJson<T>(url, body, signal?)`-shaped function has a defensible scope because the repeated transport recipe is the same at 13 sites.

**Allowed implementation.** Place the helper in the existing internal HTTP layer and delegate to `requestJson`. Accept only the cancellation option actually needed. Keep URL building, world selection, payload field names and response decoding at the current call sites. Preserve literal empty JSON bodies as `{}`. Do not add a public platform export, retry policy, class, header-merging API or migration of other adapters. An ordinary function returning `requestJson` can retain synchronous serialization before delegation; an unnecessary `async` wrapper could change serialization-error timing.

**Characterization and acceptance.** Inspect actual fetch arguments: URL/query, POST, exact JSON content type, body, no-store cache and unchanged signal identity. Cover selected and unselected worlds and selection changing after a call starts. Preserve lookup locale mapping, the fixed grammar locale, structured HTTP errors, malformed successful response handling and abort propagation. Existing worlds tests assert headers/body, writing-assistance tests assert cancellation, and backup/request tests cover several error paths; extend only the missing boundary assertions. Run the four focused HTTP suites, then the contributor build and unit gates for implementation. No visual redesign or new UI testing campaign is justified by this helper alone.

## SIM 03 FreeDict text extraction

**Evidence.** `src/quiltor/modules/writing_assistance/providers/freedict.py:13-17` calls `_text(item)` in both the filter and value expression for nonblank orthography, quote, fallback translation and selected part-of-speech elements. `_text` at line 6 joins nested text and normalizes whitespace. The output loop at lines 18-28 deduplicates translations in insertion order and creates a separate values list for each head.

**Strongest counterargument.** The parser is only 29 lines; adding a provider abstraction or a general XML traversal utility would cost more than the duplication. This change is worthwhile only as a local expression/loop simplification, with no unmeasured performance claim.

**Allowed implementation.** Cache each normalized value once in the existing traversal. Keep the `pos` traversal lazy and stop at the first nonblank value. Keep `quote` precedence: fall back to `tr` only when normalized quotes are empty. Preserve head order and duplicate heads, translation order/deduplication, and a fresh `values` list per yielded record. Do not hoist one mutable result list and share it between heads.

**Characterization and acceptance.** Add a compact parser fixture covering blank quotes with nonblank `tr`, nonblank quotes suppressing `tr`, nested text/tails, blank and multiple heads, duplicate translations and first nonblank POS. Mutating one yielded values list must not affect another or a later yielded result. Existing `test_writing_assistance.py:78-100` contains only a simple FreeDict example. Run that suite; avoid tests that merely count internal `_text` calls or introduce a benchmark project.

## SIM 04 Storyboard connection ownership

**Evidence.** `src/quiltor/infrastructure/persistence/sqlite/storyboards.py:226-234` directly uses a supplied connection, but otherwise opens one, enters its transaction context and closes it in `finally`. `connection.py:30-38` performs the same owned sequence. `story_world.py:505-514` already applies this ownership split. `storyboards.py:29` already uses the context manager for loading.

**Strongest counterargument.** The current code is correct and explicit; accidental inclusion of the supplied-connection branch in the context manager would silently give this function authority over the caller's transaction. The value is reuse of an established ownership primitive, not a new transaction abstraction.

**Allowed implementation.** Keep the supplied-connection early return exactly as an ownership boundary. Change only the remaining branch to `with connection(db_path) as database: _sync(state, database)` and remove the now-unused `connect` import. Leave the shared context manager and all other connection callers unchanged.

**Characterization and acceptance.** Owned connection: successful writes commit; an error after at least one write rolls back; success and failure both close. Caller connection: success and failure neither commit, roll back nor close it; the caller can still control its transaction. Preserve the precedence of `conn` over `db_path`. A validation error before any write is insufficient rollback evidence. Existing storage roundtrips and revision tests are useful, but `test_sqlite_connection_safety.py:12` only tests setup failure. Run Storyboard storage and connection safety suites; inspect the actual minimal diff before accepting it.

## SIM 05 SQLite deletion and order synchronization

**Evidence.** `_delete_missing_rows` at `story_world.py:155` accepts an identifier column while the version at `storyboards.py:94` fixes it to `id`. Every current caller uses `id`. The two order algorithms at `story_world.py:170,184` differ by table. They compare the existing rowid order, return for unchanged/empty order, otherwise move every rowid above the previous maximum. Calls at lines 464-469 intentionally interleave deletion and ordering. Storyboard deletes edges, then nodes, then boards at lines 210-212.

**Required correction to the proposal.** A universal promise of stable rowids is false for the current order algorithm: reordering deliberately changes them. Require unchanged rowids when order is unchanged, and preserved logical IDs, dependent records and existing rowid/order behavior when it changes. Likewise, no writes for unchanged order applies to the order helper, not the whole save: the save performs upserts regardless.

**Strongest counterargument.** Moving a dozen lines of deletion code into a cross-module SQL utility introduces ownership and identifier-parameter questions without demonstrated behavioral benefit. Combining this with ordering and transaction cleanup enlarges both the diff and the failure surface. No drift or defect in the duplicated deletion logic was demonstrated.

**Allowed implementation.** Split the proposal. The local order-helper portion can proceed after characterization, keeping only the two fixed table choices and `id` as the column. Preserve SELECT/MAX/update behavior, empty handling, call placement and transaction ownership. Defer shared deletion: reopen only with a focused need and a net reduction in maintenance complexity. Do not turn the change into an SQL builder, generic synchronization layer, delete/reinsert algorithm or `NOT IN` rewrite.

**Characterization and acceptance.** Through public `save()`, exercise presence as well as connection reordering, unchanged order, empty collections, insertion and removal. Verify payload order, existing rowid transitions, dependent-record preservation and foreign keys. Observe absence of rowid UPDATEs for unchanged order rather than demanding a write-free save. `test_storage.py:1123` covers connection reorder/dependents; the analogous presence and order-write cases need coverage. If deletion is later reopened, first add Storyboard removal through `save()`; the direct SQL cascade test at `test_storyboards_storage.py:432` does not prove that path. Test caller-controlled rollback. Run `test_storage.py`; a later shared-deletion change also needs Storyboard tests and separate review.

## SIM 06 Chapter integer normalization

**Evidence.** `src/quiltor/application/document_wire_v1.py:221-251` repeats the same chapter work for active chapters and `trash[].chapter`: note references, note marks, then mention/mark ranges. `_canonical_payload_wire_integers` deep-copies first at line 211. The trash-only tree position remains separate at lines 252-254. Note-mark normalization sorts at line 207; mention/mark traversal does not. Public decode normalizes before validation at lines 662-680; encode uses the same decode path at lines 683-693.

**Strongest counterargument.** A generic nested-document walker could hide malformed-value handling and normalization order. A private function for exactly one chapter has a coherent responsibility and needs no schema framework, callback registry or new module.

**Allowed implementation.** Extract that chapter body verbatim into one private function and call it from the two existing guarded loops. Preserve the initial deep copy, active-before-trash order, noteReferences-before-noteMarks-before-mentions-before-marks ordering, and trash treeItem handling. Do not discard malformed entries, normalize unrelated extensions or combine this with removal of other copies.

**Characterization and acceptance.** Pair active/trash cases for all four collections: integer-valued floats become actual Python ints; bools and fractional/nonfinite values remain rejected; from/to minima 0/1 and safe upper bounds remain enforced. Cover absent, null, wrong container/entry types, missing range members, note-mark heading level, astral boundaries, sorting, extension retention and input immutability on both success and rejection. A Python equality check alone cannot prove float-to-int canonicalization. Verify encode as well as decode and unchanged rejection precedence when more than one field is invalid.

The current manuscript differential fixture has 16 optional-presence entries and 36 cases. Its paths contain no trash chapter range cases for these four fields. Add representative paired cases to that existing corpus rather than creating a competing fixture format. Run `test_document_wire_v1.py`, the TypeScript consumer `packages/client/src/platform/contracts/v1/documentDifferential.test.ts`, and contract checks. The existing note-mark ordering test at `test_document_wire_v1.py:386` is useful but does not establish all paired behavior.

## Sequence and ownership

Recommended small batches are SIM-03 and SIM-04 first, then SIM-06 and the narrowed SIM-01, then SIM-02. The local SIM-05 portion is lower priority and should follow storage characterization. This is implementation advice, not a task assignment or release schedule.

| Work package      | Exclusive implementation ownership                                                                                                             | Coordination condition                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SIM-03            | `freedict.py`, relevant parser cases in `test_writing_assistance.py`                                                                           | Independent of the other candidates                                                                                |
| SIM-04            | `sqlite/storyboards.py`, `test_storyboards_storage.py`, ownership-specific tests in `test_sqlite_connection_safety.py` if used                 | Do not change shared `connection.py` without reopening scope                                                       |
| SIM-06            | `application/document_wire_v1.py`, `test_document_wire_v1.py`, manuscript differential corpus and any necessary TypeScript consumer adjustment | One owner for shared fixtures; existing corpus consumers must still agree                                          |
| SIM-01 narrow     | `exporting/docx.py`, `epub.py`, one narrowly named offset helper, the two serializer test files                                                | Keep public models/imports and validation policy out of the change                                                 |
| SIM-02 narrow     | `platform/http/request.ts`, `worlds.ts`, `writingAssistance.ts`, `backup.ts` and their four tests                                              | Coordinate `request.ts` ownership with any other transport work                                                    |
| SIM-05 local only | `sqlite/story_world.py`, `test_storage.py`                                                                                                     | Can be technically independent of SIM-04 after narrowing; sequential review by one storage owner reduces ambiguity |

The original SIM-04/SIM-05 proposals overlap in `storyboards.py` and its tests and must not have parallel editors. The accepted local-only SIM-05 slice removes that file conflict; if shared deletion is reopened, restore the dependency or assign one owner. Do not run a production build while another agent expects an unchanged `dist/`; the coordinator should own integration builds and generated output. No candidate requires a server restart during this review.

For each eventual implementation, capture missing behavior before changing product code, inspect the actual diff and rerun the relevant tests after it. Only then combine accepted work and run `npm run build` and `npm test`, plus the affected Python suites and contract checks. Do not invent a bug solely to satisfy the mutation-proof rule: these are behavior-preserving refactors. No source/test mutation is authorized by this review.

## Verification performed

The following existing tests passed outside the sandbox after its runtime/cache restrictions were encountered. Python used `-B` to avoid bytecode writes. Tests used their existing temporary fixtures; no test files were edited. Total: 98 Python tests and 28 TypeScript tests.

| Exact command                                                                                                                                                                                                                                             | Result                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_manuscript_export.py`                                                                                                                                                           | 9 passed                 |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_manuscript_epub.py`                                                                                                                                                             | 9 passed                 |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_writing_assistance.py`                                                                                                                                                          | 5 passed                 |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_storyboards_storage.py`                                                                                                                                                         | 11 passed                |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_sqlite_connection_safety.py`                                                                                                                                                    | 1 passed                 |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_storage.py`                                                                                                                                                                     | 44 passed                |
| `py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_document_wire_v1.py`                                                                                                                                                            | 19 passed                |
| `node node_modules/vitest/vitest.mjs run packages/client/src/platform/http/worlds.test.ts packages/client/src/platform/http/writingAssistance.test.ts packages/client/src/platform/http/backup.test.ts packages/client/src/platform/http/request.test.ts` | 4 files, 28 tests passed |

Initial failures are environmental evidence, not hidden green runs: a read-only `py -3.12 -B -` AST probe reported no installed Python; `node tools/dev/python.mjs --needs quiltor -B -m unittest discover -s tests/python -t tests/python -p test_manuscript_export.py` found no importable runtime in the sandbox. The first identical Vitest command failed all four suites before running tests due to an EPERM rename in the sandbox temporary transform cache. Approved execution outside the sandbox resolved these limitations. The function comparison and fixture inventory were subsequently completed with read-only PowerShell. One inventory command had a PowerShell parse error from brace syntax and was corrected before execution.

No new characterization tests were written or executed. No full `npm run build`, `npm test`, complete Python/Rust suite, E2E, external EPUB validation or server check was run for this review. Baseline test success is not proof that the proposed extractions preserve behavior. The coordinator should retain these implementation gates rather than recording all six original proposals as unconditionally approved.
