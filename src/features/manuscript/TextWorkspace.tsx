import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  FilePlus2,
  Focus,
  History as HistoryIcon,
  PanelLeft,
  PanelRight,
  Pilcrow,
  Printer,
  Redo2,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type {
  Chapter,
  FigureNode,
  FigureState,
  Manuscript,
  TextSearchTarget,
  Workspace,
  WritingIssue,
} from "../../types";
import { uid, wordCount } from "../../types";
import { download, errorMessage } from "../../lib/api";
import type { LanguageLookupResult, LanguageStatus } from "../../lib/api";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useShortcut } from "../../shared/ui/shortcuts";
import { api } from "../../lib/api";
import type { SnapshotInfo } from "../../types";
import "./TextWorkspace.css";
import { writingVocabulary } from "./autocomplete";
import { useLanguage } from "../../language";
import { Sheet } from "../../shared/ui/Sheet";
import { SegmentedControl } from "../../shared/ui/SegmentedControl";
import { Menu, MenuItem } from "../../shared/ui/Menu";
import { Popover } from "../../shared/ui/Popover";
import { SelectionMenu } from "../../shared/ui/SelectionMenu";
import type { ViewportMode } from "../../hooks/useWorkspaceLayout";
import {
  ManuscriptEditor,
  type EditorTextSelection,
  type ManuscriptEditorHandle,
} from "./ManuscriptEditor";
import { addDeterministicMentions, scanEntityMentions } from "./mentions";
import { bodyParagraphs, markdownBody, markedSegments } from "./marks";
import { kindLabel } from "../figures/relationships";
import { manuscriptSearchMatches } from "./search";
import { editorBalanceOffset } from "./editorLayout";

// The writing aid used to stack five unrelated jobs into one 294px scroll. It now holds
// three activities and shows exactly one of them: looking a word up, checking the chapter,
// and inserting a building block. Everything that is configuration rather than something
// you consult mid-sentence -- managing the project dictionary -- moved into a sheet.
type HelperMode = "lookup" | "check" | "insert";
type WritingTool = "lookup" | "synonyms" | "translate";
const WRITING_TOOLS: WritingTool[] = ["lookup", "synonyms", "translate"];

