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

describe("WorldOverviewPanel and maps", () => {
  it("lists no map, because none stands on the canvas beside it either", () => {
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

describe("WorldOverviewPanel folding", () => {
  const collapsedKey = (world: string) => `quiltor:collapsed-groups:figures-world:${world}`;

  function panelFor(worldId: string, selectedId: string | null) {
    return (
      <I18nProvider>
        <WorldOverviewPanel
          state={state}
          worldId={worldId}
          selectedId={selectedId}
          onSelect={vi.fn()}
          onReveal={vi.fn()}
        />
      </I18nProvider>
    );
  }

  afterEach(() => localStorage.clear());

  it("folds a group by its header button and unfolds it again", () => {
    render(panelFor("welt-a", null));
    const trigger = screen.getByRole("button", { name: /^Figur/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Mara Venn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gezeitenarchiv" })).toBeVisible();

    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Mara Venn" })).toBeVisible();
  });

  it("keeps the fold across a reload, separately for each world", () => {
    const first = render(panelFor("welt-a", null));
    fireEvent.click(screen.getByRole("button", { name: /^Figur/ }));
    expect(localStorage.getItem(collapsedKey("welt-a"))).toBe('["person"]');
    first.unmount();

    render(panelFor("welt-a", null));
    expect(screen.getByRole("button", { name: /^Figur/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    cleanup();

    render(panelFor("welt-b", null));
    expect(screen.getByRole("button", { name: /^Figur/ })).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem(collapsedKey("welt-b"))).toBeNull();
  });

  it("follows a change of world inside one mounted panel", () => {
    localStorage.setItem(collapsedKey("welt-a"), '["ort"]');
    const view = render(panelFor("welt-a", null));
    expect(screen.getByRole("button", { name: /^Ort/ })).toHaveAttribute("aria-expanded", "false");
    view.rerender(panelFor("welt-b", null));
    expect(screen.getByRole("button", { name: /^Ort/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the group of an element that gets selected from outside", () => {
    localStorage.setItem(collapsedKey("welt-a"), '["person","ort"]');
    const view = render(panelFor("welt-a", null));
    expect(screen.getByRole("button", { name: /^Ort/ })).toHaveAttribute("aria-expanded", "false");

    view.rerender(panelFor("welt-a", "archiv"));
    expect(screen.getByRole("button", { name: /^Ort/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Figur/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(localStorage.getItem(collapsedKey("welt-a"))).toBe('["person"]');
  });

  it("lets the user fold the group of the current selection by hand", () => {
    render(panelFor("welt-a", "mara"));
    const trigger = screen.getByRole("button", { name: /^Figur/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("tolerates a damaged stored value", () => {
    localStorage.setItem(collapsedKey("welt-a"), "{kaputt");
    render(panelFor("welt-a", null));
    expect(screen.getByRole("button", { name: /^Figur/ })).toHaveAttribute("aria-expanded", "true");
  });
});
