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
    onViewSelectionChange = vi.fn(),
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
      onViewSelectionChange={onViewSelectionChange}
      {...props}
    />,
  );
  const editorRoot = requireValue(
    view.container.querySelector<HTMLElement>(".cm-editor"),
    "CodeMirror root missing",
  );
  const editor = requireValue(EditorView.findFromDOM(editorRoot), "CodeMirror view missing");
  return {
    ...view,
    editor,
    handle,
    onSelection,
    onSelectionMenu,
    onViewSelectionChange,
    onChange,
  };
}

const tarek = { id: "t", x: 0, y: 0, type: "person" as const, name: "Tarek", sub: "Bäcker" };

describe("ManuscriptEditor selection", () => {
  it("selects only the historical document by shortcut and lets Tab move focus", () => {
    const { editor, onChange } = renderEditor({ readOnly: true });
    fireEvent.keyDown(editor.contentDOM, { key: "a", ctrlKey: true });
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(10);
    expect(fireEvent.keyDown(editor.contentDOM, { key: "Tab" })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves CRLF offsets for snapshot marks and diff ranges", () => {
    const { container, editor } = renderEditor({
      value: "Erste\r\nZweite neu",
      readOnly: true,
      marks: [{ from: 7, to: 13, kind: "bold" }],
      versionDiff: {
        changes: [{ kind: "added", from: 14, to: 17, text: "neu" }],
        equalSpans: [],
        formattingChanges: [],
      },
    });
    expect(editor.state.doc.toString()).toBe("Erste\r\nZweite neu");
    expect(container.querySelector(".text-bold")).toHaveTextContent("Zweite");
    expect(container.querySelector(".version-diff-added")).toHaveTextContent("neu");
  });

  it("blocks every editor mutation path while preserving the live selection across a same-text version", () => {
    const onSelection = vi.fn();
    const onChange = vi.fn();
    const handle =
      createRef<ManuscriptEditorHandle>() as React.MutableRefObject<ManuscriptEditorHandle | null>;
    const props = {
      value: "Hallo Welt",
      label: "Kapiteltext",
      placeholder: "",
      vocabulary: [] as string[],
      editorRef: handle,
      onChange,
      onSelection,
    };
    const rendered = render(<ManuscriptEditor {...props} />);
    const editorRoot = requireValue(
      rendered.container.querySelector<HTMLElement>(".cm-editor"),
      "CodeMirror root missing",
    );
    const editor = requireValue(EditorView.findFromDOM(editorRoot), "CodeMirror view missing");
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    editor.scrollDOM.scrollTop = 37;

    rendered.rerender(
      <ManuscriptEditor
        {...props}
        readOnly
        marks={[{ from: 0, to: 5, kind: "bold" }]}
        versionDiff={{
          changes: [],
          equalSpans: [{ previousFrom: 0, previousTo: 11, selectedFrom: 0, selectedTo: 11 }],
          formattingChanges: [{ kind: "format-added", markKind: "bold", from: 0, to: 5 }],
        }}
      />,
    );
    expect(editor.contentDOM).toHaveAttribute("aria-readonly", "true");
    editor.dispatch({ selection: EditorSelection.range(0, 5) });
    editor.dispatch({ changes: { from: 0, insert: "Nein " }, userEvent: "input" });
    handle.current?.insert("Nein");
    handle.current?.insertEntity(tarek);
    handle.current?.cut(0, 5);
    expect(handle.current?.replaceSelection(0, 5, "Hallo", "Nein")).toBe(false);
    expect(handle.current?.toggleMark("italic", { from: 0, to: 5 })).toBe(false);
    expect(editor.state.doc.toString()).toBe("Hallo Welt");
    expect(onChange).not.toHaveBeenCalled();
    expect(rendered.container.querySelector(".text-bold")).toHaveTextContent("Hallo");
    expect(rendered.container.querySelector(".version-diff-format-added")).toHaveTextContent(
      "Hallo",
    );

    rendered.rerender(<ManuscriptEditor {...props} />);
    expect(editor.contentDOM).not.toHaveAttribute("aria-readonly", "true");
    expect(editor.state.selection.main.from).toBe(6);
    expect(editor.state.selection.main.to).toBe(10);
    expect(editor.scrollDOM.scrollTop).toBe(37);
    expect(rendered.container.querySelector(".version-diff-format-added")).toBeNull();
  });

  it("keeps historical selection and snapshot loads out of the live session", () => {
    const rendered = renderEditor({ initialSelection: { anchor: 8, head: 2 } });
    rendered.editor.scrollDOM.scrollTop = 37;
    rendered.onViewSelectionChange.mockClear();

    rendered.rerender(
      <ManuscriptEditor
        value="Früher"
        readOnly
        label="Kapiteltext"
        placeholder=""
        vocabulary={[]}
        editorRef={rendered.handle}
        onChange={rendered.onChange}
        onSelection={rendered.onSelection}
        onViewSelectionChange={rendered.onViewSelectionChange}
      />,
    );
    expect(rendered.editor.state.doc.toString()).toBe("Früher");
    rendered.editor.dispatch({ selection: EditorSelection.cursor(1) });

    rendered.rerender(
      <ManuscriptEditor
        value="Noch älter"
        readOnly
        label="Kapiteltext"
        placeholder=""
        vocabulary={[]}
        editorRef={rendered.handle}
        onChange={rendered.onChange}
        onSelection={rendered.onSelection}
        onViewSelectionChange={rendered.onViewSelectionChange}
      />,
    );
    expect(rendered.editor.state.doc.toString()).toBe("Noch älter");
    expect(rendered.onViewSelectionChange).not.toHaveBeenCalled();
    expect(rendered.onChange).not.toHaveBeenCalled();

    rendered.rerender(
      <ManuscriptEditor
        value="Hallo Welt"
        label="Kapiteltext"
        placeholder=""
        vocabulary={[]}
        editorRef={rendered.handle}
        onChange={rendered.onChange}
        onSelection={rendered.onSelection}
        onViewSelectionChange={rendered.onViewSelectionChange}
      />,
    );
    expect(rendered.editor.state.doc.toString()).toBe("Hallo Welt");
    expect(rendered.editor.state.selection.main).toMatchObject({ anchor: 8, head: 2 });
    expect(rendered.editor.scrollDOM.scrollTop).toBe(37);
    expect(rendered.onViewSelectionChange).toHaveBeenCalledTimes(1);
    expect(rendered.onViewSelectionChange).toHaveBeenLastCalledWith({ anchor: 8, head: 2 });
  });

  it("captures and restores the cursor position and focus", () => {
    const { editor, handle } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    editor.focus();
    const position = handle.current?.getPosition();
    expect(position).toEqual({ anchor: 6, head: 10, focused: true });

    editor.dispatch({ selection: EditorSelection.cursor(0) });
    handle.current?.restorePosition(requireValue(position));
    expect(editor.state.selection.main).toMatchObject({ anchor: 6, head: 10 });
    expect(editor.hasFocus).toBe(true);
  });

  it("creates the editor with its initial cursor and reports it", () => {
    const { editor, onSelection, onViewSelectionChange } = renderEditor({
      initialSelection: { anchor: 3, head: 3 },
    });

    expect(editor.state.selection.main).toMatchObject({ anchor: 3, head: 3 });
    expect(onViewSelectionChange).toHaveBeenCalledWith({ anchor: 3, head: 3 });
    expect(onSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["forward", { anchor: 2, head: 8 }],
    ["backward", { anchor: 8, head: 2 }],
  ])("preserves an initial %s selection", (_direction, initialSelection) => {
    const { editor, onViewSelectionChange } = renderEditor({ initialSelection });

    expect(editor.state.selection.main).toMatchObject(initialSelection);
    expect(onViewSelectionChange).toHaveBeenCalledWith(initialSelection);
  });

  it.each([
    [
      { anchor: -4, head: 40 },
      { anchor: 0, head: 10 },
    ],
    [
      { anchor: 40, head: -4 },
      { anchor: 10, head: 0 },
    ],
  ])("clamps the initial selection to the document", (initialSelection, expected) => {
    const { editor, onViewSelectionChange } = renderEditor({ initialSelection });

    expect(editor.state.selection.main).toMatchObject(expected);
    expect(onViewSelectionChange).toHaveBeenCalledWith(expected);
  });

  it("reports a selection without opening the action menu for it", async () => {
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

  it("opens the action menu on right click", async () => {
    const { editor, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    fireEvent.contextMenu(editor.contentDOM);
    await waitFor(() =>
      expect(onSelectionMenu).toHaveBeenCalledWith(expect.objectContaining({ text: "Welt" })),
    );
  });

  it("opens the action menu from the keyboard with Shift+F10 too", async () => {
    const { editor, onSelectionMenu } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    fireEvent.keyDown(editor.contentDOM, { key: "F10", shiftKey: true });
    await waitFor(() =>
      expect(onSelectionMenu).toHaveBeenCalledWith(expect.objectContaining({ text: "Welt" })),
    );
  });

  it("reports the end of the selection when the cursor merely stands", async () => {
    const { editor, onSelection, onViewSelectionChange } = renderEditor();
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ text: "Welt" })),
    );
    editor.dispatch({ selection: EditorSelection.cursor(3) });
    await waitFor(() => expect(onSelection).toHaveBeenLastCalledWith(null));
    expect(onViewSelectionChange).toHaveBeenLastCalledWith({ anchor: 3, head: 3 });
  });

  it("reports the selection produced by typing", () => {
    const { editor, onViewSelectionChange } = renderEditor({
      initialSelection: { anchor: 5, head: 5 },
    });

    editor.dispatch({
      changes: { from: 5, insert: "!" },
      selection: EditorSelection.cursor(6),
      userEvent: "input",
    });

    expect(onViewSelectionChange).toHaveBeenLastCalledWith({ anchor: 6, head: 6 });
  });

  it("reports a document change even when it does not set the selection", () => {
    const { editor, onViewSelectionChange } = renderEditor({
      initialSelection: { anchor: 5, head: 5 },
    });
    const reportsBeforeChange = onViewSelectionChange.mock.calls.length;

    editor.dispatch({ changes: { from: 10, insert: "!" }, userEvent: "input" });

    expect(onViewSelectionChange).toHaveBeenCalledTimes(reportsBeforeChange + 1);
    expect(onViewSelectionChange).toHaveBeenLastCalledWith({ anchor: 5, head: 5 });
  });

  it("keeps a bounded selection when an external document update shortens the text", () => {
    const rendered = renderEditor({
      initialSelection: { anchor: 8, head: 1 },
    });

    rendered.rerender(
      <ManuscriptEditor
        value="Kurz"
        label="Kapiteltext"
        placeholder=""
        vocabulary={[]}
        editorRef={rendered.handle}
        onChange={rendered.onChange}
        onSelection={rendered.onSelection}
        onViewSelectionChange={rendered.onViewSelectionChange}
      />,
    );

    expect(rendered.editor.state.selection.main).toMatchObject({ anchor: 4, head: 1 });
    expect(rendered.onViewSelectionChange).toHaveBeenLastCalledWith({ anchor: 4, head: 1 });
  });

  it("uses the latest view-selection callback without recreating the editor", () => {
    const first = vi.fn();
    const second = vi.fn();
    const rendered = renderEditor({ onViewSelectionChange: first });
    const originalEditor = rendered.editor;

    rendered.rerender(
      <ManuscriptEditor
        value="Hallo Welt"
        label="Kapiteltext"
        placeholder=""
        vocabulary={[]}
        editorRef={rendered.handle}
        onChange={rendered.onChange}
        onSelection={rendered.onSelection}
        onViewSelectionChange={second}
      />,
    );
    originalEditor.dispatch({ selection: EditorSelection.cursor(7) });

    expect(EditorView.findFromDOM(originalEditor.dom)).toBe(originalEditor);
    expect(second).toHaveBeenLastCalledWith({ anchor: 7, head: 7 });
  });

  it("cancels an after-measure callback before it schedules follow-up work", () => {
    const { editor, handle } = renderEditor();
    const requestMeasure = vi.spyOn(editor, "requestMeasure").mockImplementation(() => {});
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const callback = vi.fn();
    try {
      const cancel = requireValue(handle.current?.afterMeasure?.(callback));
      const request = requireValue(requestMeasure.mock.calls[0]?.[0]);
      cancel();
      request.write?.(request.read(editor), editor);

      expect(requestFrame).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      requestMeasure.mockRestore();
      requestFrame.mockRestore();
    }
  });

  it("draws bold and italic as ranges over the text", () => {
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

  it("sets bold and italic by shortcut and takes them away again with it", () => {
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

  it("carries a mark along when text is written before it", () => {
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

  it("suggests a figure even on a typo and separates name and description with space", async () => {
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

  it("replaces the typo with Tab and remembers the mention", async () => {
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
    "resolves the approximate spelling %s to a canonical character mention",
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

  it("leaves a correctly spelled word alone", async () => {
    const { container, editor } = renderEditor({ value: "", entities: [tarek] });
    editor.dispatch({ changes: { from: 0, insert: "Fenster" }, selection: { anchor: 7 } });
    await waitFor(() => expect(editor.state.doc.toString()).toBe("Fenster"));
    expect(container.querySelector(".word-completion")).toBeNull();
  });

  it("keeps the remembered passage visible while focus is elsewhere", () => {
    // Without this mark the text looks unselected as soon as someone reaches into the
    // writing aid -- the browser draws ::selection only while focused.
    const { container } = renderEditor({ held: { from: 6, to: 10 } });
    const held = container.querySelector(".held-selection");
    expect(held).not.toBeNull();
    expect(held).toHaveTextContent("Welt");
  });

  it("marks every search hit and highlights the active one", () => {
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
