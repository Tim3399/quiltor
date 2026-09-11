import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VersionDiffProjection } from "../history";
import type { FigureNode } from "../story-world";
import { EntityMentionCard, type EntityMentionDescription } from "./EntityMentionCard";
import {
  createdMention,
  type EditorCompletion,
  suggestEditorCompletion,
} from "./editorCompletions";
import {
  editorDecorationExtensions,
  setHeldSelection,
  setIssueDecorations,
  setMarkDecorations,
  setMentionDecorations,
  setSearchDecorations,
  setVersionDiffDecorations,
} from "./editorDecorations";
import { mapMarks, toggleMark } from "./marks";
import { mapMentions } from "./mentions";
import type { EntityMention, TextMark, TextMarkKind, WritingIssue } from "./model";

const controlledUpdate = Annotation.define<boolean>();

export type EditorTextSelection = {
  from: number;
  to: number;
  text: string;
  rect: { left: number; top: number; width: number; height: number };
};

export type EditorViewSelection = {
  anchor: number;
  head: number;
};

export type ManuscriptEditorHandle = {
  focus: () => void;
  getPosition: () => ManuscriptEditorPosition;
  restorePosition: (position: ManuscriptEditorPosition) => void;
  /** Run after CodeMirror has completed its pending geometry measurement and scroll anchoring. */
  afterMeasure?: (callback: (hasFocus: boolean) => void) => () => void;
  insert: (text: string) => void;
  insertEntity: (entity: FigureNode) => void;
  replaceSelection: (from: number, to: number, expected: string, text: string) => boolean;
  /** Bold or italic over a range -- the marked one by default. */
  toggleMark: (kind: TextMarkKind, range?: { from: number; to: number }) => boolean;
  cut: (from: number, to: number) => void;
  reveal: (from: number, to: number) => void;
};

export type ManuscriptEditorPosition = {
  anchor: number;
  head: number;
  focused: boolean;
};

