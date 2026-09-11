import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  figures,
  historyApi,
  manuscript,
  renderWorkspace,
  requireValue,
} from "./TextWorkspace.testSupport";

function codeMirrorView(container: HTMLElement) {
  const root = requireValue(
    container.querySelector<HTMLElement>(".prose-editor .cm-editor"),
    "CodeMirror root missing",
  );
  return requireValue(EditorView.findFromDOM(root), "CodeMirror view missing");
}

const originalClipboard = navigator.clipboard;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: originalClipboard,
    configurable: true,
  });
});

describe("TextWorkspace editor, search and versions", () => {
  it("changes text without losing the rest of the manuscript structure", async () => {
    const onChange = vi.fn();
    renderWorkspace({ manuscript, figures, onChange, focus: false, onFocus: vi.fn() });
    const editor = screen.getByLabelText("Kapiteltext");
    editor.textContent = "Neuer Text";
    fireEvent.input(editor, { inputType: "insertText", data: "Neuer Text" });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          chapters: [expect.objectContaining({ id: "c1", body: "Neuer Text" })],
        }),
      ),
    );
  });

  it("opens versions and compares the selection with its immediate predecessor", async () => {
    vi.spyOn(historyApi, "log").mockResolvedValue({
      ok: true,
      commits: [
        {
          hash: "new",
          shortHash: "new",
          date: "2026-02-02",
          subject: "Neue Fassung",
        },
        {
          hash: "old",
          shortHash: "old",
          date: "2026-02-01",
          subject: "Alte Fassung",
        },
      ],
    });
    const chapterComparison = vi.spyOn(historyApi, "chapterComparison").mockResolvedValue({
      ok: true,
      selected: {
        available: true,
        exists: true,
        text: "Der neue Weg.",
        marks: [{ from: 9, to: 12, kind: "bold" }],
      },
      previous: {
        available: true,
        exists: true,
        text: "Der alte Weg.",
        marks: [{ from: 9, to: 12, kind: "italic" }],
      },
    });
    const onChange = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSessionStateChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      onSave,
      onSessionStateChange,
      focus: false,
      onFocus: vi.fn(),
    });
    const context = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    const versions = context.getByRole("button", { name: "Fassungen" });
    const editor = codeMirrorView(view.container);
    const editorScroll = requireValue(
      view.container.querySelector<HTMLElement>(".editor-scroll"),
      "Editor scroll area missing",
    );
    editorScroll.scrollTop = 83;
    editor.dispatch({ selection: EditorSelection.range(6, 10) });
    expect(onSessionStateChange).toHaveBeenLastCalledWith({
      chapterId: "c1",
      selection: { anchor: 6, head: 10 },
      scrollTop: 83,
    });
    onSessionStateChange.mockClear();
    expect(versions).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(versions);
    expect(versions).toHaveAttribute("aria-pressed", "true");
    expect(within(view.container).getByRole("complementary", { name: "Fassungen" })).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
    expect(editor.contentDOM).toHaveAttribute("aria-readonly", "true");
    expect(editor.state.doc.toString()).toBe("Hallo Welt");
    expect(within(view.container).getByLabelText("Kapiteltitel")).toBeDisabled();
    editor.dispatch({ changes: { from: 0, insert: "Verboten " }, userEvent: "input" });
    expect(editor.state.doc.toString()).toBe("Hallo Welt");
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(historyApi.log).toHaveBeenCalled());
    await waitFor(() => expect(chapterComparison).toHaveBeenCalledTimes(1));
    expect(chapterComparison).toHaveBeenCalledWith("new", "c1");
    await waitFor(() => expect(editor.state.doc.toString()).toBe("Der neue Weg."));
    expect(view.container.querySelector(".version-diff-added")).toHaveTextContent("neue");
    expect(view.container.querySelector(".version-diff-removed")).toHaveTextContent("alte");
    expect(view.container.querySelector(".text-bold")).toHaveTextContent("Weg");
    expect(view.container.querySelector(".version-diff-format-added")).toHaveTextContent("Weg");
    expect(view.container.querySelector(".version-diff-format-removed")).toHaveTextContent("Weg");
    const historyPanel = within(view.container).getByRole("complementary", { name: "Fassungen" });
    expect(within(historyPanel).queryByText("Der neue Weg.")).not.toBeInTheDocument();
    editor.dispatch({ selection: EditorSelection.range(0, 4) });
    editorScroll.scrollTop = 456;
    fireEvent.scroll(editorScroll);
    expect(onSessionStateChange).not.toHaveBeenCalled();

    const escapedUndo = vi.fn();
    window.addEventListener("keydown", escapedUndo);
    fireEvent.keyDown(historyPanel, { key: "z", ctrlKey: true });
    window.removeEventListener("keydown", escapedUndo);
    expect(escapedUndo).not.toHaveBeenCalled();

    fireEvent.click(
      within(view.container).getByRole("button", { name: "Kapitelfassungen schließen" }),
    );
    await waitFor(() => expect(editor.state.doc.toString()).toBe("Hallo Welt"));
    expect(editor.contentDOM).not.toHaveAttribute("aria-readonly", "true");
    expect(editor.state.selection.main.from).toBe(6);
    expect(editor.state.selection.main.to).toBe(10);
    await waitFor(() => expect(editorScroll.scrollTop).toBe(83));
    expect(onSessionStateChange).toHaveBeenLastCalledWith({
      chapterId: "c1",
      selection: { anchor: 6, head: 10 },
      scrollTop: 83,
    });
    expect(view.container.querySelector(".version-diff-added, .version-diff-removed")).toBeNull();
  });

  it("keeps the displayed snapshot stable while another version loads", async () => {
    vi.spyOn(historyApi, "log").mockResolvedValue({
      ok: true,
      commits: [
        { hash: "new", shortHash: "new", date: "2026-02-02", subject: "Neu" },
        { hash: "old", shortHash: "old", date: "2026-02-01", subject: "Alt" },
      ],
    });
    let resolveOld:
      | ((value: Awaited<ReturnType<typeof historyApi.chapterComparison>>) => void)
      | undefined;
    const oldResult = new Promise<Awaited<ReturnType<typeof historyApi.chapterComparison>>>(
      (resolve) => {
        resolveOld = resolve;
      },
    );
    const comparison = vi.spyOn(historyApi, "chapterComparison").mockImplementation((ref) =>
      ref === "new"
        ? Promise.resolve({
            ok: true,
            selected: { available: true, exists: true, text: "Neue Fassung", marks: [] },
            previous: { available: true, exists: true, text: "Davor", marks: [] },
          })
        : oldResult,
    );
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    fireEvent.click(within(view.container).getByRole("button", { name: "Fassungen" }));
    const editor = codeMirrorView(view.container);
    await waitFor(() => expect(editor.state.doc.toString()).toBe("Neue Fassung"));

    fireEvent.change(within(view.container).getByRole("combobox", { name: "Fassung" }), {
      target: { value: "old" },
    });
    await waitFor(() => expect(comparison).toHaveBeenCalledWith("old", "c1"));
    expect(editor.state.doc.toString()).toBe("Neue Fassung");
    await waitFor(() =>
      expect(view.container.querySelector(".version-diff-added, .version-diff-removed")).toBeNull(),
    );

    resolveOld?.({
      ok: true,
      selected: { available: true, exists: true, text: "Alte Fassung", marks: [] },
      previous: { available: false, exists: false, text: "", marks: [] },
    });
    await waitFor(() => expect(editor.state.doc.toString()).toBe("Alte Fassung"));
    expect(view.container.querySelector(".version-diff-added, .version-diff-removed")).toBeNull();
  });

  it("marks a search hit and rotates on across chapters", async () => {
    const searchable = {
      chapters: [
        { id: "c1", title: "Prolog", body: "Nebel hier. Nebel dort.", note: "" },
        { id: "c2", title: "Aufbruch", body: "Noch ein Nebel.", note: "" },
      ],
    };
    const view = renderWorkspace({
      manuscript: searchable,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
      targetId: "c2",
      textSearch: { query: "Nebel", from: 9, to: 14 },
    });
    const rendered = within(view.container);
    await waitFor(() => expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Aufbruch"));
    await waitFor(() =>
      expect(view.container.querySelector(".text-search-match.is-active")).toHaveTextContent(
        "Nebel",
      ),
    );
    expect(rendered.getByRole("status")).toHaveTextContent("3 von 3");
    fireEvent.click(rendered.getByRole("button", { name: "Nächster Treffer" }));
    await waitFor(() => expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Prolog"));
    expect(rendered.getByRole("status")).toHaveTextContent("1 von 3");
    fireEvent.click(rendered.getByRole("button", { name: "Vorheriger Treffer" }));
    await waitFor(() => expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Aufbruch"));
    expect(rendered.getByRole("status")).toHaveTextContent("3 von 3");
  });

  it("inserts an explicit scene break at the editor cursor", async () => {
    const onChange = vi.fn();
    renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Szenenwechsel einfügen" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          chapters: [expect.objectContaining({ body: "\n\n⁂\n\nHallo Welt" })],
        }),
      ),
    );
  });

  it("offers cut, copy, bold and italic in the selection menu", async () => {
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 40,
      top: 0,
      bottom: 16,
    });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const rendered = within(view.container);
    const editor = rendered.getByLabelText("Kapiteltext");
    codeMirrorView(view.container).dispatch({
      selection: EditorSelection.range(6, 10),
    });
    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Fett/ })).toBeTruthy());
    expect(screen.getByRole("menuitem", { name: /Kursiv/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Ausschneiden/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Kopieren/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Einfügen/ })).toBeNull();
  });

  it("reports it when the clipboard refuses the text", async () => {
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 40,
      top: 0,
      bottom: 16,
    });
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const editor = within(view.container).getByLabelText("Kapiteltext");
    codeMirrorView(view.container).dispatch({
      selection: EditorSelection.range(6, 10),
    });
    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Ausschneiden/ })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Ausschneiden/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Zwischenablage/));
    expect(writeText).toHaveBeenCalledWith("Welt");
  });
});
