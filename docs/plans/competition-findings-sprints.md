# Competition findings: delivery plan and acceptance ledger

Source: `quiltor-todo-konkurrenz-findings.md`, supplied by the owner on 2026-09-19.
Scope: QF-01 through QF-09. The source is proposal material; the owner's subsequent
instruction authorizes implementing the scoped requirements and verifying every sprint.
The [requirement acceptance matrix](competition-findings-acceptance.md) tracks every
individual source checkbox, its task and eventual evidence.

Baseline: `release/design-3.20.0` at `c533d33`, in the isolated `feature/qf-sprints`
worktree. Other worktrees and their uncommitted changes remain separate.

## Delivery decisions

- Preserve the existing five workspaces, design system, local writing and no-prose-AI policy.
- Reuse save lanes, optimistic revisions, SQLite safety copies, chapter comparison and
  references. Existing behavior needs evidence, not a second implementation.
- A recoverable delete is distinct from removing a chapter from the current book.
- Implement book inclusion as an explicit chapter property, never a special folder name.
  The owner has no current personal need for this feature; keep its implementation bounded.
- Portable project transfer is in scope. The broader DOCX/Scrivener manuscript import
  roadmap is not silently added to this list.
- Cloud requirements are launch gates for an optional service. No price, billing period,
  subscription entitlement, storage quota, retention promise or full sync capability is
  invented. An unavailable service remains explicitly unavailable. Conditional gates must
  be reported as such, never misrepresented as passed integration tests.
- No publishing, billing activation, release tagging or version bump is needed to verify
  these changes locally.

## Status rules

`planned` → `implementing` → `review` → `accepted`.

Acceptance requires the lead to inspect the actual diff and evidence. An existing feature
can be accepted with a focused behavioral check. A conditional commercial gate records
its condition and evidence; it is not counted as an implemented sync service.
Failed checks and unavailable checks remain visible in the ledger.

## Sprint 0 — Baseline and boundaries

Status: accepted.

| Task                          | Acceptance                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| S0.1 Repository baseline      | Isolated current product branch; relevant instructions read; existing edits preserved.  |
| S0.2 Requirements mapping     | Every QF requirement maps to a task below or an explicit existing/conditional behavior. |
| S0.3 Verification environment | Installed pinned tools and dependencies usable; owned test data and ports isolated.     |

## Sprint 1 — Save, recovery and migration safety

Status: accepted. Depends on Sprint 0.

| Task                           | Requirement | Acceptance                                                                                                                                               |
| ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1.1 Honest save state         | QF-02       | Dirty, pending, confirmed save and failure remain distinct; local/remote backup failures are not conflated with durable document saving.                 |
| S1.2 Emergency recovery        | QF-02       | Latest unsaved text can be copied/downloaded without a successful save; all document families have a rescue file; failures retain editor state.          |
| S1.3 Guard transitions         | QF-02       | Logout, world switch, restore/import/reset cannot discard pending edits; platform close warning is additional protection, not a crash guarantee.         |
| S1.4 Two-session conflicts     | QF-02/03    | A stale writer cannot silently overwrite; both versions are available for explicit review/rescue; no unsafe reload advice; retry works after resolution. |
| S1.5 Migration safety          | QF-06       | Preserve an unmodified pre-migration copy; rejected/failing migration does not damage the active project; future versions fail safely.                   |
| S1.6 Recovery failure fixtures | QF-02/03/06 | Read-only/full-storage errors, interrupted save, corrupt restore and old-schema open/edit/read/export are covered at relevant boundaries.                |

Ownership: save recovery worker (frontend), migration safety worker (SQLite), lead
(integration and conflict/retry contract review).

## Sprint 2 — Recoverable deletion

Status: accepted. Depends on Sprint 1 safety contracts.

