import {
  Clock3,
  Download,
  Grid3X3,
  LayoutGrid,
  Link2,
  MapPin,
  MoreHorizontal,
  Plus,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  ConfirmDialog,
  DropdownMenu,
  MenuItem,
  MenuSeparator,
  TextField,
  ToolbarButton,
  Toast,
  UndoRedoControls,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../../design";
import { useI18n } from "../../../i18n";
import { applicationErrorMessage } from "../../../platform";
import type { FigureKind, FigureState } from "../model";
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
  const { t } = useI18n();
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
              {t("nElements", { n: state.nodes.length })} ·{" "}
              {t("nRelationships", { n: state.edges.length })}
            </>
          }
        />
        <WorkspaceToolbarActions>
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
          <WorkspaceToolbarGroup label={t("figureViewMenu")}>
            <DropdownMenu
              label={t("figureViewMenu")}
              renderTrigger={({ ref, ...triggerProps }) => (
                <ToolbarButton
                  ref={ref}
                  {...triggerProps}
                  label={t("figureViewMenu")}
                  icon={<Grid3X3 />}
                />
              )}
            >
              <MenuItem
                icon={<Grid3X3 />}
                label={snapToGrid ? t("hideGrid") : t("showGrid")}
                onSelect={() => onSnapToGridChange(!snapToGrid)}
              />
              <MenuItem
                disabled={!state.nodes.length}
                icon={<LayoutGrid />}
                label={t("arrangeGrid")}
                onSelect={onAlignAllNodes}
              />
              <MenuItem
                disabled={!state.edges.length}
                icon={<Link2 />}
                label={relationshipsVisible ? t("hideRelationships") : t("showRelationships")}
                onSelect={() => onRelationshipsVisibleChange(!relationshipsVisible)}
              />
              <MenuSeparator />
              <MenuItem
                icon={<Clock3 />}
                label={timelineOpen ? t("hideTimeline") : t("showTimeline")}
                onSelect={() => onTimelineOpenChange(!timelineOpen)}
              />
              <MenuItem
                icon={<MapPin />}
                label={journeyOverlayOpen ? t("hidePaths") : t("showPaths")}
                onSelect={() => onJourneyOverlayOpenChange(!journeyOverlayOpen)}
              />
            </DropdownMenu>
          </WorkspaceToolbarGroup>
          <WorkspaceToolbarGroup label={`${t("undoDiagram")} / ${t("redoDiagram")}`}>
            <UndoRedoControls
              label={`${t("undoDiagram")} / ${t("redoDiagram")}`}
              undoLabel={t("undoDiagram")}
              redoLabel={t("redoDiagram")}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => onUndo?.()}
              onRedo={() => onRedo?.()}
            />
          </WorkspaceToolbarGroup>
          <WorkspaceToolbarGroup label={t("figureManageMenu")}>
            <DropdownMenu
              label={t("figureManageMenu")}
              renderTrigger={({ ref, ...triggerProps }) => (
                <ToolbarButton
                  ref={ref}
                  {...triggerProps}
                  label={t("figureManageMenu")}
                  icon={<MoreHorizontal />}
                  labelMode="hidden"
                  size="regular"
                />
              )}
            >
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
        </WorkspaceToolbarActions>
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
