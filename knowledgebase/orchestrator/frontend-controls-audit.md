# Frontend controls source audit

Status: source audit, UI-FIX-01 corrections and integrated local acceptance complete on 2026-10-03.
Rendered evidence and its limits are recorded in the
[frontend visual audit](frontend-visual-audit.md).

## Was

Audit button and control implementation across the manuscript, figures, timeline, places and
storyboard workspaces, including their reachable inspectors, sheets and dialogs. The pass checks
control ownership, action rank, shared heights, alignment relationships and focus contracts. The
initial pass was read-only. UI-FIX-01 subsequently authorized the narrow product-file changes
recorded under F1-F3; broader redesign remains outside this audit.

## Warum

The owner reported controls that look undesigned or misaligned. The useful distinction is between
a source-level conflict with the design system and a visual concern that needed computed
browser evidence. Fixing only the former keeps the correction narrow and avoids replacing the
approved workshop identity with another control system.

## Wann erledigt

This pass is done when the inspected scope is explicit, confirmed implementation defects are
separated from visual hypotheses, each finding names current source evidence and a narrow fix, and
two to four independent correction batches are ready for exclusive ownership and rendered review.

## Contract used

- Product TSX must use the public controls; raw `button`, `input`, `select` and `textarea` are
  prohibited. Feature CSS may position domain UI but must not create another general control
  recipe ([design contract lines 203-213](../../packages/client/src/design/README.md#feature-css)).
- `Button` owns labeled action size, tone, loading and pressed behavior; `SegmentedControl` owns an
  exclusive compact choice ([public catalog lines 131-142](../../packages/client/src/design/README.md#primitives)).
- Workspace actions use the create, view, history and actions slots. Filled emphasis belongs only
  to the create contract; toggles expose their state through `aria-pressed`
  ([action ranks lines 241-271](../../packages/client/src/design/README.md#aktionsränge-in-workspace-toolbars)).
- Focus, keyboard, normal/error states, narrow reflow and rendered verification remain acceptance
  requirements ([design Definition of Done](../../docs/design/FRONTEND_STYLEGUIDE.md#definition-of-done)).

## Coverage inventory

| Area          | Source inspected                                                                                                                                                                                       | Result                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manuscript    | `ManuscriptToolbar`, `TextWorkspace`, `WorkspaceLayout`, `ChapterBinder`, `WritingAidInspector`, `ChapterTrashDialog`, `ElementsSheet`, `TermsSheet`, `ManuscriptExportDialog` and colocated CSS/tests | Toolbar uses the public action slots and controls. Dialog actions use public buttons. Several writing-aid classes intentionally shape tabs/chips; no source-only alignment defect was promoted without browser evidence.                            |
| Figures       | `FigureToolbar`, `FigureWorkspace`, `FigureInspector`, `FigureCardPanel`, shared graph CSS and menu/create tests                                                                                       | Toolbar rank and menus pass. Shared priority toggles have competing primitive and feature styling; finding F3.                                                                                                                                      |
| Timeline      | `TimelineToolbar`, `TimeSystemControls`, `MomentTimeFields`, `StateChangePanels`, workspace CSS/tests                                                                                                  | Toolbar rank and responsive control grid pass. Two local control recipes compete with public primitive ownership; findings F1 and F2.                                                                                                               |
| Places        | `PlaceToolbar`, `PlacesWorkspace`, `PlaceInspector`, map-scale/chrome/measurement controls and shared tests                                                                                            | Toolbar rank and menus pass. It consumes the same priority toggles as figures; finding F3. Map-scale fields align at the field baseline and use public controls.                                                                                    |
| Storyboard    | `StoryboardToolbar`, `StoryboardWorkspace`, `StoryboardNode` and toolbar/review/E2E tests                                                                                                              | The two-row toolbar uses shared controls and explicit responsive grids. Board/group additions are deliberately subordinate to the one emphasized note-create action; this is not classified as a defect without contrary rendered/product evidence. |
| Cross-cutting | Public `Button`, `ToolbarButton`, `WorkspaceToolbar`, `SegmentedControl`, `ListboxSelect`, `UndoRedoControls`; design-system debt, CSS ownership, menu and action-rank gates                           | Zero raw product controls, zero legacy control classes, zero design-owner class overrides. Menu and action-rank gates pass. These gates do not detect styling through an additional class on the same public component, which is where F1-F3 occur. |

The manual search covered 224 uses of the approved control components in these module trees. A
separate intrinsic-control search returned no product-owned raw controls; the raw buttons inside
`SegmentedControl` remain owned by that documented design primitive.

## Prioritized findings

### F1 · P1 · Timeline date actions had two size/surface owners

**Classification:** confirmed compact hit-target defect, corrected in UI-FIX-01. UI-AUDIT-02
measured both inline date actions at 34 px at 1440 px and 390 px before the source correction; the
compact contract requires 44 px.

**Current evidence:** `MomentCalendarFields` renders shared `Button` controls for remove/add at
[`MomentTimeFields.tsx:156`](../../packages/client/src/modules/story-world/timeline/MomentTimeFields.tsx#L156)
and [`MomentTimeFields.tsx:162`](../../packages/client/src/modules/story-world/timeline/MomentTimeFields.tsx#L162).
After UI-FIX-01, the feature stylesheet retains only the domain mobile-width constraint at
[`MomentTimeFields.css:72`](../../packages/client/src/modules/story-world/timeline/MomentTimeFields.css#L72);
the duplicate min-height, surface, spacing and icon recipe is removed.

**Rule and impact:** `Button` is the control owner; feature CSS should describe placement. Two
owners made cascade/import order decide the final control and held the actions below the compact
hit-target size. It also left hover/disabled/focus styling split between the primitive and the
feature recipe.

**Correction applied:** grid placement and mobile width remain local. The default secondary,
regular `Button` contract owns size and visual states. No token or public API changed.

**Verification:** the add/remove callbacks have semantic unit coverage. Final rendered measurement
confirmed both actions at 36 px wide and 44 px compact; the targeted browser suite also covered
keyboard activation. See the [final local evidence](frontend-visual-audit.md#final-local-evidence).

### F2 · P2 · Timeline mode switch restyled the internals of `SegmentedControl`

**Classification:** confirmed design-system ownership debt, corrected in UI-FIX-01. No inaccessible
or broken action was established before correction; UI-AUDIT-02 confirmed working keyboard,
focus and heights. The visual delta after correction still requires rendered review.

**Current evidence:** the timeline requests the public compact control at
[`StateChangePanels.tsx:141`](../../packages/client/src/modules/story-world/timeline/StateChangePanels.tsx#L141).
After UI-FIX-01, feature CSS retains only domain width at
[`StateChangePanels.css:36`](../../packages/client/src/modules/story-world/timeline/StateChangePanels.css#L36),
plus the narrow full-width layout. The former root surface and descendant radio styling is removed,
so the primitive owns compact geometry, focus and selection.

**Rule and impact:** the public component must own its interactive descendants, including focus,
selected contrast and compact geometry. The local selectors can drift from theme, pressed and
future accessibility fixes even while CSS owner gates remain green because they avoid the
`.ui-segmented` class name.

**Correction applied:** retain only root width and consume `size="compact"` as the visual API. No
new variant or public API was needed.

**Verification:** an integration test exercises ArrowRight, focus transfer and selected state. The
rendered audit confirmed keyboard/focus behavior and 30 px wide/44 px compact targets before the
ownership cleanup; the final local bundle uses the shared primitive surface. Platform snapshot
review remains separate from this local acceptance.

### F3 · P1 · Figure/place priority toggles combined `Button` variants with a second recipe

**Classification:** confirmed state-visibility defect, corrected in UI-FIX-01. UI-AUDIT-02 found
pressed and unpressed priority actions had identical background, border and text treatment before
the source correction despite their correct `aria-pressed` state and changing labels.

**Current evidence:** the shared component now uses the supported secondary pressed treatment at
[`NodePriorityActions.tsx:28`](../../packages/client/src/modules/story-world/NodePriorityActions.tsx#L28)
and [`NodePriorityActions.tsx:37`](../../packages/client/src/modules/story-world/NodePriorityActions.tsx#L37).
`StoryGraph.css` keeps only left alignment at
[`StoryGraph.css:273`](../../packages/client/src/modules/story-world/StoryGraph.css#L273). The local
surface, spacing, icon and active rules and the redundant places action class are removed.

**Rule and impact:** these are reversible toggles, already described by `aria-pressed`. Combining
primary/secondary variants with a second local surface made active, hover, disabled and focus
outcomes depend on selector order and erased the visible pressed treatment. The component appears
in both figure and place inspectors, so the inconsistency was repeated.

**Correction applied:** both toggles use secondary `Button` with `aria-pressed`; only container
width and left alignment remain local. Labels, callbacks and regular/touch sizing are preserved.

**Verification:** the shared test asserts the secondary appearance, pressed semantics and emitted
next values. Final rendered checks covered figure/place toggles, keyboard activation, settled focus,
light/dark and wide/compact states; active and inactive surface colors are now distinguishable.

## Reviewed but not currently defects

- **Raw controls:** none in the five product module trees. Documented composites such as
  `SegmentedControl` own their intrinsic buttons and are not violations.
- **Toolbar action rank:** static action-rank and menu contracts pass. Manuscript, figures,
  timeline, places and storyboard all use `WorkspaceToolbarActions`. Secondary creation commands
  such as a map, board or group remain regular actions beside one emphasized create path; source
  evidence alone does not show that hierarchy to be wrong. UI-AUDIT-02 also found no overflow or
  alignment defect across all five main toolbars at 1440 px and 390 px in light and dark themes.
- **Common heights:** shared toolbar buttons, listbox selectors and text fields use regular 36 px
  controls and adopt 44 px touch values. No global token change is justified. F1 is the only local
  fixed-size conflict found in the audited action/field rows.
- **Manuscript dialogs:** export, trash, terms and elements surfaces use public dialog/sheet and
  button components. Their local CSS lays out content/action rows without replacing button
  surfaces. The recent EPUB dialog was separately rendered at wide, compact and 320 px enlarged
  text; no issue is carried into this audit.
- **Possible visual hypotheses:** storyboard's two toolbar rows, manuscript's tinted panel-toggle
  group and dense timeline toolbar wrapping may still look uneven in particular fonts/viewports.
  They have intentional source structure and existing narrow-layout tests, so only measured runtime
  overflow, baseline or hit-target evidence should promote them.

## Independent correction batches

UI-FIX-01 implemented all three source batches below, and the integrated local rendered checks
accepted them.

1. **UI-FIX-TIMELINE-ACTIONS**\
   **Was:** `MomentTimeFields.tsx`, `MomentTimeFields.css`, `MomentTimeFields.test.tsx` and only the
   necessary timeline layout assertion.\
   **Warum:** restore one owner for inline date actions and align them with adjacent fields.\
   **Wann erledigt:** public Button geometry/states own the controls; add/remove behavior and
   desktop/compact alignment pass rendered review.
2. **UI-FIX-TIMELINE-MODE**\
   **Was:** `StateChangePanels.tsx`, `StateChangePanels.css`, relevant timeline unit/layout tests.\
   **Warum:** stop feature CSS from restyling SegmentedControl descendants.\
   **Wann erledigt:** only product layout remains local; keyboard, focus, selected state and narrow
   wrapping pass in both themes.
3. **UI-FIX-PRIORITY-TOGGLES**\
   **Was:** `NodePriorityActions.tsx`, `NodePriorityActions.test.tsx`, the exact priority-action
   rules in `StoryGraph.css` and `places/PlaceInspector.css`.\
   **Warum:** figures and places combined primitive variants with a local button recipe.\
   **Wann erledigt:** one public Button appearance owns all visual states, layout remains unchanged,
   callbacks/pressed semantics pass, and both consumers pass rendered light/dark/touch review.

The first two batches are independent in behavior but touch the same timeline stylesheet family;
they may be assigned together to avoid edit contention. The priority-toggle batch is independent.

## Checks and final acceptance

Executed from `C:\Users\timra\git\quiltor\quiltor`:

- `node --test tools/quality/design_system_debt.test.mjs tools/quality/menu_contracts.test.mjs tools/quality/action_ranks.test.mjs tools/quality/frontend_boundaries.test.mjs` — 39 tests passed.
- `node tools/quality/check_design_system_debt.mjs` — zero raw controls and zero legacy classes.
- `node tools/quality/check_menu_contracts.mjs` — passed.
- `node tools/quality/check_action_ranks.mjs` — passed.
- `node --test tools/quality/css_ownership.test.mjs tools/quality/css_design_debt.test.mjs tools/quality/shared_feature_classes.test.mjs` — 28 tests passed.
- `node tools/quality/check_css_design_debt.mjs` — zero native-control selector branches and zero protected design-owner overrides.
- `node tools/quality/check_shared_feature_classes.mjs` — passed.

After UI-FIX-01, this source worker's affected six unit files passed 32 tests; TypeScript build mode,
changed-file lint/format checks and the design/CSS/action quality gates also passed. Those scoped
checks did not themselves establish rendered behavior.

Integrated local acceptance subsequently completed against the corrected source, as detailed in
the [frontend visual audit](frontend-visual-audit.md#final-local-evidence):

- The final product build passed.
- The full client suite passed 228 files and 1,539 tests.
- Nine targeted browser cases passed across the title, control consistency, world-gate and import
  scenarios; two intentionally inapplicable project combinations were skipped.
- One disposable final measurement capture passed and recorded the corrected title, priority-toggle
  and timeline-action geometry.

This is local Chromium evidence, not release, CI or fresh-platform evidence. Checked-in product
snapshots were not overwritten. Affected Windows, Linux and macOS visual baselines still require
normal platform-owner review; the pre-existing missing Linux/macOS compact images remain separate
debt.
