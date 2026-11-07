import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manuscript } from "./model";
import { TextWorkspace } from "./TextWorkspace";
import { figures, historyApi, requireValue, TestProviders } from "./TextWorkspace.testSupport";

// T-180: while the chapter's version panel is open, the chapter note in the inspector must not
// accept typing that is then thrown away. Either the note is saved, or it is visibly read-only.

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
  it.fails("never shows a typed chapter note that is not stored", async () => {
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
