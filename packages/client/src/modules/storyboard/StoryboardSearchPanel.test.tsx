import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { WorldReferenceCandidate } from "../world-references";
import { StoryboardSearchPanel } from "./StoryboardSearchPanel";
import {
  STORYBOARD_NODE_DRAG_MIME,
  STORYBOARD_REFERENCE_DRAG_MIME,
  storyboardNodeDragValue,
} from "./storyboardCanvasModel";

afterEach(cleanup);

const candidates: WorldReferenceCandidate[] = [
  {
    id: "entity:ada",
    target: { kind: "entity", id: "ada" },
    label: "Ada Lovelace",
    detail: "Figur",
    keywords: ["Analytikerin"],
    workspace: "figures",
    cardKind: "person",
  },
  {
    id: "place:harbour",
    target: { kind: "place", id: "harbour" },
    label: "Alter Hafen",
    detail: "Ort",
    keywords: [],
    workspace: "places",
    cardKind: "ort",
  },
];

function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
  } as unknown as DataTransfer;
}

describe("StoryboardSearchPanel", () => {
  it("filters candidates and provides click plus the stable drag MIME", () => {
    const onPlace = vi.fn();
    const onQueryChange = vi.fn();
    const onAddNote = vi.fn();
    const dataTransfer = transfer();
    const { rerender } = render(
      <I18nProvider>
        <StoryboardSearchPanel
          candidates={candidates}
          query=""
          onQueryChange={onQueryChange}
          onAddNote={onAddNote}
          onPlace={onPlace}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Welt durchsuchen" }), {
      target: { value: "Ada" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("Ada");

    rerender(
      <I18nProvider>
        <StoryboardSearchPanel
          candidates={candidates}
          query="Ada"
          onQueryChange={onQueryChange}
          onAddNote={onAddNote}
          onPlace={onPlace}
        />
      </I18nProvider>,
    );
    const result = screen.getByRole("button", {
      name: "Ada Lovelace auf dem Storyboard platzieren",
    });
    expect(screen.queryByText("Alter Hafen")).not.toBeInTheDocument();

    fireEvent.dragStart(result, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(STORYBOARD_REFERENCE_DRAG_MIME, "entity:ada");

    fireEvent.click(result);
    expect(onPlace).toHaveBeenCalledWith(candidates[0]);
  });

  it("offers a keyboard-accessible blank note before the unchanged world search", () => {
    const onAddNote = vi.fn();
    const dataTransfer = transfer();
    render(
      <I18nProvider>
        <StoryboardSearchPanel
          candidates={candidates}
          query=""
          onQueryChange={vi.fn()}
          onAddNote={onAddNote}
          onPlace={vi.fn()}
        />
      </I18nProvider>,
    );

    const library = screen.getByRole("complementary", { name: "Elementbibliothek" });
    const note = screen.getByRole("button", {
      name: "Leere Notiz auf dem Storyboard platzieren",
    });
    const search = screen.getByRole("searchbox", { name: "Welt durchsuchen" });

    expect(library).toContainElement(note);
    expect(note).toHaveAttribute("type", "button");
    expect(note).toHaveAttribute("draggable", "true");
    expect(note.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    fireEvent.dragStart(note, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      STORYBOARD_NODE_DRAG_MIME,
      storyboardNodeDragValue("note"),
    );
    expect(dataTransfer.effectAllowed).toBe("copy");

    fireEvent.click(note);
    expect(onAddNote).toHaveBeenCalledOnce();
  });
});
