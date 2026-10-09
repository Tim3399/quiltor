# Simplification implementation review for 3.22.1

Independent review recorded on 2026-10-09. This report covers Phase 1 (SIM-03 and SIM-04), Phase 2 (SIM-01 and SIM-06), and Phase 3 (SIM-05 and SIM-02). It evaluates the actual source and test diffs against the earlier [simplification review](simplification-review-2026-10-09.md). All three phases have passed independent review of the six narrowed patches at the revisions recorded here. Integrated-revision validation and release acceptance remain separate. Earlier phase records are retained below.

## Phase 1 verdict

**SIM-03: Pass. SIM-04: Pass. No actionable correctness or scope findings in the reviewed diffs.** Both changes implement the bounded plan and have meaningful characterization tests. This is approval of these specific patches for integration, not of unreviewed later changes or the patch release as a whole.

| Candidate | Checkout                                        | Common base | Test commit                                | Refactor commit                            |
| --------- | ----------------------------------------------- | ----------- | ------------------------------------------ | ------------------------------------------ |
| SIM-04    | `C:/Users/timra/git/quiltor/quiltor-dev1-sim04` | `0d59a2c`   | `8ecb0aecabcb841a8854ab9d112d556f1e8c73c2` | `8121e77e49d16dd1b23779cddc9f7e84d8ad66d4` |
| SIM-03    | `C:/Users/timra/git/quiltor/quiltor-dev2`       | `0d59a2c`   | `a191cd630c9ce96cfa3835dd5537c46f283a600e` | `6ee589946f3581a6cc635173236c62a24569dfd7` |

Both checkouts were clean, at the stated refactor commit, before review and remained clean after the targeted runs. The two commits in each range are the test commit followed by the refactor. Direct intermediate diffs confirm that the first commit changes only its test file and the second only its product file. No additional product scope is hidden in either range.

## SIM 04 Actual change and test quality

The product diff changes only `src/quiltor/infrastructure/persistence/sqlite/storyboards.py`: it removes the unused `connect` import at line 12 and replaces the owned-connection implementation at lines 229-230 with `connection(db_path)`. The supplied-connection branch at lines 226-228 is unchanged.

The shared context manager in `sqlite/connection.py:30-38` opens the connection, enters the SQLite transaction context and closes in `finally`, matching the removed sequence. It is itself unchanged. Argument precedence and `_sync` invocation remain intact. A source/test search found no use of the removed `storyboards.connect` module attribute.

The strongest risk was transferring transaction ownership from the caller to this function. The new cases in `tests/python/test_storyboards_storage.py` address that risk directly:

- Line 200: an owned save records a real COMMIT, closes its actual connection and persists an exact roundtrip.
- Line 214: the test sees a changed board title inside the transaction before deliberately failing node processing. It verifies the same exception instance, ROLLBACK without COMMIT, a closed connection and the restored original persisted document. This is failure after a real write, not validation before any write.
- Line 245: a caller-supplied connection takes precedence over an invalid path, creates no additional connection, leaves both caller and save writes pending and remains usable for caller rollback. SQL tracing rejects an internal COMMIT or ROLLBACK.
- Line 277: failure likewise leaves the caller's prior write and partial save write pending, preserves exception identity and permits caller rollback to the original document.

The connection observer wraps the real `sqlite3.connect`; it does not replace transaction behavior with mocks. Patching `_node_extra` supplies a controlled failure point while the SQL writes and rollback are real. Existing roundtrip, row-identity, foreign-key and revision tests remain unchanged. The focused evidence is proportionate; no additional storage redesign or full test campaign is needed for this six-line ownership reuse.

## SIM 03 Actual change and test quality

The product diff changes four expressions in `src/quiltor/modules/writing_assistance/providers/freedict.py:13-17`. Assignment expressions retain the normalized value once per visited element. `_text`, traversal paths, fallback branching, output fields and per-head `list(dict.fromkeys(translations))` are unchanged.

The POS expression remains a generator consumed by `next`, so it stops at the first nonblank value. Reusing the local name `text` does not introduce shared output state: every accepted comprehension element has just assigned it, POS is resolved before records are yielded, and result lists still originate inside the head loop.

The strongest risks were eager POS normalization, changing quote/fallback precedence, losing duplicate-head ordering or sharing a mutable values list. The four new cases in `tests/python/test_writing_assistance.py` cover those behaviors:

- Line 116: namespaced input, blank elements, nested text and tails, normalized whitespace, quote-to-translation fallback, stable translation deduplication, multiple/duplicate heads, first nonblank POS and entries that must produce no record.
- Line 146: nonblank quotes suppress `tr` fallback and absent POS remains empty; this also exercises unnamespaced input.
- Line 156: mutating the first record's values does not change an already yielded second record or a subsequently yielded third. Identity assertions and iterator exhaustion cover the actual aliasing risk.
- Line 176: a later POS element deliberately cannot be read. The test confirms that evaluation stops before it, independently of the exact number of `_text` calls.

The tests assert parser contracts rather than the walrus syntax or a count of private-helper calls. No provider abstraction, new mutable cache or output-schema change was introduced. No performance benchmark is claimed or required for this bounded simplification.

## Independent verification

Targeted tests were rerun by the critic on the final clean checkouts. Execution used the installed Python outside the sandbox because its interpreter access limitation had already been established. Every command completed successfully; there were no failed test runs in this implementation review. Python used `-B` and a process-local `PYTHONPATH` for the checkout's `src` directory. Product import paths were printed and asserted before the suites ran.

