import { createRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManuscriptEditor, type ManuscriptEditorHandle } from './ManuscriptEditor';

// jsdom has no layout, so the two calls that ask the browser where something is on
// screen answer with nothing and the editor would report no selection at all.
beforeEach(() => {
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ left: 0, right: 40, top: 0, bottom: 16 });
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(7);
});

function renderEditor(props: Partial<React.ComponentProps<typeof ManuscriptEditor>> = {}) {
  const onSelection = vi.fn(), onSelectionMenu = vi.fn(), onChange = vi.fn();
  const handle = createRef<ManuscriptEditorHandle>() as React.MutableRefObject<ManuscriptEditorHandle | null>;
  const view = render(<ManuscriptEditor
    value="Hallo Welt" label="Kapiteltext" placeholder="" vocabulary={[]}
    editorRef={handle}
    onChange={onChange} onSelection={onSelection} onSelectionMenu={onSelectionMenu} {...props} />);
  const editor = EditorView.findFromDOM(view.container.querySelector('.cm-editor')!)!;
  return { ...view, editor, handle, onSelection, onSelectionMenu, onChange };
}

describe('ManuscriptEditor selection', () => {
  it('meldet eine Markierung, ohne dafür das Aktionsmenü zu öffnen', async () => {
    // Der Bericht ist die Information "das ist markiert". Das Menü mit Wörterbuch,
    // Synonymen und Übersetzung ist eine eigene Entscheidung des Schreibenden und darf
    // nicht schon beim Doppelklick aufspringen.
    const { editor, onSelection, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    await waitFor(() => expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ from: 6, to: 10, text: 'Welt' })));
    expect(onSelectionMenu).not.toHaveBeenCalled();
  });

  it('öffnet das Aktionsmenü beim Rechtsklick', async () => {
    const { container, editor, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    fireEvent.contextMenu(container.querySelector('.cm-content')!);
    await waitFor(() => expect(onSelectionMenu).toHaveBeenCalledWith(expect.objectContaining({ text: 'Welt' })));
  });

  it('öffnet das Aktionsmenü auch per Tastatur mit Umschalt+F10', async () => {
    const { container, editor, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    fireEvent.keyDown(container.querySelector('.cm-content')!, { key: 'F10', shiftKey: true });
    await waitFor(() => expect(onSelectionMenu).toHaveBeenCalledWith(expect.objectContaining({ text: 'Welt' })));
  });

  it('meldet das Ende der Markierung, wenn der Cursor nur noch steht', async () => {
    const { editor, onSelection } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    await waitFor(() => expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ text: 'Welt' })));
    editor.dispatch({ selection: EditorSelection.cursor(3) });
    await waitFor(() => expect(onSelection).toHaveBeenLastCalledWith(null));
  });

  it('zeichnet Fett und Kursiv als Bereiche über dem Text', () => {
    const { container } = renderEditor({ marks: [{ from: 0, to: 5, kind: 'bold' }, { from: 6, to: 10, kind: 'italic' }] });
    expect(container.querySelector('.text-bold')).toHaveTextContent('Hallo');
    expect(container.querySelector('.text-italic')).toHaveTextContent('Welt');
    // Im Text selbst stehen keine Sternchen -- sonst würden Grammatikprüfung,
    // Erwähnungssuche und Wortzählung sie mitlesen.
    expect(container.querySelector('.cm-content')).toHaveTextContent('Hallo Welt');
  });

  it('setzt Fett und Kursiv per Tastenkürzel und nimmt sie damit auch wieder weg', () => {
    const { editor, onChange } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    // jsdom kennt keinen Mac, dort ist CodeMirrors "Mod" also Strg -- im Programm ⌘.
    fireEvent.keyDown(editor.contentDOM, { key: 'b', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('Hallo Welt', [], [{ from: 6, to: 10, kind: 'bold' }]);
    fireEvent.keyDown(editor.contentDOM, { key: 'i', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('Hallo Welt', [], [{ from: 6, to: 10, kind: 'bold' }, { from: 6, to: 10, kind: 'italic' }]);
    fireEvent.keyDown(editor.contentDOM, { key: 'b', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('Hallo Welt', [], [{ from: 6, to: 10, kind: 'italic' }]);
  });

  it('nimmt eine Auszeichnung mit, wenn davor geschrieben wird', () => {
    // Der Bereich hängt am Text, nicht an der Zeichenposition: was vorne dazukommt,
    // schiebt ihn nach hinten, statt ihn liegenzulassen.
    const { editor, onChange } = renderEditor({ marks: [{ from: 6, to: 10, kind: 'italic' }] });
    editor.dispatch({ changes: { from: 0, insert: 'Ach, ' }, userEvent: 'input' });
    expect(onChange).toHaveBeenLastCalledWith('Ach, Hallo Welt', [], [{ from: 11, to: 15, kind: 'italic' }]);
  });

  it('hält die gemerkte Textstelle sichtbar, während der Fokus woanders ist', () => {
    // Ohne diese Markierung sieht der Text unmarkiert aus, sobald man in die
    // Schreibhilfe greift -- der Browser zeichnet ::selection nur mit Fokus.
    const { container } = renderEditor({ held: { from: 6, to: 10 } });
    const held = container.querySelector('.held-selection');
    expect(held).not.toBeNull();
    expect(held).toHaveTextContent('Welt');
  });
});