| Task                               | Requirement | Acceptance                                                                                                                                                         |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S2.1 World tombstones              | QF-01       | Normal project delete keeps DB, backups and history; restart-safe owner-scoped trash; stale tabs cannot edit a trashed world.                                      |
| S2.2 World trash UI                | QF-01       | Project selection exposes labelled trash; restore preserves identity; permanent purge is a separate explicit confirmation; no automatic purge.                     |
| S2.3 Manuscript trash              | QF-01       | Chapter delete preserves id, text, notes, anchors, marks, references, previous inclusion and original placement; immediate undo plus persistent trash.             |
| S2.4 Find and restore              | QF-01/07    | Search title/content inside visible trash, see type/time/location/preview, restore to original folder or explain root fallback.                                    |
| S2.5 Folder and other-object rules | QF-01/06    | Folder removal retains chapters; reference behavior for deleted world elements/boards is explicit and tested; no accidental cascade deletion from reference cards. |

First trash slice covers manuscript chapters and complete projects. Existing folder deletion
keeps children; retain that behavior. Rules for other content types must describe actual
undo/backup/permanent-delete behavior and must not advertise nonexistent individual trash.

## Sprint 3 — Book inclusion and consistent scope

Status: accepted. Depends on Sprint 2 manuscript lifecycle.

| Task                           | Requirement | Acceptance                                                                                                                                |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S3.1 Explicit inclusion        | QF-04       | In-book/set-aside state persists; actions explain retained text; marked tree rows and filter; no text copies or new archive workspace.    |
| S3.2 Output and navigation     | QF-04       | Book view, page rendering/PDF, standard book export, chapter turns and current-book counts use one consistent inclusion rule.             |
| S3.3 Search and analysis       | QF-04/07    | Set-aside chapters remain findable; default manuscript analysis excludes them; explicit selection has visible scope; trash is excluded.   |
| S3.4 References and canon      | QF-04/06    | Storyboards open the same chapter id; confirmed facts are retained; changed source scope is visible where source evidence exists.         |
| S3.5 Statistics and regression | QF-04       | Current book count changes without rewriting historical records; no new statistics subsystem; restart/restore/export round trip verified. |

## Sprint 4 — Portable projects and understandable restoration

Status: accepted. Depends on Sprint 2/3 persisted model.

| Task                    | Requirement | Acceptance                                                                                                                                                                            |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4.1 Portable contract  | QF-05       | Versioned complete current-project transfer includes manuscripts (including set-aside/trash), folders, notes, world, relationships, timeline, boards, references and required images. |
| S4.2 Import as copy     | QF-05       | Validate size/version/structure/assets before publication; new project identity, preserved internal ids; fresh owner; no account credentials or remote endpoint inherited.            |
| S4.3 Transfer UI        | QF-05/07    | Book export, project transfer and backup restore have distinct labels; inclusion/exclusion of trash/history is shown; no cloud account required.                                      |
| S4.4 Restore preview    | QF-03       | Inspect content before restore; current state remains protected; reuse existing history/comparison; invalid snapshots leave the project untouched.                                    |
| S4.5 Storage visibility | QF-03       | Actual project storage and last successful backup are discoverable; folder opening only when host capability supports it.                                                             |
| S4.6 Round-trip proof   | QF-05/06    | Fresh-environment import matches content, formatting, order, anchors, links and assets; exclusions separately asserted; corrupt/incompatible input leaves existing worlds unchanged.  |

A project transfer is a complete current project, not a historical backup. History inclusion
must be decided explicitly in the format and explained at export; no reduced file is labelled
as a complete historical backup. Full restore continues to use the existing backup systems.

## Sprint 5 — First-use clarity and optional-cloud release gates

Status: accepted. Depends on the implemented local workflows.