The exact SIM-04 command was run from `C:/Users/timra/git/quiltor/quiltor-dev1-sim04`:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'; py -3.12 -B -c "from pathlib import Path; import quiltor.infrastructure.persistence.sqlite.storyboards as s; import quiltor.infrastructure.persistence.sqlite.connection as c; root = Path.cwd() / 'src'; print(s.__file__); print(c.__file__); assert Path(s.__file__).resolve().is_relative_to(root); assert Path(c.__file__).resolve().is_relative_to(root)"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_storyboards_storage.py; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_sqlite_connection_safety.py
```

Both modules resolved under that checkout's `src/quiltor/infrastructure/persistence/sqlite/`. Results: **15 Storyboard tests and 1 connection-safety test passed**.

The exact SIM-03 command was run from `C:/Users/timra/git/quiltor/quiltor-dev2`:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'; py -3.12 -B -c "from pathlib import Path; import quiltor.modules.writing_assistance.providers.freedict as f; print(f.__file__); assert Path(f.__file__).resolve().is_relative_to(Path.cwd() / 'src')"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_writing_assistance.py
```

FreeDict resolved under that checkout's `src/quiltor/modules/writing_assistance/providers/`. Result: **9 tests passed**. The independent final-state total is **25 passing tests**.

Whitespace checks also passed:

```powershell
git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev1-sim04 diff --check 0d59a2c 8121e77
git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev2 diff --check 0d59a2c 6ee5899
```

These ran in their respective checkouts. Git status checks were clean. Only this report was written by the critic, in the primary repository; the coordinator's existing knowledgebase edits were preserved.

## Phase 1 remaining evidence and integration boundary

The implementers report the same suite counts before and after refactoring. The critic verified the test-first commit structure and independently reran the final implementations, but did not check out or execute the intermediate test-only revisions. Their historical before-run commands, import identities and results remain evidence for the coordinator to retain; this report does not relabel them as independently reproduced.

There are no remaining behavior-specific blockers from this review. Integration must preserve the reviewed diffs and rerun affected checks if conflict resolution changes them. The two patches own different source and test files, so they have no direct file-ownership conflict with one another. Later phases touching persistence or writing-assistance files must be assessed separately.

No source or tests were edited by the critic, no mutation experiment was performed, and no commits, pushes, tags or server actions were taken. `npm run build`, `npm test`, full Python/Rust suites, E2E and release gates were not run during this focused review. Exact integrated-revision validation, version preparation and publication remain the coordinator's release work; Phase 1 approval alone is not a release approval.

## Phase 2 verdict

**SIM-01: Pass. SIM-06: Pass. No actionable correctness or scope findings in either reviewed patch. The independent Phase 2 review is complete.** SIM-01 evidence follows first; SIM-06 evidence and the combined integration boundary are recorded below.

- Checkout: `C:/Users/timra/git/quiltor/quiltor-dev1-sim04`, branch supplied as `codex/dev1-sim01`.
- Base: `c2572beec6c46be72f73237f3279df394af7a9c0`.
- Characterization commit: `13dbe50919f8794e9fffa5ce015eb46fbae7acf7`.
- Reviewed product HEAD: `6d6f1040da3db003e0cb7b56b62290f106ac878d`.

The checkout was clean at the stated HEAD. The complete five-file diff contains two test files and three exporter files. The intermediate diff confirms tests were committed separately before the product change. The product commit changes only `exporting/docx.py`, `epub.py` and the new private `_utf16.py`.

## SIM 01 Source and characterization review

The new `_utf16.py:6,10,18` owns precisely `_utf16_len`, `_utf16_boundary` and `_python_indexes`. DOCX and EPUB import those functions under their existing names and remove the local copies. No other functions, constants, budgets, exception definitions, public exports, models, normalization or validation ordering change. EPUB still imports the same `ExportChapter` class from DOCX; the critic also asserted that identity at runtime.

Independent AST comparison used the exporter sources from the immutable base commit, not an assumed prior working tree. Each of the six original function definitions matches the corresponding shared definition, including annotations and unusual boundary behavior. After removing only those original definitions and the new shared import from the comparison, both complete exporter ASTs match their base versions. This substantiates the narrow extraction rather than relying on a visual impression of a small diff.

Each serializer receives three new characterization tests:

- `test_manuscript_export.py:28` and `test_manuscript_epub.py:33` exercise empty text, BMP characters, astral text, sparse/overlapping spans and merged marks across paragraph boundaries. They inspect roundtripped DOCX content or EPUB XHTML and compare against literal expected formatted text. They also verify that adjacent marks and their merged equivalent produce identical archives.
- The primitive cases deliberately freeze sparse lookup behavior, omitted non-boundaries, empty input and existing boundary answers for negative/out-of-range offsets. They do not silently redefine these helpers as input validators.
- Invalid-range cases assert exact exception class and message, including surrogate splits and lone surrogates. Competing-error cases preserve the different DOCX/EPUB ordering between invalid option objects, chapter contents, option fields and EPUB timestamps. Existing resource-limit tests remain in place.

Direct primitive assertions are appropriate here because preserving their existing edge behavior was an explicit extraction constraint. The public serializer cases provide independent observable evidence. No test expectations were loosened and no normalization framework was introduced.

## SIM 01 Archive comparison method and reproduction

Developer evidence was read from:

`C:/Users/timra/AppData/Local/Packages/sandbox.{8f90cdd4-bb19-49bd-948d-18594fc2d68a}/AC/Temp/quiltor-dev1-sim01-20261009`

