import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Annotation, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, keymap, placeholder as placeholderExtension, EditorView, hoverTooltip } from '@codemirror/view';
import type { WordCompletion } from './autocomplete';
import { completeOneWord } from './autocomplete';
import type { EntityMention, FigureNode, WritingIssue } from '../../types';
import { mapMentions } from './mentions';

const controlledUpdate = Annotation.define<boolean>();
const createdMention = Annotation.define<EntityMention>();
const setMentionDecorations = StateEffect.define<EntityMention[]>();
const setIssueDecorations = StateEffect.define<WritingIssue[]>();
// A browser paints ::selection only while the element has focus, so the moment the
// writer reaches into the inspector the marked passage looks unmarked. This keeps the
// range the writing aid is working on visible for as long as it is held.
const setHeldSelection = StateEffect.define<{ from: number; to: number } | null>();
const mentionDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setMentionDecorations)) value = Decoration.set(effect.value.map(mention => Decoration.mark({ class: 'entity-mention', attributes: { 'data-mention-id': mention.id } }).range(mention.from, mention.to)), true);
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
const issueDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setIssueDecorations)) value = Decoration.set(effect.value.map(issue => Decoration.mark({ class: 'writing-issue', attributes: { 'data-writing-issue': issue.id } }).range(issue.from, issue.to)), true);
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
const heldSelectionDecoration = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHeldSelection)) continue;
      value = effect.value && effect.value.to > effect.value.from
        ? Decoration.set([Decoration.mark({ class: 'held-selection' }).range(effect.value.from, effect.value.to)])
        : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

type CompletionPreview = WordCompletion & { detail?: string };