| Task                            | Requirement | Acceptance                                                                                                                                                                                                                  |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5.1 Local first writing        | QF-07       | First text without account/model download; straightforward start/install instructions; only shipped host capabilities advertised.                                                                                           |
| S5.2 Task entry and return      | QF-07       | Clear entry to writing/project import/reference lookup/selected analysis; return preserves chapter, selection and scroll; empty search links to relevant alternate scope.                                                   |
| S5.3 Honest product copy        | QF-08       | Local workshop first; optional remote backup and free transfer described accurately; licence boundaries and hosted-web distinction preserved; map described as actual map/image/place tooling.                              |
| S5.4 Cloud capability inventory | QF-08/09    | Explicit matrix of available remote backup versus unavailable full sync; no unapproved price or encryption/region/device promises.                                                                                          |
| S5.5 Local independence         | QF-08/09    | Disabled/unreachable/unauthorized remote backup does not lock local save/trash/restore/export; failures offer useful next action.                                                                                           |
| S5.6 Commercial launch gate     | QF-08/09    | Billing interval, quotas, retention, cancellation/deletion and supported platforms recorded as required decisions before sale; offline-delete/edit and simultaneous-device conflict suite required before advertising sync. |

## Sprint 6 — Integrated acceptance

Status: accepted. Depends on Sprints 1–5.

| Task                            | Acceptance                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S6.1 Required contributor gates | `npm run build` and `npm test`; changed Python suites and applicable contracts/formatting checks.                                         |
| S6.2 Product paths              | Real browser on fresh built assets/backend; write → save failure/rescue → trash/restore → set aside → transfer/reopen → compare/restore.  |
| S6.3 Accessibility and states   | Relevant empty/loading/error/success states, keyboard/focus, narrow and wide views, light/dark checked without redesign.                  |
| S6.4 Delivery record            | Every task has result, changed paths and exact checks; remaining conditional commercial gates explicit; no unverifiable completion claim. |

## Shared interaction state contract

| State              | Required behavior                                                                       |
| ------------------ | --------------------------------------------------------------------------------------- |
| Loading            | Keep existing content visible; disable only dependent actions.                          |
| Empty / no results | Explain the selected scope and offer creation, reset-filter or alternate scope.         |
| Unsaved / error    | Keep draft editable, expose independent rescue, no false success/reload instruction.    |
| Conflict           | Preserve both revisions; do not adopt a new write revision just by previewing it.       |
| Restore / import   | Preview and validate first; current state retained until explicit successful operation. |
| Trash              | Hidden from normal book/analysis, visible in dedicated scope, identity retained.        |
| Permanent purge    | Clearly named confirmation and scope; never triggered by normal delete.                 |
| Remote unavailable | Local work stays usable; remote status remains separate.                                |

## Verification ledger

### Sprint 0

- Isolated branch and source baseline verified; plan mapped to all nine findings.
- `npm run doctor`: passed. Node 22.23.2, npm 10.9.8, Python 3.12.10 and Rust 1.98.0
  match the repository pins.
- `py -3.12 -c "import quiltor; print(quiltor.__file__)"`: confirmed this worktree's
  `src/quiltor/__init__.py` is imported.
- Per-process environment for checks: `npm_config_prefix=C:\Program Files\nodejs`
  (avoids an inaccessible user-global npm launcher) and
  `PYTHONPATH=C:\Users\timra\git\quiltor\quiltor-qf-sprints\src`
  (prevents an editable install from selecting another worktree).
- Dependencies use the matching 3.20.0 checkout's existing `node_modules` through a
  local junction. No global toolchain/configuration changes were made.

Worker reports remain evidence inputs, not lead acceptance. Exact commands and results
are appended as each further sprint is reviewed.

### Sprint 1 partial review — S1.1/S1.2/S1.3 frontend

Lead inspected recovery dialog/export helpers, app wiring, save hook regressions and shared
save-status change. Accepted the emergency-export slice, including the correction that a
cancelled native download must not report success. Scope labels explicitly exclude binary
images and saved history from the in-memory JSON rescue. Conflict resolution and rendered
browser inspection are still pending; Sprint 1 is not yet accepted.

