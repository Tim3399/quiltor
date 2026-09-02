import { Annotation, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { Bold, Heading, Heading1, Heading2, Heading3, Italic } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, DropdownMenu, Field, IconButton, MenuItem, Popover } from "../../design";
import { useI18n } from "../../i18n";
import type { NoteHeadingLevel, NoteMark, NoteReference } from "../../shared";
import {
  searchWorldReferences,
  type WorldReferenceCandidate,
  type WorldReferenceTarget,
  worldReferenceKey,
} from "../world-references";
import {
  mapNoteMarks,
  normalizeNoteMarks,
  toggleNoteHeading,
  toggleNoteInlineMark,
} from "./noteMarks";
import {
  type ActiveNoteReferenceQuery,
  findActiveNoteReferenceQuery,
  insertNoteReference,
  mapNoteReferences,
  reconcileNoteReferences,
} from "./noteReferences";

const controlledUpdate = Annotation.define<boolean>();
const setReferences = StateEffect.define<readonly NoteReference[]>();
const setNoteMarks = StateEffect.define<readonly NoteMark[]>();

type ReferenceState = {
  references: readonly NoteReference[];
  decorations: DecorationSet;
};

function decorationsFor(references: readonly NoteReference[]) {
  return Decoration.set(
    references.map((reference) =>
      Decoration.mark({
        class: "note-reference",
        attributes: { "data-note-reference-id": reference.id },
      }).range(reference.from, reference.to),
    ),
    true,
  );
}

