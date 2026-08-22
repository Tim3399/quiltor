import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextWorkspace } from "./TextWorkspace";
import type { Manuscript } from "./model";
import { figures, manuscript, renderWorkspace, TestProviders } from "./TextWorkspace.testSupport";

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
    const binder = within(view.container.querySelector(".binder")!);
    fireEvent.change(binder.getByLabelText("Kapitelnotiz"), {
      target: { value: "Die Unruhe nur andeuten." },
    });
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
    const status = within(view.container.querySelector(".context-bar")!);
    expect(status.getByText("Wörter").nextSibling).toHaveTextContent("2");
    expect(status.getByText("Zeichen").nextSibling).toHaveTextContent("10");
    expect(status.getByText("Normseiten").nextSibling).toHaveTextContent("0,0");
    const editor = view.container.querySelector(".cm-content") as HTMLElement;
    editor.textContent = "Ein Satz mehr im Kapitel";
    fireEvent.input(editor, { inputType: "insertText", data: "Ein Satz mehr im Kapitel" });
    await waitFor(() => expect(status.getByText("Zeichen").nextSibling).toHaveTextContent("24"));
    expect(status.getByText("Wörter").nextSibling).toHaveTextContent("5");
  });

  it("zeigt Kapitelbefehle dauerhaft oben im linken Kapitelreiter", () => {
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
    const binder = within(view.container.querySelector(".binder")!);
    const actions = within(binder.getByRole("group", { name: "Kapitelaktionen: Prolog" }));
    expect(actions.getByRole("button", { name: "Nach oben" })).toBeDisabled();
    expect(actions.getByRole("button", { name: "Kapitel als Markdown" })).toBeVisible();
    expect(actions.getByRole("button", { name: "Kapitel löschen" })).toBeVisible();
    fireEvent.click(actions.getByRole("button", { name: "Nach unten" }));
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
    const binder = within(view.container.querySelector(".binder")!);
    const actions = within(binder.getByRole("group", { name: "Kapitelaktionen: Prolog" }));
    fireEvent.click(actions.getByRole("button", { name: "Kapitel löschen" }));
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
    const binder = within(view.container.querySelector(".binder")!);
    fireEvent.click(binder.getByRole("button", { name: /Rückblende/ }));
    fireEvent.click(binder.getByText("Handlungszeit").closest("summary")!);
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
