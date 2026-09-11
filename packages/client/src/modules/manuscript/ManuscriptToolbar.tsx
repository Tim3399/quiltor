import {
  BetweenHorizontalEnd,
  BookOpen,
  Download,
  FilePlus2,
  Focus,
  History as HistoryIcon,
  PanelLeft,
  PanelRight,
  Printer,
} from "lucide-react";
import {
  DropdownMenu,
  MenuItem,
  ToolbarButton,
  UndoRedoControls,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../design";
import { useI18n } from "../../i18n";
import type { Chapter } from "./model";
import "./ManuscriptToolbar.css";

type PdfState = "idle" | "loading" | "error";

interface ManuscriptToolbarProps {
  current?: Chapter;
  focus: boolean;
  binderOpen: boolean;
  inspectorOpen: boolean;
  historyOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pdfState: PdfState;
  preview: boolean;
  onAddChapter: () => void;
  onBinderOpen: (open: boolean) => void;
  onInspectorOpen: (open: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFocus: (focus: boolean) => void;
  onHistoryOpen: (open: boolean) => void;
  onExport: () => void;
  onPrint: () => void;
  onPreview: (preview: boolean) => void;
  onInsertSceneBreak: () => void;
}

export function ManuscriptToolbar({
  current,
  focus,
  binderOpen,
  inspectorOpen,
  historyOpen,
  canUndo,
  canRedo,
  pdfState,
  preview,
  onAddChapter,
  onBinderOpen,
  onInspectorOpen,
  onUndo,
  onRedo,
  onFocus,
  onHistoryOpen,
  onExport,
  onPrint,
  onPreview,
  onInsertSceneBreak,
}: ManuscriptToolbarProps) {
  const { t } = useI18n();

  return (
    <WorkspaceToolbar className="manuscript-toolbar" label={t("manuscript")}>
      <div className="manuscript-toolbar__summary">
        <WorkspaceToolbarTitle title={current?.title || t("manuscript")} />
      </div>
      <WorkspaceToolbarActions
        className="manuscript-toolbar-actions"
        create={
          <WorkspaceToolbarGroup className="manuscript-toolbar-group">
            <WorkspaceToolbarCreateButton
              label={t("newChapter")}
              icon={<FilePlus2 />}
              disabled={preview}
              onClick={onAddChapter}
            />
          </WorkspaceToolbarGroup>
        }
        view={
          <>
            <WorkspaceToolbarGroup className="manuscript-toolbar-group">
              <ToolbarButton
                label={t("printPreview")}
                icon={<BookOpen />}
                collapseAt="medium"
                aria-pressed={preview}
                onClick={() => onPreview(!preview)}
              />
            </WorkspaceToolbarGroup>
            {!focus && (
              <WorkspaceToolbarGroup className="manuscript-toolbar-group panel-toggles">
                <ToolbarButton
                  label={t("chapters")}
                  icon={<PanelLeft />}
                  collapseAt="medium"
                  aria-pressed={binderOpen}
                  aria-expanded={binderOpen}
                  aria-controls="chapter-binder"
                  onClick={() => onBinderOpen(!binderOpen)}
                />
                <ToolbarButton
                  label={t("inspectorPanel")}
                  icon={<PanelRight />}
                  collapseAt="medium"
                  disabled={!current}
                  aria-pressed={Boolean(current && inspectorOpen)}
                  aria-expanded={Boolean(current && inspectorOpen)}
                  aria-controls={current ? "writing-aid-inspector" : undefined}
                  onClick={() => {
                    if (current) onInspectorOpen(!inspectorOpen);
                  }}
                />
                <ToolbarButton
                  label={t("focus")}
                  icon={<Focus />}
                  collapseAt="medium"
                  aria-pressed={focus}
                  disabled={preview}
                  onClick={() => onFocus(!focus)}
                />
              </WorkspaceToolbarGroup>
            )}
            {focus && (
              <WorkspaceToolbarGroup className="manuscript-toolbar-group">
                <ToolbarButton
                  label={t("focus")}
                  icon={<Focus />}
                  collapseAt="medium"
                  aria-pressed={focus}
                  onClick={() => onFocus(!focus)}
                />
              </WorkspaceToolbarGroup>
            )}
          </>
        }
        history={
          <>
            <UndoRedoControls
              className="manuscript-toolbar-group"
              label={t("manuscript")}
              undoLabel={t("undoManuscript")}
              redoLabel={t("redoManuscript")}
              onUndo={() => onUndo?.()}
              onRedo={() => onRedo?.()}
              canUndo={!preview && canUndo}
              canRedo={!preview && canRedo}
            />
            {current && (
              <WorkspaceToolbarGroup className="manuscript-toolbar-group">
                <ToolbarButton
                  label={t("versions")}
                  icon={<HistoryIcon />}
                  collapseAt="medium"
                  aria-pressed={historyOpen}
                  disabled={preview}
                  onClick={() => onHistoryOpen(!historyOpen)}
                />
              </WorkspaceToolbarGroup>
            )}
          </>
        }
        actions={
          <WorkspaceToolbarGroup className="manuscript-toolbar-group">
            <ToolbarButton
              label={t("insertSceneBreak")}
              icon={<BetweenHorizontalEnd />}
              collapseAt="medium"
              disabled={!current || preview}
              onClick={onInsertSceneBreak}
            />
            <DropdownMenu
              label={t("exportOptions")}
              renderTrigger={({ ref, ...triggerProps }) => (
                <ToolbarButton
                  {...triggerProps}
                  ref={ref}
                  label={t("exportManuscript")}
                  icon={<Download />}
                  collapseAt="medium"
                />
              )}
            >
              <MenuItem icon={<Download />} label={t("manuscript")} onSelect={onExport} />
              <MenuItem
                icon={<Printer />}
                label={pdfState === "loading" ? t("creatingPdf") : t("bookPdf")}
                disabled={pdfState === "loading"}
                onSelect={onPrint}
              />
            </DropdownMenu>
          </WorkspaceToolbarGroup>
        }
      />
    </WorkspaceToolbar>
  );
}