const referenceState = StateField.define<ReferenceState>({
  create: () => ({ references: [], decorations: Decoration.none }),
  update(value, transaction) {
    let references = transaction.docChanged
      ? mapNoteReferences(
          value.references,
          transaction.startState.doc.toString(),
          transaction.newDoc.toString(),
        )
      : value.references;
    for (const effect of transaction.effects) {
      if (effect.is(setReferences)) {
        references = reconcileNoteReferences(transaction.newDoc.toString(), effect.value);
      }
    }
    if (references === value.references) return value;
    return { references, decorations: decorationsFor(references) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

type NoteMarkState = {
  marks: readonly NoteMark[];
  decorations: DecorationSet;
};

type ActiveNoteFormatting = {
  bold: boolean;
  italic: boolean;
  heading: NoteHeadingLevel | null;
};

function noteMarkDecorations(text: string, marks: readonly NoteMark[]) {
  const decorations = normalizeNoteMarks(text, marks).map((mark) =>
    mark.kind === "heading"
      ? Decoration.line({
          class: `note-mark--heading note-mark--heading-${mark.level}`,
          attributes: { role: "heading", "aria-level": String(mark.level) },
        }).range(mark.from)
      : Decoration.mark({ class: `note-mark--${mark.kind}` }).range(mark.from, mark.to),
  );
  return Decoration.set(decorations, true);
}

function inlineMarkActive(
  marks: readonly NoteMark[],
  kind: "bold" | "italic",
  from: number,
  to: number,
) {
  const matching = marks.filter((mark) => mark.kind === kind);
  if (from === to) {
    return matching.some(
      (mark) => mark.from <= from && (from < mark.to || (from === mark.to && from > mark.from)),
    );
  }
  let covered = from;
  for (const mark of matching) {
    if (mark.to <= covered) continue;
    if (mark.from > covered) return false;
    covered = mark.to;
    if (covered >= to) return true;
  }
  return false;
}

function activeFormatting(view: EditorView): ActiveNoteFormatting {
  const selection = view.state.selection.main;
  const marks = view.state.field(noteMarkState).marks;
  const end = selection.empty ? selection.head : Math.max(selection.from, selection.to - 1);
  const firstLine = view.state.doc.lineAt(selection.from).number;
  const lastLine = view.state.doc.lineAt(end).number;
  let heading: NoteHeadingLevel | null = null;
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const current = marks.find(
      (mark) => mark.kind === "heading" && mark.from === line.from && mark.to === line.to,
    );
    if (current?.kind !== "heading" || (heading !== null && current.level !== heading)) {
      heading = null;
      break;
    }
    heading = current.level;
  }
  return {
    bold: inlineMarkActive(marks, "bold", selection.from, selection.to),
    italic: inlineMarkActive(marks, "italic", selection.from, selection.to),
    heading,
  };
}

function sameNoteMarks(left: readonly NoteMark[], right: readonly NoteMark[]) {
  return (
    left.length === right.length &&
    left.every((mark, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        mark.kind === other.kind &&
        mark.from === other.from &&
        mark.to === other.to &&
        (mark.kind !== "heading" || (other.kind === "heading" && mark.level === other.level))
      );
    })
  );
}

const noteMarkState = StateField.define<NoteMarkState>({
  create: () => ({ marks: [], decorations: Decoration.none }),
  update(value, transaction) {
    let marks = transaction.docChanged
      ? mapNoteMarks(value.marks, transaction.changes, transaction.newDoc.toString())
      : value.marks;
    for (const effect of transaction.effects) {
      if (effect.is(setNoteMarks))
        marks = normalizeNoteMarks(transaction.newDoc.toString(), effect.value);
    }
    if (marks === value.marks) return value;
    return {
      marks,
      decorations: noteMarkDecorations(transaction.newDoc.toString(), marks),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

type CompletionState = {
  query: ActiveNoteReferenceQuery;
  candidates: WorldReferenceCandidate[];
  activeIndex: number;
};

export function ReferenceTextEditor({
  label,
  ariaLabel,
  value,
  references,
  marks,
  candidates,
  onChange,
  onOpenReference,
  placeholder = "",
  actions,
  labelHidden = false,
  fieldClassName = "",
  formatActionClassName = "",
  className = "",
  rows,
  autoFocus = false,
  popoverPortalRef,
}: {
  label: ReactNode;
  ariaLabel: string;
  value: string;
  references: readonly NoteReference[];
  marks: readonly NoteMark[];
  candidates: readonly WorldReferenceCandidate[];
  onChange: (value: string, references: NoteReference[], marks: NoteMark[]) => void;
  onOpenReference: (target: WorldReferenceTarget) => void;
  placeholder?: string;
  actions?: ReactNode;
  labelHidden?: boolean;
  fieldClassName?: string;
  formatActionClassName?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  popoverPortalRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const controlId = useId();
  const completionId = `${controlId}-references`;
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const openReferenceRef = useRef(onOpenReference);
  const candidatesRef = useRef(candidates);
  const marksRef = useRef(normalizeNoteMarks(value, marks));
  const completionRef = useRef<CompletionState | null>(null);
  const [completion, setCompletionState] = useState<CompletionState | null>(null);
  const [renderedReferences, setRenderedReferences] = useState(() =>
    reconcileNoteReferences(value, references),
  );
  const [active, setActive] = useState<ActiveNoteFormatting>({
    bold: false,
    italic: false,
    heading: null,
  });

  changeRef.current = onChange;
  openReferenceRef.current = onOpenReference;
  candidatesRef.current = candidates;
  marksRef.current = normalizeNoteMarks(value, marks);

  const publishMarks = (nextMarks: NoteMark[], view = viewRef.current) => {
    if (!view) return false;
    if (sameNoteMarks(view.state.field(noteMarkState).marks, nextMarks)) return false;
    marksRef.current = nextMarks;
    view.dispatch({ effects: setNoteMarks.of(nextMarks) });
    changeRef.current(
      view.state.doc.toString(),
      [...view.state.field(referenceState).references],
      nextMarks,
    );
    return true;
  };

  const inlineSelection = (view: EditorView) => {
    const selection = view.state.selection.main;
    if (!selection.empty) return selection;
    return view.state.wordAt(selection.head);
  };

  const applyInlineMark = (kind: "bold" | "italic", view = viewRef.current) => {
    if (!view) return false;
    const range = inlineSelection(view);
    if (!range) return false;
    return publishMarks(
      toggleNoteInlineMark(
        view.state.doc.toString(),
        view.state.field(noteMarkState).marks,
        range.from,
        range.to,
        kind,
      ),
      view,
    );
  };

  const applyHeading = (level: NoteHeadingLevel, view = viewRef.current) => {
    if (!view) return false;
    const range = view.state.selection.main;
    return publishMarks(
      toggleNoteHeading(
        view.state.doc.toString(),
        view.state.field(noteMarkState).marks,
        range.from,
        range.to,
        level,
      ),
      view,
    );
  };

  const setCompletion = (next: CompletionState | null) => {
    completionRef.current = next;
    setCompletionState(next);
  };

  const refreshActiveFormatting = (view: EditorView) => {
    const next = activeFormatting(view);
    setActive((current) =>
      current.bold === next.bold &&
      current.italic === next.italic &&
      current.heading === next.heading
        ? current
        : next,
    );
  };

  const refreshCompletion = (view: EditorView) => {
    const selection = view.state.selection.main;
    const query = selection.empty
      ? findActiveNoteReferenceQuery(view.state.doc.toString(), selection.head)
      : null;
    if (!query || !view.hasFocus) {
      setCompletion(null);
      return;
    }
    const nextCandidates = searchWorldReferences(candidatesRef.current, query.query, 8).filter(
      (candidate) => candidate.label.trim().length > 0,
    );
    const previous = completionRef.current;
    const activeIndex = Math.min(
      previous?.activeIndex ?? 0,
      Math.max(0, nextCandidates.length - 1),
    );
    setCompletion({ query, candidates: nextCandidates, activeIndex });
  };

  const chooseCandidate = (candidate: WorldReferenceCandidate, view = viewRef.current) => {
    if (!view) return false;
    const selection = view.state.selection.main;
    const query = selection.empty
      ? findActiveNoteReferenceQuery(view.state.doc.toString(), selection.head)
      : null;
    if (!query) return false;
    const currentReferences = view.state.field(referenceState).references;
    const insertion = insertNoteReference(
      view.state.doc.toString(),
      currentReferences,
      query,
      candidate,
    );
    const surface = insertion.text.slice(query.from, insertion.caret);
    view.dispatch({
      changes: { from: query.from, to: query.to, insert: surface },
      selection: { anchor: insertion.caret },
      effects: setReferences.of(insertion.references),
      userEvent: "input.complete",
    });
    setCompletion(null);
    return true;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: CodeMirror owns one editor instance; changing props are synchronized through refs and the controlled-value effect.
  useLayoutEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            "aria-autocomplete": "list",
            "aria-multiline": "true",
            role: "textbox",
            spellcheck: "true",
            id: controlId,
            ...(autoFocus ? { "data-autofocus": "true" } : {}),
          }),
          placeholderExtension(placeholder),
          referenceState,
          noteMarkState,
          keymap.of([
            {
              key: "Mod-b",
              preventDefault: true,
              run: (current) => applyInlineMark("bold", current),
            },
            {
              key: "Mod-i",
              preventDefault: true,
              run: (current) => applyInlineMark("italic", current),
            },
            {
              key: "Mod-Alt-1",
              preventDefault: true,
              run: (current) => applyHeading(1, current),
            },
            {
              key: "Mod-Alt-2",
              preventDefault: true,
              run: (current) => applyHeading(2, current),
            },
            {
              key: "Mod-Alt-3",
              preventDefault: true,
              run: (current) => applyHeading(3, current),
            },
            {
              key: "ArrowDown",
              run: () => {
                const current = completionRef.current;
                if (!current?.candidates.length) return false;
                setCompletion({
                  ...current,
                  activeIndex: (current.activeIndex + 1) % current.candidates.length,
                });
                return true;
              },
            },
            {
              key: "ArrowUp",
              run: () => {
                const current = completionRef.current;
                if (!current?.candidates.length) return false;
                setCompletion({
                  ...current,
                  activeIndex:
                    (current.activeIndex - 1 + current.candidates.length) %
                    current.candidates.length,
                });
                return true;
              },
            },
            {
              key: "Enter",
              run: (current) => {
                const state = completionRef.current;
                const candidate = state?.candidates[state.activeIndex];
                return candidate ? chooseCandidate(candidate, current) : false;
              },
            },
            {
              key: "Tab",
              run: (current) => {
                const state = completionRef.current;
                const candidate = state?.candidates[state.activeIndex];
                return candidate ? chooseCandidate(candidate, current) : false;
              },
            },
            {
              key: "Escape",
              run: () => {
                if (!completionRef.current) return false;
                setCompletion(null);
                return true;
              },
            },
          ]),
          EditorView.domEventHandlers({
            click: (event, current) => {
              const id = (event.target as HTMLElement)
                .closest<HTMLElement>("[data-note-reference-id]")
                ?.getAttribute("data-note-reference-id");
              const reference =
                id && current.state.field(referenceState).references.find((item) => item.id === id);
              if (!reference) return false;
              openReferenceRef.current(reference.target);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            const marksChanged =
              update.startState.field(noteMarkState).marks !==
              update.state.field(noteMarkState).marks;
            if (update.docChanged) {
              const nextReferences = [...update.state.field(referenceState).references];
              const nextMarks = [...update.state.field(noteMarkState).marks];
              marksRef.current = nextMarks;
              setRenderedReferences(nextReferences);
              const controlled = update.transactions.some((transaction) =>
                transaction.annotation(controlledUpdate),
              );
              if (!controlled) {
                changeRef.current(update.state.doc.toString(), nextReferences, nextMarks);
              }
            }
            if (update.docChanged || update.selectionSet || update.focusChanged || marksChanged) {
              refreshCompletion(update.view);
              refreshActiveFormatting(update.view);
            }
          }),
        ],
      }),
    });
    viewRef.current = instance;
    instance.dispatch({ effects: [setReferences.of(references), setNoteMarks.of(marks)] });
    if (autoFocus) queueMicrotask(() => instance.focus());
    return () => {
      viewRef.current = null;
      instance.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const nextReferences = reconcileNoteReferences(value, references);
    const currentText = view.state.doc.toString();
    setRenderedReferences(nextReferences);
    view.dispatch({
      ...(currentText === value
        ? {}
        : { changes: { from: 0, to: currentText.length, insert: value } }),
      effects: [setReferences.of(nextReferences), setNoteMarks.of(marks)],
      annotations: controlledUpdate.of(true),
    });
  }, [marks, references, value]);

  useEffect(() => {
    const content = viewRef.current?.contentDOM;
    if (!content) return;
    if (completion) {
      content.setAttribute("aria-controls", completionId);
      const active = completion.candidates[completion.activeIndex];
      if (active)
        content.setAttribute(
          "aria-activedescendant",
          `${completionId}-option-${completion.activeIndex}`,
        );
      else content.removeAttribute("aria-activedescendant");
    } else {
      content.removeAttribute("aria-controls");
      content.removeAttribute("aria-activedescendant");
    }
  }, [completion, completionId]);

  const candidateByTarget = useMemo(() => {
    const index = new Map<string, WorldReferenceCandidate>();
    for (const candidate of candidates) {
      index.set(worldReferenceKey(candidate.target), candidate);
      if (candidate.target.kind === "entity" || candidate.target.kind === "place") {
        index.set(`story-node:${candidate.target.id}`, candidate);
      }
    }
    return index;
  }, [candidates]);
  const style = rows ? ({ "--note-editor-rows": rows } as CSSProperties) : undefined;

  return (
    <Field
      controlId={`${controlId}-surface`}
      labelTargetId={controlId}
      className={`note-editor__field ${fieldClassName}`.trim()}
      label={label}
      actions={
        <div
          className={`note-format-actions ${formatActionClassName}`.trim()}
          role="toolbar"
          aria-label={t("noteFormatting")}
        >
          <IconButton
            label={t("noteBold")}
            icon={<Bold />}
            aria-pressed={active.bold}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => applyInlineMark("bold")}
          />
          <IconButton
            label={t("noteItalic")}
            icon={<Italic />}
            aria-pressed={active.italic}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => applyInlineMark("italic")}
          />
          <DropdownMenu
            label={t("noteHeading")}
            compactMode="popover"
            portalContainerRef={popoverPortalRef}
            renderTrigger={({ ref, ...triggerProps }) => (
              <IconButton
                {...triggerProps}
                ref={ref}
                label={t("noteHeading")}
                icon={<Heading />}
                aria-pressed={active.heading !== null}
                onPointerDown={(event) => event.preventDefault()}
              />
            )}
          >
            <MenuItem
              label={t("noteHeading1")}
              icon={<Heading1 />}
              selected={active.heading === 1}
              onSelect={() => applyHeading(1)}
            />
            <MenuItem
              label={t("noteHeading2")}
              icon={<Heading2 />}
              selected={active.heading === 2}
              onSelect={() => applyHeading(2)}
            />
            <MenuItem
              label={t("noteHeading3")}
              icon={<Heading3 />}
              selected={active.heading === 3}
              onSelect={() => applyHeading(3)}
            />
          </DropdownMenu>
          {actions}
        </div>
      }
      labelHidden={labelHidden}
      onLabelClick={() => viewRef.current?.focus()}
    >
      <div ref={anchor} className="note-editor__body" style={style}>
        <div ref={host} className={`note-editor__control ${className}`.trim()} />
        <Popover
          anchorRef={anchor}
          open={Boolean(completion)}
          onClose={() => setCompletion(null)}
          label={t("noteReferencePicker")}
          compactMode="popover"
          desktopRole="presentation"
          className="note-reference-popover"
          portalContainerRef={popoverPortalRef}
        >
          <div
            id={completionId}
            className="note-reference-options"
            role="listbox"
            aria-label={t("noteReferencePicker")}
          >
            {completion?.candidates.length ? (
              completion.candidates.map((candidate, index) => (
                <Button
                  key={candidate.id}
                  id={`${completionId}-option-${index}`}
                  className="note-reference-option"
                  appearance="ghost"
                  size="compact"
                  role="option"
                  aria-selected={index === completion.activeIndex}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    const current = completionRef.current;
                    if (current) setCompletion({ ...current, activeIndex: index });
                  }}
                  onClick={() => chooseCandidate(candidate)}
                >
                  <span className="note-reference-option__copy">
                    <strong>{candidate.label}</strong>
                    {candidate.detail && <small>{candidate.detail}</small>}
                  </span>
                </Button>
              ))
            ) : (
              <p className="note-reference-options__empty">{t("noteReferenceNoResults")}</p>
            )}
          </div>
        </Popover>
        {renderedReferences.length > 0 && (
          <fieldset className="note-reference-links">
            <legend className="sr-only">{t("noteReferenceLinks")}</legend>
            {renderedReferences.map((reference) => {
              const candidate =
                candidateByTarget.get(worldReferenceKey(reference.target)) ??
                (reference.target.kind === "entity" || reference.target.kind === "place"
                  ? candidateByTarget.get(`story-node:${reference.target.id}`)
                  : undefined);
              const currentLabel = candidate?.label || reference.surface;
              return (
                <Button
                  key={reference.id}
                  appearance="ghost"
                  size="compact"
                  className="note-reference-link"
                  onClick={() => openReferenceRef.current(reference.target)}
                >
                  {currentLabel}
                </Button>
              );
            })}
          </fieldset>
        )}
      </div>
    </Field>
  );
}