The reviewed `compare_archives.py` uses five input families: empty, BMP, astral, sparse spans and merged cross-paragraph spans. Its last family includes multiple chapters, tabs, XML-sensitive characters, soft breaks and a trailing empty paragraph. Each family is exported as editor DOCX with page numbers, normseite DOCX without page numbers, EPUB with an explicit identifier and EPUB with a content-derived identifier. Both EPUB variants use a fixed modification timestamp. This yields 20 complete ZIP archives.

The method checks exporter import paths under the active checkout. The before phase refuses to overwrite an existing baseline. The after phase compares complete `result.content` bytes with each baseline file before comparing SHA-256, byte length and counts against `before.json`. It does not compare only selected XML members, only uncompressed text or only hash output. `after.json` is written only after those assertions succeed.

The critic did not execute this script in a mode that would rewrite the developer's evidence. Instead, a read-only `py -3.12 -B -` probe independently:

1. Verified current DOCX, EPUB and `_utf16` imports against this checkout's `src`.
2. Loaded the two original exporter source files with `git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev1-sim04 show c2572beec6c46be72f73237f3279df394af7a9c0:<source path>` and performed the AST comparison described above.
3. Executed those unchanged original modules only in the disposable Python process, preserving the original EPUB-to-DOCX `ExportChapter` identity. Existing application dependencies are shared because the reviewed change does not alter them.
4. Reused only the inspected script's fixed `cases` expression, with each version's own `ExportChapter`, and generated the same four export variants separately from original and final exporters.
5. Asserted original bytes == final bytes == saved baseline bytes for every filename, equal result counts, equal before/after manifests and matching manifest hashes/lengths/counts.

**Result: all 20 archives matched byte-for-byte in all three comparisons.** No product, test or evidence files were written by this probe. Regeneration from the immutable base ties the retained archive evidence to actual old code even though the JSON manifests themselves do not record a commit ID. Hash equality is supporting evidence, not the sole comparison.

This matrix does not exhaust every possible text and option combination. In particular, it is not the full DOCX preset/page-number cross-product or every EPUB metadata setting. For the unchanged algorithms plus identical remaining AST, that is a coverage limit rather than a blocking finding. No external EPUB conformance result is claimed by this check.

## SIM 01 Independent checks and integration boundary

The following exact command ran successfully from the developer checkout with installed Python outside the sandbox and a process-local source path:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'; py -3.12 -B -c "from pathlib import Path; from quiltor.infrastructure.exporting import docx, epub, _utf16; root = (Path.cwd() / 'src').resolve(); assert all(Path(m.__file__).resolve().is_relative_to(root) for m in (docx, epub, _utf16)); assert epub.ExportChapter is docx.ExportChapter; print('Exporter imports verified against this checkout')"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_manuscript_export.py; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_manuscript_epub.py
```

Results: **12 DOCX tests and 12 EPUB tests passed**. There were no failed review runs. The developer's reported before-refactor 12/12 suite results remain attributed to the developer; the critic independently regenerated old/new archives and reran the final suites, not the complete suites at the intermediate test commit.

This exact whitespace check also passed:

```powershell
git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev1-sim04 diff --check c2572beec6c46be72f73237f3279df394af7a9c0 6d6f1040da3db003e0cb7b56b62290f106ac878d
```

No additional behavior-specific tests or source changes are requested for SIM-01. Preserve the reviewed extraction on integration. The SIM-06 review is recorded below. Full build, complete test suites, packaging and release gates were not rerun for this targeted review; they remain integrated-revision responsibilities. No source/test edits, commits, pushes, tags or server actions were performed by the critic.

## SIM 06 Source and characterization review

- Checkout: `C:/Users/timra/git/quiltor/quiltor-dev2`, branch `dev2/sim-06-chapter-integers`.
- Base: `c2572beec6c46be72f73237f3279df394af7a9c0`.
- Characterization commit: `66520e088cecae5e57344e61ba0b3af99b8b9b0a`.
- Reviewed product HEAD: `c54f3547e0db36fb922dbe65e1b24e2df0881521`.

The checkout was clean at the supplied HEAD and remained clean after review. The complete three-file diff contains the one Python product module, its existing test file and the existing manuscript differential fixture. The first commit changes only tests/fixtures; the second only `src/quiltor/application/document_wire_v1.py`. No TypeScript product or test code changes are included.

The new `_canonical_chapter_wire_integers` at line 210 extracts the active-chapter body without changing its guards or operations. The call sites at lines 239 and 247 keep their existing dict checks. The original trash loop used positive list/dict guards; the extracted helper's early `continue` form is equivalent and leaves malformed values intact for later validation.

The initial payload deep copy remains at the same boundary. The helper still applies note references, then note marks, then mentions and marks, with `from` before `to` and the original minima. Note-mark sorting remains owned by the unchanged note-mark helper. Active chapters still precede trash; trash wrapper `treeItem.position` is handled after its chapter at line 248. Book-layout handling, unrelated fields and producer/consumer validation are unchanged. There is no generic traversal, extra normalization or new type coercion.

The strongest risks were normalizing too much, overlooking trash, mutating caller data and changing which invalid field fails first. Nine new tests in `ChapterIntegerCanonicalizationTests` at `test_document_wire_v1.py:844` address those risks through both public encode and decode paths:

- Line 937 explicitly asserts `type(value) is int` for canonical range members and heading level. It verifies note-mark sorting and unchanged order of the other collections, then mutates nested output extensions to establish input detachment. Input equality plus representation checks catch accidental float-to-int mutation that ordinary numeric equality would miss.
- Extra `noteReferences.paragraph` and `offset`, mention confidence, nested extension values and a chapter-level extension named `treeItem.position` remain floats. Only the actual trash-wrapper treeItem position becomes an int. This is a meaningful protection against extending normalization by field-name resemblance.
- Line 971 covers bools, fractions, nonfinite values, invalid types, negative/out-of-safe-range integers, missing members, `to = 0` and invalid heading levels for active and trash chapters. At the maximum safe integer, range validation reaches the later payload bounds check rather than incorrectly reporting an unsafe integer.
- Line 1030 checks accepted `from = 0`, `to = 1` and heading endpoints 1 and 3 with actual int results.
- Line 1052 covers missing optional collections, explicit nulls, malformed containers/entries and malformed outer active/trash containers. Values are rejected by the existing public contract rather than silently dropped.
- Line 1081 checks surrogate-splitting UTF-16 offsets in all four collections and both locations.
- Lines 1092, 1110 and 1148 use competing errors with distinguishable messages to test collection order, book-layout/active/trash/tree-position order, from-before-to and to-before-heading-level precedence. They also verify rejection does not mutate the input.
- Line 1132 checks canonical trash tree-position endpoints and rejection above the safe integer maximum.

The test fixture intentionally gives the selected chapter usable ranges and extensions before exercising failures. Assertions operate on public results and exceptions; the new helper is not mocked. There is no need to add a second implementation-shaped test of its internal call sequence.

## SIM 06 Shared corpus and TypeScript consumer

The existing manuscript differential corpus grows from 36 to 63 cases: 27 additions, with prior cases and optional-presence expectations preserved. It adds representative active/trash range acceptance and rejection, null collection rejection, heading levels, bounds and bool handling. Additional cases explicitly retain the legacy extension semantics of paragraph/offset fields rather than treating them as newly constrained range integers.

The unchanged TypeScript consumer `packages/client/src/platform/contracts/v1/documentDifferential.test.ts` imports this checkout's existing corpus and loops over every case. Its eight test functions cover the registered corpora, not merely eight individual fixture cases. The added whole-chapter trash acceptance cases do not carry a scalar `canonical: integer` marker; they test acceptance parity, while the dedicated Python matrix separately establishes actual int conversion. JavaScript number values do not distinguish `1.0` from `1`.

The shared corpus and dedicated Python tests therefore provide complementary evidence. Neither the acceptance-only fixture cases nor Python numeric equality alone are presented as type-canonicalization proof. No schema or TypeScript behavior was relaxed to make the new cases pass.

## SIM 06 Independent checks

The critic ran this exact command from `C:/Users/timra/git/quiltor/quiltor-dev2` with installed Python outside the sandbox:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'; py -3.12 -B -c "from pathlib import Path; import quiltor.application.document_wire_v1 as m; print(m.__file__); assert Path(m.__file__).resolve().is_relative_to((Path.cwd() / 'src').resolve())"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_document_wire_v1.py
```

