import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FigureState } from "../story-world";
import type { Manuscript } from "./model";
import { TestProviders } from "./TextWorkspace.testSupport";
import { WritingInsertPanel } from "./WritingInsertPanel";

const figures: FigureState = {
  nodes: [{ id: "figure", x: 0, y: 0, name: "Mara" }],
  edges: [],
};
const manuscript: Manuscript = {
  chapters: [],
  words: [{ w: "Dreamweaver", d: "" }],
  zeichenAktiv: ["—"],
};

describe("WritingInsertPanel", () => {
  afterEach(cleanup);
  it("routes entity, term and symbol chips through their dedicated actions", () => {
    const onInsertEntity = vi.fn();
    const onInsert = vi.fn();
    render(
      <TestProviders>
        <WritingInsertPanel
          manuscript={manuscript}
          figures={figures}
          orphanedMentions={0}
          ambiguousMentions={[]}
          symbolPicker={false}
          onSymbolPicker={vi.fn()}
          onInsertEntity={onInsertEntity}
          onResolveAmbiguous={vi.fn()}
          onManageTerms={vi.fn()}
          onInsert={onInsert}
          onToggleSymbol={vi.fn()}
        />
      </TestProviders>,
    );

    const entity = screen.getByRole("button", { name: "Mara" });
    expect(entity).toHaveClass("writing-insert-chip");
    fireEvent.click(entity);
    expect(onInsertEntity).toHaveBeenCalledWith(figures.nodes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Dreamweaver" }));
    const symbols = screen.getByRole("list", { name: "Sonderzeichen" });
    const activeSymbol = within(symbols).getByRole("button", { name: "—" });
    expect(activeSymbol).toHaveClass("writing-insert-chip", "writing-insert-symbol");
    fireEvent.click(activeSymbol);
    expect(onInsert).toHaveBeenNthCalledWith(1, "Dreamweaver");
    expect(onInsert).toHaveBeenNthCalledWith(2, "—");
  });

  it("uses a native disclosure for the symbol selection surface", () => {
    const onToggleSymbol = vi.fn();
    render(
      <TestProviders>
        <WritingInsertPanel
          manuscript={manuscript}
          figures={figures}
          orphanedMentions={0}
          ambiguousMentions={[]}
          symbolPicker
          onSymbolPicker={vi.fn()}
          onInsertEntity={vi.fn()}
          onResolveAmbiguous={vi.fn()}
          onManageTerms={vi.fn()}
          onInsert={vi.fn()}
          onToggleSymbol={onToggleSymbol}
        />
      </TestProviders>,
    );

    const symbol = screen.getAllByRole("button", { name: "—" }).at(-1);
    if (!symbol) throw new Error("symbol action missing");
    expect(symbol).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(symbol);
    expect(onToggleSymbol).toHaveBeenCalledWith("—", true);
  });
});
