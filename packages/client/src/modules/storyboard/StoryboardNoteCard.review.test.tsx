import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { storyboardNodeTypes } from "./StoryboardNode";
import type { StoryboardFlowNodeData } from "./storyboardCanvasModel";

vi.mock("@xyflow/react", () => ({
  Handle: ({ title }: { title?: string }) => <span aria-hidden="true" title={title} />,
  NodeResizer: ({ isVisible }: { isVisible?: boolean }) =>
    isVisible ? <span data-testid="pointer-resizer" aria-hidden="true" /> : null,
  Position: { Left: "left", Right: "right" },
}));

afterEach(cleanup);

const NoteNode = storyboardNodeTypes.storyboard as unknown as ComponentType<{
  id: string;
  data: StoryboardFlowNodeData;
  selected: boolean;
}>;

function renderNoteNode({
  onNoteChange = vi.fn(),
  onPatch = vi.fn(),
}: {
  onNoteChange?: StoryboardFlowNodeData["onNoteChange"];
  onPatch?: StoryboardFlowNodeData["onPatch"];
} = {}) {
  const data: StoryboardFlowNodeData = {
    cardKind: "note",
    item: {
      id: "note-review",
      boardId: "main-storyboard",
      kind: "note",
      x: 40,
      y: 60,
      width: 280,
      height: 210,
      text: "Lose Idee",
      noteReferences: [],
    },
    boardTitle: "Main Storyboard",
    onPatch,
    onNoteChange,
    onOpenReference: vi.fn(),
    onOpenBoard: vi.fn(),
  };
  render(
    <I18nProvider>
      <NoteNode id="note-review" data={data} selected />
    </I18nProvider>,
  );
  return { onNoteChange, onPatch };
}

function editorView(textbox: HTMLElement) {
  const root = textbox.closest<HTMLElement>(".cm-editor");
  if (!root) throw new Error("CodeMirror root missing");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

describe("Storyboard note-card UX contract", () => {
  it("keeps redundant planning labels visually absent and direct editing out of node dragging", () => {
    const onNoteChange = vi.fn();
    renderNoteNode({ onNoteChange });

    const card = document.querySelector('[data-storyboard-node-kind="note"]');
    expect(card).toBeInTheDocument();
    expect(card).not.toHaveClass("nodrag");
    expect(card).not.toHaveTextContent(/Freie Planung|nicht Teil des Kanons/i);
    const header = card?.querySelector(".storyboard-node__header");
    expect(header?.closest(".nodrag")).toBeNull();
    const body = card?.querySelector(".storyboard-node__body");
    expect(body).toHaveClass("scroll-area", "nowheel");
    expect(body).not.toHaveClass("nodrag");
    expect(body).not.toHaveClass("nopan");
    const textbox = screen.getByRole("textbox", { name: "Storyboard-Notiz" });
    expect(document.querySelector(`label[for="${textbox.id}"]`)).toHaveClass("sr-only");
    const interactionSurface = textbox.closest(".storyboard-node__note");
    expect(interactionSurface).toHaveClass("nowheel");
    expect(interactionSurface).not.toHaveClass("nodrag");
    expect(interactionSurface).not.toHaveClass("nopan");
    expect(textbox.closest(".nodrag")).toBeNull();
    expect(screen.getByRole("button", { name: "Notiz im Fokus öffnen" })).toHaveClass(
      "nodrag",
      "nopan",
      "nowheel",
    );

    act(() => {
      const view = editorView(textbox);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Neue lose Idee" },
        selection: { anchor: "Neue lose Idee".length },
        userEvent: "input",
      });
    });

    expect(onNoteChange).toHaveBeenLastCalledWith("note-review", "Neue lose Idee", []);
  });

  it("offers keyboard resizing and edits the same stable note in Focus Mode", () => {
    const onPatch = vi.fn();
    renderNoteNode({ onPatch });

    expect(screen.getByTestId("pointer-resizer")).toBeInTheDocument();
    const resizeButton = screen.getByRole("button", { name: "Element skalieren" });
    expect(resizeButton).toHaveClass("nodrag", "nopan", "nowheel");
    fireEvent.click(resizeButton);
    expect(onPatch).toHaveBeenCalledWith("note-review", { width: 320, height: 240 });

    fireEvent.click(screen.getByRole("button", { name: "Notiz im Fokus öffnen" }));
    const dialog = screen.getByRole("dialog", {
      name: "Storyboard-Notiz · Main Storyboard",
    });
    expect(dialog.querySelector("[data-note-owner]")).toHaveAttribute(
      "data-note-owner",
      "storyboard:note-review",
    );
    expect(dialog).not.toHaveTextContent("{context}");
  });
});
