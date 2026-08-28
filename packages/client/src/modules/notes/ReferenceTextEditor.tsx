import { Annotation, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
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
import { Button, Field, Popover } from "../../design";
import { useI18n } from "../../i18n";
import type { NoteReference } from "../../shared";
import {
  searchWorldReferences,
  type WorldReferenceCandidate,
  type WorldReferenceTarget,
  worldReferenceKey,
} from "../world-references";
import {
  type ActiveNoteReferenceQuery,
  findActiveNoteReferenceQuery,
  insertNoteReference,
  mapNoteReferences,
  reconcileNoteReferences,
} from "./noteReferences";

const controlledUpdate = Annotation.define<boolean>();
const setReferences = StateEffect.define<readonly NoteReference[]>();

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
  candidates,
  onChange,
  onOpenReference,
  placeholder = "",
  actions,
  labelHidden = false,
  fieldClassName = "",
  className = "",
  rows,
  autoFocus = false,
  popoverPortalRef,
}: {
  label: ReactNode;
  ariaLabel: string;
  value: string;
  references: readonly NoteReference[];
  candidates: readonly WorldReferenceCandidate[];
  onChange: (value: string, references: NoteReference[]) => void;
  onOpenReference: (target: WorldReferenceTarget) => void;
  placeholder?: string;
  actions?: ReactNode;
  labelHidden?: boolean;
  fieldClassName?: string;
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
  const completionRef = useRef<CompletionState | null>(null);
  const [completion, setCompletionState] = useState<CompletionState | null>(null);
  const [renderedReferences, setRenderedReferences] = useState(() =>
    reconcileNoteReferences(value, references),
  );

  changeRef.current = onChange;
  openReferenceRef.current = onOpenReference;
  candidatesRef.current = candidates;

  const setCompletion = (next: CompletionState | null) => {
    completionRef.current = next;
    setCompletionState(next);
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
          keymap.of([
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
            if (update.docChanged) {
              const nextReferences = [...update.state.field(referenceState).references];
              setRenderedReferences(nextReferences);
              const controlled = update.transactions.some((transaction) =>
                transaction.annotation(controlledUpdate),
              );
              if (!controlled) {
                changeRef.current(update.state.doc.toString(), nextReferences);
              }
            }
            if (update.docChanged || update.selectionSet || update.focusChanged) {
              refreshCompletion(update.view);
            }
          }),
        ],
      }),
    });
    viewRef.current = instance;
    instance.dispatch({ effects: setReferences.of(references) });
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
      effects: setReferences.of(nextReferences),
      annotations: controlledUpdate.of(true),
    });
  }, [references, value]);

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
      actions={actions}
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
