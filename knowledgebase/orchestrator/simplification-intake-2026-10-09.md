# Additional Simplifier intake

Received while the coordinator/Critic review of SIM-01–06 was being finalized.
Source: Simplifier chat `01a11f95-5493-7f03-a412-0fd44816d15c`, baseline `a7ce672`.
These additional findings are **unreviewed intake**, not covered by the six-item
Critic decision and not implementation assignments. Do not silently enlarge the
accepted [plan](simplification-review-plan.md). The source report's descriptions
of SIM-02/05 read an earlier draft: the final plan uses an ordinary JSON POST
function and defers cross-module SQL deletion.

The Simplifier reports static inspection of the Git file index, 844 longer
Python functions using AST comparison, 495 non-test TS/TSX/MJS files by text,
1,010 larger function bodies across 380 client files using TypeScript AST,
121 source CSS files, the small Rust core/FFI and 119 Markdown files for links
and script references. Generated dist CSS was excluded as an edit target.
Documentation was not exhaustively reread sentence by sentence or externally
revalidated. AST/read-only scripts ran; no product tests, build or benchmarks
ran. No source files were changed. Reported source lines refer to the baseline.

| ID / source key          | Was / evidence to review                                                                                                                                                    | Warum                                                         | Wann review complete / proposed implementation proof                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SIM-07 / R01             | Assess identical `_acyclic_place_levels` bodies in `application/document_wire_v1.py:106` and `domain/story_world/validation.py:153`; wire reportedly checks hierarchy twice | Keep the domain invariant with one owner                      | Trace both entry paths, characterize valid chains, cycles, absent/non-place parents and rejection semantics; decide whether removal is safe. Overlaps SIM-06: serialize.                                                                             |
| SIM-08 / R02             | Assess identical `hasContent`, `mergeIds`, `isInvalid` in design Field and Checkbox                                                                                         | Avoid divergence in text/ARIA helpers                         | Preserve DOM, useId, props, refs, descriptions/error precedence; cover 0/false/null/empty text and supported aria-invalid values; both primitive suites. No form base component.                                                                     |
| SIM-09 / R03             | Assess archive JSON extraction duplication in `distribution/tooling/artifact_profile.py:69,100`                                                                             | Reduce repeated wheel/tar selection and JSON handling         | Characterize unique/missing/duplicate members, non-file tar members, invalid UTF-8/JSON/non-object and exact errors. Release tooling requires independent review; no incidental hardening.                                                           |
| SIM-10 / R04             | Assess parser-session lifecycle duplication in four `tools/quality/` scanners: design_public_api, design_system_debt, frontend_boundaries, locale_registry                  | Give compiler/snapshot/open-file resources a clear owner      | Test changed same-path files, stale source, syntax errors, independent sessions and disposal; keep scanner visitors/errors separate. Review a small composition design first; no global shared session.                                              |
| SIM-11 / R05             | Assess only pure validated-manifest comparison in design_system_debt and css_design_debt                                                                                    | Reduce duplication without merging CSS/JSX policy             | Preserve error-array order, file additions/removals, increases/decreases and invalid counts. Keep countingUnit, flags, categories and parsers separate; no baseline rewrite. Overlaps SIM-10. Validation/serialization are separate later questions. |
| SIM-12 / R06             | Assess identical catch callbacks at `modules/recovery/RecoveryDialog.tsx:275,301`                                                                                           | Reduce local error-path duplication                           | First pair both actions' Error/non-Error failures, no close, withdrawn authorization, pending completion and deliberate retry; success behavior unchanged. No recovery workflow redesign.                                                            |
| SIM-13 / R07             | Assess Unicode `\w+` import counts in importing/docx, importing/text_formats and persistence/manuscript_import                                                              | Keep import word-count semantics in one place                 | Test Unicode, combining marks, digits/underscore, apostrophe/hyphen, punctuation and empty text across three consumers. Do not share export word_count: its whitespace semantics differ.                                                             |
| SIM-14 / R08             | Verify outdated Rust formatting description in `docs/FORMATTING_README.md:21–24` against package scripts and PROJECT_PROFILE                                                | Keep contributor instructions accurate                        | Confirm current commands, narrowly update prose and validate Markdown/links. No formatter or CI changes.                                                                                                                                             |
| SIM-15 / R09             | Verify missing `mailto:` in `COMMERCIAL.md:16`                                                                                                                              | Make the existing contact link usable                         | Inspect target/rendered semantics; correct target only, leaving licensing terms untouched; Markdown/link check.                                                                                                                                      |
| SIM-16 / export addition | Assess AST-identical `_marks_in_paragraph` and `_marks_in_range` bodies in DOCX/EPUB                                                                                        | Potentially share another genuinely common interval algorithm | Characterize paragraph boundaries, empty paragraphs, overlaps/adjacency, astral text and sequential cursor mutation. Separate review after SIM-01; do not enlarge its three-function scope.                                                          |
| SIM-17 / U01             | Investigate shared import/require/glob AST patterns in design_public_api and frontend_boundaries                                                                            | Determine whether a small common recognizer is safe           | Existing glob argument-count acceptance and metadata differ; first characterize both contracts. No refactor is recommended yet. Overlaps SIM-10.                                                                                                     |
| SIM-18 / U02             | Investigate duplicated visually-hidden CSS versus existing `.sr-only`                                                                                                       | Determine whether reuse preserves layout and accessibility    | Existing `.sr-only` adds margin -1px; require browser geometry/focus/accessibility evidence before replacement. Unit label tests alone are insufficient. No refactor is recommended yet.                                                             |

## Reported exclusions to retain

- AdaptivePanel/Sheet have different geometry, animation and focus contracts;
  shared focus logic already exists. Utility-sheet CSS remains used by Backup
  and History dialogs and is not dead code.
- Strict JSON, archive/backup validation and staged validation have different
  limits, normalization and rejection semantics; no broad merger.
- Temporal phase wrappers, element/alias decisions, repository interface
  signatures and distinct DOCX XML producers are intentional similarities.
- No new repository/provider/HTTP/capability base classes, Rust/FFI cleanup or
  safe private-function deletion candidate was established.
- Historical inventories, examples, future roadmap paths and documented past
  failures are not automatically stale current instructions. Parallel translated
  README prose remains intentional.

Any later assignments require coordinator and Critic review, exclusive ownership
and characterization before refactoring. Planned conflicts: SIM-07 with SIM-06;
SIM-16 with SIM-01; SIM-10/11/17 share quality-tool files. Preserve current release
and the owner's local runtime during review.
