import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    expect(card.closest(".nowheel")).toBeNull();
    const textbox = within(card).getByRole("textbox", { name: `Notiz zu ${label}` });
    const body = textbox.closest(".storyboard-node__body");
    expect(body).toBeInTheDocument();
    expect(body).toHaveClass("scroll-area");
    // The wheel belongs to the card's own scroller -- but only while there is something
    // there to scroll. A short card hands it back to the canvas, or a board full of short
    // cards swallows every zoom.
    expect(body).not.toHaveClass("nowheel");
    // Dragging stays on: the card is still moved by grabbing its padding.
    expect(body).not.toHaveClass("nodrag");
    expect(body).not.toHaveClass("nopan");
    expect(body).toHaveAttribute("data-axis", "y");
    expect(body).toHaveAttribute("data-gutter", "auto");
    expect(body).toHaveAttribute("data-overscroll", "contain");
    expect(body).toHaveAttribute("data-scrollbar", "thin");
    expect(card.querySelector(".cm-placeholder")).toHaveTextContent("Notiz");
    expect(textbox.closest(".storyboard-node-note-field")).toBeInTheDocument();
    const note = textbox.closest(".storyboard-node__note");
    expect(note).toHaveClass("storyboard-node__note--compact");
    expect(note).not.toHaveClass("nowheel");
    expect(note).not.toHaveClass("nodrag");
    expect(note).not.toHaveClass("nopan");
    // A drag inside the editor selects text. Reaching the canvas, the same press
    // would pull the card out from under the selection instead.
    expect(textbox.closest(".nodrag")).toHaveClass("storyboard-note-control", "nopan");

    const header = card.querySelector(".storyboard-node__header");
    expect(header).toBeInTheDocument();
    expect(header?.closest(".nodrag")).toBeNull();

    const focusButton = within(card).getByRole("button", { name: "Notiz im Fokus öffnen" });
    expect(focusButton).toHaveClass("nodrag", "nopan");
    expect(focusButton).not.toHaveClass("nowheel");

    const openButton = card.querySelector(".storyboard-node__open");
    if (kind === "reference" || kind === "storyboard") {
      expect(openButton).toHaveClass("nodrag", "nopan");
      expect(openButton).not.toHaveClass("nowheel");
      const title = card.querySelector(".storyboard-node__title");
      expect(title).toBeInTheDocument();
      expect(title?.closest(".nodrag")).toBeNull();
    } else {
      expect(openButton).not.toBeInTheDocument();
      const groupTitle = card.querySelector(".storyboard-group-title-control");
      expect(groupTitle).toHaveClass("nodrag", "nopan");
      expect(groupTitle).not.toHaveClass("nowheel");
    }

    act(() => {
      const view = editorView(textbox);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Eigene Randnotiz" },
        selection: { anchor: "Eigene Randnotiz".length },
        userEvent: "input",
      });
    });

    expect(onNoteChange).toHaveBeenLastCalledWith(item.id, "Eigene Randnotiz", [], []);
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

describe("Storyboard card and the mouse wheel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("takes the wheel only once the card really has something to scroll", () => {
    // The overflow does not exist in jsdom by itself; it is staged here so the measurement
    // gets the same answer it would in a browser with a long note.
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(120);

    renderNode(
      {
        id: "n1",
        kind: "note",
        boardId: "b1",
        x: 0,
        y: 0,
        text: "Lange Notiz",
        note: "Viel Text",
      },
      vi.fn(),
    );

    const body = document.querySelector(".storyboard-node__body");
    expect(body).toHaveClass("nowheel");

    scrollHeight.mockReturnValue(120);
    act(() => {
      for (const notify of observers) notify();
    });
    expect(document.querySelector(".storyboard-node__body")).not.toHaveClass("nowheel");
  });
});

describe("Kartenchrome", () => {
  const css = readFileSync(
    join(process.cwd(), "packages/client/src/modules/storyboard/StoryboardNode.css"),
    "utf8",
  );
  const tsx = readFileSync(
    join(process.cwd(), "packages/client/src/modules/storyboard/StoryboardNode.tsx"),
    "utf8",
  );

  it("gives the formatting bar a class of its own, or the CSS points at nothing", () => {
    expect(tsx).toContain("storyboard-note-format");
  });

  it("keeps the bar quiet until the card is meant", () => {
    expect(css).toMatch(/\.storyboard-note-format\s*\{[^}]*opacity:\s*0;/s);
  });

  // They may stay invisible only as long as they show themselves the moment someone points
  // or tabs at them -- otherwise the buttons would simply be gone for the keyboard.
  it("shows it on hover, selection and keyboard focus", () => {
    expect(css).toContain(".storyboard-node:hover .storyboard-note-format");
    expect(css).toContain(".storyboard-node.is-selected .storyboard-note-format");
    expect(css).toContain(".storyboard-node:focus-within .storyboard-note-format");
  });

  it("leaves it standing on touch devices, where there is no hover", () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.storyboard-note-format\s*\{[^}]*opacity:\s*1;/s,
    );
  });

  it("takes the second frame off the note field and hands it back while writing", () => {
    expect(css).toMatch(
      /\.storyboard-note-control\s*\{[^}]*border-color:\s*var\(--transparent\);/s,
    );
    expect(css).toMatch(/\.storyboard-note-control:focus-within\s*\{[^}]*border-color:/s);
  });
});

describe("Note height on cards without a note of their own", () => {
  it("lets a reference's note grow along instead of holding it to one line", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/storyboard/StoryboardNode.css"),
      "utf8",
    );
    const tsx = readFileSync(
      join(process.cwd(), "packages/client/src/modules/storyboard/StoryboardNode.tsx"),
      "utf8",
    );

    expect(css).toMatch(/\.storyboard-node__note--compact\s*\{[^}]*flex:\s*1;/s);
    // A fixed number of lines would be exactly what was meant to go away here.
    expect(tsx).not.toMatch(/rows=\{isNoteCard \? undefined : \d+\}/);
  });
});