The printed import resolved to this checkout's `src/quiltor/application/document_wire_v1.py`. **28 Python tests passed**, including the nine new test methods and their paired subcases.

These exact commands also passed from the same checkout:

```powershell
node node_modules/vitest/vitest.mjs run packages/client/src/platform/contracts/v1/documentDifferential.test.ts
node tools/quality/check_contracts.mjs
git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev2 diff --check c2572be c54f354
```

Results: **8 TypeScript tests passed**; contract registry, schemas, references and fixtures were consistent; whitespace check passed. No review run failed. The developer reports the same Python/TypeScript/contract results before and after refactoring. The critic verified the test-first commit structure and independently reran the final checkout; intermediate test-only suite execution remains developer evidence.

## Phase 2 combined integration boundary

SIM-01 and SIM-06 both satisfy their narrowed implementation plans. Their source and test files are disjoint, so these two patches have no direct ownership conflict. Both are accepted for integration at the exact revisions recorded above; no additional product edit or behavior-specific test is requested by this review.

Independent Phase 2 checks comprise 24 export Python tests, 28 document-wire Python tests, 8 TypeScript tests, contract/whitespace checks and the 20-archive original/final/saved-baseline comparison. These are focused patch results. If integration changes either diff, reassess the affected portion. Run the required build, full contributor unit gate and relevant backend/release checks against the integrated revision before publication. This report does not claim that Dev3's integration or the 3.22.1 release has passed those gates.

Only this report was edited by the critic. The Phase 1 findings and evidence remain retained, other knowledgebase ownership was respected, and no source/test edits, commits, pushes, tags or server actions were performed.

## Phase 3 verdict

**SIM-05 local order helper: Pass. SIM-02 ordinary JSON POST helper: Pass. No actionable correctness or scope findings. Phase 3 patch review is complete.** This verdict does not approve the previously deferred cross-module deletion abstraction.

- Checkout: `C:/Users/timra/git/quiltor/quiltor-dev1-sim04`, branch `codex/dev1-sim05`.
- Base: `e2d5cadeac13af8e0dbf76c5d7ec1cde7c282303`.
- Characterization commit: `cba0ef8138372779ba4a9676a3dcb6392a079487`.
- Reviewed product HEAD: `ad57a5fd308bf0c8a4f3e0374d9f42feada11818`.

The checkout was clean at the supplied HEAD. The complete two-file diff contains only `src/quiltor/infrastructure/persistence/sqlite/story_world.py` and `tests/python/test_storage.py`. The first commit adds characterization tests; the second changes only the product module. No migration, other storage module or shared SQL utility is introduced.

## SIM 05 Actual algorithm and scope

`story_world.py:170-182` replaces the two local order functions with `_sync_row_order(database, table, ordered_ids)`. For each of the two actual table values, it emits the same SELECT ordered by rowid, the same early return for unchanged or empty input, the same MAX lookup and the same parameterized rowid updates above that maximum. IDs remain bound parameters. The renamed comprehension variable does not change enumeration or values.

