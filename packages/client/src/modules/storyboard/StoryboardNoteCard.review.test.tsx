import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
      <div data-testid="narrow-storyboard-card-host" style={{ width: 280 }}>
        <NoteNode id="note-review" data={data} selected />
      </div>
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
    expect(card?.closest(".nowheel")).toBeNull();
    expect(card).not.toHaveTextContent(/Freie Planung|nicht Teil des Kanons/i);
    const header = card?.querySelector(".storyboard-node__header");
    expect(header?.closest(".nodrag")).toBeNull();
    const body = card?.querySelector(".storyboard-node__body");
    expect(body).toHaveClass("scroll-area");
    // The card scrolls its own body under the wheel; the canvas zoom would
    // otherwise swallow the event and the note could never be scrolled.
    expect(body).toHaveClass("nowheel");
    // Still draggable by its padding, so the card does not lose its grip.
    expect(body).not.toHaveClass("nodrag");
    expect(body).not.toHaveClass("nopan");
    const textbox = screen.getByRole("textbox", { name: "Storyboard-Notiz" });
    expect(document.querySelector(`label[for="${textbox.id}"]`)).toHaveClass("sr-only");
    const interactionSurface = textbox.closest(".storyboard-node__note");
    expect(interactionSurface).not.toHaveClass("nowheel");
    expect(interactionSurface).not.toHaveClass("nodrag");
    expect(interactionSurface).not.toHaveClass("nopan");
    // The resize grip lives on this control. Left reachable by the canvas, a drag
    // on it moves the card and resizes the field at the same time.
    expect(textbox.closest(".nodrag")).toHaveClass("storyboard-note-control", "nopan");
    expect(screen.getByRole("button", { name: "Notiz im Fokus öffnen" })).toHaveClass(
      "nodrag",
      "nopan",
    );
    const toolbar = screen.getByRole("toolbar", { name: "Notiz formatieren" });
    expect(screen.getByTestId("narrow-storyboard-card-host")).toHaveStyle({ width: "280px" });
    expect(toolbar).toHaveClass("nodrag", "nopan");
    expect(toolbar).not.toHaveClass("nowheel");
    expect(within(toolbar).getAllByRole("button")).toHaveLength(4);

    act(() => {
      const view = editorView(textbox);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Neue lose Idee" },
        selection: { anchor: "Neue lose Idee".length },
        userEvent: "input",
      });
    });

    expect(onNoteChange).toHaveBeenLastCalledWith("note-review", "Neue lose Idee", [], []);
  });

  it("offers keyboard resizing and edits the same stable note in Focus Mode", () => {
    const onPatch = vi.fn();
    renderNoteNode({ onPatch });

    expect(screen.getByTestId("pointer-resizer")).toBeInTheDocument();
    const resizeButton = screen.getByRole("button", { name: "Element skalieren" });
    expect(resizeButton).toHaveClass("nodrag", "nopan");
    expect(resizeButton.closest(".nowheel")).toBeNull();
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

  it("persists a format-only edit through the storyboard owner callback", () => {
    const onNoteChange = vi.fn();
    renderNoteNode({ onNoteChange });
    const textbox = screen.getByRole("textbox", { name: "Storyboard-Notiz" });
    act(() => editorView(textbox).dispatch({ selection: { anchor: 0, head: 4 } }));

    fireEvent.click(screen.getByRole("button", { name: "Fett" }));

    expect(onNoteChange).toHaveBeenLastCalledWith(
      "note-review",
      "Lose Idee",
      [],
      [{ from: 0, to: 4, kind: "bold" }],
    );
  });
});
