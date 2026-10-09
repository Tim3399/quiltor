# Read-only simplification candidates

Recorded 2026-10-09 from the user-owned Simplifier chat
`01a11f95-5493-7f03-a412-0fd44816d15c`. Its inventory inspected `f3d4c4f` without
edits, tests or an implementation assignment. The coordinator deferred all code
changes during the 3.22.0 release freeze. The taskboard owns prioritization;
these remain open and unassigned after publication.

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
