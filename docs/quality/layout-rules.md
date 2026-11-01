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
measuring tool's scale legend ("Maßs" / "tab"), which T-91 fixes; since T-81 the audit run
opens the measuring tool (see "Map coverage").

## Map coverage

Since T-81 the capture run opens, on every layout in both themes (the first two in the
`places` scenario, the last two in `places-map`):

| State                                   | What it shows                                   | Coverage evidence                                       |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `workspace.places/expanded-map`         | the map unfolded, with its scale bar            | `view:expanded-map`, img "Maßstabsleiste"               |
| `…/popover.massstab-von-nordmeerkueste` | the scale popover, opened from the map's chrome | `PlaceMapScaleControl`, dialog "Maßstab von …"          |
| `workspace.places/collapsed-map`        | the same map folded to its card                 | `view:collapsed-map`, button "Nordmeerküste aufklappen" |
| `workspace.places/measuring`            | the measuring tool with its scale legend        | `view:measuring`, button "Distanz messen beenden"       |

Each state must exist in all three viewports and both themes, or the merge records a failure.
`node tests/audit/support/merge.ts --expect-reached view:measuring` (and the others) exits 1
when the evidence was never seen. The measuring legend has no evidence of its own: its unit
field is named like the one in the scale popover, so it would count as reached without the
tool. The state itself waits for the legend before it is captured.

`places-map` is a scenario of its own because folding the map is saved, and the audit world
keeps what a page saves. Inside the places scenario every later state would have found the map
folded or not depending on whether the save had landed; the first attempt showed exactly that
(the scale popover of `places.selected` went missing in one theme). Each scenario has its own
page and world, so no state there can affect the places scenario.
