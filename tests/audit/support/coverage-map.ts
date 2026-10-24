// Where every popup-rendering component of the inventory (tools/audit/inventory.mjs) appears, and
// which DOM evidence proves it was on screen. A component counts as reached only when its
// evidence -- a visible role with an accessible name -- was seen in a captured state.
//
// Views and Overlay values are listed too (category "view"/"overlay"): they are not inventory
// items, but the audit owes the same proof for them.
//
// Names quote German interface text on purpose; they are selectors, not prose.

export type Evidence = {
  /** ARIA role as Playwright's aria snapshot reports it; several when it differs per layout. */
  role: string | string[];
  name: string | RegExp;
  /** Extra marker the snapshot line must carry, e.g. "[pressed]". */
  marker?: string;
};

export type CoverageMapEntry = {
  component: string;
  file: string;
  category: "component" | "view" | "overlay";
  /** The audit state in which the component appears (state ids of capture.spec.ts). */
  state: string;
  evidence: Evidence;
};

const src = (path: string) => `packages/client/src/${path}`;

const component = (
  name: string,
  file: string,
  state: string,
  evidence: Evidence,
): CoverageMapEntry => ({ component: name, file: src(file), category: "component", state, evidence });

export const COVERAGE_MAP: CoverageMapEntry[] = [
  // Views (packages/client/src/shared/workspace.ts and the world gate, focus mode, expanded map).
  {
    component: "view:world-gate",
    file: src("modules/story-world/worlds/WorldGate.tsx"),
    category: "view",
    state: "world-gate",
    evidence: { role: "heading", name: "Welt öffnen" },
  },
  {
    component: "view:workspace.text",
    file: src("shared/workspace.ts"),
    category: "view",
    state: "workspace.text",
    evidence: { role: "textbox", name: "Kapiteltext" },
  },
  {
    component: "view:workspace.figures",
    file: src("shared/workspace.ts"),
    category: "view",
    state: "workspace.figures",
    evidence: { role: "region", name: "Figuren und Beziehungen" },
  },
  {
    component: "view:workspace.timeline",
    file: src("shared/workspace.ts"),
    category: "view",
    state: "workspace.timeline",
    evidence: { role: "region", name: "Timeline" },
  },
  {
    component: "view:workspace.places",
    file: src("shared/workspace.ts"),
    category: "view",
    state: "workspace.places",
    evidence: { role: "region", name: "Orte verwalten" },
  },
  {
    component: "view:workspace.storyboard",
    file: src("shared/workspace.ts"),
    category: "view",
    state: "workspace.storyboard",
    evidence: { role: "region", name: "Storyboard" },
  },
  {
    component: "view:focus-mode",
    file: src("modules/manuscript/ManuscriptToolbar.tsx"),
    category: "view",
    state: "workspace.text/focus",
    evidence: { role: "button", name: /^Fokusmodus verlassen/ },
  },
  {
    component: "view:expanded-map",
    file: src("modules/story-world/places/PlaceMapChrome.tsx"),
    category: "view",
    state: "workspace.places/expanded-map",
    evidence: { role: "img", name: /^Maßstabsleiste/ },
  },

  // Overlay union (packages/client/src/app/overlays/useOverlayController.ts).
  {
    component: "overlay:palette",
    file: src("app/overlays/useOverlayController.ts"),
    category: "overlay",
    state: "overlay.palette",
    evidence: { role: "dialog", name: "Suchen & Befehle" },
  },
  {
    component: "overlay:history",
    file: src("app/overlays/useOverlayController.ts"),
    category: "overlay",
    state: "overlay.history",
    evidence: { role: "dialog", name: "Verlauf" },
  },
  {
    component: "overlay:snapshot",
    file: src("app/overlays/useOverlayController.ts"),
    category: "overlay",
    state: "overlay.snapshot",
    evidence: { role: "dialog", name: "Arbeitsstand sichern" },
  },
  {
    component: "overlay:backups",
    file: src("app/overlays/useOverlayController.ts"),
    category: "overlay",
    state: "overlay.backups",
    evidence: { role: "dialog", name: "Sicherungen" },
  },
  {
    component: "overlay:cloud",
    file: src("app/overlays/useOverlayController.ts"),
    category: "overlay",
    state: "overlay.cloud",
    evidence: { role: "dialog", name: "Cloud-Synchronisation" },
  },

  // Inventory components.
  component("App", "app/Application.tsx", "dialog.getting-started", {
    role: "dialog",
    name: "Erste Schritte",
  }),
  component("AppShell", "app/AppShell.tsx", "workspace.text/menu.mehr", {
    role: "menu",
    name: "Aktionen",
  }),
  component("OverlayHost", "app/overlays/OverlayHost.tsx", "overlay.palette", {
    role: "dialog",
    name: "Suchen & Befehle",
  }),
  component(
    "AssistantComposer",
    "modules/assistant/AssistantComposer.tsx",
    "assistant/popover.kontext",
    { role: "dialog", name: "Kapitel einzeln auswählen" },
  ),
  component("ProposalList", "modules/assistant/AssistantConversation.tsx", "assistant.proposals/listbox", {
    role: "listbox",
    name: "Aussage einordnen",
  }),
  component("AssistantDrawer", "modules/assistant/AssistantDrawer.tsx", "assistant/listbox.manuskriptbereich", {
    role: "listbox",
    name: "Manuskriptbereich",
  }),
  component(
    "AssistantProposalEditor",
    "modules/assistant/AssistantProposalEditor.tsx",
    "assistant.proposals/dialog.bearbeiten",
    { role: "dialog", name: "Bearbeiten" },
  ),
  component("SelectionField", "modules/assistant/AssistantProposalEditor.tsx", "assistant.proposals/dialog.bearbeiten/listbox", {
    role: "listbox",
    name: "Element",
  }),
  component("BackupDialog", "modules/backup/BackupDialog.tsx", "overlay.backups", {
    role: "dialog",
    name: "Sicherungen",
  }),
  component("CloudDialog", "modules/cloud/CloudDialog.tsx", "overlay.cloud", {
    role: "dialog",
    name: "Cloud-Synchronisation",
  }),
  component(
    "GettingStartedDialog",
    "modules/getting-started/GettingStartedDialog.tsx",
    "dialog.getting-started",
    { role: "dialog", name: "Erste Schritte" },
  ),
  component("GraphEdgeColorSelect", "modules/graph/GraphEdgeColorSelect.tsx", "figures.edge/listbox.kantenfarbe", {
    role: "listbox",
    name: "Kantenfarbe",
  }),
  component(
    "GraphEdgeLineStyleSelect",
    "modules/graph/GraphEdgeLineStyleSelect.tsx",
    "figures.edge/listbox.linienart",
    { role: "listbox", name: "Linienart" },
  ),
  component("HistoryDialog", "modules/history/HistoryDialog.tsx", "overlay.history", {
    role: "dialog",
    name: "Verlauf",
  }),
  component("SnapshotDialog", "modules/history/SnapshotDialog.tsx", "overlay.snapshot", {
    role: "dialog",
    name: "Arbeitsstand sichern",
  }),
  component(
    "ManuscriptImportDialog",
    "modules/manuscript-import/ManuscriptImportDialog.tsx",
    "world-gate/dialog.manuscript-import",
    { role: "dialog", name: "Manuskript importieren" },
  ),
  component("ChapterActionsMenu", "modules/manuscript/ChapterActionsMenu.tsx", "text.binder/menu.kapitelaktionen", {
    role: "menu",
    name: /^Kapitelaktionen: /,
  }),
  component(
    "ChapterStoryTimeFields",
    "modules/manuscript/ChapterStoryTimeFields.tsx",
    "text.inspector.story-time/listbox.zeitpunkt",
    { role: "listbox", name: /^(Zeitpunkt|Von|Bis)$/ },
  ),
  component("ChapterTrashDialog", "modules/manuscript/ChapterTrashDialog.tsx", "text.binder/dialog.trash", {
    role: "textbox",
    name: "Gelöschte Kapitel durchsuchen",
  }),
  component("FolderRowActions", "modules/manuscript/ChapterTreeRows.tsx", "text.binder/menu.ordner", {
    role: "menu",
    name: /^Aktionen: /,
  }),
  component("ElementsSheet", "modules/manuscript/ElementsSheet.tsx", "text.insert/sheet.elements", {
    role: "dialog",
    name: "Figuren & Orte verwalten",
  }),
  component("GrammarInspectorPanel", "modules/manuscript/GrammarInspectorPanel.tsx", "text.check/listbox.pruefmodus", {
    role: "listbox",
    name: "Prüfmodus",
  }),
  component("ManuscriptEditor", "modules/manuscript/ManuscriptEditor.tsx", "workspace.text/popover.entity-mention", {
    role: "button",
    name: "Mara Venn öffnen",
  }),
  component(
    "ManuscriptExportDialog",
    "modules/manuscript/ManuscriptExportDialog.tsx",
    "workspace.text/dialog.manuscript-export",
    { role: "dialog", name: /^(DOCX|EPUB)-Inhalt prüfen$/ },
  ),
  component("ManuscriptToolbar", "modules/manuscript/ManuscriptToolbar.tsx", "workspace.text/menu.buch-exportieren", {
    role: "menu",
    name: "Buchexport",
  }),
  component("SelectionActions", "modules/manuscript/SelectionActions.tsx", "workspace.text/selection-menu", {
    role: "menu",
    name: "Aktionen für die Textauswahl",
  }),
  component("TermsSheet", "modules/manuscript/TermsSheet.tsx", "text.insert/sheet.terms", {
    role: "dialog",
    name: "Eigene Begriffe",
  }),
  component("TextWorkspace", "modules/manuscript/TextWorkspace.tsx", "text.binder/dialog.delete-chapter", {
    role: "alertdialog",
    name: "Kapitel löschen",
  }),
  component("WorkspaceLayout", "modules/manuscript/WorkspaceLayout.tsx", "workspace.text", {
    role: ["complementary", "dialog"],
    name: "Kapitel",
  }),
  component("NoteFocusMode", "modules/notes/NoteFocusMode.tsx", "text.inspector/dialog.note-focus", {
    role: "dialog",
    name: /^Notiz · /,
  }),
  component("ReferenceTextEditor", "modules/notes/ReferenceTextEditor.tsx", "text.inspector/dialog.note-focus/menu.ueberschrift", {
    role: "menu",
    name: "Überschrift",
  }),
  component(
    "ProjectExportDialog",
    "modules/project-transfer/ProjectExportDialog.tsx",
    "dialog.project-export",
    { role: "dialog", name: "Quiltor-Projekt exportieren" },
  ),
  component(
    "ProjectImportDialog",
    "modules/project-transfer/ProjectImportDialog.tsx",
    "world-gate/dialog.project-import",
    { role: "dialog", name: "Quiltor-Projekt importieren" },
  ),
  component("RecoveryDialog", "modules/recovery/RecoveryDialog.tsx", "save-error/dialog.recovery", {
    role: "dialog",
    name: "Ungespeicherten Entwurf retten",
  }),
  component("SearchDialog", "modules/search/SearchDialog.tsx", "overlay.palette", {
    role: "listbox",
    name: "Suchen & Befehle",
  }),
  component("FigureCardPanel", "modules/story-world/figures/FigureCardPanel.tsx", "figures.inspector/listbox.art", {
    role: "listbox",
    name: "Art",
  }),
  component("FigureInspector", "modules/story-world/figures/FigureInspector.tsx", "figures.inspector.relationships/dialog.delete", {
    role: "alertdialog",
    name: "Beziehung löschen",
  }),
  component(
    "FigureNodeContextMenu",
    "modules/story-world/figures/FigureNodeContextMenu.tsx",
    "workspace.figures/context-menu.node",
    { role: "menu", name: "Elementaktionen" },
  ),
  component("FigureProfilePanel", "modules/story-world/figures/FigureProfilePanel.tsx", "figures.inspector.profile/menu.feld", {
    role: "menu",
    name: "Feld hinzufügen",
  }),
  component("FigureToolbar", "modules/story-world/figures/FigureToolbar.tsx", "workspace.figures/menu.element", {
    role: "menu",
    name: "Element erstellen",
  }),
  component("FigureWorkspaceInner", "modules/story-world/figures/FigureWorkspace.tsx", "workspace.figures/dialog.delete-element", {
    role: "alertdialog",
    name: "Element löschen",
  }),
  component("PresenceField", "modules/story-world/figures/PresenceField.tsx", "figures.inspector/listbox.ort", {
    role: "listbox",
    name: /^Ort (\(Ausgangslage\)|ab )/,
  }),
  component(
    "PlaceMapScaleControl",
    "modules/story-world/places/PlaceMapScaleControl.tsx",
    "workspace.places/popover.massstab",
    { role: "dialog", name: /^Maßstab von / },
  ),
  component("PlacesWorkspaceInner", "modules/story-world/places/PlacesWorkspace.tsx", "places.selected/dialog.delete-place", {
    role: "alertdialog",
    name: "Ort löschen",
  }),
  component("PlaceToolbar", "modules/story-world/places/PlaceToolbar.tsx", "places.selected/menu.ortsaktionen", {
    role: "menu",
    name: "Ortsaktionen",
  }),
  component("MomentHeader", "modules/story-world/timeline/MomentHeader.tsx", "workspace.timeline/menu.aktionen", {
    role: "menu",
    name: "Zeitpunktaktionen",
  }),
  component("MomentStateWorkspace", "modules/story-world/timeline/StateChangePanels.tsx", "timeline.relationship", {
    role: ["complementary", "dialog"],
    name: "Beziehung",
  }),
  component("TimelineWorkspace", "modules/story-world/timeline/TimelineWorkspace.tsx", "workspace.timeline/dialog.delete-moment", {
    role: "alertdialog",
    name: "Zeitpunkt löschen",
  }),
  component("TimeSystemControls", "modules/story-world/timeline/TimeSystemControls.tsx", "workspace.timeline/popover.zeitsystem", {
    role: "dialog",
    name: "Zeitsystem konfigurieren",
  }),
  component("WorldGate", "modules/story-world/worlds/WorldGate.tsx", "world-gate/sheet.new-world", {
    role: "dialog",
    name: "Neue Welt",
  }),
  component("StoryboardToolbar", "modules/storyboard/StoryboardToolbar.tsx", "workspace.storyboard/listbox.board", {
    role: "listbox",
    name: "Storyboard auswählen",
  }),
];
