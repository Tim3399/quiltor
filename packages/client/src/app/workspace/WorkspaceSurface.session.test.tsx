import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { loadTextWorkspace } from "../../modules/manuscript";
import { createDefaultStoryboardState } from "../../modules/storyboard";
import type { Workspace } from "../../shared";
import { WorkspaceSurface } from "./WorkspaceSurface";

vi.mock("../../modules/story-world", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../modules/story-world")>()),
  loadFigureWorkspace: async () => ({ default: () => <div>Figurenansicht</div> }),
}));

const manuscript = {
  chapters: [
    { id: "c1", title: "Prolog", body: "Der Morgen", note: "" },
    { id: "c2", title: "Am Hafen", body: "Hallo Welt am Hafen", note: "" },
  ],
};
const actions = { change: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false };

// Exercise the real lazy workspace lifecycle without timing its cold module transform.
beforeAll(async () => {
  await loadTextWorkspace();
});

function Harness({
  worldId = "world-a",
  workspace = "text",
}: {
  worldId?: string;
  workspace?: Workspace;
}) {
  const [chapter, setChapter] = useState("c2");
  return (
    <I18nProvider>
      <Suspense fallback={<div>Wird geladen</div>}>
        <WorkspaceSurface
          worldId={worldId}
          worldTitle="Testwelt"
          workspace={workspace}
          manuscript={manuscript}
          figures={{ nodes: [], edges: [] }}
          storyboards={createDefaultStoryboardState()}
          orphanedMentions={0}
          manuscriptHistory={actions}
          figureHistory={actions}
          storyboardHistory={actions}
          referenceCandidates={[]}
          onFiguresChange={vi.fn()}
          target={null}
          onNavigate={vi.fn()}
          focus={false}
          onFocus={vi.fn()}
          onSave={async () => {}}
          currentChapterId={chapter}
          onCurrentChapterId={setChapter}
        />
      </Suspense>
    </I18nProvider>
  );
}

async function editorView() {
  const textbox = await screen.findByLabelText("Kapiteltext");
  const root = textbox.closest<HTMLElement>(".cm-editor");
  const view = root && EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

describe("WorkspaceSurface session ownership", () => {
  it("keeps the live snapshot across a real text workspace unmount", async () => {
    const view = render(<Harness />);
    const previousEditor = await editorView();
    act(() => previousEditor.dispatch({ selection: { anchor: 10, head: 6 } }));
    const scroller = view.container.querySelector<HTMLElement>(".editor-scroll");
    if (!scroller) throw new Error("Editor scroller missing");
    scroller.scrollTop = 245;
    fireEvent.scroll(scroller);
    view.rerender(<Harness workspace="figures" />);
    await screen.findByText("Figurenansicht");
    expect(screen.queryByLabelText("Kapiteltext")).toBeNull();
    view.rerender(<Harness />);
    const restoredEditor = await editorView();
    expect(restoredEditor).not.toBe(previousEditor);
    expect(screen.getByLabelText("Kapiteltitel")).toHaveValue("Am Hafen");
    expect(restoredEditor.state.selection.main).toMatchObject({ anchor: 10, head: 6 });
    expect(screen.getByLabelText("Kapiteltext")).toHaveFocus();
    expect(view.container.querySelector(".editor-scroll")?.scrollTop).toBe(245);
  });

  it("does not apply a snapshot to a different world with the same chapter ids", async () => {
    const view = render(<Harness />);
    const previousEditor = await editorView();
    act(() => previousEditor.dispatch({ selection: { anchor: 10, head: 6 } }));
    view.rerender(<Harness workspace="figures" />);
    await screen.findByText("Figurenansicht");
    view.rerender(<Harness worldId="world-b" />);
    const freshEditor = await editorView();
    expect(freshEditor.state.selection.main).toMatchObject({ anchor: 0, head: 0 });
    expect(screen.getByLabelText("Kapiteltext")).not.toHaveFocus();
  });
});
