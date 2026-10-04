# Follow-up code quality closure

Status: CLOSE-01 source corrections complete on 2026-10-04. Integrated build and browser checks
remain with the lead and browser owner.

## Was

Close the five lint findings left outside the earlier frontend and persistence work: three React
effect dependency findings in `EditorSurface`, one timezone-naive restore timestamp, and one nested
test context.

## Warum

The findings represented two concrete ownership problems rather than a need for suppressions. The
session callbacks had render-unstable identities, so adding them directly to dependency arrays
would have rerun restoration effects on every render. The restore timestamp also omitted its UTC
offset even though it records a cross-process persistence event. The nested contexts were equivalent
but obscured their intentional entry and rollback order.

## Wann erledigt

- `stopScheduledRestore` and `abandonSessionRestore` now have stable identities, while
  `captureSession` refreshes only when history mode or the selected chapter changes
  ([EditorSurface.tsx:144](../../packages/client/src/modules/manuscript/EditorSurface.tsx#L144)).
  Both restoration effects declare these callbacks explicitly
  ([history transition](../../packages/client/src/modules/manuscript/EditorSurface.tsx#L246),
  [session restoration](../../packages/client/src/modules/manuscript/EditorSurface.tsx#L312)). This
  preserves the existing trigger set and avoids restoration loops; no stale closure was reproduced,
  so the established session transition suite is the behavioral regression evidence.
- `last_restore_at` is now written as an aware UTC ISO timestamp with `datetime.UTC`
  ([revisions.py:96](../../src/quiltor/infrastructure/persistence/sqlite/revisions.py#L96)). Existing
  consumers only test presence; `datetime.fromisoformat` compatibility and the UTC offset have
  focused coverage
  ([test_chapter_story_time.py:256](../../tests/python/test_chapter_story_time.py#L256)).
- The direct foreign-key test uses one `with` statement for `assertRaises` and the SQLite
  transaction ([test_chapter_story_time.py:253](../../tests/python/test_chapter_story_time.py#L253)).
  Contexts still enter left-to-right and unwind the database transaction before `assertRaises`, so
  rollback and exception verification retain their prior order.
- Scoped Biome and pinned Ruff 0.16.4 report no findings for the owned files. No command-line
  ignores or source suppressions were added.

## Scoped verification

Executed from `C:\Users\timra\git\quiltor\quiltor`:

- `.\node_modules\.bin\biome.cmd lint packages/client/src/modules/manuscript/EditorSurface.tsx --error-on-warnings`
  — passed.
- `.\node_modules\.bin\vitest.cmd run packages/client/src/modules/manuscript/TextWorkspace.session.test.tsx packages/client/src/modules/manuscript/TextWorkspace.editor.test.tsx`
  — 2 files and 18 tests passed.
- `.\node_modules\.bin\tsc.cmd -b --pretty false` — passed.
- `.\distribution\.build\release-preflight-venv\Scripts\ruff.exe check src/quiltor/infrastructure/persistence/sqlite/revisions.py tests/python/test_chapter_story_time.py --output-format concise`
  — passed with pinned Ruff 0.16.4.
- `.\distribution\.build\release-preflight-venv\Scripts\ruff.exe format --check src/quiltor/infrastructure/persistence/sqlite/revisions.py tests/python/test_chapter_story_time.py`
  — both files formatted.
- `.\distribution\.build\native-lock-smoke-win\Scripts\python.exe -m unittest tests.python.test_chapter_story_time`
  — 13 tests passed under Python 3.12.14.

The standard `py -3.12` launcher has no installed interpreter on this host, and the repository's
Python selector therefore could not locate Ruff. Existing repository build environments supplied
the exact pinned Ruff and a Python 3.12 runtime without installing or downloading tools.

## Full Python acceptance and mutation proof

The first discovery attempt used the documented `-t tests/python` form inside a repository build
venv that did not have `quiltor` installed. That form imported tests as top-level modules, bypassed
the checked-in `tests/python/__init__.py` source-layout bootstrap, and ended with 742 tests, 30
`ModuleNotFoundError` import errors and 5 skips. This was an invocation-environment failure.

The source remained frozen for the corrected full run:

- `.\distribution\.build\native-lock-smoke-win\Scripts\python.exe -m unittest discover -s tests/python -t .`
  — 1,099 total tests: 1,092 successful and 7 skipped in 210.458 seconds. This is the prior 1,098
  baseline plus the new UTC regression.
- `node tools/dev/mutate.mjs src/quiltor/infrastructure/persistence/sqlite/revisions.py --from "datetime.now(UTC)" --to "datetime.now()" -- .\distribution\.build\native-lock-smoke-win\Scripts\python.exe -m unittest tests.python.test_chapter_story_time.ChapterStoryTimePersistenceTests.test_restore_revision_timestamp_is_explicit_utc`
  — mutation proof passed: the targeted test failed because `tzinfo` became `None`; the mutation
  tool restored the source.
- `.\distribution\.build\native-lock-smoke-win\Scripts\python.exe -m unittest tests.python.test_chapter_story_time.ChapterStoryTimePersistenceTests.test_restore_revision_timestamp_is_explicit_utc`
  — passed after restoration. Pinned Ruff and the scoped diff check also passed after restoration.

The integrated build and browser run subsequently passed after restarting the isolated API on
the frozen backend source. See [UI acceptance](followup-ui-coverage.md) and the
[four-point closure record](four-point-closure.md) for final bundle identity and combined evidence.
