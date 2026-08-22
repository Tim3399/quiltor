import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import {
  quiltorClient,
  type WritingAssistanceLookupResult,
  type WritingAssistanceStatus,
} from "../../platform";
import type { FigureNode, FigureState } from "../story-world";
import { writingVocabulary } from "./autocomplete";
import type { ManuscriptEditorHandle } from "./ManuscriptEditor";
import { addDeterministicMentions, scanEntityMentions } from "./mentions";
import type { Chapter, EntityMention, Manuscript, TextMark, WritingIssue } from "./model";
import type { HelperMode, WorkspaceSelection, WritingTool } from "./workspaceTypes";

interface WritingAssistanceOptions {
  selectionKey: string;
  current?: Chapter;
  manuscript: Manuscript;
  figures: FigureState;
  onChange: (manuscript: Manuscript) => void;
  onUpdateCurrent: (patch: Partial<Chapter>) => void;
  onInspectorOpen: (open: boolean) => void;
  onError: (message: string) => void;
}

export function useWritingAssistance({
  selectionKey,
  current,
  manuscript,
  figures,
  onChange,
  onUpdateCurrent,
  onInspectorOpen,
  onError,
}: WritingAssistanceOptions) {
  const { t } = useI18n();
  const editor = useRef<ManuscriptEditorHandle | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const grammarRequest = useRef<AbortController | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const [symbolPicker, setSymbolPicker] = useState(false);
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [writingSelection, setWritingSelection] = useState<WorkspaceSelection | null>(null);
  const [helperMode, setHelperMode] = useState<HelperMode>("lookup");
  const [selectionTool, setSelectionTool] = useState<WritingTool>("lookup");
  const [termsOpen, setTermsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [locale, setLocale] = useState<"de-DE" | "en-GB">("de-DE");
  const [status, setStatus] = useState<WritingAssistanceStatus | null>(null);
  const [results, setResults] = useState<WritingAssistanceLookupResult[]>([]);
  const [phase, setPhase] = useState<"idle" | "loading" | "installing" | "error">("idle");
  const [grammarIssues, setGrammarIssues] = useState<WritingIssue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<WritingIssue | null>(null);
  const [grammarPhase, setGrammarPhase] = useState<
    "idle" | "checking" | "installing" | "unavailable" | "error"
  >("idle");
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
    setQuery("");
    setResults([]);
    setGrammarIssues([]);
    setSelectedIssue(null);
    grammarRequest.current?.abort();
  }, [selectionKey]);

  useEffect(() => {
    void quiltorClient.application.writingAssistance
      .status()
      .then(setStatus)
      .catch(() => setPhase("error"));
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

  const insert = (text: string) => {
    if (current) editor.current?.insert(text);
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
    onUpdateCurrent({
      mentions: [...(current.mentions || []), mention].sort((a, b) => a.from - b.from),
    });
  };
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await quiltorClient.platform.clipboard.writeText(text);
      onError("");
      return true;
    } catch {
      onError(t("clipboardRefused"));
      return false;
    }
  };
  const lookupMode = (tool: WritingTool) =>
    tool === "lookup" ? "dictionary" : tool === "synonyms" ? "synonyms" : "translation";
  const runLookup = (tool = selectionTool, value = query, writingLocale = locale) => {
    const normalized = value.trim();
    if (!normalized || !status?.installed) return;
    lookupRequest.current?.abort();
    const request = new AbortController();
    lookupRequest.current = request;
    setPhase("loading");
    setResults([]);
    void quiltorClient.application.writingAssistance
      .lookup(
        tool === "translate" ? writingLocale : "de-DE",
        lookupMode(tool),
        normalized,
        request.signal,
      )
      .then((result) => {
        if (lookupRequest.current === request) {
          setResults(result.results);
          setPhase("idle");
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("error");
      });
  };
  const liveSelection =
    selection &&
    current &&
    selection.chapterId === current.id &&
    selection.revision === current.body
      ? selection
      : null;
  const heldSelection =
    writingSelection &&
    current &&
    writingSelection.chapterId === current.id &&
    writingSelection.revision === current.body
      ? writingSelection
      : null;
  const replaceTarget = heldSelection || liveSelection;
  const openTool = (tool: WritingTool) => {
    if (!liveSelection) return;
    const selectedText = liveSelection;
    setSelectionMenuOpen(false);
    setWritingSelection(selectedText);
    setSelectionTool(tool);
    setQuery(selectedText.text);
    setHelperMode("lookup");
    onInspectorOpen(true);
    requestAnimationFrame(() => runLookup(tool, selectedText.text, locale));
  };
  const chooseTool = (tool: WritingTool) => {
    setSelectionTool(tool);
    if (liveSelection) setWritingSelection(liveSelection);
    const value = liveSelection?.text ?? query;
    setQuery(value);
    runLookup(tool, value, locale);
  };
  const changeLocale = (value: "de-DE" | "en-GB") => {
    setLocale(value);
    runLookup(selectionTool, query, value);
  };
  const installData = () => {
    setPhase("installing");
    void quiltorClient.application.writingAssistance
      .installData()
      .then(() => quiltorClient.application.writingAssistance.status())
      .then((nextStatus) => {
        setStatus(nextStatus);
        setPhase("idle");
      })
      .catch(() => setPhase("error"));
  };
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
  const projectWords = () => [
    ...(manuscript.words || []).map((item) => (typeof item === "string" ? item : item.w)),
    ...figures.nodes.map((node) => node.name),
  ];
  const checkGrammar = () => {
    if (!current || !status?.grammar?.available) {
      setGrammarPhase("unavailable");
      return;
    }
    grammarRequest.current?.abort();
    const request = new AbortController();
    grammarRequest.current = request;
    const chapterId = current.id;
    const revision = current.body;
    setGrammarPhase("checking");
    setSelectedIssue(null);
    void quiltorClient.application.writingAssistance
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
    void quiltorClient.application.writingAssistance
      .installGrammar()
      .then(() => quiltorClient.application.writingAssistance.status())
      .then((nextStatus) => {
        setStatus(nextStatus);
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
    if (manuscript.grammarMode !== "automatic" || !current?.body || !status?.grammar?.available)
      return;
    const timeout = window.setTimeout(checkGrammar, 900);
    return () => {
      window.clearTimeout(timeout);
      grammarRequest.current?.abort();
    };
  }, [current?.id, current?.body, manuscript.grammarMode, status?.grammar?.available]);

  useEffect(() => {
    if (liveSelection?.text) setQuery(liveSelection.text);
  }, [liveSelection?.text, liveSelection?.from]);

  const grammarSupported = status?.grammar?.supported !== false;
  const helperModes: HelperMode[] = grammarSupported
    ? ["lookup", "check", "insert"]
    : ["lookup", "insert"];
  const activeMode: HelperMode = helperModes.includes(helperMode) ? helperMode : "lookup";

  const onEditorChange = (body: string, mentions: EntityMention[], marks: TextMark[]) => {
    if (current && body !== current.body) {
      setWritingSelection(null);
      setGrammarIssues([]);
      setSelectedIssue(null);
      grammarRequest.current?.abort();
    }
    onUpdateCurrent({
      body,
      mentions: addDeterministicMentions(body, mentions, figures.nodes),
      marks,
    });
  };

  return {
    editor,
    selection,
    selectionMenuOpen,
    setSelectionMenuOpen,
    writingSelection,
    liveSelection,
    heldSelection,
    selectionTool,
    helperModes,
    activeMode,
    setHelperMode,
    termsOpen,
    setTermsOpen,
    symbolPicker,
    setSymbolPicker,
    query,
    setQuery,
    locale,
    status,
    results,
    phase,
    lookupSources: [...new Set(results.map((result) => result.source))],
    grammarIssues,
    selectedIssue,
    setSelectedIssue,
    grammarPhase,
    vocabulary,
    ambiguousMentions,
    insert,
    insertEntity,
    resolveAmbiguous,
    copyToClipboard,
    runLookup,
    chooseTool,
    changeLocale,
    installData,
    applyValue,
    checkGrammar,
    installGrammar,
    applyIssue,
    openTool,
    onEditorChange,
    onSelection: (next: WorkspaceSelection | null) => {
      setSelection(next);
      if (!next) setSelectionMenuOpen(false);
    },
    onSelectionMenu: (next: WorkspaceSelection) => {
      setSelection(next);
      setSelectionMenuOpen(true);
    },
    onIssue: (issue: WritingIssue) => {
      setSelectedIssue(issue);
      setHelperMode("check");
      onInspectorOpen(true);
    },
  };
}
