import {
  Clock3,
  Download,
  Grid3X3,
  LayoutGrid,
  Link2,
  MapPin,
  MoreHorizontal,
  Plus,
  Redo2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button, IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import { applicationErrorMessage } from "../../../platform";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { Menu, MenuItem, MenuSeparator } from "../../../shared/ui/Menu";
import { Popover } from "../../../shared/ui/Popover";
import { useShortcut } from "../../../shared/ui/shortcuts";
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
  const keys = useShortcut();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<FigureState | null>(null);
  const [importError, setImportError] = useState("");
  const [exportError, setExportError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const manageButton = useRef<HTMLButtonElement>(null);

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
      <div className="context-bar">
        <div className="context-title">
          <strong>{t("figuresWorld")}</strong>
          <span>
            {t("nElements", { n: state.nodes.length })} ·{" "}
            {t("nRelationships", { n: state.edges.length })}
          </span>
        </div>
        <div className="tool-group create-group">
          <Button
            ref={createButton}
            appearance="primary"
            icon={<Plus />}
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
            onClick={() => setCreateMenuOpen((value) => !value)}
          >
            {t("element")}
          </Button>
          <Popover
            anchorRef={createButton}
            open={createMenuOpen}
            onClose={() => setCreateMenuOpen(false)}
            label={t("createElementMenu")}
          >
            <Menu label={t("createElementMenu")} onClose={() => setCreateMenuOpen(false)}>
              {FIGURE_ELEMENT_TYPES.map((type) => (
                <MenuItem
                  key={type.kind}
                  onSelect={() => {
                    onAddNode(type.kind);
                    setCreateMenuOpen(false);
                  }}
                >
                  <Plus />
                  {t(type.label)}
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </div>
        <div className="tool-group">
          <Button
            appearance="ghost"
            icon={<Link2 />}
            aria-pressed={connecting}
            onClick={() => {
              onConnectingChange(!connecting);
              if (!connecting) onRelationshipsVisibleChange(true);
            }}
          >
            {t("connect")}
          </Button>
        </div>
        <div className="tool-group">
          <Button
            ref={viewButton}
            appearance="ghost"
            icon={<Grid3X3 />}
            aria-expanded={viewMenuOpen}
            aria-haspopup="menu"
            onClick={() => setViewMenuOpen((value) => !value)}
          >
            {t("figureViewMenu")}
          </Button>
          <Popover
            anchorRef={viewButton}
            open={viewMenuOpen}
            onClose={() => setViewMenuOpen(false)}
            label={t("figureViewMenu")}
          >
            <Menu label={t("figureViewMenu")} onClose={() => setViewMenuOpen(false)}>
              <MenuItem
                onSelect={() => {
                  onSnapToGridChange(!snapToGrid);
                  setViewMenuOpen(false);
                }}
              >
                <Grid3X3 />
                {snapToGrid ? t("hideGrid") : t("showGrid")}
              </MenuItem>
              <MenuItem
                disabled={!state.nodes.length}
                onSelect={() => {
                  onAlignAllNodes();
                  setViewMenuOpen(false);
                }}
              >
                <LayoutGrid />
                {t("arrangeGrid")}
              </MenuItem>
              <MenuItem
                disabled={!state.edges.length}
                onSelect={() => {
                  onRelationshipsVisibleChange(!relationshipsVisible);
                  setViewMenuOpen(false);
                }}
              >
                <Link2 />
                {relationshipsVisible ? t("hideRelationships") : t("showRelationships")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  onTimelineOpenChange(!timelineOpen);
                  setViewMenuOpen(false);
                }}
              >
                <Clock3 />
                {timelineOpen ? t("hideTimeline") : t("showTimeline")}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  onJourneyOverlayOpenChange(!journeyOverlayOpen);
                  setViewMenuOpen(false);
                }}
              >
                <MapPin />
                {journeyOverlayOpen ? t("hidePaths") : t("showPaths")}
              </MenuItem>
            </Menu>
          </Popover>
        </div>
        <div className="tool-group">
          <IconButton
            label={t("undoDiagram")}
            icon={<Undo2 />}
            appearance="ghost"
            size="regular"
            disabled={!canUndo}
            onClick={onUndo}
            title={`${t("undoDiagram")} · ${keys("Z")}`}
          />
          <IconButton
            label={t("redoDiagram")}
            icon={<Redo2 />}
            appearance="ghost"
            size="regular"
            disabled={!canRedo}
            onClick={onRedo}
            title={`${t("redoDiagram")} · ${keys("Z", { shift: true })}`}
          />
        </div>
        <div className="tool-group">
          <IconButton
            ref={manageButton}
            label={t("figureManageMenu")}
            icon={<MoreHorizontal />}
            appearance="ghost"
            size="regular"
            aria-expanded={manageMenuOpen}
            aria-haspopup="menu"
            onClick={() => setManageMenuOpen((value) => !value)}
          />
          <Popover
            anchorRef={manageButton}
            open={manageMenuOpen}
            onClose={() => setManageMenuOpen(false)}
            label={t("figureManageMenu")}
          >
            <Menu label={t("figureManageMenu")} onClose={() => setManageMenuOpen(false)}>
              <MenuItem
                onSelect={() => {
                  runExport(saveFigureProfiles(state, t));
                  setManageMenuOpen(false);
                }}
              >
                <Download />
                {t("profiles")}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  runExport(saveFigureState(state, t));
                  setManageMenuOpen(false);
                }}
              >
                <Download />
                JSON
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  input.current?.click();
                  setManageMenuOpen(false);
                }}
              >
                <Upload />
                {t("import")}
              </MenuItem>
            </Menu>
          </Popover>
          <input
            ref={input}
            hidden
            type="file"
            accept="application/json"
            onChange={(event) => void importState(event.target.files?.[0])}
          />
        </div>
      </div>
      {importError && (
        <div className="toast error-box" role="alert">
          {importError}
          <IconButton
            className="figure-toolbar-toast-close"
            label={t("closeMessage")}
            icon={<X />}
            appearance="ghost"
            onClick={() => setImportError("")}
          />
        </div>
      )}
      {exportError && (
        <div className="toast error-box" role="alert">
          {exportError}
          <IconButton
            className="figure-toolbar-toast-close"
            label={t("closeMessage")}
            icon={<X />}
            appearance="ghost"
            onClick={() => setExportError("")}
          />
        </div>
      )}
      {pendingImport && (
        <ConfirmDialog
          title={t("importDiagram")}
          description={t("importDiagramDescription")
            .replace("{nodes}", String(pendingImport.nodes.length))
            .replace("{edges}", String(pendingImport.edges.length))}
          confirmLabel={t("importAction")}
          undoable
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
