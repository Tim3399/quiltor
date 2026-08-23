import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";
import { applicationErrorMessage, quiltorClient, saveTextFile } from "../../platform";
import { uid } from "../../shared/id";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { ChapterBinder } from "./ChapterBinder";
import {
  addChapterItem,
  flattenChapterIds,
  manuscriptStructure,
  orderedChapters,
  removeChapterItem,
} from "./binder/manuscriptTree";
import { EditorSurface } from "./EditorSurface";
import { FocusPanels } from "./FocusPanels";
import { ManuscriptToolbar } from "./ManuscriptToolbar";
import { markdownBody } from "./marks";
import type { Chapter } from "./model";
import { PrintDocument } from "./PrintDocument";
import { SelectionActions } from "./SelectionActions";
import { TermsSheet } from "./TermsSheet";
import { useChapterHistory } from "./useChapterHistory";
import { useManuscriptSearch } from "./useManuscriptSearch";
import { useWorkspaceSizing } from "./useWorkspaceSizing";
import { useWritingAssistance } from "./useWritingAssistance";
import { WorkspaceLayout } from "./WorkspaceLayout";
import type { TextWorkspaceProps } from "./workspaceTypes";
import { WritingAidInspector } from "./WritingAidInspector";
import { wordCount } from "./wordCount";

