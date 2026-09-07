import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { WorldOverviewPanel } from "./WorldOverviewPanel";

const state: FigureState = {
  nodes: [
    { id: "mara", x: 0, y: 0, type: "person", name: "Mara Venn" },
    { id: "iven", x: 200, y: 0, type: "person", name: "Iven Rook" },
    { id: "archiv", x: 0, y: 200, type: "ort", name: "Gezeitenarchiv" },
  ],
  edges: [{ id: "e1", from: "mara", to: "archiv" }],
};

afterEach(cleanup);

function renderPanel(onSelect = vi.fn(), onReveal = vi.fn()) {
  render(
    <I18nProvider>
      <WorldOverviewPanel state={state} selectedId="mara" onSelect={onSelect} onReveal={onReveal} />
    </I18nProvider>,
  );
  return { onSelect, onReveal };
}

describe("WorldOverviewPanel", () => {
  it("groups the world by kind and counts what it holds", () => {
    renderPanel();
    const panel = screen.getByRole("complementary", { name: "Weltübersicht" });

    expect(within(panel).getByText("3 Elemente")).toBeVisible();
    expect(within(panel).getByText("1 Beziehungen")).toBeVisible();
    const groups = within(panel).getAllByRole("heading", { level: 3 });
    expect(groups.map((group) => group.textContent)).toEqual(["Figur2", "Ort1"]);
  });

  it("marks the selected element and selects on a single click", () => {
    const { onSelect } = renderPanel();
    const panel = screen.getByRole("complementary", { name: "Weltübersicht" });

    expect(within(panel).getByRole("button", { name: "Mara Venn" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Iven Rook" }));
    expect(onSelect).toHaveBeenCalledWith("iven");
  });

  it("brings the element into view on a double click", () => {
    const { onSelect, onReveal } = renderPanel();
    const panel = screen.getByRole("complementary", { name: "Weltübersicht" });

    fireEvent.doubleClick(within(panel).getByRole("button", { name: "Gezeitenarchiv" }));
    expect(onSelect).toHaveBeenCalledWith("archiv");
    expect(onReveal).toHaveBeenCalledWith(expect.objectContaining({ id: "archiv" }));
  });
});

describe("WorldOverviewPanel und Karten", () => {
  it("fuehrt keine Karte auf, denn auf der Leinwand daneben steht auch keine", () => {
    const withMap: FigureState = {
      nodes: [
        ...state.nodes,
        { id: "karte", x: 0, y: 400, type: "ort", name: "Nordhafen", mapImageId: "bild-1" },
      ],
      edges: state.edges,
    };
    render(
      <I18nProvider>
        <WorldOverviewPanel
          state={withMap}
          selectedId={null}
          onSelect={vi.fn()}
          onReveal={vi.fn()}
        />
      </I18nProvider>,
    );
    const panel = screen.getByRole("complementary", { name: "Weltübersicht" });

    expect(within(panel).queryByText("Nordhafen")).toBeNull();
    // The number in the header counts the same thing as the list below it.
    expect(within(panel).getByText("3 Elemente")).toBeVisible();
  });
});
