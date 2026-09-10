import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TextWorkspace } from "./TextWorkspace";
import { figures, renderWorkspace, requireValue, TestProviders } from "./TextWorkspace.testSupport";
import type { ManuscriptEditorSessionState, TextWorkspaceProps } from "./workspaceTypes";

const manuscript = {
  chapters: [
    { id: "c1", title: "Prolog", body: "Der Morgen", note: "" },
    { id: "c2", title: "Am Hafen", body: "Hallo Welt am Hafen", note: "" },
  ],
};
const saved: ManuscriptEditorSessionState = {
  chapterId: "c2",
  selection: { anchor: 10, head: 6 },
  scrollTop: 321,
};
const defaults = { manuscript, figures, onChange: vi.fn(), focus: false, onFocus: vi.fn() };

function editor() {
  return requireValue(
    EditorView.findFromDOM(
      requireValue(screen.getByLabelText("Kapiteltext").closest(".cm-editor")),
    ),
  );
}

function ControlledWorkspace(props: Partial<TextWorkspaceProps>) {
  const [currentChapterId, setCurrentChapterId] = useState(props.currentChapterId ?? "c2");
  return (
    <TextWorkspace
      {...defaults}
      {...props}
      currentChapterId={currentChapterId}
      onCurrentChapterId={setCurrentChapterId}
    />
  );
}

describe("TextWorkspace session", () => {
  it("starts on the controlled chapter and keeps chapter navigation controlled", () => {
    render(
      <TestProviders>
        <ControlledWorkspace />
      </TestProviders>,
    );
    expect(screen.getByLabelText("Kapiteltitel")).toHaveValue("Am Hafen");
    fireEvent.click(screen.getByRole("button", { name: "Vorheriges Kapitel: Kapitel 1 · Prolog" }));
    expect(screen.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");
  });

  it("falls back to an existing chapter when the controlled chapter was deleted", () => {
    const onCurrentChapterId = vi.fn();
    renderWorkspace({
      ...defaults,
      currentChapterId: "deleted",
      onCurrentChapterId,
      sessionState: saved,
    });
    expect(screen.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");
    expect(onCurrentChapterId).toHaveBeenCalledWith("c1");
    expect(editor().state.selection.main.head).toBe(0);
  });

  it("restores a reversed selection, scroll and focus and continuously captures changes", async () => {
    const onSessionStateChange = vi.fn();
    const view = renderWorkspace({ ...defaults, sessionState: saved, onSessionStateChange });
    const scroller = requireValue(view.container.querySelector<HTMLElement>(".editor-scroll"));
    expect(screen.getByLabelText("Kapiteltitel")).toHaveValue("Am Hafen");
    expect(editor().state.selection.main).toMatchObject(saved.selection);
    expect(screen.getByLabelText("Kapiteltext")).toHaveFocus();
    expect(scroller.scrollTop).toBe(321);
    await waitFor(() => expect(onSessionStateChange).toHaveBeenCalledWith(saved));
    // Let the one-time layout restoration finish before the next user input.
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    act(() => editor().dispatch({ selection: { anchor: 4 } }));
    scroller.scrollTop = 123;
    fireEvent.scroll(scroller);
    expect(onSessionStateChange).toHaveBeenLastCalledWith({
      chapterId: "c2",
      selection: { anchor: 4, head: 4 },
      scrollTop: 123,
    });
    act(() => editor().dispatch({ changes: { from: 4, insert: "!" }, selection: { anchor: 5 } }));
    expect(onSessionStateChange).toHaveBeenLastCalledWith({
      chapterId: "c2",
      selection: { anchor: 5, head: 5 },
      scrollTop: 123,
    });
  });

  it("does not replay the saved selection after an internal chapter round trip", async () => {
    renderWorkspace({ ...defaults, sessionState: saved });
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    fireEvent.click(screen.getByRole("button", { name: "Vorheriges Kapitel: Kapitel 1 · Prolog" }));
    fireEvent.click(screen.getByRole("button", { name: "Nächstes Kapitel: Kapitel 2 · Am Hafen" }));
    expect(editor().state.selection.main.head).toBe(0);
  });

  it("gives explicit chapter navigation priority over the saved session", async () => {
    render(
      <TestProviders>
        <ControlledWorkspace sessionState={saved} targetId="c1" targetRequestId={1} />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByLabelText("Kapiteltitel")).toHaveValue("Prolog"));
    expect(editor().state.selection.main.head).toBe(0);
    expect(screen.getByLabelText("Kapiteltext")).not.toHaveFocus();
  });

  it("gives an explicit search in the saved chapter priority over restoration", async () => {
    renderWorkspace({
      ...defaults,
      sessionState: saved,
      targetId: "c2",
      targetRequestId: 1,
      textSearch: { query: "Hafen", from: 14, to: 19 },
    });
    await waitFor(() => expect(editor().state.selection.main.head).toBe(14));
  });

  it("clamps a saved selection when the chapter was shortened while away", () => {
    renderWorkspace({
      ...defaults,
      sessionState: saved,
      manuscript: { chapters: [{ ...manuscript.chapters[1], body: "Hi" }] },
    });
    expect(editor().state.selection.main).toMatchObject({ anchor: 2, head: 2 });
  });
});
