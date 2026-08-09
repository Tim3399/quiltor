import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Annotation, EditorSelection, EditorState } from '@codemirror/state';
import { keymap, placeholder as placeholderExtension, EditorView } from '@codemirror/view';
import type { WordCompletion } from './autocomplete';
import { completeOneWord } from './autocomplete';

const controlledUpdate = Annotation.define<boolean>();

export type EditorTextSelection = {
  from: number;
  to: number;
  text: string;
  rect: { left: number; top: number; width: number; height: number };
};

export type ManuscriptEditorHandle = {
  focus: () => void;
  insert: (text: string) => void;
};

export function ManuscriptEditor({ value, label, placeholder, vocabulary, editorRef, onChange, onSelection }: {
  value: string;
  label: string;
  placeholder: string;
  vocabulary: string[];
  editorRef: React.MutableRefObject<ManuscriptEditorHandle | null>;
  onChange: (value: string) => void;
  onSelection: (selection: EditorTextSelection | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange), selectionRef = useRef(onSelection), vocabularyRef = useRef(vocabulary);
  const [completion, setCompletion] = useState<WordCompletion | null>(null);
  changeRef.current = onChange; selectionRef.current = onSelection; vocabularyRef.current = vocabulary;

  useLayoutEffect(() => {
    if (!host.current) return;
    const reportSelection = (instance: EditorView) => {
      const range = instance.state.selection.main;
      if (range.empty) { selectionRef.current(null); return; }
      const start = instance.coordsAtPos(range.from), end = instance.coordsAtPos(range.to);
      if (!start || !end) { selectionRef.current(null); return; }
      selectionRef.current({ from: range.from, to: range.to, text: instance.state.sliceDoc(range.from, range.to), rect: { left: Math.min(start.left, end.left), top: Math.min(start.top, end.top), width: Math.max(1, Math.abs(end.right - start.left)), height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top) } });
    };
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: value, extensions: [
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' }),
        placeholderExtension(placeholder),
        keymap.of([{ key: 'Tab', run: current => {
          const range = current.state.selection.main;
          if (!range.empty) return false;
          const next = completeOneWord(current.state.doc.toString(), range.head, vocabularyRef.current);
          if (!next) return false;
          current.dispatch({ changes: { from: next.start, to: next.end, insert: next.word }, selection: { anchor: next.start + next.word.length }, userEvent: 'input.complete' });
          return true;
        } }]),
        EditorView.domEventHandlers({
          contextmenu: (event, current) => {
            if (current.state.selection.main.empty) {
              const position = current.posAtCoords({ x: event.clientX, y: event.clientY });
              const word = position === null ? null : current.state.wordAt(position);
              if (word) current.dispatch({ selection: EditorSelection.range(word.from, word.to) });
            }
            requestAnimationFrame(() => reportSelection(current));
            return false;
          },
          keydown: (event, current) => {
            if (!(event.shiftKey && event.key === 'F10')) return false;
            event.preventDefault();
            const range = current.state.selection.main, word = range.empty ? current.state.wordAt(range.head) : null;
            if (word) current.dispatch({ selection: EditorSelection.range(word.from, word.to) });
            requestAnimationFrame(() => reportSelection(current));
            requestAnimationFrame(() => requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('.ui-popover [role="menuitem"], .ui-sheet [role="menuitem"]')].at(-1)?.focus()));
            return true;
          },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            setCompletion(null);
            selectionRef.current(null);
            if (!update.transactions.some(transaction => transaction.annotation(controlledUpdate))) changeRef.current(update.state.doc.toString());
          } else if (update.selectionSet) {
            const range = update.state.selection.main;
            setCompletion(range.empty ? completeOneWord(update.state.doc.toString(), range.head, vocabularyRef.current) : null);
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
    };
    return () => { selectionRef.current(null); editorRef.current = null; view.current = null; instance.destroy(); };
  }, [editorRef, label, placeholder]);

  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) return;
    const head = Math.min(instance.state.selection.main.head, value.length);
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value }, selection: EditorSelection.cursor(head), annotations: controlledUpdate.of(true) });
  }, [value]);

  return <div className="prose-editor" ref={host}>{completion && <div className="word-completion" role="status" aria-live="polite"><kbd>Tab</kbd><span>{completion.word}</span></div>}</div>;
}