The two call sites at lines 453 and 455 use literal `presence_states` and `connections` strings. They retain their original positions after deletion from the corresponding table and before figure/timeline deletion. `_delete_missing_rows`, all upserts, public `save`, connection management, schema and foreign-key definitions are unchanged. A source/test search found no remaining callers of the retired private function names and only these two callers of the new helper.

The `Literal` annotation documents the two-table contract; it is not runtime validation. The actual closed call sites, rather than that annotation, establish that user-controlled identifiers do not enter the SQL interpolation. A generic SQL builder or defensive public table API would be outside this patch's scope.

The strongest risk was accidentally changing physical row ordering or transaction ownership while consolidating similar SQL. The diff does neither. Actual reorders intentionally continue to change rowids; equal order must avoid rowid updates by this helper, not all writes by the surrounding save.

## SIM 05 Characterization quality

Four new methods add concrete evidence through public `story_world.save`, using real SQLite writes and temporary databases:

- `test_storage.py:306` reverses both connections and presence, then checks their exact historical rowid transitions: connections `[1, 2]` to `[3, 4]`, presence `[1, 2, 3]` to `[4, 5, 6]`. Logical row contents follow the requested order, deliberately added foreign-key dependents survive, relationship states stay unchanged, foreign-key checks pass and the loaded payload equals the reordered input. SQL tracing fixes the relevant deletion/order-query/update sequencing.
- Line 391 checks unchanged order, append insertions, removal and empty collections. It verifies no rowid UPDATE or MAX query in these cases, retained row identities, expected inserted rowids, requested stored order and foreign-key consistency. It also verifies that removal precedes the corresponding order query. The assertions correctly allow ordinary save upserts.
- Line 474 exercises a borrowed connection on success and on a late failure caused by canvas conversion after both order updates. Both cases leave the caller's prior write and the real order changes pending, without an internal COMMIT or ROLLBACK. The connection stays usable, and explicit caller rollback restores original rowids and the original persisted payload.
- Line 518 fails at the same late stage with an owned connection. It observes actual rowid UPDATEs before ROLLBACK, no COMMIT, a closed connection and restored original rows and payload. The observer wraps real connection creation; rollback behavior is not replaced by a mock.

The precise SQL trace assertions are deliberately coupled to the requested unchanged algorithm and sequencing, while row data, dependents, public roundtrips and transaction checks provide observable behavior evidence. The cases do not establish a write-free save or universal stable rowids, and this review makes neither claim. No additional behavior-specific test is required for this bounded extraction.

## SIM 05 Independent checks and remaining boundary