export function TextWorkspace({
  worldTitle,
  manuscript,
  figures,
  orphanedMentions = 0,
  onChange,
  onOpenEntity,
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
}: {
  worldTitle?: string;
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions?: number;
  onChange: (value: Manuscript) => void;
  onOpenEntity?: (target: { workspace: Workspace; id: string }) => void;
  focus: boolean;
  onFocus: (value: boolean) => void;
  targetId?: string;
  textSearch?: TextSearchTarget;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSave?: () => Promise<void>;
  viewportMode?: ViewportMode;
  binderOpen?: boolean;
  onBinderOpen?: (open: boolean) => void;
  inspectorOpen?: boolean;
  onInspectorOpen?: (open: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidth?: (width: number) => void;
  inspectorWidth?: number;
  onInspectorWidth?: (width: number) => void;
}) {
  // Aliased: runLookup() has its own `language` parameter for the *manuscript* language, which
  // is a different thing from the interface language used for number and date formatting.
  const { t, language: uiLanguage } = useLanguage();
  const keys = useShortcut();
  const [currentId, setCurrentId] = useState(manuscript.chapters[0]?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [localBinderOpen, setLocalBinderOpen] = useState(() => window.innerWidth >= 720);
  const [localInspectorOpen, setLocalInspectorOpen] = useState(() => window.innerWidth >= 1100);
  const binderOpen = controlledBinderOpen ?? localBinderOpen;
  const inspectorOpen = controlledInspectorOpen ?? localInspectorOpen;
  const setBinderOpen = onBinderOpen ?? setLocalBinderOpen;
  const setInspectorOpen = onInspectorOpen ?? setLocalInspectorOpen;
  const [newWord, setNewWord] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [symbolPicker, setSymbolPicker] = useState(false);
  const [focusHelpers, setFocusHelpers] = useState(false);
  const [focusChapters, setFocusChapters] = useState(false);
  const [selection, setSelection] = useState<
    (EditorTextSelection & { chapterId: string; revision: string }) | null
  >(null);
  // Marking text and asking for the lookup actions are two different acts. The menu
  // opens only for the second one -- right-click or Shift+F10 in the editor, the way
  // macOS does it -- instead of springing up at every double-click.
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [writingSelection, setWritingSelection] = useState<
    (EditorTextSelection & { chapterId: string; revision: string }) | null
  >(null);
  const [helperMode, setHelperMode] = useState<HelperMode>("lookup");
  const [selectionTool, setSelectionTool] = useState<WritingTool>("lookup");
  const [termsOpen, setTermsOpen] = useState(false);
  const [writingQuery, setWritingQuery] = useState("");
  const [writingLanguage, setWritingLanguage] = useState<"de-DE" | "en-GB">("de-DE");
  const [languageStatus, setLanguageStatus] = useState<LanguageStatus | null>(null);
  const [languageResults, setLanguageResults] = useState<LanguageLookupResult[]>([]);
  const [languagePhase, setLanguagePhase] = useState<"idle" | "loading" | "installing" | "error">(
    "idle",
  );
  const [grammarIssues, setGrammarIssues] = useState<WritingIssue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<WritingIssue | null>(null);
  const [grammarPhase, setGrammarPhase] = useState<
    "idle" | "checking" | "installing" | "unavailable" | "error"
  >("idle");
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [commits, setCommits] = useState<SnapshotInfo[]>([]);
  const [historyRef, setHistoryRef] = useState("");
  const [historicalText, setHistoricalText] = useState("");
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");
  const [exportError, setExportError] = useState("");
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const editor = useRef<ManuscriptEditorHandle | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const grammarRequest = useRef<AbortController | null>(null);
  const selectionAnchor = useRef<HTMLButtonElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const current =
    manuscript.chapters.find((chapter) => chapter.id === currentId) ?? manuscript.chapters[0];
  const currentRef = useRef(current);
  currentRef.current = current;
  const currentIndex = current ? manuscript.chapters.indexOf(current) + 1 : 0;
  const editorBalance =
    viewportMode === "wide" && !focus && !historyOpen
      ? editorBalanceOffset(
          layoutWidth,
          binderOpen ? sidebarWidth : 0,
          inspectorOpen && current ? inspectorWidth : 0,
        )
      : null;
  const searchMatches = useMemo(
    () => manuscriptSearchMatches(manuscript.chapters, searchQuery),
    [manuscript.chapters, searchQuery],
  );
  const activeSearchMatch = searchMatches[activeSearchIndex] ?? null;
  const currentSearchMatches = useMemo(
    () => searchMatches.filter((match) => match.chapterId === current?.id),
    [searchMatches, current?.id],
  );
  useEffect(() => {
    if (targetId && manuscript.chapters.some((chapter) => chapter.id === targetId))
      setCurrentId(targetId);
  }, [targetId]);
  useEffect(() => {
    const requestedSearch = textSearch,
      query = requestedSearch?.query.trim();
    if (!query || !targetId || !requestedSearch) return;
    const matches = manuscriptSearchMatches(manuscript.chapters, query);
    const requested = matches.findIndex(
      (match) =>
        match.chapterId === targetId &&
        match.from === requestedSearch.from &&
        match.to === requestedSearch.to,
    );
    setSearchQuery(query);
    setActiveSearchIndex(requested >= 0 ? requested : 0);
    if (manuscript.chapters.some((chapter) => chapter.id === targetId)) setCurrentId(targetId);
  }, [targetId, textSearch]);
  useEffect(() => {
    if (!searchQuery) return;
    setActiveSearchIndex((index) => Math.min(index, Math.max(0, searchMatches.length - 1)));
  }, [searchMatches.length, searchQuery]);
  useEffect(() => {
    if (!activeSearchMatch || activeSearchMatch.chapterId !== current?.id) return;
    const frame = requestAnimationFrame(() =>
      editor.current?.reveal(activeSearchMatch.from, activeSearchMatch.to),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeSearchMatch?.chapterId, activeSearchMatch?.from, activeSearchMatch?.to, current?.id]);
  useEffect(() => {
    if (!focus) setFocusHelpers(false);
  }, [focus]);
  useEffect(() => {
    const element = layout.current;
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0) setLayoutWidth(element.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    if (typeof ResizeObserver !== "function")
      return () => window.removeEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    if (!historyOpen || commits.length) return;
    setHistoryState("loading");
    void api
      .log()
      .then((result) => {
        setCommits(result.commits);
        setHistoryRef(result.commits[0]?.hash || "");
        setHistoryState("idle");
      })
      .catch(() => setHistoryState("error"));
  }, [historyOpen, commits.length]);
  useEffect(() => {
    if (!historyOpen || !historyRef || !current) return;
    setHistoryState("loading");
    // current.title has to stay a dependency (the lookup is by archived filename, which
    // is derived from the title), but that means every keystroke while editing the title
    // would otherwise re-fire this fetch -- debounce so only a paused title settles it.
    const timeout = setTimeout(() => {
      void api
        .textVersion(historyRef, currentIndex, current.title)
        .then((result) => {
          setHistoricalText(result.neu ? "" : result.text);
          setHistoryState("idle");
        })
        .catch(() => setHistoryState("error"));
    }, 400);
    return () => clearTimeout(timeout);
  }, [historyOpen, historyRef, current?.id, current?.title, currentIndex]);
  const total = useMemo(
    () => manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0),
    [manuscript.chapters],
  );
  const navigateSearch = (offset: number) => {
    if (!searchMatches.length) return;
    const next = (activeSearchIndex + offset + searchMatches.length) % searchMatches.length;
    setActiveSearchIndex(next);
    setCurrentId(searchMatches[next].chapterId);
  };
  const vocabulary = useMemo(
    () => writingVocabulary(manuscript, figures),
    [manuscript.words, figures.nodes],
  );
  const ambiguousMentions = useMemo(
    () =>
      current
        ? scanEntityMentions(current.body, figures.nodes, () => "").ambiguous.filter(
            (candidate) =>
              !(current.mentions || []).some(
                (mention) => candidate.from < mention.to && candidate.to > mention.from,
              ),
          )
        : [],
    [current, figures.nodes],
  );
  useEffect(() => {
    setSelection(null);
    setSelectionMenuOpen(false);
    setWritingSelection(null);
    setWritingQuery("");
    setLanguageResults([]);
    setGrammarIssues([]);
    setSelectedIssue(null);
    grammarRequest.current?.abort();
  }, [currentId]);
  useEffect(() => {
    void api
      .languageStatus()
      .then(setLanguageStatus)
      .catch(() => setLanguagePhase("error"));
    return () => lookupRequest.current?.abort();
  }, []);
  useEffect(
    () => () => lookupRequest.current?.abort(),
    [
      writingSelection?.chapterId,
      writingSelection?.from,
      writingSelection?.to,
      writingSelection?.revision,
    ],
  );

  const setChapters = (chapters: Chapter[]) => onChange({ ...manuscript, chapters });
  const update = (patch: Partial<Chapter>) =>
    current &&
    setChapters(
      manuscript.chapters.map((chapter) =>
        chapter.id === current.id ? { ...chapter, ...patch } : chapter,
      ),
    );
  const add = () => {
    const chapter = {
      id: uid("c"),
      title: t("newChapterTitle").replace("{n}", String(manuscript.chapters.length + 1)),
      body: "",
      note: "",
    };
    setChapters([...manuscript.chapters, chapter]);
    setCurrentId(chapter.id);
  };
  const move = (delta: number) => {
    if (!current) return;
    const from = manuscript.chapters.indexOf(current),
      to = from + delta;
    if (to < 0 || to >= manuscript.chapters.length) return;
    const chapters = [...manuscript.chapters];
    [chapters[from], chapters[to]] = [chapters[to], chapters[from]];
    setChapters(chapters);
  };
  const remove = () => {
    if (!current) return;
    const index = manuscript.chapters.indexOf(current);
    const chapters = manuscript.chapters.filter((chapter) => chapter.id !== current.id);
    setCurrentId(chapters[Math.min(index, chapters.length - 1)]?.id ?? "");
    setChapters(chapters);
  };
  const insert = (text: string) => {
    if (!current) return;
    editor.current?.insert(text);
  };
  const insertEntity = (entity: FigureNode) => editor.current?.insertEntity(entity);
  const resolveAmbiguous = (candidate: (typeof ambiguousMentions)[number], entity: FigureNode) => {
    if (!current) return;
    const mention = {
      id: crypto.randomUUID(),
      elementId: entity.id,
      from: candidate.from,
      to: candidate.to,
      surface: candidate.surface,
      source: "helper" as const,
      confidence: 1,
    };
    update({ mentions: [...(current.mentions || []), mention].sort((a, b) => a.from - b.from) });
  };
  // Saving an export can fail for real now that the desktop app writes the file itself
  // (see download() in lib/api.ts) -- a rejected promise here has to reach the reader.
  const runExport = (task: Promise<void>) => {
    void task.then(() => setExportError("")).catch((error) => setExportError(errorMessage(error)));
  };
  // Resolves only when the text is really on the clipboard. WKWebView may refuse the write,
  // and the caller has to know: Cut deletes the passage on the strength of this promise.
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setExportError("");
      return true;
    } catch {
      setExportError(t("clipboardRefused"));
      return false;
    }
  };
  // Markdown is the format on the way out, so the ranges become markers here -- and only
  // here. Chapter.body itself stays plain text for the grammar check, the mention scanner
  // and the assistant.
  const exportAll = () =>
    runExport(
      download(
        `Quiltor-Manuskript-${new Date().toISOString().slice(0, 10)}.md`,
        manuscript.chapters
          .map((c) => `# ${c.title || t("untitled")}\n\n${markdownBody(c.body, c.marks).trim()}\n`)
          .join("\n"),
      ),
    );
  const printBook = async () => {
    setPdfState("loading");
    try {
      await onSave?.();
      await api.bookPdf();
      setPdfState("idle");
    } catch {
      setPdfState("error");
    }
  };
  const addWord = () => {
    const value = newWord.trim();
    if (!value) return;
    const words = manuscript.words || [];
    if (
      !words.some(
        (item) =>
          (typeof item === "string" ? item : item.w).toLocaleLowerCase("de-DE") ===
          value.toLocaleLowerCase("de-DE"),
      )
    )
      onChange({ ...manuscript, words: [...words, { w: value, d: "" }] });
    setNewWord("");
  };
  const beginResize = (side: "sidebar" | "inspector", event: React.PointerEvent) => {
    if (!layout.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = layout.current.getBoundingClientRect();
    const move = (next: PointerEvent) =>
      side === "sidebar"
        ? onSidebarWidth?.(next.clientX - bounds.left)
        : onInspectorWidth?.(bounds.right - next.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const lookupMode = (tool: WritingTool) =>
    tool === "lookup" ? "dictionary" : tool === "synonyms" ? "synonyms" : "translation";
  const toolLabel = (tool: WritingTool) =>
    tool === "lookup" ? t("dictionary") : tool === "synonyms" ? t("synonyms") : t("translate");
  const modeLabel = (mode: HelperMode) =>
    mode === "lookup" ? t("helperLookup") : mode === "check" ? t("helperCheck") : t("helperInsert");
  const runLookup = (tool = selectionTool, query = writingQuery, language = writingLanguage) => {
    const value = query.trim();
    if (!value || !languageStatus?.installed) return;
    lookupRequest.current?.abort();
    const request = new AbortController();
    lookupRequest.current = request;
    setLanguagePhase("loading");
    setLanguageResults([]);
    void api
      .languageLookup(
        tool === "translate" ? language : "de-DE",
        lookupMode(tool),
        value,
        request.signal,
      )
      .then((result) => {
        if (lookupRequest.current === request) {
          setLanguageResults(result.results);
          setLanguagePhase("idle");
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLanguagePhase("error");
      });
  };
  // The selection only counts while it still describes the chapter on screen: switching
  // chapters or editing the text moves the offsets out from under it.
  const liveSelection =
    selection &&
    current &&
    selection.chapterId === current.id &&
    selection.revision === current.body
      ? selection
      : null;
  // The passage a result would replace: the one the aid is holding while focus sits in the
  // panel, or -- if the writer marked something else meanwhile -- the fresh marking.
  const heldSelection =
    writingSelection &&
    current &&
    writingSelection.chapterId === current.id &&
    writingSelection.revision === current.body
      ? writingSelection
      : null;
  const replaceTarget = heldSelection || liveSelection;
  const openWritingTool = (tool: WritingTool) => {
    if (!liveSelection) return;
    const selectedText = liveSelection;
    setSelectionMenuOpen(false);
    setWritingSelection(selectedText);
    setSelectionTool(tool);
    setWritingQuery(selectedText.text);
    setHelperMode("lookup");
    setInspectorOpen(true);
    requestAnimationFrame(() => runLookup(tool, selectedText.text, writingLanguage));
  };
  // Choosing a reference always looks up what is marked right now -- the marking is the
  // question, the three sources are only the answer's origin.
  const chooseTool = (tool: WritingTool) => {
    setSelectionTool(tool);
    if (liveSelection) setWritingSelection(liveSelection);
    const query = liveSelection?.text ?? writingQuery;
    setWritingQuery(query);
    runLookup(tool, query, writingLanguage);
  };
  const installLanguageData = () => {
    setLanguagePhase("installing");
    void api
      .installLanguageData()
      .then(() => api.languageStatus())
      .then((status) => {
        setLanguageStatus(status);
        setLanguagePhase("idle");
      })
      .catch(() => setLanguagePhase("error"));
  };
  // One gesture instead of three buttons per result: a value goes where the writer is
  // pointing -- over the marked passage if there is one, otherwise at the cursor.
  const applyValue = (text: string) => {
    if (!replaceTarget) return insert(text);
    if (
      editor.current?.replaceSelection(
        replaceTarget.from,
        replaceTarget.to,
        replaceTarget.text,
        text,
      )
    ) {
      setSelection(null);
      setWritingSelection(null);
    }
  };
  const resultValues = (result: LanguageLookupResult) =>
    result.values.length ? result.values : [result.lemma];
  const projectWords = () => [
    ...(manuscript.words || []).map((item) => (typeof item === "string" ? item : item.w)),
    ...figures.nodes.map((node) => node.name),
  ];
  const checkGrammar = () => {
    if (!current || !languageStatus?.grammar?.available) {
      setGrammarPhase("unavailable");
      return;
    }
    grammarRequest.current?.abort();
    const request = new AbortController();
    grammarRequest.current = request;
    const chapterId = current.id,
      revision = current.body;
    setGrammarPhase("checking");
    setSelectedIssue(null);
    void api
      .checkGrammar(revision, projectWords(), request.signal)
      .then((result) => {
        if (
          grammarRequest.current === request &&
          currentRef.current?.id === chapterId &&
          currentRef.current.body === revision
        ) {
          setGrammarIssues(result.issues);
          setGrammarPhase("idle");
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGrammarPhase("error");
      });
  };
  const installGrammar = () => {
    setGrammarPhase("installing");
    void api
      .installGrammar()
      .then(() => api.languageStatus())
      .then((status) => {
        setLanguageStatus(status);
        setGrammarPhase("idle");
      })
      .catch(() => setGrammarPhase("error"));
  };
  const applyIssue = (issue: WritingIssue, replacement: string) => {
    if (
      !current ||
      current.body.slice(issue.from, issue.to) === "" ||
      !editor.current?.replaceSelection(
        issue.from,
        issue.to,
        current.body.slice(issue.from, issue.to),
        replacement,
      )
    )
      return;
    setGrammarIssues([]);
    setSelectedIssue(null);
  };
  useEffect(() => {
    if (
      manuscript.grammarMode !== "automatic" ||
      !current?.body ||
      !languageStatus?.grammar?.available
    )
      return;
    const timeout = window.setTimeout(checkGrammar, 900);
    return () => {
      window.clearTimeout(timeout);
      grammarRequest.current?.abort();
    };
  }, [current?.id, current?.body, manuscript.grammarMode, languageStatus?.grammar?.available]);
  // Marking a passage is the question the lookup answers, so the search field simply shows
  // it. That replaces the separate "Markierung" card, which said the same thing twice.
  useEffect(() => {
    if (liveSelection?.text) setWritingQuery(liveSelection.text);
  }, [liveSelection?.text, liveSelection?.from]);

  const grammarSupported = languageStatus?.grammar?.supported !== false;
  const helperModes: HelperMode[] = grammarSupported
    ? ["lookup", "check", "insert"]
    : ["lookup", "insert"];
  const activeMode: HelperMode = helperModes.includes(helperMode) ? helperMode : "lookup";
  const lookupSources = [...new Set(languageResults.map((result) => result.source))];
  const projectDictionary = manuscript.words || [];

  const binderPanel = (
    <>
      <div className="panel-heading panel-heading--binder">
        <span>{t("chapters")}</span>
        {viewportMode === "compact" && (
          <button
            type="button"
            className="icon-button"
            onClick={() => setBinderOpen(false)}
            aria-label={t("closeNavigation")}
            title={t("closeNavigation")}
          >
            <X />
          </button>
        )}
      </div>
      {current && (
        <section className="binder-chapter-actions">
          <span>{t("chapterActions")}</span>
          <div
            role="group"
            aria-label={`${t("chapterActions")}: ${current.title || t("untitled")}`}
          >
            <button
              type="button"
              className="icon-button"
              disabled={currentIndex <= 1}
              onClick={() => move(-1)}
              aria-label={t("moveUp")}
              title={t("moveUp")}
            >
              <ChevronUp />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={currentIndex >= manuscript.chapters.length}
              onClick={() => move(1)}
              aria-label={t("moveDown")}
              title={t("moveDown")}
            >
              <ChevronDown />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                runExport(
                  download(
                    `${current.title || t("chapter")}.md`,
                    `# ${current.title}\n\n${markdownBody(current.body, current.marks)}\n`,
                  ),
                )
              }
              aria-label={t("chapterMarkdown")}
              title={t("chapterMarkdown")}
            >
              <Download />
            </button>
            <button
              type="button"
              className="icon-button chapter-action-delete"
              onClick={() => setDeleteOpen(true)}
              aria-label={t("deleteChapter")}
              title={t("deleteChapter")}
            >
              <Trash2 />
            </button>
          </div>
        </section>
      )}
      <div className="chapter-list">
        {manuscript.chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            draggable
            className={chapter.id === current?.id ? "active" : ""}
            onClick={() => {
              setCurrentId(chapter.id);
              if (viewportMode === "compact") setBinderOpen(false);
            }}
            onDragStart={() => setDraggedId(chapter.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!draggedId || draggedId === chapter.id) return;
              const next = [...manuscript.chapters],
                from = next.findIndex((item) => item.id === draggedId),
                to = next.findIndex((item) => item.id === chapter.id);
              const [item] = next.splice(from, 1);
              next.splice(to, 0, item);
              setChapters(next);
              setDraggedId(null);
            }}
          >
            <span className="chapter-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="chapter-name">{chapter.title || t("untitled")}</span>
            <span className="chapter-words">
              {wordCount(chapter.body)} {t("words")}
            </span>
          </button>
        ))}
      </div>
      {/* The note belongs to the chapter one picks, so it sits under the list that picks it --
        not in the aid on the other side of the editor, which is about words, not about plot. */}
      {current && (
        <label className="field binder-note">
          <span>{t("chapterNote")}</span>
          <textarea
            value={current.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder={t("chapterNotePlaceholder")}
          />
        </label>
      )}
      <footer>
        {manuscript.chapters.length} {t("chapters")} · {(total / 250).toFixed(1).replace(".", ",")}{" "}
        {t("standardPages")}
      </footer>
    </>
  );
  // The right column has one job: the writing aid. Chapter actions stay with the chapter list
  // on the left; the persistent text-side edge control opens and closes this panel on desktop.
  const inspectorPanel = current ? (
    <>
      <div className="panel-heading panel-heading--inspector">
        <span>{t("writingAid")}</span>
        {viewportMode === "compact" && (
          <button
            type="button"
            className="icon-button"
            onClick={() => setInspectorOpen(false)}
            aria-label={t("closeWritingAid")}
            title={t("closeWritingAid")}
          >
            <X />
          </button>
        )}
      </div>
      <div className="helper-panel">
        <div className="helper-modes" role="tablist" aria-label={t("writingAidSection")}>
          {helperModes.map((mode) => (
            <button
              key={mode}
              role="tab"
              aria-selected={activeMode === mode}
              onClick={() => setHelperMode(mode)}
            >
              {modeLabel(mode)}
            </button>
          ))}
        </div>
        {activeMode === "lookup" ? (
          <div className="panel-body writing-lookup">
            <form
              className="writing-search"
              onSubmit={(event) => {
                event.preventDefault();
                runLookup();
              }}
            >
              <input
                aria-label={t("searchTerm")}
                value={writingQuery}
                onChange={(event) => setWritingQuery(event.target.value)}
                placeholder={t("writingSearchPlaceholder")}
              />
              <button
                className="icon-button"
                aria-label={t("lookup")}
                disabled={!writingQuery.trim() || languagePhase === "loading"}
              >
                <Search />
              </button>
            </form>
            <div className="writing-tool-tabs" role="tablist" aria-label={t("lookupSources")}>
              {WRITING_TOOLS.map((tool) => (
                <button
                  key={tool}
                  role="tab"
                  aria-selected={selectionTool === tool}
                  onClick={() => chooseTool(tool)}
                >
                  {toolLabel(tool)}
                </button>
              ))}
            </div>
            {selectionTool === "translate" && (
              <SegmentedControl
                label={t("translationDirection")}
                value={writingLanguage}
                options={[
                  { value: "de-DE", label: t("germanToEnglish") },
                  { value: "en-GB", label: t("englishToGerman") },
                ]}
                onChange={(value) => {
                  setWritingLanguage(value);
                  runLookup(selectionTool, writingQuery, value);
                }}
              />
            )}
            {!languageStatus?.installed ? (
              <div className="writing-data-state">
                <p>{t("writingDataMissing")}</p>
                <button
                  className="ui-button"
                  onClick={installLanguageData}
                  disabled={languagePhase === "installing"}
                >
                  {languagePhase === "installing"
                    ? t("writingDataInstalling")
                    : t("writingDataInstall")}
                </button>
              </div>
            ) : languagePhase === "error" ? (
              <p className="error-box" role="alert">
                {t("writingRequestError")}
              </p>
            ) : languagePhase === "loading" ? (
              <p className="muted" role="status">
                {t("writingSearching")}
              </p>
            ) : languageResults.length ? (
              <div className="writing-results">
                <p className="writing-apply-hint" role="status">
                  {replaceTarget ? t("valueReplacesSelection") : t("valueInsertsAtCursor")}
                </p>
                {languageResults.map((result, index) => (
                  <article key={`${result.source}-${result.lemma}-${index}`}>
                    <header>
                      <strong>{result.lemma}</strong>
                      {result.partOfSpeech && <span>{result.partOfSpeech}</span>}
                      <button
                        className="icon-button"
                        aria-label={t("writingCopy").replace("{word}", result.lemma)}
                        onClick={() => void navigator.clipboard.writeText(resultValues(result)[0])}
                      >
                        <Copy />
                      </button>
                    </header>
                    {result.meaning && <p>{result.meaning}</p>}
                    <div className="writing-values">
                      {resultValues(result).map((value) => (
                        <button key={value} onClick={() => applyValue(value)}>
                          {value}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
                {/* Attribution is a licensing obligation, so it stays -- but once per source that
                actually produced a result, plainly visible, instead of a disclosure per card. */}
                <footer className="writing-attribution">
                  <span>{t("writingAttribution")}</span>
                  <ul>
                    {lookupSources.map((source) => (
                      <li key={source}>
                        {languageStatus.sources[source]?.attribution || source} ·{" "}
                        {languageStatus.sources[source]?.license}
                      </li>
                    ))}
                  </ul>
                </footer>
              </div>
            ) : writingQuery.trim() ? (
              <p className="muted">{t("writingNoResults")}</p>
            ) : (
              <div className="writing-empty">
                <p>{t("lookupEmptyHint")}</p>
                <p>{t("selectionMenuHint")}</p>
              </div>
            )}
          </div>
        ) : activeMode === "check" ? (
          <div className="panel-body grammar-tool">
            <div className="grammar-heading">
              <button
                className="ui-button primary"
                onClick={checkGrammar}
                disabled={grammarPhase === "checking"}
              >
                {grammarPhase === "checking" ? t("grammarChecking") : t("checkText")}
              </button>
              {languageStatus?.grammar?.available && grammarPhase !== "error" && (
                <span className="muted" role="status">
                  {grammarPhase === "checking"
                    ? ""
                    : grammarIssues.length
                      ? t("grammarIssueCount").replace("{count}", String(grammarIssues.length))
                      : t("grammarReady")}
                </span>
              )}
            </div>
            {!languageStatus?.grammar?.available && (
              <div className="writing-data-state">
                <p>
                  {languageStatus?.grammar?.installed
                    ? t("grammarJavaMissing").replace(
                        "{version}",
                        String(languageStatus.grammar.javaRequired),
                      )
                    : t("grammarUnavailable")}
                </p>
                {!languageStatus?.grammar?.installed && (
                  <button
                    className="ui-button"
                    onClick={installGrammar}
                    disabled={grammarPhase === "installing"}
                  >
                    {grammarPhase === "installing" ? t("grammarInstalling") : t("grammarInstall")}
                  </button>
                )}
                <small>{t("grammarBrowserFallback")}</small>
              </div>
            )}
            {grammarPhase === "error" && (
              <p className="error-box" role="alert">
                {t("grammarCheckError")}
              </p>
            )}
            {/* One row per finding, the details of the one in hand expanded. Clicking the wavy
            underline in the text opens the same row, so both directions lead to one place. */}
            {!!grammarIssues.length && (
              <ul className="grammar-issues">
                {grammarIssues.map((issue) => {
                  const open = selectedIssue?.id === issue.id;
                  return (
                    <li key={issue.id}>
                      <button
                        className="grammar-issue-row"
                        aria-expanded={open}
                        onClick={() => setSelectedIssue(open ? null : issue)}
                      >
                        <strong>{current.body.slice(issue.from, issue.to) || t("grammar")}</strong>
                        <span>{issue.category || t("grammar")}</span>
                      </button>
                      {open && (
                        <div className="grammar-issue-detail">
                          <p>{issue.message}</p>
                          {!!issue.replacements.length && (
                            <div className="writing-values">
                              {issue.replacements.map((value) => (
                                <button key={value} onClick={() => applyIssue(issue, value)}>
                                  {value}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <label className="field grammar-mode">
              <span>{t("grammarMode")}</span>
              <select
                value={manuscript.grammarMode || "manual"}
                onChange={(event) =>
                  onChange({
                    ...manuscript,
                    language: "de-DE",
                    grammarMode: event.target.value as Manuscript["grammarMode"],
                  })
                }
              >
                <option value="manual">{t("grammarManual")}</option>
                <option value="automatic">{t("grammarAutomatic")}</option>
              </select>
            </label>
            {languageStatus?.grammar?.installed && (
              <footer className="writing-attribution">
                <span>{t("writingAttribution")}</span>
                <ul>
                  <li>
                    LanguageTool {languageStatus.grammar.version} ·{" "}
                    {languageStatus.grammar.download.license}
                  </li>
                </ul>
              </footer>
            )}
          </div>
        ) : (
          <div className="panel-body writing-insert">
            <h3>{t("figuresPlaces")}</h3>
            <div className="chip-list">
              {figures.nodes.map((node) => (
                <button key={node.id} onClick={() => insertEntity(node)}>
                  {node.name}
                </button>
              ))}
            </div>
            {!!ambiguousMentions.length && (
              <section className="mention-review">
                <h3>{t("ambiguousMentions")}</h3>
                {ambiguousMentions.map((candidate) => (
                  <div key={`${candidate.from}-${candidate.to}`}>
                    <strong>{candidate.surface}</strong>
                    <div className="chip-list">
                      {candidate.elementIds.map((id) => {
                        const node = figures.nodes.find((item) => item.id === id);
                        return (
                          node && (
                            <button key={id} onClick={() => resolveAmbiguous(candidate, node)}>
                              {node.name} · {node.sub || node.label || t("worldObject")}
                            </button>
                          )
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}
            {orphanedMentions > 0 && (
              <p className="muted" role="status">
                {t("orphanedMentionsRemoved").replace("{count}", String(orphanedMentions))}
              </p>
            )}
            <div className="helper-section-heading">
              <h3>{t("ownTerms")}</h3>
              <button className="text-action" onClick={() => setTermsOpen(true)}>
                <SlidersHorizontal />
                {t("manageTerms")}
              </button>
            </div>
            {projectDictionary.length ? (
              <div className="chip-list">
                {projectDictionary.map((item, index) => {
                  const word = typeof item === "string" ? item : item.w;
                  return (
                    <button key={`${word}-${index}`} onClick={() => insert(word)}>
                      {word}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted">{t("ownTermsEmpty")}</p>
            )}
            <h3>{t("specialCharacters")}</h3>
            <div className="chip-list symbols">
              {(manuscript.zeichenAktiv || ["„", "“", "–", "—", "…"]).map((symbol) => (
                <button key={symbol} onClick={() => insert(symbol)}>
                  {symbol}
                </button>
              ))}
              <button
                aria-expanded={symbolPicker}
                aria-label={t("chooseSymbols")}
                onClick={() => setSymbolPicker(!symbolPicker)}
              >
                ±
              </button>
            </div>
            {symbolPicker && (
              <div className="symbol-picker">
                {[
                  "„",
                  "“",
                  "‚",
                  "‘",
                  "»",
                  "«",
                  "›",
                  "‹",
                  "–",
                  "—",
                  "…",
                  "·",
                  "§",
                  "¶",
                  "†",
                  "°",
                  "′",
                  "″",
                  "×",
                  "±",
                  "½",
                  "¼",
                ].map((symbol) => {
                  const active = (manuscript.zeichenAktiv || []).includes(symbol);
                  return (
                    <button
                      key={symbol}
                      aria-pressed={active}
                      onClick={() =>
                        onChange({
                          ...manuscript,
                          zeichenAktiv: active
                            ? (manuscript.zeichenAktiv || []).filter((item) => item !== symbol)
                            : [...(manuscript.zeichenAktiv || []), symbol],
                        })
                      }
                    >
                      {symbol}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <section className={`text-workspace ${focus ? "is-focus" : ""}`} aria-label={t("manuscript")}>
      <div className="context-bar">
        {/* The counts used to sit in the chapter tab of the inspector, where they were only
          visible if you had that tab open. They are status, so they belong on the status line
          that is on screen anyway -- under the chapter name, beside the manuscript total. */}
        <div className="context-title">
          <strong>{current?.title || t("manuscript")}</strong>
          <dl className="stats chapter-stats">
            {current && (
              <>
                <div>
                  <dt>{t("words")}</dt>
                  <dd>{wordCount(current.body).toLocaleString(uiLanguage)}</dd>
                </div>
                <div>
                  <dt>{t("characters")}</dt>
                  <dd>{current.body.length.toLocaleString(uiLanguage)}</dd>
                </div>
                <div>
                  <dt>{t("standardPages")}</dt>
                  <dd>{(wordCount(current.body) / 250).toFixed(1).replace(".", ",")}</dd>
                </div>
              </>
            )}
            <div>
              <dt>{t("totalWords")}</dt>
              <dd>{total.toLocaleString(uiLanguage)}</dd>
            </div>
          </dl>
        </div>
        {/* "Neues Kapitel", not "Kapitel": beside the column toggle of the same name, one word
          for both would have read as two ways to the same place. */}
        <div className="tool-group">
          <button className="primary" onClick={add}>
            <FilePlus2 />
            {t("newChapter")}
          </button>
        </div>
        {/* The toolbar toggles remain the explicit, always-visible controls outside focus mode.
          Desktop additionally keeps the quiet edge controls, so a collapsed panel can still be
          reopened from beside the text without hunting through the toolbar. */}
        {!focus && (
          <div className="tool-group panel-toggles">
            <button
              aria-pressed={binderOpen}
              aria-expanded={binderOpen}
              aria-controls="chapter-binder"
              onClick={() => setBinderOpen(!binderOpen)}
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
                if (current) setInspectorOpen(!inspectorOpen);
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
              onClick={() => setHistoryOpen((open) => !open)}
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
                exportAll();
                setExportOpen(false);
              }}
            >
              <Download />
              {t("manuscript")}
            </MenuItem>
            <MenuItem
              disabled={pdfState === "loading"}
              onSelect={() => {
                void printBook();
                setExportOpen(false);
              }}
            >
              <Printer />
              {pdfState === "loading" ? t("creatingPdf") : t("bookPdf")}
            </MenuItem>
          </Menu>
        </Popover>
      </div>
      <div
        ref={layout}
        className={`text-layout ${!binderOpen || focus ? "no-binder" : ""} ${!inspectorOpen || focus || !current ? "no-inspector" : ""} ${editorBalance !== null ? "has-balanced-editor" : ""}`}
        style={
          {
            "--workspace-sidebar-width": `${sidebarWidth}px`,
            "--workspace-inspector-width": `${inspectorWidth}px`,
            "--editor-balance-offset": `${Math.round(editorBalance ?? 0)}px`,
          } as React.CSSProperties
        }
      >
        {!focus && viewportMode !== "compact" && (
          <button
            type="button"
            className={`focus-side-toggle panel-edge-toggle panel-edge-toggle--left ${binderOpen ? "is-open" : ""}`}
            aria-expanded={binderOpen}
            aria-controls="chapter-binder"
            aria-label={binderOpen ? t("closeNavigation") : t("openNavigation")}
            title={binderOpen ? t("closeNavigation") : t("openNavigation")}
            onClick={() => setBinderOpen(!binderOpen)}
          >
            {binderOpen ? <X /> : <PanelLeft />}
          </button>
        )}
        {!focus && viewportMode !== "compact" && binderOpen && (
          <aside
            id="chapter-binder"
            className="binder drawer-open"
            aria-label={t("chapters")}
            style={{ width: sidebarWidth }}
          >
            {binderPanel}
            {onSidebarWidth && (
              <div
                className="panel-resize-handle panel-resize-handle--end"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeNavigation")}
                aria-valuemin={220}
                aria-valuemax={340}
                aria-valuenow={sidebarWidth}
                tabIndex={0}
                onPointerDown={(event) => beginResize("sidebar", event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                    onSidebarWidth(sidebarWidth + (event.key === "ArrowRight" ? 10 : -10));
                }}
              />
            )}
          </aside>
        )}
        <article className="editor-scroll">
          {current ? (
            <div className={`editor-page ${historyOpen ? "has-chapter-history" : ""}`}>
              <div className="editor-document">
                <input
                  className="chapter-title"
                  aria-label={t("chapterTitle")}
                  value={current.title}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder={t("chapterTitle")}
                />
                {searchQuery && (
                  <div
                    className="text-search-navigation"
                    role="search"
                    aria-label={t("textSearchResults")}
                  >
                    <Search aria-hidden="true" />
                    <strong title={searchQuery}>{searchQuery}</strong>
                    <span role="status" aria-live="polite">
                      {t("searchResultPosition", {
                        current: activeSearchMatch ? activeSearchIndex + 1 : 0,
                        total: searchMatches.length,
                      })}
                    </span>
                    <button
                      className="icon-button"
                      disabled={!searchMatches.length}
                      onClick={() => navigateSearch(-1)}
                      aria-label={t("previousSearchResult")}
                      title={t("previousSearchResult")}
                    >
                      <ChevronLeft />
                    </button>
                    <button
                      className="icon-button"
                      disabled={!searchMatches.length}
                      onClick={() => navigateSearch(1)}
                      aria-label={t("nextSearchResult")}
                      title={t("nextSearchResult")}
                    >
                      <ChevronRight />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => {
                        setSearchQuery("");
                        setActiveSearchIndex(0);
                        editor.current?.focus();
                      }}
                      aria-label={t("closeTextSearch")}
                      title={t("closeTextSearch")}
                    >
                      <X />
                    </button>
                  </div>
                )}
                <ManuscriptEditor
                  key={current.id}
                  value={current.body}
                  mentions={current.mentions}
                  marks={current.marks}
                  issues={grammarIssues}
                  searchMatches={currentSearchMatches}
                  activeSearchMatch={
                    activeSearchMatch?.chapterId === current.id ? activeSearchMatch : null
                  }
                  entities={figures.nodes}
                  label={t("chapterText")}
                  placeholder={t("startWritingPlaceholder")}
                  vocabulary={vocabulary}
                  editorRef={editor}
                  onChange={(body, mentions, marks) => {
                    if (body !== current.body) {
                      setWritingSelection(null);
                      setGrammarIssues([]);
                      setSelectedIssue(null);
                      grammarRequest.current?.abort();
                    }
                    update({
                      body,
                      mentions: addDeterministicMentions(body, mentions, figures.nodes),
                      marks,
                    });
                  }}
                  held={
                    writingSelection &&
                    writingSelection.chapterId === current.id &&
                    writingSelection.revision === current.body
                      ? { from: writingSelection.from, to: writingSelection.to }
                      : liveSelection
                        ? { from: liveSelection.from, to: liveSelection.to }
                        : null
                  }
                  onSelection={(next) => {
                    setSelection(
                      next ? { ...next, chapterId: current.id, revision: current.body } : null,
                    );
                    if (!next) setSelectionMenuOpen(false);
                  }}
                  onSelectionMenu={(next) => {
                    setSelection({ ...next, chapterId: current.id, revision: current.body });
                    setSelectionMenuOpen(true);
                  }}
                  onIssue={(issue) => {
                    setSelectedIssue(issue);
                    setHelperMode("check");
                    setInspectorOpen(true);
                  }}
                  onOpenEntity={(node) =>
                    onOpenEntity?.({
                      workspace: node.type === "ort" ? "places" : "figures",
                      id: node.id,
                    })
                  }
                  describeEntity={(node) =>
                    `${kindLabel(node.type, t)}${node.sub ? ` · ${node.sub}` : ""}`
                  }
                />
              </div>
              {historyOpen && (
                <aside className="chapter-history" aria-label={t("versions")}>
                  <header>
                    <div>
                      <strong>{t("previousVersion")}</strong>
                      <span>{t("nextToCurrent")}</span>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => setHistoryOpen(false)}
                      aria-label={t("closeVersions")}
                    >
                      <X />
                    </button>
                  </header>
                  {commits.length ? (
                    <label className="field">
                      <span>{t("state")}</span>
                      <select
                        value={historyRef}
                        onChange={(event) => setHistoryRef(event.target.value)}
                      >
                        {commits.map((commit) => (
                          <option key={commit.hash} value={commit.hash}>
                            {commit.datum} · {commit.betreff}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    historyState !== "loading" && <p className="muted">{t("noVersion")}</p>
                  )}
                  {historyState === "loading" ? (
                    <p className="muted">{t("loadingVersion")}</p>
                  ) : historyState === "error" ? (
                    <div className="error-box">{t("versionLoadError")}</div>
                  ) : (
                    commits.length > 0 && (
                      <div className="historical-prose">
                        {historicalText || <em>{t("chapterNotYetExisting")}</em>}
                      </div>
                    )
                  )}
                </aside>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <FileTextIcon />
              <h2>{t("noChapterYet")}</h2>
              <button className="primary" onClick={add}>
                {t("createFirstChapter")}
              </button>
            </div>
          )}
        </article>
        {!focus && viewportMode !== "compact" && current && (
          <button
            type="button"
            className={`focus-helper-toggle panel-edge-toggle panel-edge-toggle--right ${inspectorOpen ? "is-open" : ""}`}
            aria-expanded={inspectorOpen}
            aria-controls="writing-aid-inspector"
            aria-label={inspectorOpen ? t("closeWritingAid") : t("openWritingAid")}
            title={inspectorOpen ? t("closeWritingAid") : t("openWritingAid")}
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            {inspectorOpen ? <X /> : <Pilcrow />}
          </button>
        )}
        {!focus && viewportMode !== "compact" && inspectorOpen && inspectorPanel && (
          <aside
            id="writing-aid-inspector"
            className="inspector drawer-open"
            aria-label={t("writingAid")}
            style={{ width: inspectorWidth }}
          >
            {onInspectorWidth && (
              <div
                className="panel-resize-handle panel-resize-handle--start"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeWritingAid")}
                aria-valuemin={240}
                aria-valuemax={380}
                aria-valuenow={inspectorWidth}
                tabIndex={0}
                onPointerDown={(event) => beginResize("inspector", event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                    onInspectorWidth(inspectorWidth + (event.key === "ArrowLeft" ? 10 : -10));
                }}
              />
            )}
            {inspectorPanel}
          </aside>
        )}
      </div>
      <button
        ref={selectionAnchor}
        className="selection-anchor"
        tabIndex={-1}
        aria-hidden="true"
        style={
          selection
            ? {
                left: selection.rect.left,
                top: selection.rect.top,
                width: selection.rect.width,
                height: selection.rect.height,
              }
            : undefined
        }
        onFocus={() => editor.current?.focus()}
      />
      {/* Since the editor suppresses WebKit's own context menu, ours has to carry the ordinary
        commands as well. Paste is deliberately absent: WebKit refuses clipboard reads to web
        content, and ⌘V goes through the browser regardless. */}
      <SelectionMenu
        anchorRef={selectionAnchor}
        open={selectionMenuOpen && !!liveSelection}
        label={t("writingSelectionActions")}
        onClose={() => setSelectionMenuOpen(false)}
        actions={[
          // Cut removes the passage only once the clipboard has actually taken it. WKWebView can
          // refuse writeText, and a cut that deletes a paragraph the writer can no longer paste
          // back is lost work -- so a rejection leaves the text where it is and says so.
          {
            id: "cut",
            label: t("cut"),
            shortcut: keys("X"),
            run: () => {
              if (liveSelection) {
                const { from, to, text } = liveSelection;
                void copyToClipboard(text).then((ok) => {
                  if (ok) editor.current?.cut(from, to);
                });
              }
            },
          },
          {
            id: "copy",
            label: t("copy"),
            shortcut: keys("C"),
            run: () => {
              if (liveSelection) void copyToClipboard(liveSelection.text);
            },
          },
          {
            id: "bold",
            label: t("formatBold"),
            shortcut: keys("B"),
            separatorBefore: true,
            run: () => {
              if (liveSelection) editor.current?.toggleMark("bold", liveSelection);
            },
          },
          {
            id: "italic",
            label: t("formatItalic"),
            shortcut: keys("I"),
            run: () => {
              if (liveSelection) editor.current?.toggleMark("italic", liveSelection);
            },
          },
          {
            id: "lookup",
            label: t("lookup"),
            separatorBefore: true,
            run: () => openWritingTool("lookup"),
          },
          { id: "synonyms", label: t("synonyms"), run: () => openWritingTool("synonyms") },
          { id: "translate", label: t("translate"), run: () => openWritingTool("translate") },
          { id: "more", label: t("writingMore"), run: () => openWritingTool(selectionTool) },
        ]}
      />
      {!focus && viewportMode === "compact" && (
        <Sheet open={binderOpen} label={t("chapters")} onClose={() => setBinderOpen(false)}>
          <div id="chapter-binder" className="binder compact-panel">
            {binderPanel}
          </div>
        </Sheet>
      )}
      {!focus && viewportMode === "compact" && inspectorPanel && (
        <Sheet open={inspectorOpen} label={t("writingAid")} onClose={() => setInspectorOpen(false)}>
          <div id="writing-aid-inspector" className="inspector compact-panel">
            {inspectorPanel}
          </div>
        </Sheet>
      )}
      {focus && manuscript.chapters.length > 1 && (
        <aside
          className={`focus-chapters ${focusChapters ? "is-open" : ""}`}
          aria-label={t("focusChapterPickerLabel")}
        >
          <button
            className="focus-side-toggle"
            aria-expanded={focusChapters}
            onClick={() => setFocusChapters(!focusChapters)}
            title={t("selectChapters")}
          >
            {focusChapters ? <X /> : <PanelLeft />}
            <span className="sr-only">
              {focusChapters ? t("closeChapterPicker") : t("openChapterPicker")}
            </span>
          </button>
          {focusChapters && (
            <nav className="focus-chapter-list">
              {manuscript.chapters.map((chapter, index) => (
                <button
                  key={chapter.id}
                  className={chapter.id === current?.id ? "active" : ""}
                  aria-current={chapter.id === current?.id ? "page" : undefined}
                  onClick={() => {
                    setCurrentId(chapter.id);
                    requestAnimationFrame(() => editor.current?.focus());
                  }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.title || t("untitled")}</strong>
                  <small>
                    {wordCount(chapter.body)} {t("words")}
                  </small>
                </button>
              ))}
            </nav>
          )}
        </aside>
      )}
      {focus && (
        <aside
          className={`focus-helper ${focusHelpers ? "is-open" : ""}`}
          aria-label={t("writingAidPanelLabel")}
        >
          <button
            className="focus-helper-toggle"
            aria-expanded={focusHelpers}
            onClick={() => setFocusHelpers(!focusHelpers)}
            title={t("writingAid")}
          >
            {focusHelpers ? <X /> : <Pilcrow />}
            <span className="sr-only">
              {focusHelpers ? t("closeWritingAid") : t("openWritingAid")}
            </span>
          </button>
          {focusHelpers && (
            <div className="focus-helper-panel">
              <section>
                <h3>{t("figuresPlaces")}</h3>
                <div className="focus-helper-chips">
                  {figures.nodes.map((node) => (
                    <button key={node.id} onClick={() => insertEntity(node)}>
                      {node.name}
                    </button>
                  ))}
                </div>
              </section>
              {!!(manuscript.words || []).length && (
                <section>
                  <h3>{t("ownTerms")}</h3>
                  <div className="focus-helper-chips">
                    {(manuscript.words || []).map((item, index) => {
                      const word = typeof item === "string" ? item : item.w;
                      return (
                        <button key={`${word}-${index}`} onClick={() => insert(word)}>
                          {word}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              <section>
                <h3>{t("specialCharacters")}</h3>
                <div className="focus-helper-chips focus-helper-symbols">
                  {(manuscript.zeichenAktiv || ["„", "“", "–", "—", "…"]).map((symbol) => (
                    <button key={symbol} onClick={() => insert(symbol)}>
                      {symbol}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </aside>
      )}
      {focus && (
        <button className="exit-focus" onClick={() => onFocus(false)}>
          {t("leaveFocus")} <kbd>Esc</kbd>
        </button>
      )}
      <article className="print-document" aria-hidden="true" lang="de">
        <section className="book-title-page">
          <div>
            <span>{t("novelLabel")}</span>
            <h1>{worldTitle || t("untitledWorld")}</h1>
            <i aria-hidden="true">◆</i>
          </div>
          <footer>
            {t("manuscriptVersionLabel")} · {new Date().toLocaleDateString(uiLanguage)}
          </footer>
        </section>
        {manuscript.chapters.map((chapter, chapterIndex) => (
          <section className="book-chapter" key={chapter.id}>
            <header>
              <span>{String(chapterIndex + 1).padStart(2, "0")}</span>
              <h2>{chapter.title || t("untitled")}</h2>
            </header>
            {bodyParagraphs(chapter.body).map((paragraph, index) =>
              /^\s*([*⁂◆]|\*\s*\*\s*\*)\s*$/.test(paragraph.text) ? (
                <div className="scene-break" key={index}>
                  ⁂
                </div>
              ) : (
                <p key={index}>{printedRuns(paragraph, chapter.marks)}</p>
              ),
            )}
          </section>
        ))}
      </article>
      {/* Editing the project dictionary is configuration, not something consulted mid-sentence.
        It keeps its own surface; the writing aid only offers the finished terms. */}
      <Sheet open={termsOpen} label={t("ownTerms")} onClose={() => setTermsOpen(false)}>
        <div className="terms-sheet">
          <header>
            <h2>{t("ownTerms")}</h2>
            <button
              className="icon-button"
              onClick={() => setTermsOpen(false)}
              aria-label={t("close")}
            >
              <X />
            </button>
          </header>
          <p className="muted">{t("ownTermsIntro")}</p>
          <div className="add-term">
            <input
              data-autofocus
              aria-label={t("newTerm")}
              value={newWord}
              onChange={(event) => setNewWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addWord();
              }}
              placeholder={t("addTerm")}
            />
            <button onClick={addWord} aria-label={t("addTerm")}>
              +
            </button>
          </div>
          {projectDictionary.length ? (
            <div className="chip-list editable-chips">
              {projectDictionary.map((item, index) => {
                const word = typeof item === "string" ? item : item.w;
                return (
                  <span key={`${word}-${index}`}>
                    <button onClick={() => insert(word)}>{word}</button>
                    <button
                      aria-label={t("removeTerm").replace("{word}", word)}
                      onClick={() =>
                        onChange({
                          ...manuscript,
                          words: projectDictionary.filter((_, i) => i !== index),
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="muted">{t("ownTermsEmpty")}</p>
          )}
        </div>
      </Sheet>
      {deleteOpen && current && (
        <ConfirmDialog
          title={t("deleteChapter")}
          description={t("deleteChapterDescription").replace(
            "{title}",
            current.title || t("untitled"),
          )}
          confirmLabel={t("deleteChapter")}
          undoable
          onConfirm={remove}
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

function FileTextIcon() {
  return (
    <span className="empty-glyph" aria-hidden="true">
      Aa
    </span>
  );
}

// The book page prints the formatting as formatting. Marks index the whole body while a
// paragraph is a slice of it, so each paragraph passes its own start offset; replacing the
// single newlines with spaces stays inside a run because it swaps one character for one.
function printedRuns(paragraph: { text: string; from: number }, marks: Chapter["marks"]) {
  return markedSegments(paragraph.text, paragraph.from, marks).map((segment, index) => {
    const text = segment.text.replace(/\n/g, " ");
    if (segment.bold && segment.italic)
      return (
        <em key={index}>
          <strong>{text}</strong>
        </em>
      );
    if (segment.bold) return <strong key={index}>{text}</strong>;
    if (segment.italic) return <em key={index}>{text}</em>;
    // Plain runs stay bare text: an extra <span> around the opening words would sit
    // between the paragraph and its ::first-letter drop cap.
    return <Fragment key={index}>{text}</Fragment>;
  });
}
