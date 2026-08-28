import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Manuscript } from "./model";
import { TextWorkspace } from "./TextWorkspace";
import {
  figures,
  manuscript,
  renderWorkspace,
  requireValue,
  TestProviders,
} from "./TextWorkspace.testSupport";

function codeMirrorView(textbox: HTMLElement) {
  const root = textbox.closest<HTMLElement>(".cm-editor");
  if (!root) throw new Error("CodeMirror root missing");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

describe("TextWorkspace chapter binder", () => {
  it("speichert die Kapitelnotiz aus der linken Spalte", () => {
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    const binder = within(within(view.container).getByRole("complementary", { name: "Kapitel" }));
    const note = codeMirrorView(binder.getByLabelText("Kapitelnotiz"));
    act(() =>
      note.dispatch({
        changes: { from: 0, to: note.state.doc.length, insert: "Die Unruhe nur andeuten." },
        userEvent: "input",
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        chapters: [expect.objectContaining({ id: "c1", note: "Die Unruhe nur andeuten." })],
      }),
    );
  });

  it("zeigt Wörter, Zeichen und Normseiten in der Statuszeile", async () => {
    function Stateful() {
      const [value, setValue] = useState<Manuscript>(manuscript);
      return (
        <TextWorkspace
          manuscript={value}
          figures={figures}
          onChange={setValue}
          focus={false}
          onFocus={vi.fn()}
          viewportMode="wide"
          binderOpen
          inspectorOpen
        />
      );
    }
    const view = render(
      <TestProviders>
        <Stateful />
      </TestProviders>,
    );
    const status = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    expect(status.getByText("Wörter").nextSibling).toHaveTextContent("2");
    expect(status.getByText("Zeichen").nextSibling).toHaveTextContent("10");
    expect(status.getByText("Normseiten").nextSibling).toHaveTextContent("0,0");
    const editor = codeMirrorView(within(view.container).getByLabelText("Kapiteltext"));
    act(() =>
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: "Ein Satz mehr im Kapitel" },
        userEvent: "input",
      }),
    );
    await waitFor(() => expect(status.getByText("Zeichen").nextSibling).toHaveTextContent("24"));
    expect(status.getByText("Wörter").nextSibling).toHaveTextContent("5");
  });

  it("bietet Kapitelbefehle im Kontextmenü der aktiven Kapitelzeile an", async () => {
    const twoChapters = {
      chapters: [
        ...manuscript.chapters,
        { id: "c2", title: "Aufbruch", body: "Der Weg beginnt.", note: "" },
      ],
    };
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript: twoChapters,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    const binder = within(within(view.container).getByRole("complementary", { name: "Kapitel" }));
    fireEvent.click(binder.getByRole("button", { name: "Kapitelaktionen: Prolog" }));
    const actions = within(await screen.findByRole("menu", { name: "Kapitelaktionen: Prolog" }));
    expect(actions.getByRole("menuitem", { name: "Nach oben" })).toBeDisabled();
    expect(actions.getByRole("menuitem", { name: "Kapitel als Markdown" })).toBeVisible();
    expect(actions.getByRole("menuitem", { name: "Kapitel löschen" })).toBeVisible();
    fireEvent.click(actions.getByRole("menuitem", { name: "Nach unten" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        chapters: [expect.objectContaining({ id: "c2" }), expect.objectContaining({ id: "c1" })],
      }),
    );
  });

  it("löscht ein Kapitel aus dem linken Reiter erst nach Bestätigung", async () => {
    const onChange = vi.fn();
    const view = renderWorkspace({
      manuscript,
      figures,
      onChange,
      focus: false,
      onFocus: vi.fn(),
      viewportMode: "wide",
      binderOpen: true,
      inspectorOpen: true,
    });
    const binder = within(within(view.container).getByRole("complementary", { name: "Kapitel" }));
    fireEvent.click(binder.getByRole("button", { name: "Kapitelaktionen: Prolog" }));
    const actions = within(await screen.findByRole("menu", { name: "Kapitelaktionen: Prolog" }));
    fireEvent.click(actions.getByRole("menuitem", { name: "Kapitel löschen" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Kapitel löschen" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chapters: [] }));
  });

  it("verankert eine Rückblende, ohne die Manuskriptreihenfolge zu verändern", () => {
    const onChange = vi.fn();
    const twoChapters: Manuscript = {
      chapters: [
        { id: "present", title: "Heimkehr", body: "Jetzt.", note: "" },
        { id: "flashback", title: "Rückblende", body: "Damals.", note: "" },
      ],
    };
    function Stateful() {
      const [value, setValue] = useState(twoChapters);
      return (
        <TextWorkspace
          manuscript={value}
          figures={{
            ...figures,
            timeline: [
              { id: "now", title: "Heimkehr", time: 10, position: 1 },
              { id: "past", title: "Früher", time: -20, position: 0 },
            ],
          }}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          focus={false}
          onFocus={vi.fn()}
          viewportMode="wide"
          binderOpen
          inspectorOpen
        />
      );
    }
    const view = render(
      <TestProviders>
        <Stateful />
      </TestProviders>,
    );
    const binder = within(within(view.container).getByRole("complementary", { name: "Kapitel" }));
    fireEvent.click(binder.getByRole("button", { name: /Rückblende/ }));
    fireEvent.click(
      requireValue(
        binder.getByText("Handlungszeit").closest("summary"),
        "Story-time summary missing",
      ),
    );
    fireEvent.click(binder.getByRole("radio", { name: "Zeitpunkt" }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chapters: [
          expect.objectContaining({ id: "present" }),
          expect.objectContaining({
            id: "flashback",
            storyTime: { startMomentId: "past" },
          }),
        ],
      }),
    );
  });
});
