# UI inventory before adaptive migration

## Application shell

- Global app bar and workspace switch: `src/app/AppShell.tsx`
- Global search/command dialog: `src/features/tools/SearchDialog.tsx`
- Save status: `src/shared/ui/SaveStatus.tsx`
- Overflow popover/menu: `src/shared/ui/Popover.tsx`, `src/shared/ui/Menu.tsx`

## Manuscript

- Context toolbar, chapter binder (list, note), editor with its title and ⋯ menu, writing-aid inspector, focus-side panels, completion popover, chapter-history panel: `src/features/manuscript/TextWorkspace.tsx`
- Destructive chapter dialog: shared `ConfirmDialog`

## Figures and graph

- Context toolbar, creation menu, graph controls/minimap, timeline strip, figure inspector, relationship editor: `src/features/figures/FigureWorkspace.tsx`

## Timeline and places

- Timeline toolbar, moment navigation, manager disclosures, relation inspector: `src/features/timeline/TimelineWorkspace.tsx`
- Places toolbar, map, list, and inspector: `src/features/places/PlacesWorkspace.tsx`

## Utility workflows

- Dialog foundation and graded destructive confirmation: `src/shared/ui/Dialog.tsx`, `src/shared/ui/ConfirmDialog.tsx`
- History, Git, backup, and search dialogs: `src/features/tools/`
- Assistant drawer: `src/features/assistant/AssistantDrawer.tsx`
- World Gate, preferences, world list, creation form, destructive dialog: `src/features/worlds/WorldGate.tsx`

## Keyboard, focus, and screen-reader baseline

- `Cmd/Ctrl+F`: content search; `Cmd/Ctrl+K`: command palette.
- `Cmd/Ctrl+S`: save; `Cmd/Ctrl+Shift+S`: Git workflow.
- `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z`: active workspace history outside form fields.
- `Escape`: dialog/popover/focus-mode exit where applicable.
- Dialogs trap focus and restore it; menus use arrow keys, Home/End, Enter, and Escape.
- Destructive confirmations are graded by what can be recovered. Deleting a chapter, element, place,
  moment or relationship goes through the undo stack, so it is a plain `alertdialog` that names the
  undo shortcut and confirms with one click. Only deleting a world and restoring a backup — neither of
  which any undo, backup or snapshot survives — keep the press-and-hold control, now at 1.5 seconds
  (`IRREVERSIBLE_HOLD_MS`).
- Marking text in the manuscript never opens anything by itself. The marked passage stays visible
  (`.held-selection`, painted even once focus moves into the inspector) and is named in the writing
  aid; dictionary, synonyms and translation are asked for deliberately — right-click or `Shift+F10`
  in the editor, or the buttons on that selection card. Matches macOS, where a lookup is a request.
- Overlays mark their intended first focus with `data-autofocus`; React never renders its own
  `autoFocus` prop as an attribute, so `useOverlayFocus` cannot see it.
- Shortcut labels follow the operating system, detected once in `src/shared/ui/shortcuts.ts`
  (`IS_APPLE_OS`): `⌘K` on Apple, `Strg+K`/`Ctrl+K` elsewhere depending on interface language.
- Automated Axe checks currently report no A/AA violations in the tested core views.

## Localization and design inventories

- `npm run check:i18n` is the machine-readable inventory for visible German JSX and DE/EN key parity. User prose, chapter titles, world names, and entity names are explicitly excluded.
- `npm run check:design` inventories raw colors, spacing, radius, type size, shadow, z-index, animation duration, and blur outside `src/design/` and fails on violations.
- Intentional exceptions are print-only `pt`/`in` geometry, hairline borders, percentage circles, and structural layout dimensions documented in `scripts/check-design.mjs`.
