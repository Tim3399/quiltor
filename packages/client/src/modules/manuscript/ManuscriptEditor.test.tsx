import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "./ManuscriptEditor";
import { requireValue } from "./TextWorkspace.testSupport";

// jsdom has no layout, so the two calls that ask the browser where something is on
// screen answer with nothing and the editor would report no selection at all.
beforeEach(() => {
  vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
    left: 0,
    right: 40,
    top: 0,
    bottom: 16,
  });
  vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(7);
});

function renderEditor(props: Partial<React.ComponentProps<typeof ManuscriptEditor>> = {}) {
  const onSelection = vi.fn(),
    onSelectionMenu = vi.fn(),
    onChange = vi.fn();
  const handle =
    createRef<ManuscriptEditorHandle>() as React.MutableRefObject<ManuscriptEditorHandle | null>;
  const view = render(
    <ManuscriptEditor
      value="Hallo Welt"
      label="Kapiteltext"
      placeholder=""
      vocabulary={[]}
      editorRef={handle}
      onChange={onChange}
      onSelection={onSelection}
      onSelectionMenu={onSelectionMenu}
      {...props}
    />,
  );
  const editorRoot = requireValue(
    view.container.querySelector<HTMLElement>(".cm-editor"),
    "CodeMirror root missing",
  );
  const editor = requireValue(EditorView.findFromDOM(editorRoot), "CodeMirror view missing");
  return { ...view, editor, handle, onSelection, onSelectionMenu, onChange };
}

const tarek = { id: "t", x: 0, y: 0, type: "person" as const, name: "Tarek", sub: "Bäcker" };