function entityCompletion(value: string, caret: number, entities: FigureNode[], describe: (entity: FigureNode) => string): CompletionPreview | null {
  const prefix = value.slice(0, caret).match(/[\p{L}\p{N}'’-]+$/u)?.[0] || '';
  if (prefix.length < 2) return null;
  const grouped = new Map<string, FigureNode[]>();
  for (const entity of entities) { const key = entity.name.toLocaleLowerCase('de-DE'); grouped.set(key, [...(grouped.get(key) || []), entity]); }
  const match = [...grouped.entries()].filter(([name, nodes]) => nodes.length === 1 && name.length > prefix.length && name.startsWith(prefix.toLocaleLowerCase('de-DE'))).sort(([a], [b]) => a.localeCompare(b, 'de-DE'))[0];
  if (!match) return null;
  const entity = match[1][0];
  return { word: entity.name, start: caret - prefix.length, end: caret, detail: describe(entity) };
}

export type EditorTextSelection = {
  from: number;
  to: number;
  text: string;
  rect: { left: number; top: number; width: number; height: number };
};

export type ManuscriptEditorHandle = {
  focus: () => void;
  insert: (text: string) => void;
  insertEntity: (entity: FigureNode) => void;
  replaceSelection: (from: number, to: number, expected: string, text: string) => boolean;
};

export function ManuscriptEditor({ value, label, placeholder, vocabulary, mentions = [], issues = [], entities = [], held = null, editorRef, onChange, onSelection, onSelectionMenu, onIssue, onOpenEntity, describeEntity = entity => entity.sub || entity.label || '' }: {
  value: string;
  label: string;
  placeholder: string;
  vocabulary: string[];
  mentions?: EntityMention[];
  issues?: WritingIssue[];
  entities?: FigureNode[];
  /** The passage the writing aid is holding, kept visible while focus is elsewhere. */
  held?: { from: number; to: number } | null;
  editorRef: React.MutableRefObject<ManuscriptEditorHandle | null>;
  onChange: (value: string, mentions: EntityMention[]) => void;
  /** Every change of the marked range. Reports what is selected -- nothing more. */
  onSelection: (selection: EditorTextSelection | null) => void;
  /** Only when the writer asks for the actions: right-click, or Shift+F10. */
  onSelectionMenu?: (selection: EditorTextSelection) => void;
  onIssue?: (issue: WritingIssue) => void;
  onOpenEntity?: (entity: FigureNode) => void;
  describeEntity?: (entity: FigureNode) => string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange), selectionRef = useRef(onSelection), selectionMenuRef = useRef(onSelectionMenu), issueRef = useRef(onIssue), openEntityRef = useRef(onOpenEntity), describeEntityRef = useRef(describeEntity), vocabularyRef = useRef(vocabulary), mentionsRef = useRef(mentions || []), issuesRef = useRef(issues), entitiesRef = useRef(entities || []);
  const [completion, setCompletion] = useState<CompletionPreview | null>(null);
  changeRef.current = onChange; selectionRef.current = onSelection; selectionMenuRef.current = onSelectionMenu; issueRef.current = onIssue; openEntityRef.current = onOpenEntity; describeEntityRef.current = describeEntity; vocabularyRef.current = vocabulary; mentionsRef.current = mentions || []; issuesRef.current = issues; entitiesRef.current = entities || [];

  useLayoutEffect(() => {
    if (!host.current) return;
    // `asked` separates the two things a selection can mean. Marking text only ever
    // reports what is marked; the actions menu belongs to the writer's explicit
    // request for it (right-click, Shift+F10) -- macOS behaviour, and the reason the
    // panel no longer springs up on an ordinary double-click.
    const reportSelection = (instance: EditorView, asked = false) => {
      const range = instance.state.selection.main;
      if (range.empty) { selectionRef.current(null); return; }
      const start = instance.coordsAtPos(range.from), end = instance.coordsAtPos(range.to);
      if (!start || !end) { selectionRef.current(null); return; }
      const selection = { from: range.from, to: range.to, text: instance.state.sliceDoc(range.from, range.to), rect: { left: Math.min(start.left, end.left), top: Math.min(start.top, end.top), width: Math.max(1, Math.abs(end.right - start.left)), height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top) } };
      selectionRef.current(selection);
      if (asked) selectionMenuRef.current?.(selection);
    };
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: value, extensions: [
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' }),
        placeholderExtension(placeholder),
        mentionDecorations,
        issueDecorations,
        heldSelectionDecoration,
        hoverTooltip((_current, position) => {
          const mention = mentionsRef.current.find(item => position >= item.from && position <= item.to);
          const entity = mention && entitiesRef.current.find(item => item.id === mention.elementId);
          if (!mention || !entity) return null;
          return { pos: mention.from, end: mention.to, above: true, create: () => {
            const dom = document.createElement('div'); dom.className = 'entity-mention-card';
            const title = document.createElement('strong'); title.textContent = entity.name;
            const detail = document.createElement('span'); detail.textContent = describeEntityRef.current(entity);
            const button = document.createElement('button'); button.type = 'button'; button.textContent = '→'; button.setAttribute('aria-label', entity.name); button.addEventListener('click', () => openEntityRef.current?.(entity));
            dom.append(title, detail, button); return { dom };
          } };
        }),
        keymap.of([{ key: 'Tab', run: current => {
          const range = current.state.selection.main;
          if (!range.empty) return false;
          const text = current.state.doc.toString(), entity = entityCompletion(text, range.head, entitiesRef.current, describeEntityRef.current);
          const next = entity || completeOneWord(text, range.head, vocabularyRef.current);
          if (!next) return false;
          const matchedEntity = entity && entitiesRef.current.find(item => item.name === entity.word);
          const mention = matchedEntity ? { id: crypto.randomUUID(), elementId: matchedEntity.id, from: next.start, to: next.start + next.word.length, surface: next.word, source: 'completion' as const, confidence: 1 } : undefined;
          current.dispatch({ changes: { from: next.start, to: next.end, insert: next.word }, selection: { anchor: next.start + next.word.length }, annotations: mention ? createdMention.of(mention) : undefined, userEvent: 'input.complete' });
          return true;
        } }]),
        EditorView.domEventHandlers({
          click: event => {
            const id = (event.target as HTMLElement).closest<HTMLElement>('[data-writing-issue]')?.dataset.writingIssue;
            const issue = id && issuesRef.current.find(item => item.id === id);
            if (issue) { issueRef.current?.(issue); return true; }
            return false;
          },
          contextmenu: (event, current) => {
            if (current.state.selection.main.empty) {
              const position = current.posAtCoords({ x: event.clientX, y: event.clientY });
              const word = position === null ? null : current.state.wordAt(position);
              if (word) current.dispatch({ selection: EditorSelection.range(word.from, word.to) });
            }
            requestAnimationFrame(() => reportSelection(current, true));
            return false;
          },
          keydown: (event, current) => {
            if (!(event.shiftKey && event.key === 'F10')) return false;
            event.preventDefault();
            const range = current.state.selection.main, word = range.empty ? current.state.wordAt(range.head) : null;
            if (word) current.dispatch({ selection: EditorSelection.range(word.from, word.to) });
            requestAnimationFrame(() => reportSelection(current, true));
            requestAnimationFrame(() => requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('.ui-popover [role="menuitem"], .ui-sheet [role="menuitem"]')].at(-1)?.focus()));
            return true;
          },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const range = update.state.selection.main;
            setCompletion(range.empty ? entityCompletion(update.state.doc.toString(), range.head, entitiesRef.current, describeEntityRef.current) || completeOneWord(update.state.doc.toString(), range.head, vocabularyRef.current) : null);
            selectionRef.current(null);
            if (!update.transactions.some(transaction => transaction.annotation(controlledUpdate))) {
              let nextMentions = mentionsRef.current;
              for (const transaction of update.transactions) {
                nextMentions = mapMentions(nextMentions, transaction.changes, transaction.newDoc.toString());
                const mention = transaction.annotation(createdMention);
                if (mention) nextMentions = [...nextMentions.filter(item => item.to <= mention.from || item.from >= mention.to), mention].sort((a, b) => a.from - b.from);
              }
              mentionsRef.current = nextMentions;
              changeRef.current(update.state.doc.toString(), nextMentions);
            }
          } else if (update.selectionSet) {
            const range = update.state.selection.main;
            setCompletion(range.empty ? entityCompletion(update.state.doc.toString(), range.head, entitiesRef.current, describeEntityRef.current) || completeOneWord(update.state.doc.toString(), range.head, vocabularyRef.current) : null);
            requestAnimationFrame(() => reportSelection(update.view));
          }
        }),
      ] }),
    });
    view.current = instance;
    editorRef.current = {
      focus: () => instance.focus(),
      insert: text => {
        const range = instance.state.selection.main;
        instance.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length }, userEvent: 'input' });
        instance.focus();
      },
      insertEntity: entity => {
        const range = instance.state.selection.main;
        const mention = { id: crypto.randomUUID(), elementId: entity.id, from: range.from, to: range.from + entity.name.length, surface: entity.name, source: 'helper' as const, confidence: 1 };
        instance.dispatch({ changes: { from: range.from, to: range.to, insert: entity.name }, selection: { anchor: mention.to }, annotations: createdMention.of(mention), userEvent: 'input' });
        instance.focus();
      },
      replaceSelection: (from, to, expected, text) => {
        if (instance.state.sliceDoc(from, to) !== expected) return false;
        instance.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input' });
        instance.focus(); return true;
      },
    };
    return () => { selectionRef.current(null); editorRef.current = null; view.current = null; instance.destroy(); };
  }, [editorRef, label, placeholder]);

  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) return;
    const head = Math.min(instance.state.selection.main.head, value.length);
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value }, selection: EditorSelection.cursor(head), annotations: controlledUpdate.of(true) });
  }, [value]);

  useEffect(() => { view.current?.dispatch({ effects: setMentionDecorations.of(mentions) }); }, [mentions]);
  useEffect(() => { view.current?.dispatch({ effects: setIssueDecorations.of(issues) }); }, [issues]);
  useEffect(() => { view.current?.dispatch({ effects: setHeldSelection.of(held) }); }, [held?.from, held?.to]);

  return <div className="prose-editor" ref={host}>{completion && <div className="word-completion" role="status" aria-live="polite"><kbd>Tab</kbd><span>{completion.word}{completion.detail && <small>{completion.detail}</small>}</span></div>}</div>;
}
