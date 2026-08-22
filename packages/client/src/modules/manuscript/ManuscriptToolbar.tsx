import { useRef, useState } from "react";
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
      <div className="tool-group">
        <button className="primary" onClick={onAddChapter}>
          <FilePlus2 />
          {t("newChapter")}
        </button>
      </div>
      {!focus && (
        <div className="tool-group panel-toggles">
          <button
            aria-pressed={binderOpen}
            aria-expanded={binderOpen}
            aria-controls="chapter-binder"
            onClick={() => onBinderOpen(!binderOpen)}
            aria-label={t("chapters")}
            title={t("chapters")}
          >
            <PanelLeft />
            <span>{t("chapters")}</span>
          </button>
          <button
            disabled={!current}
            aria-pressed={Boolean(current && inspectorOpen)}
            aria-expanded={Boolean(current && inspectorOpen)}
            aria-controls={current ? "writing-aid-inspector" : undefined}
            onClick={() => {
              if (current) onInspectorOpen(!inspectorOpen);
            }}
            aria-label={t("writingAid")}
            title={t("writingAid")}
          >
            <PanelRight />
            <span>{t("writingAid")}</span>
          </button>
        </div>
      )}
      <div className="tool-group">
        <button
          disabled={!canUndo}
          onClick={onUndo}
          aria-label={t("undoManuscript")}
          title={`${t("undoManuscript")} · ${keys("Z")}`}
        >
          <Undo2 />
        </button>
        <button
          disabled={!canRedo}
          onClick={onRedo}
          aria-label={t("redoManuscript")}
          title={`${t("redoManuscript")} · ${keys("Z", { shift: true })}`}
        >
          <Redo2 />
        </button>
      </div>
      <div className="tool-group">
        <button aria-pressed={focus} onClick={() => onFocus(!focus)}>
          <Focus />
          {t("focus")}
        </button>
      </div>
      {current && (
        <div className="tool-group">
          <button
            aria-pressed={historyOpen}
            onClick={() => onHistoryOpen(!historyOpen)}
            title={t("versions")}
          >
            <HistoryIcon />
            {t("versions")}
          </button>
        </div>
      )}
      <div className="tool-group">
        <button
          ref={exportButton}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen((value) => !value)}
        >
          <Download />
          {t("exportManuscript")}
        </button>
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
  );
}