```powershell
node node_modules/vitest/vitest.mjs run packages/client/src/modules/recovery/RecoveryDialog.test.tsx packages/client/src/app/workspace/Application.test.tsx packages/client/src/app/AppShell.test.tsx packages/client/src/app/workspace/useAutosave.test.tsx packages/client/src/design/components/SaveStatus/SaveStatus.test.tsx
```

Worker evidence: 5 files, 23 tests passed; final cancellation/recovery rerun: 5 tests passed.
Targeted architecture, i18n, platform and design checks passed. Combined build/typecheck and
browser verification follow after the parallel changes are integrated.

### Sprint 1 partial review — S1.5 migration safety

Lead rejected the initial replacement of a live SQLite file because old WAL handles could
invalidate it. The revised implementation takes SQLite's writer lock, preserves a standalone
WAL-aware safety copy, and executes all existing migrations and validation in one transaction.
Failure rolls back; future/negative schema versions are rejected before writes. Lead inspected
the actual SQL transaction and real v3/v7 fixtures, including preserved references and editing.

```powershell
py -3.12 -m unittest discover -s tests/python -t tests/python -p test_migration_safety.py
py -3.12 -m unittest discover -s tests/python -t tests/python -p test_storage.py
```

Worker evidence with pinned `PYTHONPATH`: 8 migration-safety tests and 44 storage tests passed;
Ruff format/lint passed. Three existing deletion assertions were coordinated with S2.1 to
expect retention until explicit purge. S1.5 is accepted; integrated restoration/browser checks
remain scheduled.

Lead mutation proof:

```powershell
node tools/dev/mutate.mjs src/quiltor/infrastructure/persistence/sqlite/schema.py --from '_backup_database(database_path, safety_temp)' --to 'safety_temp.write_bytes(b"invalid backup")' -- py -3.12 -m unittest discover -s tests/python -t tests/python -p test_migration_safety.py
```

Expected failure observed: legacy-copy and WAL-copy checks rejected the invalid backup;
the mutation tool restored the source automatically. The run also exposed a pre-existing
connection-handle leak when connection setup encounters corrupt SQLite data. Its narrow
fix and immediate-file-release regression are assigned to the world-trash worker.

### Sprint 1 partial review — S1.4 two-session recovery

Lead inspected the document transport, exact-snapshot autosave operations, app integration
and recovery dialog. Read-only comparison keeps the original write revision. Both complete
in-memory document sets can be exported; resolution names the affected family and requires
successful export of the current reviewed snapshots. A third writer still causes a conflict.
Lead requested and verified correction of an authorization race during a pending download,
and readable planning details where equal counts would conceal content differences.

```powershell
node node_modules/vitest/vitest.mjs run packages/client/src/platform/http/documents.test.ts packages/client/src/app/workspace/useAutosave.test.tsx packages/client/src/modules/recovery/RecoveryDialog.test.tsx packages/client/src/app/workspace/Application.test.tsx packages/client/src/app/AppShell.test.tsx packages/client/src/design/components/SaveStatus/SaveStatus.test.tsx
```

Worker evidence: 6 files, 44 tests passed. TypeScript passed before concurrent manuscript
work; its later rerun identified a manuscript wire-model mismatch assigned to that worker.
Lead mutation proof deliberately made `peek` adopt the remote revision:

```powershell
node tools/dev/mutate.mjs packages/client/src/platform/http/documentTransport.ts --from 'peek: read,' --to 'peek: async () => { const value = await read(); state.revisions[kind] = value.revision; return value; },' -- node node_modules/vitest/vitest.mjs run packages/client/src/platform/http/documents.test.ts
```

Expected failure observed: the test caught an incorrect `If-Match` value (9 instead of 7).
The mutation tool restored the source. Source acceptance is complete; integrated browser
verification remains pending. A separate review found a pre-existing nested SQLite commit
between document and revision updates; S1.6 now explicitly includes its correction.

