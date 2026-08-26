import {
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
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../design";
import { useI18n } from "../../i18n";
import type { Chapter } from "./model";
import { wordCount } from "./wordCount";
import "./ManuscriptToolbar.css";

type PdfState = "idle" | "loading" | "error";

interface ManuscriptToolbarProps {
  current?: Chapter;
  totalWords: number;
  focus: boolean;
  binderOpen: boolean;
  inspectorOpen: boolean;
  historyOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pdfState: PdfState;
  onAddChapter: () => void;
  onBinderOpen: (open: boolean) => void;
  onInspectorOpen: (open: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFocus: (focus: boolean) => void;
  onHistoryOpen: (open: boolean) => void;
  onExport: () => void;
  onPrint: () => void;
}

export function ManuscriptToolbar({
  current,
  totalWords,
  focus,
  binderOpen,
  inspectorOpen,
  historyOpen,
  canUndo,
  canRedo,
  pdfState,
  onAddChapter,
  onBinderOpen,
  onInspectorOpen,
  onUndo,
  onRedo,
  onFocus,
  onHistoryOpen,
  onExport,
  onPrint,
}: ManuscriptToolbarProps) {
  const { t, locale } = useI18n();

  return (
    <WorkspaceToolbar className="manuscript-toolbar" label={t("manuscript")}>
      <div className="manuscript-toolbar__summary">
        <WorkspaceToolbarTitle title={current?.title || t("manuscript")} />
        <dl className="manuscript-toolbar__stats">
          {current && (
            <>
              <div>
                <dt>{t("words")}</dt>
                <dd>{wordCount(current.body).toLocaleString(locale)}</dd>
              </div>
              <div>
                <dt>{t("characters")}</dt>
                <dd>{current.body.length.toLocaleString(locale)}</dd>
              </div>
              <div>
                <dt>{t("standardPages")}</dt>
                <dd>{(wordCount(current.body) / 250).toFixed(1).replace(".", ",")}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("totalWords")}</dt>
            <dd>{totalWords.toLocaleString(locale)}</dd>
          </div>
        </dl>
      </div>
      <WorkspaceToolbarActions className="manuscript-toolbar-actions">
        <WorkspaceToolbarGroup className="manuscript-toolbar-group">
          <ToolbarButton
            label={t("newChapter")}
            icon={<FilePlus2 />}
            appearance="primary"
            onClick={onAddChapter}
          />
        </WorkspaceToolbarGroup>
        {!focus && (
          <WorkspaceToolbarGroup className="manuscript-toolbar-group panel-toggles">
            <ToolbarButton
              label={t("chapters")}
              icon={<PanelLeft />}
              aria-pressed={binderOpen}
              aria-expanded={binderOpen}
              aria-controls="chapter-binder"
              onClick={() => onBinderOpen(!binderOpen)}
            />
            <ToolbarButton
              label={t("writingAid")}
              icon={<PanelRight />}
              disabled={!current}
              aria-pressed={Boolean(current && inspectorOpen)}
              aria-expanded={Boolean(current && inspectorOpen)}
              aria-controls={current ? "writing-aid-inspector" : undefined}
              onClick={() => {
                if (current) onInspectorOpen(!inspectorOpen);
              }}
            />
          </WorkspaceToolbarGroup>
        )}
        <UndoRedoControls
          className="manuscript-toolbar-group"
          label={t("manuscript")}
          undoLabel={t("undoManuscript")}
          redoLabel={t("redoManuscript")}
          onUndo={() => onUndo?.()}
          onRedo={() => onRedo?.()}
          canUndo={canUndo}
          canRedo={canRedo}
        />
        <WorkspaceToolbarGroup className="manuscript-toolbar-group">
          <ToolbarButton
            label={t("focus")}
            icon={<Focus />}
            aria-pressed={focus}
            onClick={() => onFocus(!focus)}
          />
        </WorkspaceToolbarGroup>
        {current && (
          <WorkspaceToolbarGroup className="manuscript-toolbar-group">
            <ToolbarButton
              label={t("versions")}
              icon={<HistoryIcon />}
              aria-pressed={historyOpen}
              onClick={() => onHistoryOpen(!historyOpen)}
            />
          </WorkspaceToolbarGroup>
        )}
        <WorkspaceToolbarGroup className="manuscript-toolbar-group">
          <DropdownMenu
            label={t("exportOptions")}
            renderTrigger={({ ref, ...triggerProps }) => (
              <ToolbarButton
                {...triggerProps}
                ref={ref}
                label={t("exportManuscript")}
                icon={<Download />}
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
      </WorkspaceToolbarActions>
    </WorkspaceToolbar>
  );
}
