import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    container.querySelector<HTMLElement>(".cm-editor"),
    "CodeMirror root missing",
  );
  return requireValue(EditorView.findFromDOM(root), "CodeMirror view missing");
}

const originalClipboard = navigator.clipboard;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: originalClipboard,
    configurable: true,
  });
});

describe("TextWorkspace editor, search and versions", () => {
  it("ändert Text ohne die übrige Manuskriptstruktur zu verlieren", async () => {
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

  it("öffnet die Fassungen des ausgewählten Kapitels direkt aus der Kontextleiste", async () => {
    vi.spyOn(historyApi, "log").mockResolvedValue({ ok: true, commits: [] });
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const context = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    const versions = context.getByRole("button", { name: "Fassungen" });
    expect(versions).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(versions);
    expect(versions).toHaveAttribute("aria-pressed", "true");
    expect(within(view.container).getByRole("complementary", { name: "Fassungen" })).toBeVisible();
    await waitFor(() => expect(historyApi.log).toHaveBeenCalled());
  });

  it("markiert einen Suchtreffer und rotiert kapitelübergreifend weiter", async () => {
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

  it("setzt in der Buchfassung Auszeichnungen als <strong> und <em>", () => {
    const formatted = {
      chapters: [
        {
          id: "c1",
          title: "Prolog",
          body: "Hallo Welt\n\n*\n\nZweiter Absatz",
          note: "",
          marks: [
            { from: 6, to: 10, kind: "italic" as const },
            { from: 15, to: 22, kind: "bold" as const },
          ],
        },
      ],
    };
    const view = renderWorkspace({
      manuscript: formatted,
      figures,
      onChange: vi.fn(),
      focus: false,
      onFocus: vi.fn(),
    });
    const book = requireValue(
      view.container.querySelector(".print-document"),
      "Print document missing",
    );
    expect(book.querySelector("em")).toHaveTextContent("Welt");
    expect(book.querySelector("strong")).toHaveTextContent("Zweiter");
    expect(book.querySelector(".scene-break")).toHaveTextContent("⁂");
    expect(book.querySelectorAll(".book-chapter p")[0]).toHaveTextContent("Hallo Welt");
  });

  it("bietet im Auswahlmenü Ausschneiden, Kopieren, Fett und Kursiv an", async () => {
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

  it("meldet es, wenn die Zwischenablage den Text ablehnt", async () => {
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