### Sprint 2 partial review — S2.1/S2.2 project trash

Lead inspected catalogue/repository/use-case routes, owner gates, revision invalidation,
gateway/session/UI and regressions. Delete/restore retain project identity and resources;
purge is separate. Corrections requested and reviewed: lifecycle/revision atomicity,
purging owned migration safety copies without neighboring files, explicit retry and stale
undo cleanup. Shared app wiring is integrated. Browser and combined gates remain pending.

```powershell
py -3.12 -m unittest tests.python.test_world_trash tests.python.test_sqlite_connection_safety tests.python.test_application_operations tests.python.test_routes
node node_modules/vitest/vitest.mjs run packages/client/src/platform/http/worlds.test.ts packages/client/src/modules/story-world/worlds/WorldGate.test.tsx packages/client/src/app/world/useWorldSession.test.tsx
```

Worker evidence: 21 Python tests and 16 client tests passed, plus no-emit TypeScript,
i18n/platform, focused Ruff and diff checks. The SQLite corrupt-connection regression
also passes and its mutation exposed Windows file-lock failure. Product-test cleanup now
permanently purges only test worlds registered by the existing cleanup fixture after closing
the page; normal user deletion continues to use trash.

### QF-06 partial review — missing references

Missing note-reference targets now have an explicit unavailable label and cannot navigate
to a nonexistent item. Editing and pasted paragraph boundaries retain stable reference ids.

```powershell
node node_modules/vitest/vitest.mjs run packages/client/src/modules/notes/NoteEditor.test.tsx packages/client/src/modules/world-references/worldReferenceBacklinks.test.ts
```

Lead run: 2 files, 28 tests passed, covering missing targets, rename identity, pasted text
and backlinks. Browser/editor creation checks remain part of Sprint 6.

### Sprint 1 further review — durable saves and real storage failures

Document writes and revision updates now share the SQLite writer transaction. Faults at
the revision step roll back all three families; two independent connections cannot both
win the same revision. The manuscript repository no longer commits an externally owned
transaction. Worker evidence: 64 storage/storyboard/tree/transaction tests passed. Its
mutation test restored the premature commit and correctly failed on persisted changed text.

The lead exercised actual read-only SQLite, exhausted SQLite pages and a competing write
lock. Failed writes retain content and revision; the same expected revision succeeds after
the restriction is removed. HTTP errors distinguish read-only/full/locked with useful
localized actions. A failed derived Markdown mirror after a committed save now returns the
actual successful revision plus a separate warning, never a false failed save.

```powershell
py -3.12 -m unittest tests.python.test_storage_failures tests.python.test_document_transaction_safety
py -3.12 -m unittest tests.python.test_document_save_status tests.python.test_application_operations tests.python.test_http_errors tests.python.test_storage_failures
```

Lead evidence: 8 and 14 tests passed, respectively. Focused Ruff passed for new tests and
save implementation; existing unrelated route lint findings were not silently rewritten.

### Sprint 3 further review — analysis scope reaches actual read tools

Book rendering, export, chapter transitions and book counts use explicit inclusion; absent
`inBook` remains true. Search retains labelled set-aside chapters. Trash remains separate.
The lead found and rejected a scope gap where tool calls could still see the original
manuscript after retrieval was filtered. The corrected completion passes the same scoped
snapshot to both paths; explicit set-aside selection includes only the selected chapters.
Confirmed canon is not deleted; source labels indicate changed source availability.

```powershell
py -3.12 -m unittest tests.python.test_assistant_runtime tests.python.test_analysis_scope tests.python.test_story_world_read_tools
```

Worker evidence: 48 tests passed, including actual tool invocations through completion.
The lead inspected the corrected call boundary and general search semantics. Combined
frontend gates and actual rendered flows remain pending.

### Sprint 4 further review — independent transfer and backup inspection

