import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manuscript } from "./model";
import { TextWorkspace } from "./TextWorkspace";
import { figures, historyApi, requireValue, TestProviders } from "./TextWorkspace.testSupport";

// T-180: while the chapter's version panel is open, the chapter note in the inspector stays
// editable and is saved: nothing the author types may be shown without being stored.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const start: Manuscript = {
  chapters: [{ id: "c1", title: "Prolog", body: "Hallo Welt", note: "" }],
} as Manuscript;

function Harness({ onStored }: { onStored: (value: Manuscript) => void }) {
  const [value, setValue] = useState<Manuscript>(start);
  return (
    <TextWorkspace
      manuscript={value}
      figures={figures}
      onChange={(next: Manuscript) => {
        onStored(next);
        setValue(next);
      }}
      focus={false}
      onFocus={vi.fn()}
      inspectorOpen
      onInspectorOpen={vi.fn()}
    />
  );
}

function noteView(container: HTMLElement) {
  const owner = requireValue(
    container.querySelector<HTMLElement>('[data-note-owner="chapter:c1"] .cm-editor'),
    "chapter note editor missing",
  );
  return requireValue(EditorView.findFromDOM(owner), "chapter note view missing");
}

describe("chapter note while the version panel is open (T-180)", () => {
  it("never shows a typed chapter note that is not stored", async () => {
    vi.spyOn(historyApi, "log").mockResolvedValue({ ok: true, commits: [] });
    let stored: Manuscript = start;
    const view = render(
      <TestProviders>
        <Harness onStored={(next) => (stored = next)} />
      </TestProviders>,
    );
    const toolbar = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Versionen" }));
    await waitFor(() => expect(historyApi.log).toHaveBeenCalled());

    const note = noteView(view.container);
    const readOnly = note.contentDOM.getAttribute("aria-readonly") === "true";
    act(() => {
      note.dispatch({ changes: { from: 0, insert: "Wichtig" }, userEvent: "input" });
    });

    const shown = note.state.doc.toString();
    const kept = stored.chapters[0].note ?? "";
    // Locked is acceptable only if the lock is visible and nothing was typed.
    if (readOnly) expect(shown).toBe("");
    // Whatever the author sees in the note must be what is stored.
    expect(shown).toBe(kept);
  });
});

describe("chapter note typed while versions are open survives a chapter switch (T-180)", () => {
  it("still shows the note after closing versions and coming back to the chapter", async () => {
    vi.spyOn(historyApi, "log").mockResolvedValue({ ok: true, commits: [] });
    const twoChapters = {
      chapters: [
        { id: "c1", title: "Prolog", body: "Hallo Welt", note: "" },
        { id: "c2", title: "Hafen", body: "Nebel.", note: "" },
      ],
    } as Manuscript;
    function TwoChapters() {
      const [value, setValue] = useState<Manuscript>(twoChapters);
      const [currentId, setCurrentId] = useState("c1");
      return (
        <>
          <button type="button" onClick={() => setCurrentId(currentId === "c1" ? "c2" : "c1")}>
            Testwechsel
          </button>
          <TextWorkspace
            manuscript={value}
            figures={figures}
            onChange={setValue}
            focus={false}
            onFocus={vi.fn()}
            inspectorOpen
            onInspectorOpen={vi.fn()}
            currentChapterId={currentId}
            onCurrentChapterId={vi.fn()}
          />
        </>
      );
    }
    const view = render(
      <TestProviders>
        <TwoChapters />
      </TestProviders>,
    );
    const toolbar = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Versionen" }));
    await waitFor(() => expect(historyApi.log).toHaveBeenCalled());
    act(() => {
      noteView(view.container).dispatch({
        changes: { from: 0, insert: "Wichtig" },
        userEvent: "input",
      });
    });
    fireEvent.click(
      within(view.container).getByRole("button", { name: "Kapitelversionen schließen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Testwechsel" }));
    fireEvent.click(screen.getByRole("button", { name: "Testwechsel" }));
    expect(noteView(view.container).state.doc.toString()).toBe("Wichtig");
  });
});

describe("undo in the chapter note while versions are open (T-180, T-177)", () => {
  it("never reaches any history", async () => {
    vi.spyOn(historyApi, "log").mockResolvedValue({ ok: true, commits: [] });
    const view = render(
      <TestProviders>
        <Harness onStored={() => undefined} />
      </TestProviders>,
    );
    const toolbar = within(within(view.container).getByRole("toolbar", { name: "Manuskript" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Versionen" }));
    await waitFor(() => expect(historyApi.log).toHaveBeenCalled());
    const undo = vi.fn();
    window.addEventListener("keydown", undo);

    fireEvent.keyDown(noteView(view.container).contentDOM, { key: "z", ctrlKey: true });

    window.removeEventListener("keydown", undo);
    expect(undo).not.toHaveBeenCalled();
  });
});
