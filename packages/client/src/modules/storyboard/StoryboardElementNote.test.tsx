import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { ElementNote } from "../notes";
import type { StoryboardReferenceNode } from "./model";
import { storyboardNodeTypes } from "./StoryboardNode";
import type { StoryboardFlowNodeData } from "./storyboardCanvasModel";

// T-177: a reference card shows and edits the one note of its element, not a text of its own.

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

function card(id: string, boardId: string): StoryboardReferenceNode {
  return {
    id,
    boardId,
    kind: "reference",
    x: 0,
    y: 0,
    label: "Ankunft",
    target: { kind: "chapter", id: "k1" },
  };
}

function data(
  item: StoryboardReferenceNode,
  elementNote: ElementNote | null,
  handlers: Partial<StoryboardFlowNodeData> = {},
): StoryboardFlowNodeData {
  return {
    item,
    cardKind: "reference",
    boardTitle: item.boardId,
    boardContext: item.boardId,
    onPatch: vi.fn(),
    onNoteChange: vi.fn(),
    onOpenReference: vi.fn(),
    onOpenBoard: vi.fn(),
    onElementNoteChange: vi.fn(),
    elementNote,
    ...handlers,
  };
}

const note = (text: string): ElementNote => ({ text, noteReferences: [], noteMarks: [] });

function editors(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".cm-editor")].map((root) => {
    const view = EditorView.findFromDOM(root);
    if (!view) throw new Error("CodeMirror view missing");
    return view;
  });
}

function renderCards(entries: StoryboardFlowNodeData[]) {
  const tree = (items: StoryboardFlowNodeData[]) => (
    <I18nProvider>
      {items.map((entry) => (
        <CanvasNode key={entry.item.id} id={entry.item.id} data={entry} selected={false} />
      ))}
    </I18nProvider>
  );
  const view = render(tree(entries));
  return { ...view, update: (items: StoryboardFlowNodeData[]) => view.rerender(tree(items)) };
}

describe("a Storyboard reference card and its element's note (T-177)", () => {
  it("edits the element's note under the element as owner, never a note of its own", () => {
    const onElementNoteChange = vi.fn();
    const onNoteChange = vi.fn();
    const item = card("c1", "plot");
    const { container } = renderCards([
      data(item, note("Hafen bei Nacht."), { onElementNoteChange, onNoteChange }),
    ]);

    expect(container.querySelector("[data-note-owner]")).toHaveAttribute(
      "data-note-owner",
      "chapter:k1",
    );
    const [editor] = editors(container);
    expect(editor.state.doc.toString()).toBe("Hafen bei Nacht.");
    act(() => {
      editor.dispatch({ changes: { from: 0, insert: "Neu: " }, userEvent: "input" });
    });

    expect(onElementNoteChange).toHaveBeenLastCalledWith(
      { kind: "chapter", id: "k1" },
      "Neu: Hafen bei Nacht.",
      [],
      [],
    );
    expect(onNoteChange).not.toHaveBeenCalled();
  });

  it("says the element is gone and offers no editor", () => {
    const { container } = renderCards([data(card("c1", "plot"), null)]);

    expect(screen.getByText("Element gelöscht")).toBeVisible();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("shows the same note on two boards and carries an edit from one card to the other", () => {
    const first = card("c1", "plot");
    const second = card("c2", "figuren");
    const cards = renderCards([data(first, note("Eins.")), data(second, note("Eins."))]);
    const [one, two] = editors(cards.container);
    expect([one.state.doc.toString(), two.state.doc.toString()]).toEqual(["Eins.", "Eins."]);
    act(() => {
      two.dispatch({ selection: EditorSelection.cursor(2) });
    });

    cards.update([data(first, note("Eins. Zwei.")), data(second, note("Eins. Zwei."))]);

    expect([one.state.doc.toString(), two.state.doc.toString()]).toEqual([
      "Eins. Zwei.",
      "Eins. Zwei.",
    ]);
  });

  // Plan test 17: a controlled update changes only the edited range, so the editor that did
  // not type keeps its cursor.
  it("keeps the other card's cursor where its author left it", () => {
    const first = card("c1", "plot");
    const second = card("c2", "figuren");
    const cards = renderCards([data(first, note("Eins.")), data(second, note("Eins."))]);
    const [, two] = editors(cards.container);
    act(() => {
      two.dispatch({ selection: EditorSelection.cursor(2) });
    });

    cards.update([data(first, note("Eins. Zwei.")), data(second, note("Eins. Zwei."))]);

    expect(two.state.selection.main.head).toBe(2);
  });
});