Portable archives validate all current documents and referenced images before publishing
a new owned project. The lead requested strict overflow-number/boolean/image metadata
checks and a genuinely separate destination root. The corrected round trip compares all
three documents and images; account settings, history and original revisions are excluded.

```powershell
py -3.12 -m unittest tests.python.test_project_transfer tests.python.test_project_transfer_routes
py -3.12 -m unittest tests.python.test_architecture_contracts tests.python.test_routes
node tools/quality/check_contracts.mjs .
py -3.12 -m unittest tests.python.test_backup_preview tests.python.test_storage tests.python.test_migration_safety tests.python.test_routes
```

Transfer worker evidence: 11 transfer tests, 24 architecture/route tests and contracts passed.
Lead backup/storage/migration/route run: 66 tests passed. The first combined run exposed a
legacy fixture import and the new backup routes missing from the expected route set; both
were fixed before the passing rerun. Preview preserves source bytes/mtime, current revision
and content across reconstructed services. Corrupt or changed snapshots are rejected.
Further logical-document restore validation and the rendered UI remain under review.

### Sprint 5 partial review — first use and independence

Local bootstrap no longer waits for a model-installation question before opening the UI.
The source uses optional assistant setup. README copy and the author-facing first-steps
guide distinguish local writing, hosted web, book output, full current-project transfer,
history, restore and optional remote backup. Commercial terms and unimplemented sync remain
explicitly closed launch gates in `cloud-release-gates.md`.

```powershell
py -3.12 -m unittest tests.python.test_local_remote_independence
```

Lead evidence: one test with unreachable/timeout/expired-token/quota subcases passed. After
each remote failure local save, project trash/restore and local backup restoration succeed
without another remote request. Extension to project transfer and persisted upload status
is in progress.

## Final integrated acceptance — 2026-09-19

All seven scoped sprints are accepted. Earlier partial-review notes above are the audit
trail; the final outcomes below and the 54-row acceptance matrix supersede their pending
status. The source's three preliminary tasks are fulfilled by S0 and this ledger.

### Final implementation corrections

- Local restore validates the exact staged three-document set and story-time anchors
  before changing the active database. The same validated snapshot feeds preview.
- A committed restore with failed Markdown mirrors remains successful with a warning;
  the dialog requires reload before exposing stale editor state and blocks duplicate restore.
- A confirmed remote upload with failed local status-file persistence likewise remains
  successful with a separate warning. Previous durable status remains truthful.
- Remote transfer time and snapshot id persist per world/endpoint without recording
  credentials. Local snapshots never advance remote transfer status. Transfer failure
  cases also prove local archive export/preview/import remains usable.
- A committed import whose subsequent open fails retries opening the same created project;
  it does not import again. File upload uses a stable binary media type across browsers.
- First Steps uses existing navigation/search/assistant actions. Plain German guidance
  and a linked author installation guide describe supported capabilities without a new
  workspace or unsupported manuscript conversion claims.

### Complete contributor and backend gates

Process-local environment remains as documented in Sprint 0. Python and headless Chromium
needed the approved unsandboxed process launch on this Windows host; no machine-wide
configuration changes were made.

```powershell
npm run build
npm test -- --reporter=dot
npm run check:format
py -3.12 -m unittest discover -s tests/python -t tests/python
node tools/quality/check_contracts.mjs .
```

- Build passed, including contracts, architecture, design, design-system debt, i18n,
  platform boundaries, TypeScript and regenerated tracked `dist/`.
- Vitest passed: **223 files, 1,414 tests**.
- Backend passed: **979 tests run, 5 skipped**. These are existing environment-specific
  optional checks, not skipped acceptance cases for this delivery.
- Full formatting passed: Biome checked 958 files, Ruff 331 files, and Prettier all
  configured documentation. Contracts passed after the final archive fixture formatting.
