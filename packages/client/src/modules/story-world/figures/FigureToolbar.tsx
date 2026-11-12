import {
  Clock3,
  Download,
  Ellipsis,
  Grid3X3,
  LayoutGrid,
  Link2,
  MapPin,
  Plus,
  Upload,
  Waypoints,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  ConfirmDialog,
  DropdownMenu,
  MenuItem,
  MenuItemCheckbox,
  MenuSeparator,
  TextField,
  Toast,
  ToolbarButton,
  UndoRedoControls,
  useCompactToolbar,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../../design";
import { useI18n } from "../../../i18n";
import { applicationErrorMessage } from "../../../platform";
import { historyShortcuts } from "../../../shared";
import type { FigureKind, FigureState } from "../model";
import { countBoardElements } from "./figureCanvasModel";
import { parseFigureState, saveFigureProfiles, saveFigureState } from "./figureTransfer";
import { FIGURE_ELEMENT_TYPES } from "./figureTypes";
import "./FigureToolbar.css";

export type FigureToolbarProps = {
  state: FigureState;
  connecting: boolean;
  snapToGrid: boolean;
  relationshipsVisible: boolean;
  timelineOpen: boolean;
  journeyOverlayOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAddNode: (kind: FigureKind) => void;
  onConnectingChange: (value: boolean) => void;
  onSnapToGridChange: (value: boolean) => void;
  onAlignAllNodes: () => void;
  onRelationshipsVisibleChange: (value: boolean) => void;
  onTimelineOpenChange: (value: boolean) => void;
  onJourneyOverlayOpenChange: (value: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onImport: (state: FigureState) => void;
};

export function FigureToolbar({
  state,
  connecting,
  snapToGrid,
  relationshipsVisible,
  timelineOpen,
  journeyOverlayOpen,
  canUndo,
  canRedo,
  onAddNode,
  onConnectingChange,
  onSnapToGridChange,
  onAlignAllNodes,
  onRelationshipsVisibleChange,
  onTimelineOpenChange,
  onJourneyOverlayOpenChange,
  onUndo,
  onRedo,
  onImport,
}: FigureToolbarProps) {
  const { t, locale } = useI18n();
  // A compact row holds at most six touch buttons (styleguide 7.4): time and paths, the toggles
  // reached for least, move into "…" there. Undo never does.
  const compact = useCompactToolbar();
  const shortcuts = historyShortcuts(locale);
  const [pendingImport, setPendingImport] = useState<FigureState | null>(null);
  const [importError, setImportError] = useState("");
  const [exportError, setExportError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const runExport = (task: Promise<void>) => {
    void task
      .then(() => setExportError(""))
      .catch((error) => setExportError(applicationErrorMessage(error)));
  };
  const importState = async (file?: File) => {
    if (!file) return;
    try {
      setPendingImport(parseFigureState(await file.text()));
      setImportError("");
    } catch {
      setImportError(t("invalidDiagramFile"));
    }
    if (input.current) input.current.value = "";
  };

  return (
    <>
      <WorkspaceToolbar className="figure-toolbar" label={t("figuresWorld")}>
        <WorkspaceToolbarTitle
          title={t("figuresWorld")}
          detail={
            <>
              {t("nElements", { n: countBoardElements(state.nodes) })} ·{" "}
              {t("nRelationships", { n: state.edges.length })}
            </>
          }
        />
        <WorkspaceToolbarActions
          create={
            <WorkspaceToolbarGroup className="figure-create-group" label={t("createElementMenu")}>
              <DropdownMenu
                label={t("createElementMenu")}
                renderTrigger={({ ref, ...triggerProps }) => (
                  <WorkspaceToolbarCreateButton ref={ref} {...triggerProps} label={t("element")} />
                )}
              >
                {FIGURE_ELEMENT_TYPES.map((type) => (
                  <MenuItem
                    key={type.kind}
                    icon={<Plus />}
                    label={t(type.label)}
                    onSelect={() => onAddNode(type.kind)}
                  />
                ))}
              </DropdownMenu>
            </WorkspaceToolbarGroup>
          }
          view={
            <>
              <WorkspaceToolbarGroup label={t("connect")}>
                <ToolbarButton
                  label={t("connect")}
                  icon={<Link2 />}
                  aria-pressed={connecting}
                  onClick={() => {
                    onConnectingChange(!connecting);
                    if (!connecting) onRelationshipsVisibleChange(true);
                  }}
                />
              </WorkspaceToolbarGroup>
              <WorkspaceToolbarGroup label={t("relationships")}>
                <ToolbarButton
                  label={t("relationships")}
                  icon={<Waypoints />}
                  collapseAt="medium"
                  disabled={!state.edges.length}
                  aria-pressed={relationshipsVisible}
                  onClick={() => onRelationshipsVisibleChange(!relationshipsVisible)}
                />
              </WorkspaceToolbarGroup>
              {!compact && (
                <>
                  <WorkspaceToolbarGroup label={t("timeToggle")}>
                    <ToolbarButton
                      label={t("timeToggle")}
                      icon={<Clock3 />}
                      collapseAt="medium"
                      aria-pressed={timelineOpen}
                      onClick={() => onTimelineOpenChange(!timelineOpen)}
                    />
                  </WorkspaceToolbarGroup>
                  <WorkspaceToolbarGroup label={t("pathsToggle")}>
                    <ToolbarButton
                      label={t("pathsToggle")}
                      icon={<MapPin />}
                      collapseAt="medium"
                      aria-pressed={journeyOverlayOpen}
                      onClick={() => onJourneyOverlayOpenChange(!journeyOverlayOpen)}
                    />
                  </WorkspaceToolbarGroup>
                </>
              )}
            </>
          }
          history={
            <WorkspaceToolbarGroup label={t("figureHistory")}>
              <UndoRedoControls
                label={t("figureHistory")}
                undoLabel={t("undo")}
                redoLabel={t("redo")}
                undoShortcut={shortcuts.undo}
                redoShortcut={shortcuts.redo}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={() => onUndo?.()}
                onRedo={() => onRedo?.()}
              />
            </WorkspaceToolbarGroup>
          }
          overflow={
            <WorkspaceToolbarGroup label={t("toolbarMoreActions")}>
              <DropdownMenu
                label={t("toolbarMoreActions")}
                renderTrigger={({ ref, ...triggerProps }) => (
                  <ToolbarButton
                    ref={ref}
                    {...triggerProps}
                    label={t("toolbarMoreActions")}
                    icon={<Ellipsis />}
                    labelMode="hidden"
                  />
                )}
              >
                {compact && (
                  <>
                    <MenuItemCheckbox
                      icon={<Clock3 />}
                      label={t("timeToggle")}
                      checked={timelineOpen}
                      onCheckedChange={onTimelineOpenChange}
                    />
                    <MenuItemCheckbox
                      icon={<MapPin />}
                      label={t("pathsToggle")}
                      checked={journeyOverlayOpen}
                      onCheckedChange={onJourneyOverlayOpenChange}
                    />
                    <MenuSeparator />
                  </>
                )}
                <MenuItemCheckbox
                  icon={<Grid3X3 />}
                  label={t("snapToGrid")}
                  checked={snapToGrid}
                  onCheckedChange={onSnapToGridChange}
                />
                <MenuItem
                  disabled={!state.nodes.length}
                  icon={<LayoutGrid />}
                  label={t("arrangeGrid")}
                  onSelect={onAlignAllNodes}
                />
                <MenuSeparator />
                <MenuItem
                  icon={<Download />}
                  label={t("profiles")}
                  onSelect={() => runExport(saveFigureProfiles(state, t))}
                />
                <MenuItem
                  icon={<Download />}
                  label="JSON"
                  onSelect={() => runExport(saveFigureState(state, t))}
                />
                <MenuSeparator />
                <MenuItem
                  icon={<Upload />}
                  label={t("import")}
                  onSelect={() => input.current?.click()}
                />
              </DropdownMenu>
              {/* The file picker behind "Import" stays inside the toolbar, out of the layout. */}
              <TextField
                ref={input}
                fieldClassName="figure-import-field"
                label={t("import")}
                labelHidden
                hidden
                type="file"
                accept="application/json"
                onChange={(event) => void importState(event.target.files?.[0])}
              />
            </WorkspaceToolbarGroup>
          }
        />
      </WorkspaceToolbar>
      {importError && (
        <Toast
          className="story-world-toast"
          tone="danger"
          title={importError}
          dismissLabel={t("closeMessage")}
          onDismiss={() => setImportError("")}
        />
      )}
      {exportError && (
        <Toast
          className="story-world-toast"
          tone="danger"
          title={exportError}
          dismissLabel={t("closeMessage")}
          onDismiss={() => setExportError("")}
        />
      )}
      {pendingImport && (
        <ConfirmDialog
          title={t("importDiagram")}
          description={t("importDiagramDescription")
            .replace("{nodes}", String(pendingImport.nodes.length))
            .replace("{edges}", String(pendingImport.edges.length))}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("importAction")}
          onConfirm={() => {
            onImport(pendingImport);
            setPendingImport(null);
          }}
          onClose={() => setPendingImport(null)}
        />
      )}
    </>
  );
}
