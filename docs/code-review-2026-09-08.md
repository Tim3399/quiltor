# Code review — 8 September 2026

Reviewed version: **3.16.2**, commit `99102cc`. The checkout was clean before this review. Review scope: current implementation, with particular attention to persistence, backup/restore, authentication boundaries, client saves/imports, Assistant proposal acceptance, language consistency and README accuracy.

Six behavioral defects were reproduced against the reviewed commit. The follow-up implements corrections for all six defects and the developer-language finding. The descriptions and line numbers below document the original failures at `99102cc`; the resolution section describes the changes. Reproductions and regression tests use isolated temporary worlds, without reading or changing author data.

## Findings

### 1. [P1] Restoring the oldest local backup can empty the active world

Location: [`restore.py`](../src/quiltor/infrastructure/persistence/sqlite/restore.py), lines 79–83; rotation at lines 45–46.

`restore_backup()` first calls `backup_if_due(force=True)`. When the directory already contains the normal maximum of 40 backups, this safety backup rotates away the oldest file. If that is the selected restore source, the subsequent `sqlite3.connect(source_path)` silently creates an empty database at the deleted path. Copying that database overwrites the active world. Initialization then creates an empty current schema, and the restore reports success.

Reproduction: create a current-schema world with a chapter, fill its backup directory with 40 normal backups, and restore the oldest one. The selected source changed from 294,912 bytes to zero bytes; querying the active world's chapters returned an empty list. The newly created safety backup still contains the previous active world, but the chosen historical backup has been destroyed.

Required correction: protect or stage the selected source before any retention cleanup; open restore sources read-only and validate them before touching the active world. Add a regression test at the retention limit.

### 2. [P1] A failed save still allows the author to leave the world

Location: [`useAutosave.ts`](../packages/client/src/app/workspace/useAutosave.ts), lines 40–45; [`Application.tsx`](../packages/client/src/app/Application.tsx), lines 160–168.

`flush()` catches a rejected save, sets the error state and then resolves successfully. `returnToWorldSelection()` awaits `flushAll()` and proceeds to close the world. Opening a world afterward loads server documents over the dirty local documents and resets their histories. Network errors and revision conflicts can therefore cause unsaved author changes to be lost. Other callers that flush before generating snapshots, PDFs or Assistant context can also continue with stale server data.

Reproduction: reject a dirty document's save, await its explicit `flush()` and invoke the continuation used to close the world. The continuation runs even though the save phase is `error`. A temporary Vitest test confirmed this behavior.

Required correction: return an explicit failure or reject explicit flush requests, handle background autosave failures separately, and keep navigation or dependent operations blocked until the author has resolved the save failure. Preserve retry behavior and test both network rejection and HTTP 409.

### 3. [P2] Retrying a remote backup can report success without uploading

Location: [`snapshots.py`](../src/quiltor/infrastructure/backup/snapshots.py), lines 539–544.

`SnapshotStore.commit()` returns early when local content is unchanged, before considering `push`. A snapshot is persisted locally before the remote upload. If that upload fails, a second attempt sees no local changes and returns `ok: true` with `Everything is already backed up.` without contacting the endpoint. Creating a local-only snapshot and later requesting upload of the unchanged world has the same problem.

Reproduction: make the gateway fail on the first upload, then restore gateway availability and repeat the same commit with `push=True`. The retry reports success, while the gateway's total push call count remains one.

Required correction: upload an existing snapshot when upload is requested; distinguish the local snapshot state from successful remote delivery. Test outage/retry and local-only-then-upload workflows.

### 4. [P2] A torn history-index write breaks subsequent snapshots

Location: [`snapshots.py`](../src/quiltor/infrastructure/backup/snapshots.py), lines 573–574; recovery reader at lines 448–450.

`entries()` tolerates a syntactically incomplete final JSON line but leaves that line on disk. A later commit appends its new JSON directly to the incomplete text. That successful commit is then hidden by the same recovery reader. On the following commit, the malformed line is no longer the last line, and reading the entire history fails with `BackupContractError`.

Reproduction: create one valid snapshot, append `{"format":` without a newline to `index.jsonl`, change the world, and commit again. The commit reports success but only the original snapshot remains visible. Change the world again and commit: the operation raises `BackupContractError`.

Required correction: repair a recoverable final line before appending, retaining the complete validated prefix. Test resumed writes after interruption, not just reading an interrupted file.

### 5. [P2] Malformed figure imports can crash the application

Location: [`figureTransfer.ts`](../packages/client/src/modules/story-world/figures/figureTransfer.ts), lines 66–86; consumer in [`worldReferenceIndex.ts`](../packages/client/src/modules/world-references/worldReferenceIndex.ts), lines 61–70.