- Existing non-failing test-double React warnings, socket ResourceWarnings in remote
  tests and Vite's existing large-chunk advisory remain informational.

Initial combined failures were resolved, not hidden: save-response mocks followed the new
explicit result type; the new gateway was added to composition expectations; renamed book
export assertions were updated; new controls/styles were brought inside design contracts
without loosening debt baselines. Strict restore validation exposed an old fixture using
`blue` as a figure accent, although historical figure contracts allow only ink/gold/rose/moss.
That fixture now uses `moss`; production validation remains strict. The complete backend
suite then passed. A worker's nonexistent `npm run test:web` command was corrected to the
repository's actual Vitest command.

### Real browser acceptance and visual inspection

Fresh built assets were served from this worktree on `http://127.0.0.1:8130`, with a separate
temporary `QUILTOR_HOME` and data directory. Port ownership was verified against the newly
started Python process. Test-world fixtures purge only worlds created by their own tests.
No account or model setup was required.

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:8130'
node node_modules/@playwright/test/cli.js test tests/e2e/competition-findings.spec.ts --workers=2 --reporter=line --output=$env:TEMP/quiltor-qf-e2e
node node_modules/@playwright/test/cli.js test tests/e2e/competition-findings.spec.ts --grep 'Set-aside|Project transfer' --workers=2 --reporter=line --output=$env:TEMP/quiltor-qf-e2e-final
node node_modules/@playwright/test/cli.js test tests/e2e/editor-session-state.spec.ts --output $env:TEMP/quiltor-qf-session-e2e
node node_modules/@playwright/test/cli.js test tests/e2e/competition-findings.spec.ts --project=wide --grep 'Project transfer' --workers=1 --reporter=line --output=$env:TEMP/quiltor-qf-render-final
```

- New workflow coverage: **16 passing viewport/theme cases**, 2 intentionally redundant
  conflict-width skips. Includes actual two-session 409/rescue/resolution, project trash
  after reload, set-aside chapter trash/restore, content preview/restore with newer safety
  copy, actual binary project export/import and exact manuscript comparison.
- Session navigation: **7 passed, 8 intentional redundant-width skips**. Text → figures
  → storyboard → text retains chapter, cursor/selection, scroll and focus; chapter notes
  remain available. The compact test observes the actual modal inspector lifecycle.
- New dialogs passed Axe WCAG A/AA checks. Lead inspected generated wide and compact
  screenshots for import, First Steps and backup preview, in light/dark as applicable;
  labels, retained-content explanations, wrapping and reachable actions were legible.
- Early browser failures were test synchronization/locator issues: confirmation uses
  `alertdialog`, world return is a menu item, loading must finish before selecting the
  chapter trash, and contrast is inspected after the disabled-to-enabled button transition.
  The initial all-width run passed 11 cases; the 9 affected cases then all passed after
  those test corrections. No assertion or accessibility rule was disabled.
- After the final German guidance copy cleanup and rebuilt assets, both wide light/dark
  guide/transfer flows passed again (2 cases); this does not inflate the 23 distinct
  passing browser cases above.

Browser evidence is for local Windows Chromium at 1440×900, 900×760 and 390×844. It does not
claim a native macOS/mobile installer or a managed multi-device cloud integration was tested.
Disposable screenshots, traces and logs live under the OS temporary directory.

### Conditional requirements closed as release restrictions

QF-08.3, QF-08.5 and QF-09.3 are conditional commercial/sync launch requirements. The source
explicitly excludes forcing a cloud expansion for local delivery. Their completed outcome
is a documented closed release gate: no invented subscription price/period/retention and
no advertised full sync. They are **not** represented as implemented commercial features
or passing offline-sync tests. See `cloud-release-gates.md` for the owner decisions and
engineering acceptance required before a future offer.

The work remains on isolated branch `feature/qf-sprints`; unrelated working trees, version
numbers and release/deployment state are unchanged.
