import {
  BetweenHorizontalEnd,
  BookOpen,
  Download,
  Ellipsis,
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
  MenuSeparator,
  ToolbarButton,
  UndoRedoControls,
  useMediaMatch,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../design";
import { useI18n } from "../../i18n";
import type { ManuscriptDocxPreset } from "../../platform";
import { historyShortcuts } from "../../shared";
import type { Chapter } from "./model";
import "./ManuscriptToolbar.css";

type PdfState = "idle" | "loading" | "error";

interface ManuscriptToolbarProps {
  current?: Chapter;
  focus: boolean;
  binderOpen: boolean;
  inspectorOpen: boolean;
  historyOpen: boolean;
  /** False in the example world's preview, which keeps no versions (T-214, T-86). */
  versionsAvailable?: boolean;
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
  onExportDocx: (preset: ManuscriptDocxPreset) => void;
  onExportEpub: () => void;
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
  versionsAvailable = true,
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
  onExportDocx,
  onExportEpub,
  onPrint,
  onPreview,
  onInsertSceneBreak,
}: ManuscriptToolbarProps) {
  const { t, locale } = useI18n();
  // Undo and redo stay in the row at every width, like in every other workspace (styleguide
  // 7.4). Seven touch buttons fit down to 360 px; below that the focus toggle, the one reached
  // for least while writing on a phone, moves into "…" instead.
  const shortcuts = historyShortcuts(locale);
  const focusInMenu = useMediaMatch("(max-width: 359px)");

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
                {!focusInMenu && (
                  <ToolbarButton
                    label={t("focus")}
                    icon={<Focus />}
                    collapseAt="medium"
                    aria-pressed={focus}
                    disabled={preview}
                    onClick={() => onFocus(!focus)}
                  />
                )}
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
          <UndoRedoControls
            className="manuscript-toolbar-group"
            label={t("manuscriptHistory")}
            undoLabel={t("undo")}
            redoLabel={t("redo")}
            undoShortcut={shortcuts.undo}
            redoShortcut={shortcuts.redo}
            onUndo={() => onUndo?.()}
            onRedo={() => onRedo?.()}
            canUndo={!preview && canUndo}
            canRedo={!preview && canRedo}
          />
        }
        overflow={
          // Secondary by frequency: writing happens with chapters, panels, focus and history at
          // hand; the print preview, stored versions, the scene break and the book export are
          // reached for now and then, so they wait one click away instead of a second row. The
          // exports sit flat, not in a submenu: on compact widths a submenu opens as a sheet
          // underneath the overflow sheet and cannot be reached.
          <DropdownMenu
            label={t("toolbarMoreActions")}
            renderTrigger={({ ref, ...triggerProps }) => (
              <ToolbarButton
                {...triggerProps}
                ref={ref}
                className="manuscript-toolbar__more"
                label={t("toolbarMoreActions")}
                labelMode="hidden"
                icon={<Ellipsis />}
              />
            )}
          >
            {focusInMenu && !focus && (
              <>
                {/* An action, not a checkbox: a checkbox keeps the menu open, and focus mode
                    then opened behind the sheet with no way back (T-258 F1). */}
                <MenuItem
                  icon={<Focus />}
                  label={t("focus")}
                  disabled={preview}
                  onSelect={() => onFocus(true)}
                />
                <MenuSeparator />
              </>
            )}
            <MenuItem
              icon={<BookOpen />}
              label={t("printPreview")}
              selected={preview}
              onSelect={() => onPreview(!preview)}
            />
            {current && versionsAvailable && (
              <MenuItem
                icon={<HistoryIcon />}
                label={t("versions")}
                selected={historyOpen}
                disabled={preview}
                onSelect={() => onHistoryOpen(!historyOpen)}
              />
            )}
            <MenuItem
              icon={<BetweenHorizontalEnd />}
              label={t("insertSceneBreak")}
              disabled={!current || preview}
              onSelect={onInsertSceneBreak}
            />
            <MenuSeparator />
            <MenuItem
              icon={<Download />}
              label={t("manuscriptMarkdownAction")}
              onSelect={onExport}
            />
            <MenuItem
              icon={<Download />}
              label={t("manuscriptExportEditorAction")}
              onSelect={() => onExportDocx("editor")}
            />
            <MenuItem
              icon={<Download />}
              label={t("manuscriptExportNormseiteAction")}
              onSelect={() => onExportDocx("normseite")}
            />
            <MenuItem
              icon={<Download />}
              label={t("manuscriptEpubAction")}
              onSelect={onExportEpub}
            />
            <MenuItem
              icon={<Printer />}
              label={pdfState === "loading" ? t("creatingPdf") : t("bookPdf")}
              disabled={pdfState === "loading"}
              onSelect={onPrint}
            />
          </DropdownMenu>
        }
      />
    </WorkspaceToolbar>
  );
}
