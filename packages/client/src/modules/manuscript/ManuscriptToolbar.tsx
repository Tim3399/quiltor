import {
  Download,
  FilePlus2,
  Focus,
  History as HistoryIcon,
  PanelLeft,
  PanelRight,
  Printer,
  Redo2,
  Undo2,
} from "lucide-react";
import { useRef, useState } from "react";
import { ToolbarButton } from "../../design";
import { useI18n } from "../../i18n";
import { Menu, MenuItem } from "../../shared/ui/Menu";
import { Popover } from "../../shared/ui/Popover";
import { useShortcut } from "../../shared/ui/shortcuts";
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
  const keys = useShortcut();
  const [exportOpen, setExportOpen] = useState(false);
  const exportButton = useRef<HTMLButtonElement>(null);

  return (
    <div className="context-bar">
      <div className="context-title">
        <strong>{current?.title || t("manuscript")}</strong>
        <dl className="stats chapter-stats">
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
      <div
        className="context-tools manuscript-toolbar-actions"
        role="toolbar"
        aria-label={t("manuscript")}
      >
        <div className="tool-group">
          <ToolbarButton
            label={t("newChapter")}
            icon={<FilePlus2 />}
            appearance="primary"
            onClick={onAddChapter}
          />
        </div>
        {!focus && (
          <div className="tool-group panel-toggles">
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
          </div>
        )}
        <div className="tool-group">
          <ToolbarButton
            label={t("undoManuscript")}
            labelMode="hidden"
            icon={<Undo2 />}
            disabled={!canUndo}
            onClick={onUndo}
            title={`${t("undoManuscript")} · ${keys("Z")}`}
          />
          <ToolbarButton
            label={t("redoManuscript")}
            labelMode="hidden"
            icon={<Redo2 />}
            disabled={!canRedo}
            onClick={onRedo}
            title={`${t("redoManuscript")} · ${keys("Z", { shift: true })}`}
          />
        </div>
        <div className="tool-group">
          <ToolbarButton
            label={t("focus")}
            icon={<Focus />}
            aria-pressed={focus}
            onClick={() => onFocus(!focus)}
          />
        </div>
        {current && (
          <div className="tool-group">
            <ToolbarButton
              label={t("versions")}
              icon={<HistoryIcon />}
              aria-pressed={historyOpen}
              onClick={() => onHistoryOpen(!historyOpen)}
            />
          </div>
        )}
        <div className="tool-group">
          <ToolbarButton
            ref={exportButton}
            label={t("exportManuscript")}
            icon={<Download />}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((value) => !value)}
          />
        </div>
        <Popover
          anchorRef={exportButton}
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          label={t("exportOptions")}
        >
          <Menu label={t("exportOptions")} onClose={() => setExportOpen(false)}>
            <MenuItem
              onSelect={() => {
                onExport();
                setExportOpen(false);
              }}
            >
              <Download />
              {t("manuscript")}
            </MenuItem>
            <MenuItem
              disabled={pdfState === "loading"}
              onSelect={() => {
                onPrint();
                setExportOpen(false);
              }}
            >
              <Printer />
              {pdfState === "loading" ? t("creatingPdf") : t("bookPdf")}
            </MenuItem>
          </Menu>
        </Popover>
      </div>
    </div>
  );
}