export function TextWorkspace({
  worldTitle,
  manuscript,
  figures,
  orphanedMentions = 0,
  onChange,
  onOpenEntity,
  onCurrentChapterId,
  focus,
  onFocus,
  targetId,
  textSearch,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onSave,
  viewportMode = window.innerWidth < 720
    ? "compact"
    : window.innerWidth < 1100
      ? "regular"
      : "wide",
  binderOpen: controlledBinderOpen,
  onBinderOpen,
  inspectorOpen: controlledInspectorOpen,
  onInspectorOpen,
  sidebarWidth = 246,
  onSidebarWidth,
  inspectorWidth = 294,
  onInspectorWidth,
}: TextWorkspaceProps) {
  const { t } = useI18n();
  const [currentId, setCurrentId] = useState(manuscript.chapters[0]?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [localBinderOpen, setLocalBinderOpen] = useState(() => window.innerWidth >= 720);
  const [localInspectorOpen, setLocalInspectorOpen] = useState(() => window.innerWidth >= 1100);
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");
  const [exportError, setExportError] = useState("");
  const binderOpen = controlledBinderOpen ?? localBinderOpen;
  const inspectorOpen = controlledInspectorOpen ?? localInspectorOpen;
  const setBinderOpen = onBinderOpen ?? setLocalBinderOpen;
  const setInspectorOpen = onInspectorOpen ?? setLocalInspectorOpen;
  const structure = useMemo(() => manuscriptStructure(manuscript), [manuscript]);
  const chapters = useMemo(() => orderedChapters(manuscript), [manuscript]);
  const current = chapters.find((chapter) => chapter.id === currentId) ?? chapters[0];
  const currentIndex = current ? chapters.indexOf(current) + 1 : 0;
  useEffect(() => {
    onCurrentChapterId?.(current?.id || "");
  }, [current?.id, onCurrentChapterId]);
  const totalWords = useMemo(
    () => chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0),
    [chapters],
  );
  const commitManuscript = (nextChapters: Chapter[], nextStructure = structure) => {
    const byId = new Map(nextChapters.map((chapter) => [chapter.id, chapter]));
    const ordered = flattenChapterIds(nextStructure).map((id) => {
      const chapter = byId.get(id);
      if (!chapter) throw new Error(`Binder references missing chapter ${id}`);
      return chapter;
    });
    onChange({ ...manuscript, chapters: ordered, structure: nextStructure });
  };
  const setChapters = (nextChapters: Chapter[]) => commitManuscript(nextChapters);
  const updateCurrent = (patch: Partial<Chapter>) =>
    current &&
    setChapters(
      chapters.map((chapter) => (chapter.id === current.id ? { ...chapter, ...patch } : chapter)),
    );
  const writing = useWritingAssistance({
    selectionKey: currentId,
    current,
    manuscript,
    figures,
    onChange,
    onUpdateCurrent: updateCurrent,
    onInspectorOpen: setInspectorOpen,
    onError: setExportError,
  });
  const history = useChapterHistory(current, currentIndex);
  const search = useManuscriptSearch({
    chapters,
    current,
    targetId,
    textSearch,
    editor: writing.editor,
    onCurrentId: setCurrentId,
  });
  const { layoutRef, editorBalance } = useWorkspaceSizing({
    viewportMode,
    focus,
    historyOpen: history.open,
    binderOpen,
    inspectorOpen,
    hasCurrent: Boolean(current),
    sidebarWidth,
    inspectorWidth,
  });

  const addChapter = () => {
    const chapter = {
      id: uid("c"),
      title: t("newChapterTitle").replace("{n}", String(chapters.length + 1)),
      body: "",
      note: "",
    };
    commitManuscript([...chapters, chapter], addChapterItem(structure, chapter.id, uid("tree")));
    setCurrentId(chapter.id);
  };
  const removeChapter = () => {
    if (!current) return;
    const index = chapters.indexOf(current);
    const nextChapters = chapters.filter((chapter) => chapter.id !== current.id);
    setCurrentId(nextChapters[Math.min(index, nextChapters.length - 1)]?.id ?? "");
    commitManuscript(nextChapters, removeChapterItem(structure, current.id));
  };
  const runExport = (task: Promise<void>) => {
    void task
      .then(() => setExportError(""))
      .catch((error) => setExportError(applicationErrorMessage(error)));
  };
  const exportAll = () =>
    runExport(
      saveTextFile(
        quiltorClient.platform,
        `Quiltor-Manuskript-${new Date().toISOString().slice(0, 10)}.md`,
        chapters
          .map(
            (chapter) =>
              `# ${chapter.title || t("untitled")}\n\n${markdownBody(chapter.body, chapter.marks).trim()}\n`,
          )
          .join("\n"),
        t("exportFailed"),
      ),
    );
  const printBook = async () => {
    setPdfState("loading");
    try {
      await onSave?.();
      await quiltorClient.application.documents.bookPdf();
      setPdfState("idle");
    } catch {
      setPdfState("error");
    }
  };

  const binder = (
    <ChapterBinder
      manuscript={manuscript}
      current={current}
      timeline={figures.timeline}
      timeSystem={figures.timeSystem}
      totalWords={totalWords}
      viewportMode={viewportMode}
      onClose={() => setBinderOpen(false)}
      onSelect={setCurrentId}
      onStructureChange={(nextStructure) => commitManuscript(chapters, nextStructure)}
      onUpdateCurrent={updateCurrent}
      onExportCurrent={() => {
        if (!current) return;
        runExport(
          saveTextFile(
            quiltorClient.platform,
            `${current.title || t("chapter")}.md`,
            `# ${current.title}\n\n${markdownBody(current.body, current.marks)}\n`,
            t("exportFailed"),
          ),
        );
      }}
      onRequestDelete={() => setDeleteOpen(true)}
    />
  );
  const inspector = current ? (
    <WritingAidInspector
      current={current}
      manuscript={manuscript}
      figures={figures}
      orphanedMentions={orphanedMentions}
      helperModes={writing.helperModes}
      activeMode={writing.activeMode}
      onMode={writing.setHelperMode}
      selectionTool={writing.selectionTool}
      writingLocale={writing.locale}
      writingQuery={writing.query}
      onWritingQuery={writing.setQuery}
      status={writing.status}
      results={writing.results}
      assistancePhase={writing.phase}
      replaceTarget={Boolean(writing.heldSelection || writing.liveSelection)}
      lookupSources={writing.lookupSources}
      grammarIssues={writing.grammarIssues}
      selectedIssue={writing.selectedIssue}
      grammarPhase={writing.grammarPhase}
      ambiguousMentions={writing.ambiguousMentions}
      symbolPicker={writing.symbolPicker}
      onSymbolPicker={writing.setSymbolPicker}
      onClose={() => setInspectorOpen(false)}
      onRunLookup={() => writing.runLookup()}
      onChooseTool={writing.chooseTool}
      onLocale={writing.changeLocale}
      onInstallData={writing.installData}
      onApplyValue={writing.applyValue}
      onCheckGrammar={writing.checkGrammar}
      onInstallGrammar={writing.installGrammar}
      onSelectIssue={writing.setSelectedIssue}
      onApplyIssue={writing.applyIssue}
      onGrammarMode={(grammarMode) => onChange({ ...manuscript, language: "de-DE", grammarMode })}
      onInsertEntity={writing.insertEntity}
      onResolveAmbiguous={writing.resolveAmbiguous}
      onManageTerms={() => writing.setTermsOpen(true)}
      onInsert={writing.insert}
      onToggleSymbol={(symbol, active) =>
        onChange({
          ...manuscript,
          zeichenAktiv: active
            ? (manuscript.zeichenAktiv || []).filter((item) => item !== symbol)
            : [...(manuscript.zeichenAktiv || []), symbol],
        })
      }
    />
  ) : null;

  return (
    <section className={`text-workspace ${focus ? "is-focus" : ""}`} aria-label={t("manuscript")}>
      <ManuscriptToolbar
        current={current}
        totalWords={totalWords}
        focus={focus}
        binderOpen={binderOpen}
        inspectorOpen={inspectorOpen}
        historyOpen={history.open}
        canUndo={canUndo}
        canRedo={canRedo}
        pdfState={pdfState}
        onAddChapter={addChapter}
        onBinderOpen={setBinderOpen}
        onInspectorOpen={setInspectorOpen}
        onUndo={onUndo}
        onRedo={onRedo}
        onFocus={onFocus}
        onHistoryOpen={history.setOpen}
        onExport={exportAll}
        onPrint={() => void printBook()}
      />
      <WorkspaceLayout
        layoutRef={layoutRef}
        viewportMode={viewportMode}
        focus={focus}
        binderOpen={binderOpen}
        inspectorOpen={inspectorOpen}
        hasCurrent={Boolean(current)}
        sidebarWidth={sidebarWidth}
        inspectorWidth={inspectorWidth}
        editorBalance={editorBalance}
        binder={binder}
        inspector={inspector}
        onBinderOpen={setBinderOpen}
        onInspectorOpen={setInspectorOpen}
        onSidebarWidth={onSidebarWidth}
        onInspectorWidth={onInspectorWidth}
        editor={
          <EditorSurface
            current={current}
            editorRef={writing.editor}
            figures={figures}
            vocabulary={writing.vocabulary}
            grammarIssues={writing.grammarIssues}
            held={
              writing.heldSelection
                ? { from: writing.heldSelection.from, to: writing.heldSelection.to }
                : writing.liveSelection
                  ? { from: writing.liveSelection.from, to: writing.liveSelection.to }
                  : null
            }
            searchQuery={search.query}
            searchMatches={search.matches}
            currentSearchMatches={search.currentMatches}
            activeSearchIndex={search.activeIndex}
            activeSearchMatch={search.activeMatch}
            historyOpen={history.open}
            historyCommits={history.commits}
            historyRef={history.selectedRef}
            historicalText={history.historicalText}
            historyState={history.state}
            onCreateChapter={addChapter}
            onUpdateTitle={(title) => updateCurrent({ title })}
            onEditorChange={writing.onEditorChange}
            onSelection={writing.onSelection}
            onSelectionMenu={writing.onSelectionMenu}
            onIssue={writing.onIssue}
            onOpenEntity={onOpenEntity}
            onNavigateSearch={search.navigate}
            onCloseSearch={search.close}
            onCloseHistory={() => history.setOpen(false)}
            onHistoryRef={history.setSelectedRef}
          />
        }
      />
      <SelectionActions
        editorRef={writing.editor}
        selection={writing.selection}
        liveSelection={writing.liveSelection}
        open={writing.selectionMenuOpen}
        selectionTool={writing.selectionTool}
        onClose={() => writing.setSelectionMenuOpen(false)}
        onCopy={writing.copyToClipboard}
        onOpenWritingTool={writing.openTool}
      />
      <FocusPanels
        focus={focus}
        manuscript={manuscript}
        figures={figures}
        current={current}
        onSelectChapter={setCurrentId}
        onInsertEntity={writing.insertEntity}
        onInsert={writing.insert}
        onFocusEditor={() => writing.editor.current?.focus()}
        onLeave={() => onFocus(false)}
      />
      <PrintDocument worldTitle={worldTitle} manuscript={manuscript} />
      <TermsSheet
        open={writing.termsOpen}
        manuscript={manuscript}
        onChange={onChange}
        onInsert={writing.insert}
        onClose={() => writing.setTermsOpen(false)}
      />
      {deleteOpen && current && (
        <ConfirmDialog
          title={t("deleteChapter")}
          description={t("deleteChapterDescription").replace(
            "{title}",
            current.title || t("untitled"),
          )}
          confirmLabel={t("deleteChapter")}
          undoable
          onConfirm={removeChapter}
          onClose={() => setDeleteOpen(false)}
        />
      )}
      {pdfState === "error" && (
        <div className="toast error-box" role="alert">
          {t("bookPdfError")}
          <button onClick={() => setPdfState("idle")}>
            <X />
            <span className="sr-only">{t("closeMessage")}</span>
          </button>
        </div>
      )}
      {!!exportError && (
        <div className="toast error-box" role="alert">
          {exportError}
          <button onClick={() => setExportError("")}>
            <X />
            <span className="sr-only">{t("closeMessage")}</span>
          </button>
        </div>
      )}
    </section>
  );
}