The critic executed this exact command from the SIM-05 checkout with installed Python outside the sandbox and a process-local source path:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'; py -3.12 -B -c "from pathlib import Path; import quiltor.infrastructure.persistence.sqlite.story_world as s; print(s.__file__); assert Path(s.__file__).resolve().is_relative_to((Path.cwd() / 'src').resolve())"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; py -3.12 -B -m unittest discover -s tests/python -t tests/python -p test_storage.py
```

The import resolved to this checkout's `src/quiltor/infrastructure/persistence/sqlite/story_world.py`. **48 storage tests passed**, including all four new cases. No review run failed. This exact whitespace check also passed:

```powershell
git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev1-sim04 diff --check e2d5cad ad57a5f
```

The implementer reports 48 passing tests before and after refactoring. The critic verified the test-first commit structure and independently ran the final source, but did not execute the intermediate test-only commit. Historical before-run evidence remains attributed to the implementer.

The reviewed local-only SIM-05 patch can be integrated as recorded. It does not touch Storyboard files or reopen the shared-deletion proposal. Reassess any integration conflict that changes the SQL or test semantics. SIM-02 is reviewed below. Full build, full contributor unit tests, broader suites and release gates were not run for this targeted patch review. Only this report was edited; no source/test edits, commits, pushes, tags or server actions were performed by the critic.

## SIM 02 Reviewed revisions and scope

- Checkout: `C:/Users/timra/git/quiltor/quiltor-dev2`, branch `dev2/sim-02-post-json`.
- Base: `e2d5cadeac13af8e0dbf76c5d7ec1cde7c282303`.
- Characterization commit: `7ec8f6e5f1b93f2bcceb44df1262d659c4cdc9fc`.
- Reviewed product HEAD: `bd7f5a0be2c26dd754685c9587b21f0361d1fc98`.

The checkout was clean at this HEAD before and after the targeted checks. The complete diff contains the four HTTP modules `request.ts`, `worlds.ts`, `writingAssistance.ts` and `backup.ts`, plus their four test files. The characterization commit changes only the three gateway test files. The refactor commit changes the four product modules and adds five direct helper cases in `request.test.ts`; these five cases were not claimed to run before the helper existed.

## SIM 02 Actual helper and behavior

`request.ts:179-189` adds the ordinary, non-async `postJson<T>(url, body, signal?)` function. It serializes the supplied body synchronously and delegates the resulting POST request to the existing `requestJson`. `requestJson`, JSON response reading, HTTP error mapping, localized messages and cache behavior remain unchanged. The helper adds no options object, configurable method, world-selection logic, decoder or error wrapper.

There are exactly 13 converted call sites: five in `worlds.ts`, four in `writingAssistance.ts` and four in `backup.ts`. The ordinary command wrappers remain ordinary functions, while the existing async wrappers and their decoding remain async. URL construction and body construction still occur at invocation time. In particular, `withWorldQuery` and `withWorldBody` read the selected world before the request starts; later selection changes cannot redirect a pending request. Lookup language mapping and the fixed grammar language remain unchanged. Binary transfers, synchronization paths and other request variants are outside this diff.

The helper uses `arguments.length > 2` to preserve the existing request shape: 11 callers omit the signal property, while lookup and grammar check supply it even when its value is `undefined`. This is a small compatibility detail with direct characterization, not a generic options mechanism. Real signals are forwarded by identity. Keeping this helper non-async also preserves synchronous serialization exceptions at ordinary call sites; making it async would silently turn those into promise rejections.

The simplification removes repeated request assembly without absorbing gateway responsibilities. There is no new public platform API export, and a source search found only the helper, these 13 production calls and its direct tests. No additional abstraction or behavior-specific test is requested.

## SIM 02 Characterization quality

The tests exercise gateways through real request assembly and response handling, replacing `fetch` rather than mocking the new helper or `requestJson`:

- World tests cover all five operations with exact URLs, serialized bodies, headers, cache and absence of a signal property. They check selected and unselected state, request creation before awaiting, world changes while a request is pending, and preservation of synchronous throws versus async rejection when serialization fails. They distinguish decoded open/create results from passthrough command responses.
- Writing-assistance tests cover all four operations and both explicit signals and explicit `undefined` for lookup/check. Strict request assertions retain signal presence and identity, request bodies, language fields and immediate request creation. Malformed decoded results remain errors; successful install responses remain passthrough values.
- Backup tests cover all four operations with a selected world containing query-sensitive characters and with no world selected. They check the exact query/body representation, immediate state capture and absence of signal properties. Snapshot/restore decoding remains distinct from login/logout passthrough handling.
- Across the gateway groups, structured application error codes, categories, parameters and retryability remain intact. Native network and abort rejection objects retain identity. Malformed and invalid-JSON responses preserve the existing distinction between decoding and passthrough behavior. Existing request tests still assert localized error messages.
- Five new helper cases establish serialization before fetch, omitted versus explicitly supplied signals, synchronous `toJSON` failure and rejection of circular/BigInt bodies before any request starts. These cover meaningful observable edges of the extracted function.

The tests use synthetic fetch rejection for native network and abort errors; this review does not claim a real browser/network cancellation exercise. Signal forwarding and the unchanged fetch path are sufficient for the bounded extraction. Existing assertions were not weakened to accommodate changed behavior.

## SIM 02 Independent checks

The critic executed the following exact commands from the SIM-02 checkout; the Vitest command ran outside the sandbox with the installed runtime:

```powershell
node node_modules/vitest/vitest.mjs run packages/client/src/platform/http/request.test.ts packages/client/src/platform/http/worlds.test.ts packages/client/src/platform/http/writingAssistance.test.ts packages/client/src/platform/http/backup.test.ts
node tools/quality/check_platform_boundaries.mjs
git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev2 diff --check e2d5cad bd7f5a0
```

Results: **66 tests passed in four files**; platform-dependent capabilities remained isolated behind `PlatformGateway`; whitespace check passed. No independent review run failed. The implementer reports 169 passing HTTP tests before and 174 after extraction, plus platform/Biome/whitespace checks. Those broader runs remain attributed to the implementer; the critic verified commit scope and reran the four affected test files independently.

## Phase 3 combined integration boundary

SIM-05 at `ad57a5f` and SIM-02 at `bd7f5a0` satisfy their narrowed plans and are accepted for integration. Their source and test files are disjoint. Independent Phase 3 verification comprises 48 real-SQLite storage tests, 66 HTTP tests, the platform boundary check and both whitespace checks. No actionable finding or additional product change remains for either reviewed patch.

All six narrowed simplifications have now passed independent patch review. The rejected or deferred broader abstractions remain outside that acceptance, including cross-module SQL deletion and broader normalization helpers. If integration alters a reviewed diff, reassess the affected portion. The required `npm run build` and `npm test`, relevant backend checks and release checks still belong on the integrated revision; they were not rerun as full gates for this targeted review. Passing these patches does not establish that the release or the entire project is defect-free.

The critic edited only this report for implementation review. No source/test edits, commits, pushes, tags or server actions were performed.

## Release completion review: missing native exit status

**Verdict: the logged preflight and five-file version transaction are supported; a captured native exit 0 for the complete updater invocation is not. The proposed bounded recovery and full rerun are justified to meet that explicit completion criterion. This is an external launcher/evidence defect, not a new rejection of the six product patches.**

Reviewed run: `C:/Users/timra/AppData/Local/CodexWork/quiltor/dev3-version-updater/20261009T155634649Z-4e7b16a2b8f1457a88e27584e5400854`. Its `started.json` records `npm run set-version -- patch`, the integration checkout, launcher PID 26404, start time `2026-10-09T15:56:34.6754111Z`, and matching expected/actual revision `90332abc2cd19b6b2554441756350b529b467ea3`.

### What the evidence establishes

The critic inspected both retained logs, the saved original launcher, the corrected launcher currently on disk, the integration checkout's authoritative updater/preflight/Python resolver, and the actual version diff. At inspection, HEAD was still `90332ab`, with exactly five modified files: `VERSION`, `package.json`, `package-lock.json`, `Cargo.toml`, and `Cargo.lock`. The complete diff changes only their seven version entries from 3.22.0 to 3.22.1; no product, updater, preflight or resolver modification was present. `git -c safe.directory=C:/Users/timra/git/quiltor/quiltor-dev3-integration diff --check` passed.

The logs contain these completed suite summaries:

| Suite           | Recorded result                         |
| --------------- | --------------------------------------- |
| Backend         | 1134 tests run, OK, including 6 skipped |
| CLI             | 4 tests run, OK                         |
| Frontend        | 1598 passed across 230 files            |
| Product browser | 338 passed, 193 skipped                 |
| Design browser  | 144 passed                              |

The stdout sequence also includes formatting, portable Rust checks, frontend build and committed-dist comparison, wheel/sdist builds, isolated wheel checks, and both container build/verification groups. The decisive final preflight marker is stdout line 2270, after the browser/design summaries, followed by the version transition and all five updated-file messages at lines 2271-2276 and the final commit guidance. An earlier identical preflight marker at line 230 occurs during backend test output and must not be mistaken for the real run's completion.

This sequence has a concrete control-flow basis. `release_preflight.py:134-147` rejects a nonzero gate subprocess return code. `run_preflight` runs the declared checks, portable artifact builds and browser suite before printing its final success line at 661. Browser teardown failures are propagated before that point. `set_version.py:390-411` only proceeds after preflight returns and the validated five-file replacement succeeds. Its observed final guidance at lines 413-423 is followed by `return 0` and `SystemExit(main())`. The Node resolver forwards the Python status with `process.exit(run.status ?? 1)`.

Consequently, the available evidence supports that the gates completed and the updater reached its normal success path after writing 3.22.1. It does not support calling the entire launcher invocation successful, nor does it turn pre-bump artifact checks into published/signed 3.22.1 release artifacts.

### The missing observation

The original external launcher clears `$LASTEXITCODE` at line 127, invokes Node/npm at line 128, reads `$LASTEXITCODE` at 129 and throws on null at 130, before writing the exit file at 131. The recorded `launcher-error.txt` identifies precisely that null-status exception. Its catch path sets the launcher result to 1. `updater.exitcode.txt` is absent.

The saved artifacts contain no captured native exit status for the top-level updater process. The retained npm debug logs show exit 0 for subordinate build/test commands, but contain no `npm run set-version` log. Those subordinate results and the Python success-path messages do not substitute for the missing top-level observation. A process can reach its last normal application message without that message being an operating-system exit record. The exact reason PowerShell left the variable null was not independently reproduced by the critic; local/global exit-variable shadowing is the correction author's diagnosis, not an additional proven finding here.

Do not manufacture the old exit file, infer its value from a later successful command, or describe the missing capture as a failed product gate. Without an independently retained process result, source inspection cannot retroactively supply the promised native-exit observation.

### Recovery plan assessment

The proposed recovery is proportionate and accepted with the following execution conditions:

1. Preserve the original launcher, complete old logs, start/error records, exact five-file diff and current manifest bytes before restoration. Keep this run recorded as gates/version update completed with launcher completion failure.
2. Correct only the external launcher's process-status capture. The inspected revision now starts Node/npm through `Start-Process -PassThru -WindowStyle Hidden`, redirects both logs, waits for exit, refreshes the retained process object and reads its `ExitCode` at lines 128-136. This removes dependence on `$LASTEXITCODE` for the updater. Static inspection supports the approach; isolated zero/nonzero child-process probes still need to demonstrate exact status propagation, log capture and failure handling through the actual corrected capture path. A null or unavailable result must remain failure, never default to zero.
3. Before restoring anything, recheck HEAD, branch and the complete status/diff. Only the five generated manifests may differ, and only by the reviewed version transaction. Save them, then restore only those exact paths from `90332abc2cd19b6b2554441756350b529b467ea3`. Stop if concurrent or unexpected edits appear. Do not use a blanket reset/clean, change product code, commit a temporary rollback or alter Git history.
4. Verify the checkout is completely clean at that revision and all version copies are again 3.22.0. Run the unchanged supported `npm run set-version -- patch` once through the corrected launcher with a new artifact directory and the same pinned toolchains. Run its complete preflight; do not call `apply_version` directly, reuse a partial gate selection, or apply another patch bump while 3.22.1 remains present.
5. Accept completion only after observing and recording the actual native updater exit 0, successful launcher completion, fresh full-run logs, unchanged expected HEAD and the exact five-file 3.22.0-to-3.22.1 diff. Any new nonzero/null result remains unresolved; no automatic retry to 3.22.2 is authorized by this plan.

The full rerun is necessary for the stated completion promise if the original process result cannot be recovered; it is not required because the existing successful gate evidence has become false. No supported resume/skip mode exists in the inspected updater, and its clean-tree/increasing-version guards explain why bounded restoration must precede repetition. The critic did not execute these recovery steps or either updater run.

### Evidence identities and review limits

SHA-256 values recorded during inspection:

| Evidence                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `Invoke-ApprovedVersionUpdater.original.ps1`  | `6f74b05a6d993f71e3193dedfc2808dcf3590f5cfd89ce4bef4dd9c295713f9b` |
| Corrected `Invoke-ApprovedVersionUpdater.ps1` | `0974d064233db5fc0ca394983950829a8b66deb033053082f063192c355b0f33` |
| Original run stdout                           | `d695a78b58ef678dc46515e4692c26cb060bfb4e7b538984f33b2dbd2060fa42` |
| Original run stderr                           | `72c4d84021e3e7cf9be4d05e27d1aba9b21fa562a0179b8f557a5f94d8ef3675` |

This addendum is a read-only diagnostic review plus an update to this report. The critic ran no product suite, launcher probe, updater, restoration, version bump or server action. The suite counts above are independently inspected original-run evidence, not fresh critic test executions. Product patch acceptance remains unchanged; release completion remains pending until the missing observation is satisfied.

## CI recovery plan review: Windows dependency installation

**Pass for one bounded retry of the demonstrated installation failure on unchanged SHA `9695cd4e72091a782377912a8bff08bab5f4f6d0`, after the remaining jobs finish. Any additional failed job must be classified from its own evidence before inclusion; a product assertion failure does not inherit this approval.**

The coordinator reports that the second local updater run captured native exit 0 and launcher exit 0 and that the release commit reached main. That is subsequent context for the historical launcher review above; this short review independently checks the CI failure and recovery plan, not the second local run or live publication status.

The critic read `job.json` and `job-log.raw.log` in `C:/Users/timra/AppData/Local/CodexWork/quiltor/dev3-ci-monitor-3.22.1/failed-job-113928073943`, and the two workflow definitions directly from the stated release commit. Test run `37961937563`, attempt 1, job `113928073943` is `Product on windows-2025 / shard 5 of 8`. Both job metadata and the checkout log identify the exact release SHA. Step 5 (`npm ci`) failed with exit 1; Chromium installation, unit tests, application installation/start and the product suite were all skipped. No product assertion ran in this job. The successful diagnostic-upload step found no test/server files and is not test evidence.

The log records `EEXIST`, syscall `rename`, and an `ENOENT` message for movement from `C:\npm\cache\_cacache\tmp\b213b91f` into the content-addressed cache. It also records an `EPERM` cleanup warning under `node_modules`. These establish the failure stage and symptoms, not the underlying cause. In particular, setup-node reports `npm cache is not found` at raw-log line 131. A corrupted restored Actions cache, concurrent access, antivirus interference or a transient runner defect is therefore not an established diagnosis. The runner used Node 22.23.2 and npm 10.9.8 as expected.

The unchanged workflow selects a GitHub-hosted Windows runner, enables npm caching and executes installation before unit/product tests. One new job attempt with the same SHA and unchanged workflow/lockfile is a reasonable way to obtain the missing test execution and check whether the install failure recurs. A new runner does not itself establish an empty npm cache or identical external state; retain the retry's runner identity, cache restore output, attempt/job IDs and full logs. Even a successful retry would establish success of that attempt, not prove the original root cause.

After the remaining jobs finish, retry only the evidenced failed job(s) once. Preserve the first failure; make no speculative cache deletion, source/workflow change, force-install, version bump or manual tag. Require successful installation and actual unit/product execution in the replacement job, then assess the final Test result. If the same installation failure recurs, stop retries and inspect the npm debug log, cache provenance and workflow/runner environment. If a different failure appears, diagnose that failure rather than automatically retrying again.

Release Build `37961937425` has a separate portable release gate: at this SHA, `release.yml:37-63` runs the full `release_preflight.py`. Its eventual outcome must be evaluated independently and does not turn the skipped Windows shard into a pass. No overall green CI or completed release is asserted here. The critic performed no CI action or product edit and only appended this review to the existing report.

## CI recovery plan extension: Windows backend setup timeout

**Pass to include job `113926686234` in the same one-time retry on unchanged SHA `9695cd4e72091a782377912a8bff08bab5f4f6d0`, after all remaining failures have been individually classified. This is a retry of a genuine failed backend run with an unresolved cause, not acceptance of a proven runner flake.**

The critic inspected the job JSON and raw log in `C:/Users/timra/AppData/Local/CodexWork/quiltor/dev3-ci-monitor-3.22.1/failed-job-113926686234`, the test and route at the exact release revision, the world-creation call path, and Dev 3's retained file-identity evidence. In Test run `37961937563`, attempt 1, `Core on windows-2025` completed its backend step with exit 1: **1134 tests run in 311.946 seconds, errors=1, skipped=3**. The subsequent Portable core step was skipped. This job differs from the npm-install failure: its backend suite did execute, but the named test body did not.

The error is in `ServerAssistantRouteTests.setUp`, at `test_server_assistant.py:134`, during `POST http://127.0.0.1:<assigned-port>/api/worlds/create` with `{"title":"Testwelt","backupUrl":""}`. The fixture starts a real server on loopback port 0 and uses the assigned port. `_request` at line 119 supplies `timeout=5`. The stack ends while reading the HTTP response status (`http.client._read_status` to `socket.recv_into`), before even the fixture's status-200 assertion and before the progress-authorization test body. It does not identify a failed authorization assertion, a connection refusal, or the server-side point at which time was spent.