describe("ManuscriptEditor selection", () => {
  it("meldet eine Markierung, ohne dafür das Aktionsmenü zu öffnen", async () => {
    // The report is the information "this is selected". The menu with dictionary,
    // synonyms and translation is the writer's own decision and must not spring open on a
    // double click already.
    const { editor, onSelection, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith(
        expect.objectContaining({ from: 6, to: 10, text: "Welt" }),
      ),
    );
    expect(onSelectionMenu).not.toHaveBeenCalled();
  });

  it("öffnet das Aktionsmenü beim Rechtsklick", async () => {
    const { editor, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    fireEvent.contextMenu(editor.contentDOM);
    await waitFor(() =>
      expect(onSelectionMenu).toHaveBeenCalledWith(expect.objectContaining({ text: "Welt" })),
    );
  });

  it("öffnet das Aktionsmenü auch per Tastatur mit Umschalt+F10", async () => {
    const { editor, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    fireEvent.keyDown(editor.contentDOM, { key: "F10", shiftKey: true });
    await waitFor(() =>
      expect(onSelectionMenu).toHaveBeenCalledWith(expect.objectContaining({ text: "Welt" })),
    );
  });

  it("meldet das Ende der Markierung, wenn der Cursor nur noch steht", async () => {
    const { editor, onSelection } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ text: "Welt" })),
    );
    editor.dispatch({ selection: EditorSelection.cursor(3) });
    await waitFor(() => expect(onSelection).toHaveBeenLastCalledWith(null));
  });

  it("zeichnet Fett und Kursiv als Bereiche über dem Text", () => {
    const { container } = renderEditor({
      marks: [
        { from: 0, to: 5, kind: "bold" },
        { from: 6, to: 10, kind: "italic" },
      ],
    });
    expect(container.querySelector(".text-bold")).toHaveTextContent("Hallo");
    expect(container.querySelector(".text-italic")).toHaveTextContent("Welt");
    // There are no asterisks in the text itself -- grammar checking, mention search and
    // word counting would otherwise read them along with it.
    expect(container.querySelector(".cm-content")).toHaveTextContent("Hallo Welt");
  });

  it("setzt Fett und Kursiv per Tastenkürzel und nimmt sie damit auch wieder weg", () => {
    const { editor, onChange } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    // jsdom knows no Mac, so CodeMirror's "Mod" is Ctrl there -- in the product it is ⌘.
    fireEvent.keyDown(editor.contentDOM, { key: "b", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(
      "Hallo Welt",
      [],
      [{ from: 6, to: 10, kind: "bold" }],
    );
    fireEvent.keyDown(editor.contentDOM, { key: "i", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(
      "Hallo Welt",
      [],
      [
        { from: 6, to: 10, kind: "bold" },
        { from: 6, to: 10, kind: "italic" },
      ],
    );
    fireEvent.keyDown(editor.contentDOM, { key: "b", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(
      "Hallo Welt",
      [],
      [{ from: 6, to: 10, kind: "italic" }],
    );
  });

  it("nimmt eine Auszeichnung mit, wenn davor geschrieben wird", () => {
    // The range hangs on the text, not on the character position: what is added in front
    // pushes it back rather than leaving it where it was.
    const { editor, onChange } = renderEditor({ marks: [{ from: 6, to: 10, kind: "italic" }] });
    editor.dispatch({ changes: { from: 0, insert: "Ach, " }, userEvent: "input" });
    expect(onChange).toHaveBeenLastCalledWith(
      "Ach, Hallo Welt",
      [],
      [{ from: 11, to: 15, kind: "italic" }],
    );
  });

  it("schlägt eine Figur auch bei einem Vertipper vor und trennt Name und Beschreibung mit Abstand", async () => {
    const { container, editor } = renderEditor({ value: "", entities: [tarek] });
    editor.dispatch({ changes: { from: 0, insert: "Tarke" }, selection: { anchor: 5 } });
    await waitFor(() => expect(container.querySelector(".word-completion")).not.toBeNull());
    const hint = requireValue(
      container.querySelector(".word-completion span"),
      "Completion hint missing",
    );
    expect(hint).toHaveTextContent("Tarek");
    // No space in the markup: the gap comes from .completion-detail.
    expect(hint.querySelector(".completion-detail")).toHaveTextContent("Bäcker");
  });

  it("ersetzt den Vertipper mit Tab und merkt sich die Erwähnung", async () => {
    const { editor, onChange } = renderEditor({ value: "", entities: [tarek] });
    editor.dispatch({ changes: { from: 0, insert: "Tarke" }, selection: { anchor: 5 } });
    fireEvent.keyDown(editor.contentDOM, { key: "Tab" });
    expect(editor.state.doc.toString()).toBe("Tarek");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "Tarek",
        [expect.objectContaining({ elementId: "t", surface: "Tarek", from: 0, to: 5 })],
        [],
      ),
    );
  });

  it.each(["Serafine", "Seraphine", "Serapgi"])(
    "übernimmt die tolerante Schreibweise %s als kanonische Figuren-Erwähnung",
    async (typed) => {
      const seraphine = {
        ...tarek,
        id: "figure-seraphine",
        name: "Séraphine",
        sub: "Heilerin",
      };
      const before = `🙂 ${typed}`;
      const { container, editor, onChange } = renderEditor({ value: "", entities: [seraphine] });

      editor.dispatch({
        changes: { from: 0, insert: before },
        selection: { anchor: before.length },
      });

      await waitFor(() =>
        expect(container.querySelector(".word-completion")).toHaveTextContent(
          "TabSéraphineHeilerin",
        ),
      );
      fireEvent.keyDown(editor.contentDOM, { key: "Tab" });

      expect(editor.state.doc.toString()).toBe("🙂 Séraphine");
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith(
          "🙂 Séraphine",
          [
            expect.objectContaining({
              elementId: "figure-seraphine",
              surface: "Séraphine",
              source: "completion",
              // CodeMirror and the persisted contract count UTF-16 code units: the emoji uses two.
              from: 3,
              to: 12,
            }),
          ],
          [],
        ),
      );
    },
  );

  it("lässt ein richtig geschriebenes Wort in Ruhe", async () => {
    const { container, editor } = renderEditor({ value: "", entities: [tarek] });
    editor.dispatch({ changes: { from: 0, insert: "Fenster" }, selection: { anchor: 7 } });
    await waitFor(() => expect(editor.state.doc.toString()).toBe("Fenster"));
    expect(container.querySelector(".word-completion")).toBeNull();
  });

  it("hält die gemerkte Textstelle sichtbar, während der Fokus woanders ist", () => {
    // Without this mark the text looks unselected as soon as someone reaches into the
    // writing aid -- the browser draws ::selection only while focused.
    const { container } = renderEditor({ held: { from: 6, to: 10 } });
    const held = container.querySelector(".held-selection");
    expect(held).not.toBeNull();
    expect(held).toHaveTextContent("Welt");
  });

  it("markiert alle Suchtreffer und hebt den aktiven Treffer hervor", () => {
    const { container, editor, handle } = renderEditor({
      value: "Welt neben Welt",
      searchMatches: [
        { from: 0, to: 4 },
        { from: 11, to: 15 },
      ],
      activeSearchMatch: { from: 11, to: 15 },
    });
    const matches = container.querySelectorAll(".text-search-match");
    expect(matches).toHaveLength(2);
    expect(container.querySelector(".text-search-match.is-active")).toHaveTextContent("Welt");

    handle.current?.reveal(11, 15);
    expect(editor.state.selection.main.empty).toBe(true);
    expect(editor.state.selection.main.head).toBe(11);
  });
});
