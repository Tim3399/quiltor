import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { StoryboardNode } from "./model";
import { storyboardNodeTypes } from "./StoryboardNode";
import type { StoryboardFlowNodeData } from "./storyboardCanvasModel";

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  NodeResizer: () => null,
  Position: { Left: "left", Right: "right" },
}));

afterEach(cleanup);

const CanvasNode = storyboardNodeTypes.storyboard as unknown as ComponentType<{
  id: string;
  data: StoryboardFlowNodeData;
  selected: boolean;
}>;

function editorView(textbox: HTMLElement) {
  const root = textbox.closest<HTMLElement>(".cm-editor");
  if (!root) throw new Error("CodeMirror root missing");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

function renderNode(item: StoryboardNode, onNoteChange: StoryboardFlowNodeData["onNoteChange"]) {
  const data: StoryboardFlowNodeData = {
    item,
    cardKind:
      item.kind === "reference" ? "reference" : item.kind === "storyboard" ? "storyboard" : "group",
    boardTitle: item.kind === "storyboard" ? "Zweiter Akt" : "Main Storyboard",
    boardContext: "Main Storyboard",
    onPatch: vi.fn(),
    onNoteChange,
    onOpenReference: vi.fn(),
    onOpenBoard: vi.fn(),
  };
  render(
    <I18nProvider>
      <CanvasNode id={item.id} data={data} selected={false} />
    </I18nProvider>,
  );
}

describe("Storyboard node notes", () => {
  it.each([
    {
      kind: "reference" as const,
      label: "Ada",
      item: {
        id: "reference-ada",
        boardId: "main-storyboard",
        kind: "reference" as const,
        x: 20,
        y: 40,
        label: "Ada",
        target: { kind: "entity" as const, id: "ada" },
      },
    },
    {
      kind: "storyboard" as const,
      label: "Zweiter Akt",
      item: {
        id: "board-act-two",
        boardId: "main-storyboard",
        kind: "storyboard" as const,
        x: 60,
        y: 80,
        label: "Zweiter Akt",
        target: { kind: "storyboard" as const, id: "act-two" },
      },
    },
    {
      kind: "group" as const,
      label: "Gruppe Eins",
      item: {
        id: "group-one",
        boardId: "main-storyboard",
        kind: "group" as const,
        x: 100,
        y: 120,
        width: 240,
        height: 100,
        label: "Gruppe Eins",
      },
    },
  ])("edits an optional note owned by a $kind node", ({ kind, label, item }) => {
    const onNoteChange = vi.fn();
    renderNode(item, onNoteChange);

    const card = document.querySelector<HTMLElement>(`[data-storyboard-node-kind="${kind}"]`);
    expect(card).toBeInTheDocument();
    if (!card) throw new Error(`${kind} card missing`);
    const textbox = within(card).getByRole("textbox", { name: `Notiz zu ${label}` });
    const body = textbox.closest(".storyboard-node__body");
    expect(body).toBeInTheDocument();
    expect(body).toHaveClass("scroll-area", "nowheel");
    expect(body).not.toHaveClass("nodrag");
    expect(body).not.toHaveClass("nopan");
    expect(body).toHaveAttribute("data-axis", "y");
    expect(body).toHaveAttribute("data-gutter", "auto");
    expect(body).toHaveAttribute("data-overscroll", "contain");
    expect(body).toHaveAttribute("data-scrollbar", "thin");
    expect(card.querySelector(".cm-placeholder")).toHaveTextContent("Notiz");
    expect(textbox.closest(".storyboard-node-note-field")).toBeInTheDocument();
    const note = textbox.closest(".storyboard-node__note");
    expect(note).toHaveClass("storyboard-node__note--compact", "nowheel");
    expect(note).not.toHaveClass("nodrag");
    expect(note).not.toHaveClass("nopan");
    expect(textbox.closest(".nodrag")).toBeNull();

    const header = card.querySelector(".storyboard-node__header");
    expect(header).toBeInTheDocument();
    expect(header?.closest(".nodrag")).toBeNull();

    const focusButton = within(card).getByRole("button", { name: "Notiz im Fokus öffnen" });
    expect(focusButton).toHaveClass("nodrag", "nopan", "nowheel");

    const openButton = card.querySelector(".storyboard-node__open");
    if (kind === "reference" || kind === "storyboard") {
      expect(openButton).toHaveClass("nodrag", "nopan", "nowheel");
      const title = card.querySelector(".storyboard-node__title");
      expect(title).toBeInTheDocument();
      expect(title?.closest(".nodrag")).toBeNull();
    } else {
      expect(openButton).not.toBeInTheDocument();
      const groupTitle = card.querySelector(".storyboard-group-title-control");
      expect(groupTitle).toHaveClass("nodrag", "nopan", "nowheel");
    }

    act(() => {
      const view = editorView(textbox);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Eigene Randnotiz" },
        selection: { anchor: "Eigene Randnotiz".length },
        userEvent: "input",
      });
    });

    expect(onNoteChange).toHaveBeenLastCalledWith(item.id, "Eigene Randnotiz", []);
  });

  it("distinguishes a linked storyboard title from the current board in focus mode", () => {
    renderNode(
      {
        id: "board-act-two",
        boardId: "main-storyboard",
        kind: "storyboard",
        x: 60,
        y: 80,
        label: "Veralteter Titel",
        target: { kind: "storyboard", id: "act-two" },
      },
      vi.fn(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Notiz im Fokus öffnen" }));

    expect(
      screen.getByRole("dialog", {
        name: "Notiz zu Zweiter Akt · Main Storyboard",
      }),
    ).toBeInTheDocument();
  });
});
