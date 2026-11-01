# Layout audit rules

The deterministic rules of the layout audit live in `tests/audit/support/layout-rules.ts` and run
on every captured state (see [LAYOUT_AUDIT.md](../LAYOUT_AUDIT.md)). Each rule has synthetic
cases in `tests/audit/rules.spec.ts`, one where it must fire and one where it must not, run by
`npm run test:audit-rules`. This page has one section per rule added since T-80; the older
rules are described in the source.

## `broken-word`

**Finds** a word whose letters run onto a second line without a hyphen, for example a scale
label drawn as "MASSST" over "AB". A screenshot comparison cannot find this once the baseline
already contains it, which is how the T-78 map findings slipped through.

**How:** for every visible text node, each run of letters and digits (`\p{L}\p{N}\p{M}`) is
measured with `Range.getClientRects()`. Two fragments on distinct lines mean the word itself was
split. The message names the word and where it broke.

**Severity:** `high` inside a control (button, link, any element of the interactive list) or a
heading, label, legend, table header or tab; `medium` everywhere else.

**Allowed:**

- A break between words, or after a hyphen or slash ("Ort-" / "Karte"): those characters are
  not part of a letter run.
- A break at a soft hyphen (U+00AD) the text carries.
- Any break in an element with `hyphens: auto`, the hyphenation the style guide allows for
  running text. The browser draws the hyphen. Where it has no dictionary for the language and
  `overflow-wrap` forces the break instead, the rule still lets it pass, because it cannot tell
  the two apart from the geometry alone.
- Text hidden for screen readers only (the sr-only pattern), since nobody sees it.
- Machine text inside `code`, `kbd`, `samp` or `pre`: paths and ids have no syllables to
  hyphenate, and breaking them anywhere is how a long path is meant to fit. Found at
  calibration in the backup overview on mobile ("…/Welten/…", "…/Sicherungen/…").
- Editable text (`contenteditable`, `textarea`, `role="textbox"`): what the author typed. A word
  longer than the line has to break somewhere, and hyphenating the manuscript is not the
  editor's call. Found at calibration in the focus editor on mobile, where the audit world's
  manuscript contains "Sturmflutwarnungsbekanntmachung".

**Not exempted:** text inside `aria-hidden` subtrees. It is still drawn, so a split there is
still seen.

**Proof:** with the T-78 fix undone (`labelHidden` removed from the scale field in
`PlaceMapScaleControl.tsx`, `dist/` rebuilt) the audit run of the places scenario reports the
visible "Maßstab" label as "Maßst" / "ab" in every `popover.massstab-…` state: 12 findings, all
`high`. With the fix in place the same run has none. The rule also finds the label in the
measuring tool's scale legend ("Maßs" / "tab"), which T-91 fixes; the audit run does not open
the measuring tool yet (T-81).