The importer checks the top-level arrays, node IDs and some profile fields, then casts the result to `FigureState`. It does not validate required node names and other structural invariants before replacing the live document. The following input is accepted:

```json
{ "nodes": [{ "id": "broken" }], "edges": [] }
```

Building reference candidates then calls `node.name.trim()` and throws an unhandled `TypeError`. This crashes the application after import confirmation; recovery by reload can lose other unsaved work.

Reproduction: run the actual parser and reference-index builder on this payload. A temporary Vitest test and a separate execution of the actual modules through Vite SSR both confirmed acceptance followed by the exception.

Required correction: validate the complete import document, including required fields, IDs and references, before replacing live state. Reject invalid imports with an actionable message and preserve the current document.

### 6. [P2] Assistant proposals can be marked applied despite being skipped

Location: [`useAssistantConversation.ts`](../packages/client/src/modules/assistant/useAssistantConversation.ts), lines 306–312; [`proposals.ts`](../packages/client/src/modules/assistant/proposals.ts), lines 98–115; group actions in [`AssistantConversation.tsx`](../packages/client/src/modules/assistant/AssistantConversation.tsx), around line 395.

The review UI permits accepting a relationship group before the groups that create its endpoints. Applying that relationship skips it because the elements do not exist yet. However, the conversation records all requested indices as applied, regardless of what the mutation function actually changed. Accepting the element groups afterward leaves the relationship absent and its apply action unavailable.

Reproduction: prepare two element-creation proposals and a relationship between them. Accept the relationship first, then the elements. All three indices become applied, but the result contains two elements and no relationship. Accepting the same proposals together produces the expected relationship. Both a temporary Vitest test and direct module execution confirmed the difference.

Required correction: validate proposal dependencies and record only successfully applied proposals. Keep skipped or unresolved proposals reviewable; communicate why they could not be applied.

### 7. [P3] Developer-facing language is still mixed

The repository's convention in [`CLAUDE.md`](../CLAUDE.md) requires English developer-facing text. German product text, quotations of the interface and manuscript fixtures are intentional and were excluded from this finding.

Representative violations in the reviewed commit:

| Category             | Locations                                                                                                                                                                                         | Examples                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Runtime logs         | `src/quiltor/delivery/http/routes/documents.py:103–114`; `src/quiltor/infrastructure/pdf/page_numbers.py:74`                                                                                      | German save summaries and a page-number warning                    |
| Startup/setup output | `src/quiltor/hosts/web/server.py:620–657`; `src/quiltor/hosts/cli/main.py:231–346`; `src/quiltor/infrastructure/inference/installer.py:141–165`                                                   | Mixed German and English output                                    |
| Technical errors     | `src/quiltor/infrastructure/persistence/sqlite/revisions.py:18`; `src/quiltor/infrastructure/writing_assistance/languagetool.py:132,161,169`; PDF adapters                                        | German diagnostic exceptions                                       |
| Comments             | `pyproject.toml:12–14,121–123`; `packages/client/src/modules/manuscript/EditorSurface.css:1`                                                                                                      | German toolchain rationale and `Das Blatt.`                        |
| Test declarations    | `packages/client/src/modules/history/SnapshotDialog.test.tsx:149`; `packages/client/src/modules/manuscript/ManuscriptEditor.test.tsx:174`; `tests/python/test_web_server_connections.py:21,45,57` | At least five German declarations, including a parameterized title |
| Test diagnostics     | `tests/e2e/support/native-control-audit.ts:99,101,204`; `tests/e2e/storyboard.spec.ts:904,934`; `tests/e2e/design-product-matrix.spec.ts:159,169,172`                                             | German assertion messages                                          |
| Test identifiers     | `tests/python/test_web_server_connections.py`                                                                                                                                                     | `uebergeben`, `fehler`, `_protokoll_von`, `puffer`, `vorher`       |

Comments and docstrings were mostly English in the inspected areas. The UI catalogs pass the i18n gate; that gate checks catalog parity and visible UI strings, not the language of comments, logs or test output. Diagnostic messages and their dependent assertions must move together. Persisted compatibility keys and German test content are excluded from this cleanup.

## Resolution

These corrections are prepared as patch version **3.16.3**.

The implementation was split between three agents for persistence, client behavior and developer language. Their changes were reviewed before integrated validation; the persistence agent also independently reviewed the client changes.

