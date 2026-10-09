# Read-only simplification candidates

Status update, 2026-10-09: coordinator and Critic review is complete. The
[final review and plan](simplification-review-plan.md) is authoritative for
implementation scope. The original proposals below are retained as evidence:
SIM-01 is limited to three UTF-16 primitives; SIM-02 uses a narrow ordinary
JSON POST function; SIM-05 is limited to local ordering. Shared export
normalization and cross-module SQL deletion are deferred. No implementation
has started.

Recorded 2026-10-09 from the user-owned Simplifier chat
`01a11f95-5493-7f03-a412-0fd44816d15c`. Its inventory inspected `f3d4c4f` without
edits, tests or an implementation assignment. The coordinator deferred all code
changes during the 3.22.0 release freeze. The taskboard owns prioritization;
these remain open and unassigned after publication.

A further read-only inventory on `93e0f30`, requested by the owner in the
Simplifier chat, supplied SIM-04 through SIM-06. Evidence is static inspection
and a read-only fixture count, not executed behavioral tests or accepted fixes.
The coordinator records these findings as proposals pending implementation review.

## SIM-01 — export helpers

- **Was:** consider sharing the duplicated normalization/UTF-16 helpers in
  `docx.py` and `epub.py`; `_python_indexes` was reported text-identical.
- **Warum:** avoid divergent maintenance of common text-offset behavior.
- **Wann erledigt:** first characterize errors, then preserve output archives,
  validation/rejection order, format-specific error messages and public imports;
  `test_manuscript_export.py` and `test_manuscript_epub.py` pass and lead review
  accepts the actual diff. No serializer base class.

## SIM-02 — JSON POST adapters

- **Was:** consider a narrow internal helper for repeated JSON POST construction
  in worlds, writingAssistance and backup HTTP adapters.
- **Warum:** reduce repetition while keeping endpoint behavior explicit.
- **Wann erledigt:** URLs, world selection, decoders, options and cancellation
  remain equivalent under focused tests and review. Exclude synchronize's
  intentional header behavior and binary projectTransfer. No HTTP class hierarchy.

## SIM-03 — FreeDict text extraction

- **Was:** avoid repeated `_text` normalization while retaining a separate values
  list for each head.
- **Warum:** simplify the parsing flow without broad provider abstractions.
- **Wann erledigt:** first cover blank quote/translation fallback, nested text,
  multiple heads and duplicates, then retain those behaviors under tests and
  lead review. No provider base class.

## SIM-04 — Storyboard connection ownership

- **Was:** use the already imported SQLite `connection()` context manager in
  `src/quiltor/infrastructure/persistence/sqlite/storyboards.py:219–234` for the
  path that opens its own connection. `connection.py:30` reportedly provides the
  same transaction/close sequence; `story_world.save():505` already uses it.
- **Warum:** remove duplicated transaction management with the smallest scoped
  change, keeping connection ownership explicit.
- **Wann erledigt:** first prove own-connection commit, rollback and close after
  errors, and that a caller-supplied connection is never committed, rolled back
  or closed by this function. Preserve roundtrips, stable rowids and revision
  conflicts in `test_storyboards_storage.py`. Existing connection-safety tests
  cover setup errors, not all these ownership cases. Lead reviews diff/evidence.
- **Boundary:** do not replace unrelated read-only or restore `connect()` calls.
  Assign before SIM-05, or to the same implementation owner, because both touch
  `storyboards.py`.

## SIM-05 — narrow SQLite synchronization helpers

- **Was:** consider sharing deletion of removed IDs between `story_world.py:155`
  and `storyboards.py:94`, with fixed internal table names; consolidate the two
  local order-sync algorithms in `story_world.py:170,184` into a local helper.
- **Warum:** reduce duplicated SQL synchronization logic without changing
  transaction boundaries or widening the storage abstraction.
- **Wann erledigt:** preserve deletion order, foreign keys, no writes for
  unchanged order, stable rowids and dependent records, plus the caller's
  transaction. First cover presence reordering, empty lists and Storyboard
  deletion through `save()`. Existing direct SQL cascade tests alone do not
  establish the latter behavior. Target `test_storage.py` and
  `test_storyboards_storage.py`, with lead review of actual changes and evidence.
- **Dependency:** serialize with SIM-04 or give both to one developer; no parallel
  ownership of the overlapping persistence files.

## SIM-06 — active and trashed chapter normalization

- **Was:** extract a small chapter-level helper for repeated normalization in
  `src/quiltor/application/document_wire_v1.py:221–250`, currently applied to
  active chapters and `trash[].chapter` separately.
- **Warum:** keep note references/marks and mention/mark ranges consistent across
  active and deleted chapters without duplicating rules.
- **Wann erledigt:** first add paired active/trash cases for integer-valued
  floats, booleans, bounds 0/1, missing/null fields and invalid types. Preserve
  order, note-mark sorting, extension fields and deep-copy/input immutability.
  The existing differential fixture reportedly contains no trash range cases
  for these four fields. Extend `test_document_wire_v1.py` and its fixtures;
  accept only after focused tests and lead review.

## Deliberately separate behavior

Do not merge `project_archive._strict_json` with
`backup_manifest.strict_json_loads`: non-finite-number rejection, byte limits and
error/parsing semantics differ. Likewise, staged archive verification and backup
document validation have different normalization/error boundaries. The static
inventory justifies no common base class for these paths.