export function ManuscriptEditor({
  value,
  label,
  placeholder,
  vocabulary,
  mentions = [],
  marks = [],
  issues = [],
  entities = [],
  held = null,
  searchMatches = [],
  activeSearchMatch = null,
  readOnly = false,
  versionDiff = null,
  versionDiffLabels,
  editorRef,
  initialSelection,
  onChange,
  onSelection,
  onViewSelectionChange,
  onSelectionMenu,
  onIssue,
  onOpenEntity,
  describeEntity = (entity) => entity.sub || entity.label || "",
  describeMention,
}: {
  value: string;
  label: string;
  placeholder: string;
  vocabulary: string[];
  mentions?: EntityMention[];
  marks?: TextMark[];
  issues?: WritingIssue[];
  entities?: FigureNode[];
  /** The passage the writing aid is holding, kept visible while focus is elsewhere. */
  held?: { from: number; to: number } | null;
  searchMatches?: Array<{ from: number; to: number }>;
  activeSearchMatch?: { from: number; to: number } | null;
  readOnly?: boolean;
  versionDiff?: VersionDiffProjection | null;
  versionDiffLabels?: {
    added: string;
    addedLineBreak: string;
    removed: string;
    formattingAdded: Record<"bold" | "italic", string>;
    formattingRemoved: Record<"bold" | "italic", string>;
  };
  editorRef: React.MutableRefObject<ManuscriptEditorHandle | null>;
  initialSelection?: EditorViewSelection;
  onChange: (value: string, mentions: EntityMention[], marks: TextMark[]) => void;
  /** Every change of the marked range. Reports what is selected -- nothing more. */
  onSelection: (selection: EditorTextSelection | null) => void;
  onViewSelectionChange?: (selection: EditorViewSelection) => void;
  /** Only when the writer asks for the actions: right-click, or Shift+F10. */
  onSelectionMenu?: (selection: EditorTextSelection) => void;
  onIssue?: (issue: WritingIssue) => void;
  onOpenEntity?: (entity: FigureNode) => void;
  describeEntity?: (entity: FigureNode) => string;
  /** What the hover card says about a mention, composed where the words live. */
  describeMention?: (entity: FigureNode) => EntityMentionDescription;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange),
    selectionRef = useRef(onSelection),
    viewSelectionRef = useRef(onViewSelectionChange),
    selectionMenuRef = useRef(onSelectionMenu),
    issueRef = useRef(onIssue),
    openEntityRef = useRef(onOpenEntity),
    describeEntityRef = useRef(describeEntity),
    vocabularyRef = useRef(vocabulary),
    mentionsRef = useRef(mentions || []),
    marksRef = useRef(marks || []),
    issuesRef = useRef(issues),
    entitiesRef = useRef(entities || []);
  const readOnlyRef = useRef(readOnly);
  const editableCompartment = useRef(new Compartment()).current;
  const savedLiveState = useRef<{
    anchor: number;
    head: number;
    scrollTop: number;
    scrollLeft: number;
  } | null>(null);
  const wasReadOnly = useRef(readOnly);
  const [completion, setCompletion] = useState<EditorCompletion | null>(null);
  changeRef.current = onChange;
  selectionRef.current = onSelection;
  viewSelectionRef.current = onViewSelectionChange;
  selectionMenuRef.current = onSelectionMenu;
  issueRef.current = onIssue;
  openEntityRef.current = onOpenEntity;
  describeEntityRef.current = describeEntity;
  const describeMentionRef = useRef(describeMention);
  describeMentionRef.current = describeMention;
  // The card is React's, rendered through the node CodeMirror hands over, so
  // the design system owns it the same way it owns every other surface.
  const [mentionCard, setMentionCard] = useState<{
    host: HTMLElement;
    entity: FigureNode;
  } | null>(null);
  vocabularyRef.current = vocabulary;
  mentionsRef.current = mentions || [];
  marksRef.current = marks || [];
  issuesRef.current = issues;
  entitiesRef.current = entities || [];
  readOnlyRef.current = readOnly;

  // biome-ignore lint/correctness/useExhaustiveDependencies: The editor view is created once; controlled document updates are synchronized by the value effect below.
  useLayoutEffect(() => {
    if (!host.current) return;
    // `asked` separates the two things a selection can mean. Marking text only ever
    // reports what is marked; the actions menu belongs to the writer's explicit
    // request for it (right-click, Shift+F10) -- macOS behaviour, and the reason the
    // panel no longer springs up on an ordinary double-click.
    const reportSelection = (instance: EditorView, asked = false) => {
      const range = instance.state.selection.main;
      if (range.empty) {
        selectionRef.current(null);
        return;
      }
      const start = instance.coordsAtPos(range.from),
        end = instance.coordsAtPos(range.to);
      if (!start || !end) {
        selectionRef.current(null);
        return;
      }
      const selection = {
        from: range.from,
        to: range.to,
        text: instance.state.sliceDoc(range.from, range.to),
        rect: {
          left: Math.min(start.left, end.left),
          top: Math.min(start.top, end.top),
          width: Math.max(1, Math.abs(end.right - start.left)),
          height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top),
        },
      };
      selectionRef.current(selection);
      if (asked) selectionMenuRef.current?.(selection);
    };
    const reportViewSelection = (instance: EditorView) => {
      // A historical snapshot reuses this editor, but its temporary cursor must never
      // replace the live chapter session that will be restored when history closes.
      if (readOnlyRef.current) return;
      const { anchor, head } = instance.state.selection.main;
      viewSelectionRef.current?.({ anchor, head });
    };
    // Toggling changes no character, so it is not a document change: the new ranges go
    // straight to whoever owns the text and come back as the `marks` prop. The decoration
    // effect is dispatched here as well so the passage changes weight under the cursor
    // rather than one React round-trip later.
    const applyMark = (
      instance: EditorView,
      kind: TextMarkKind,
      range?: { from: number; to: number },
    ) => {
      if (readOnlyRef.current) return false;
      const target = range ?? instance.state.selection.main;
      if (target.to <= target.from) return false;
      const next = toggleMark(marksRef.current, target.from, target.to, kind);
      marksRef.current = next;
      instance.dispatch({ effects: setMarkDecorations.of(next) });
      changeRef.current(instance.state.doc.toString(), mentionsRef.current, next);
      return true;
    };
    const clampPosition = (position: number) => Math.max(0, Math.min(position, value.length));
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        selection: initialSelection
          ? EditorSelection.single(
              clampPosition(initialSelection.anchor),
              clampPosition(initialSelection.head),
            )
          : undefined,
        extensions: [
          // Persisted offsets count every UTF-16 code unit. Treat only LF as CodeMirror's
          // structural separator so a CR in CRLF remains in the document and offsets stay exact.
          EditorState.lineSeparator.of("\n"),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": label,
            spellcheck: "true",
            role: "textbox",
            "aria-multiline": "true",
          }),
          editableCompartment.of([
            placeholderExtension(readOnlyRef.current ? "" : placeholder),
            EditorState.readOnly.of(readOnlyRef.current),
            EditorView.editable.of(!readOnlyRef.current),
            EditorView.contentAttributes.of({ tabindex: "0" }),
          ]),
          EditorState.transactionFilter.of((transaction) =>
            readOnlyRef.current &&
            transaction.docChanged &&
            !transaction.annotation(controlledUpdate)
              ? []
              : transaction,
          ),
          editorDecorationExtensions,
          hoverTooltip((_current, position) => {
            const mention = mentionsRef.current.find(
              (item) => position >= item.from && position <= item.to,
            );
            const entity =
              mention && entitiesRef.current.find((item) => item.id === mention.elementId);
            if (!mention || !entity) return null;
            return {
              pos: mention.from,
              end: mention.to,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "entity-mention-host";
                setMentionCard({ host: dom, entity });
                return {
                  dom,
                  destroy: () =>
                    setMentionCard((current) => (current?.host === dom ? null : current)),
                };
              },
            };
          }),
          // Formatting belongs to the editor, not to the window: App.tsx's global handler
          // would fire in every field of the app, including ones where bold means nothing.
          keymap.of([
            {
              key: "Mod-a",
              run: (current) => {
                if (!readOnlyRef.current) return false;
                current.dispatch({
                  selection: EditorSelection.range(0, current.state.doc.length),
                });
                return true;
              },
            },
            { key: "Mod-b", preventDefault: true, run: (current) => applyMark(current, "bold") },
            { key: "Mod-i", preventDefault: true, run: (current) => applyMark(current, "italic") },
          ]),
          keymap.of([
            {
              key: "Tab",
              run: (current) => {
                if (readOnlyRef.current) return false;
                const range = current.state.selection.main;
                if (!range.empty) return false;
                const next = suggestEditorCompletion(
                  current.state.doc.toString(),
                  range.head,
                  entitiesRef.current,
                  vocabularyRef.current,
                  describeEntityRef.current,
                );
                if (!next) return false;
                const mention = next.entity
                  ? {
                      id: crypto.randomUUID(),
                      elementId: next.entity.id,
                      from: next.start,
                      to: next.start + next.word.length,
                      surface: next.word,
                      source: "completion" as const,
                      confidence: 1,
                    }
                  : undefined;
                current.dispatch({
                  changes: { from: next.start, to: next.end, insert: next.word },
                  selection: { anchor: next.start + next.word.length },
                  annotations: mention ? createdMention.of(mention) : undefined,
                  userEvent: "input.complete",
                });
                return true;
              },
            },
          ]),
          EditorView.domEventHandlers({
            click: (event) => {
              const id = (event.target as HTMLElement).closest<HTMLElement>("[data-writing-issue]")
                ?.dataset.writingIssue;
              const issue = id && issuesRef.current.find((item) => item.id === id);
              if (issue) {
                issueRef.current?.(issue);
                return true;
              }
              return false;
            },
            contextmenu: (event, current) => {
              if (readOnlyRef.current) {
                event.preventDefault();
                return true;
              }
              if (current.state.selection.main.empty) {
                const position = current.posAtCoords({ x: event.clientX, y: event.clientY });
                const word = position === null ? null : current.state.wordAt(position);
                if (word)
                  current.dispatch({ selection: EditorSelection.range(word.from, word.to) });
              }
              requestAnimationFrame(() => reportSelection(current, true));
              // Without this the browser adds its own menu on top of the one we just
              // opened -- on macOS a WebKit panel offering "Automatisch ausfüllen" and
              // "Dienste", covering ours. Returning false alone is not enough: CodeMirror
              // reads it as "not handled" and lets the event through. Same shape as the
              // Shift+F10 branch below, which has always got this right.
              event.preventDefault();
              return true;
            },
            keydown: (event, current) => {
              if (readOnlyRef.current && event.shiftKey && event.key === "F10") {
                event.preventDefault();
                return true;
              }
              if (!(event.shiftKey && event.key === "F10")) return false;
              event.preventDefault();
              const range = current.state.selection.main,
                word = range.empty ? current.state.wordAt(range.head) : null;
              if (word) current.dispatch({ selection: EditorSelection.range(word.from, word.to) });
              requestAnimationFrame(() => reportSelection(current, true));
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) reportViewSelection(update.view);
            if (update.docChanged) {
              const range = update.state.selection.main;
              setCompletion(
                range.empty
                  ? suggestEditorCompletion(
                      update.state.doc.toString(),
                      range.head,
                      entitiesRef.current,
                      vocabularyRef.current,
                      describeEntityRef.current,
                    )
                  : null,
              );
              selectionRef.current(null);
              if (
                !update.transactions.some((transaction) => transaction.annotation(controlledUpdate))
              ) {
                let nextMentions = mentionsRef.current,
                  nextMarks = marksRef.current;
                for (const transaction of update.transactions) {
                  nextMentions = mapMentions(
                    nextMentions,
                    transaction.changes,
                    transaction.newDoc.toString(),
                  );
                  nextMarks = mapMarks(nextMarks, transaction.changes, transaction.newDoc.length);
                  const mention = transaction.annotation(createdMention);
                  if (mention)
                    nextMentions = [
                      ...nextMentions.filter(
                        (item) => item.to <= mention.from || item.from >= mention.to,
                      ),
                      mention,
                    ].sort((a, b) => a.from - b.from);
                }
                mentionsRef.current = nextMentions;
                marksRef.current = nextMarks;
                changeRef.current(update.state.doc.toString(), nextMentions, nextMarks);
              }
            } else if (update.selectionSet) {
              const range = update.state.selection.main;
              setCompletion(
                range.empty
                  ? suggestEditorCompletion(
                      update.state.doc.toString(),
                      range.head,
                      entitiesRef.current,
                      vocabularyRef.current,
                      describeEntityRef.current,
                    )
                  : null,
              );
              requestAnimationFrame(() => reportSelection(update.view));
            }
          }),
        ],
      }),
    });
    view.current = instance;
    editorRef.current = {
      focus: () => instance.focus(),
      getPosition: () => ({
        anchor: instance.state.selection.main.anchor,
        head: instance.state.selection.main.head,
        focused: instance.hasFocus,
      }),
      restorePosition: ({ anchor, head, focused }) => {
        const length = instance.state.doc.length;
        const safeAnchor = Math.max(0, Math.min(anchor, length));
        const safeHead = Math.max(0, Math.min(head, length));
        instance.dispatch({ selection: EditorSelection.range(safeAnchor, safeHead) });
        if (focused) instance.focus();
      },
      afterMeasure: (callback) => {
        let cancelled = false;
        let frame: number | null = null;
        instance.requestMeasure({
          read: () => undefined,
          write: () => {
            if (cancelled) return;
            const editorWindow = instance.dom.ownerDocument.defaultView ?? window;
            frame = editorWindow.requestAnimationFrame(() => {
              frame = null;
              if (!cancelled) callback(instance.hasFocus);
            });
          },
        });
        return () => {
          cancelled = true;
          if (frame !== null) {
            (instance.dom.ownerDocument.defaultView ?? window).cancelAnimationFrame(frame);
          }
        };
      },
      insert: (text) => {
        if (readOnlyRef.current) return;
        const range = instance.state.selection.main;
        instance.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          selection: { anchor: range.from + text.length },
          userEvent: "input",
        });
        instance.focus();
      },
      insertEntity: (entity) => {
        if (readOnlyRef.current) return;
        const range = instance.state.selection.main;
        const mention = {
          id: crypto.randomUUID(),
          elementId: entity.id,
          from: range.from,
          to: range.from + entity.name.length,
          surface: entity.name,
          source: "helper" as const,
          confidence: 1,
        };
        instance.dispatch({
          changes: { from: range.from, to: range.to, insert: entity.name },
          selection: { anchor: mention.to },
          annotations: createdMention.of(mention),
          userEvent: "input",
        });
        instance.focus();
      },
      replaceSelection: (from, to, expected, text) => {
        if (readOnlyRef.current) return false;
        if (instance.state.sliceDoc(from, to) !== expected) return false;
        instance.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input",
        });
        instance.focus();
        return true;
      },
      toggleMark: (kind, range) => {
        if (readOnlyRef.current) return false;
        const applied = applyMark(instance, kind, range);
        instance.focus();
        return applied;
      },
      cut: (from, to) => {
        if (readOnlyRef.current) return;
        instance.dispatch({
          changes: { from, to, insert: "" },
          selection: { anchor: from },
          userEvent: "delete.cut",
        });
        instance.focus();
      },
      reveal: (from, to) => {
        const safeFrom = Math.max(0, Math.min(from, instance.state.doc.length)),
          safeTo = Math.max(safeFrom, Math.min(to, instance.state.doc.length));
        instance.dispatch({
          selection: EditorSelection.cursor(safeFrom),
          effects: EditorView.scrollIntoView(EditorSelection.range(safeFrom, safeTo), {
            y: "center",
          }),
        });
        instance.focus();
      },
    };
    reportViewSelection(instance);
    return () => {
      selectionRef.current(null);
      editorRef.current = null;
      view.current = null;
      instance.destroy();
    };
  }, [editorRef, label, placeholder]);

  useLayoutEffect(() => {
    const instance = view.current;
    if (!instance || wasReadOnly.current === readOnly) return;
    if (readOnly) {
      savedLiveState.current = {
        anchor: instance.state.selection.main.anchor,
        head: instance.state.selection.main.head,
        scrollTop: instance.scrollDOM.scrollTop,
        scrollLeft: instance.scrollDOM.scrollLeft,
      };
      setCompletion(null);
      setMentionCard(null);
      selectionRef.current(null);
    }
    wasReadOnly.current = readOnly;
    instance.dispatch({
      effects: editableCompartment.reconfigure([
        placeholderExtension(readOnly ? "" : placeholder),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ tabindex: "0" }),
      ]),
    });
  }, [editableCompartment, placeholder, readOnly]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const restored = !readOnly ? savedLiveState.current : null;
    const clampPosition = (position: number) => Math.max(0, Math.min(position, value.length));
    const anchor = clampPosition(restored?.anchor ?? instance.state.selection.main.anchor);
    const head = clampPosition(restored?.head ?? instance.state.selection.main.head);
    if (instance.state.doc.toString() !== value) {
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: value },
        selection: EditorSelection.single(anchor, head),
        annotations: controlledUpdate.of(true),
      });
    } else if (restored) {
      instance.dispatch({ selection: EditorSelection.single(anchor, head) });
    }
    if (restored) {
      instance.scrollDOM.scrollTop = restored.scrollTop;
      instance.scrollDOM.scrollLeft = restored.scrollLeft;
      savedLiveState.current = null;
    }
  }, [readOnly, value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setMentionDecorations.of(mentions) });
  }, [mentions]);
  useEffect(() => {
    view.current?.dispatch({ effects: setMarkDecorations.of(marks) });
  }, [marks]);
  useEffect(() => {
    view.current?.dispatch({ effects: setIssueDecorations.of(issues) });
  }, [issues]);
  useEffect(() => {
    view.current?.dispatch({ effects: setHeldSelection.of(held) });
  }, [held]);
  useEffect(() => {
    view.current?.dispatch({
      effects: setSearchDecorations.of({ matches: searchMatches, active: activeSearchMatch }),
    });
  }, [searchMatches, activeSearchMatch]);
  useEffect(() => {
    view.current?.dispatch({
      effects: setVersionDiffDecorations.of({
        projection: versionDiff,
        addedLabel: versionDiffLabels?.added ?? "",
        addedLineBreakLabel: versionDiffLabels?.addedLineBreak ?? "",
        removedLabel: versionDiffLabels?.removed ?? "",
        formattingAddedLabels: versionDiffLabels?.formattingAdded ?? { bold: "", italic: "" },
        formattingRemovedLabels: versionDiffLabels?.formattingRemoved ?? { bold: "", italic: "" },
      }),
    });
  }, [versionDiff, versionDiffLabels]);

  return (
    <div className="prose-editor" ref={host} data-readonly={readOnly || undefined}>
      {!readOnly && completion && (
        <div className="word-completion" role="status" aria-live="polite">
          <kbd>Tab</kbd>
          <span>
            {completion.word}
            {completion.detail && <small className="completion-detail">{completion.detail}</small>}
          </span>
        </div>
      )}
      {mentionCard &&
        describeMention &&
        createPortal(
          <EntityMentionCard
            entity={mentionCard.entity}
            description={describeMention(mentionCard.entity)}
            onOpen={() => onOpenEntity?.(mentionCard.entity)}
          />,
          mentionCard.host,
        )}
    </div>
  );
}