| Finding                 | Correction                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Local restore        | Validate the selected SQLite source read-only and stage it before retention cleanup. Migrate and advance revisions on the staged database before replacing the active world. Regression coverage includes the 40-backup boundary, corrupt/empty sources and legacy databases.                                         |
| 2. Save failures        | Explicit flushes reject on failure and drain edits made during an in-flight save. World exit and logout wait for successful saves; snapshots, history, restores and other dependent operations handle rejection. Background saves and retry controls retain visible error state without unhandled promise rejections. |
| 3. Remote retry         | Upload an existing unchanged snapshot when requested, retaining the original local history entry. Failed delivery remains a failure on retry.                                                                                                                                                                         |
| 4. Interrupted history  | Validate the retained index prefix, remove only a recoverable incomplete final record before appending, and flush the completed append to disk. Complete invalid records remain errors.                                                                                                                               |
| 5. Figure imports       | Pass legacy import payloads through the existing complete story-world decoder before they can replace live state. Preserve legacy profile/note normalization and reject malformed fields and references.                                                                                                              |
| 6. Assistant acceptance | Resolve selected creation dependencies first and return applied indices plus explicit skip reasons. Record only successful proposals as applied; unresolved suggestions remain available for a later retry with localized feedback.                                                                                   |
| 7. Developer language   | Translate inspected comments, setup output, technical exceptions, logs, test declarations and diagnostics to English. Preserve German author-facing strings and fixtures. Typed inference exceptions keep Assistant error codes independent of translated diagnostic wording.                                         |

## Current implementation and documentation

Quiltor now has five implemented client workspaces, shared formatted notes and references, hierarchical chapter organization, calendar projections, deterministic temporal world state, and expanded manuscript-driven world proposals. Python/SQLite remains the storage implementation; the Rust crates currently provide timeline policy and a contract-version ABI. Mobile hosts and store targets are still scaffolds where the distribution profiles say so.

Both root READMEs were updated to cover these features, distinguish implemented hosts from future targets, correct development/API port 8010 and the Python test discovery command, document the committed-client build requirement, and reflect the English developer-text convention. Detailed architecture plans remain target designs rather than evidence of completed implementations.

## Verification after the corrections

| Check                                                                   | Result                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend unit/component suite                                           | 203 files, 1,191 tests passed                                                                                                                           |
| Python backend suite                                                    | 912 tests, successful; 6 platform/optional tests skipped                                                                                                |
| TypeScript project build                                                | Passed (`tsc -b`)                                                                                                                                       |
| Vite production build                                                   | Passed; committed `dist/` regenerated from the corrected source                                                                                         |
| Rust unit tests                                                         | 3 passed during the initial review; Rust source unchanged by these corrections                                                                          |
| Rust formatting and Clippy                                              | Passed during the initial review, including warnings as errors                                                                                          |
| Contracts, architecture, design, design-system, i18n and platform gates | Passed                                                                                                                                                  |
| Biome formatting                                                        | Passed, 881 files                                                                                                                                       |
| Python formatting                                                       | Passed with pinned Ruff 0.16.4, 309 files                                                                                                               |
| Distribution contract/version validation                                | Passed for all 9 profiles during the initial review; profiles unchanged                                                                                 |
| New product browser regressions                                         | 12 passed: save network failure, revision conflict, invalid import and Assistant retry, each at 3 viewport sizes                                        |
| Existing related product browser tests                                  | 22 passed, 2 viewport-specific cases skipped; saving, snapshots, history, world exit and Assistant acceptance                                           |
| Defect and classification regression evidence                           | Original defects reproduced before correction; regression tests pass afterward. Removing typed inference classification makes its regression test fail. |

The full `npm run check` and production build passed, including repository Markdown/YAML/HTML formatting. Local links across the changed documents resolve, and `git diff --check` passed. Product browser tests ran against the regenerated `dist/` and a restarted Python server using a separate temporary data directory. The two final diagnostic-only Python edits were additionally checked against their actual Java-version and missing-job error paths.

The initial shell selected an interpreter without JWT/Ruff dependencies; the backend suite was rerun successfully with the existing `.venv-desktop` interpreter (Python 3.12.14). The npm wrapper also required a process-local prefix adjustment. These are local execution-environment facts, not application regressions. The final Python interpreter differs from the pinned release build version, so this run does not replace release preflight.

The complete product/design browser suites, native installer smoke tests, actual local-model evaluation and live deployment tests were not run. Browser Assistant tests use simulated model responses and real temporary-world persistence. No dependency vulnerability advisory scan was performed. Inspected OIDC validation, world ownership, backup endpoint binding and manifest validation did not reveal a concrete authentication bypass; this is a focused code review, not a claim of complete security coverage.