The route reads JSON, takes `app.lock`, invokes `app.worlds.create`, then sends JSON after releasing the lock. Creation goes through the world use case and SQLite repository into `world_catalog.create_world`, which initializes the world database and writes initial metadata/chapter/tree rows. The retained exact-base comparison confirms unchanged test/HTTP host/route files. However, unchanged entry points do not exclude timing or storage effects elsewhere in the process: the release changes the Story World and Storyboard persistence modules, and the client traceback contains no server stack, lock-wait measurement or storage timing. No concrete execution point inside a refactored helper is established either. The reported two successful complete local Windows runs and Linux backend success support trying once again, but do not explain this failure.

One unchanged full-job retry is therefore a reasonable bounded diagnostic step without guessing at a product fix. Preserve attempt 1 and capture the new attempt/job/runner identity and complete logs. Success must cover the full backend suite and the previously skipped Portable core step, not only the named test. Do not increase the timeout, insert sleeps, skip tests, alter storage or reset caches to obtain green. A repeated setup timeout ends this retry allowance and requires targeted diagnosis of server scheduling, request handling, application-lock ownership, world creation/storage and fixture resource cleanup. A different failure also requires classification before further action. A successful repeat would establish that attempt's result, not retroactively prove an infrastructure-only cause.

The critic made no CI mutation, ran no test or retry, and changed only this report. Existing product patch acceptance remains unchanged; final CI and publication acceptance remain separate.
