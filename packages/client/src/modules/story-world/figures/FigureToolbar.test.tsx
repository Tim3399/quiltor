import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { FigureToolbar, type FigureToolbarProps } from "./FigureToolbar";

const state: FigureState = {
  nodes: [
    { id: "ada", x: 0, y: 0, name: "Ada", type: "person" },
    { id: "bela", x: 200, y: 0, name: "Bela", type: "person" },
  ],
  edges: [{ id: "allies", from: "ada", to: "bela", label: "Verbündet" }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubCompactToolbar(compact: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: compact && query === "(max-width: 719px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderToolbar(overrides: Partial<FigureToolbarProps> = {}) {
  const props: FigureToolbarProps = {
    state,
    connecting: false,
    snapToGrid: true,
    relationshipsVisible: true,
    timelineOpen: false,
    journeyOverlayOpen: false,
    canUndo: false,
    canRedo: false,
    onAddNode: vi.fn(),
    onConnectingChange: vi.fn(),
    onSnapToGridChange: vi.fn(),
    onAlignAllNodes: vi.fn(),
    onRelationshipsVisibleChange: vi.fn(),
    onTimelineOpenChange: vi.fn(),
    onJourneyOverlayOpenChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <FigureToolbar {...props} />
    </I18nProvider>,
  );
  return props;
}

function expectStructuredItems(menu: HTMLElement) {
  for (const item of within(menu).getAllByRole("menuitem")) {
    expect(item.querySelector(".ui-menu__icon")).toBeInTheDocument();
    expect(item.querySelector(".ui-menu__label")).toBeInTheDocument();
  }
}

describe("FigureToolbar element count", () => {
  it("counts the same elements as the list, leaving map sheets out", () => {
    renderToolbar({
      state: {
        nodes: [
          ...state.nodes,
          { id: "karte", x: 0, y: 200, name: "Nordhafen", type: "ort", mapImageId: "bild-1" },
        ],
        edges: state.edges,
      },
    });
    expect(screen.getByText(/2 Elemente/)).toBeInTheDocument();
    expect(screen.queryByText(/3 Elemente/)).not.toBeInTheDocument();
  });
});

describe("FigureToolbar menus", () => {
  it("keeps every visible action inside the shared scrollable toolbar contract", () => {
    renderToolbar();

    const toolbar = screen.getByRole("toolbar", { name: "Figuren & Welt" });
    const actions = toolbar.querySelector(".workspace-toolbar__actions");
    expect(actions).toBeInTheDocument();
    expect(actions).toHaveAttribute("data-axis", "x");
    expect(toolbar.querySelectorAll(":scope > .workspace-toolbar__group")).toHaveLength(0);

    for (const button of within(toolbar).getAllByRole("button")) {
      expect(button).toHaveClass("ui-toolbar-button");
    }
    expect(within(toolbar).getByRole("button", { name: "Element" })).toHaveAttribute(
      "data-workspace-action",
      "create",
    );
  });

  it("opens the element menu from the keyboard and restores its trigger after selection", async () => {
    const props = renderToolbar();
    const trigger = screen.getByRole("button", { name: "Element" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "Element erstellen" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expectStructuredItems(menu);
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "Figur" })).toHaveFocus(),
    );

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Tier" }));
    expect(props.onAddNode).toHaveBeenCalledWith("tier");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows relationships, time and paths as pressed toggles in the row, without a view menu", () => {
    stubCompactToolbar(false);
    const props = renderToolbar({ relationshipsVisible: true, timelineOpen: false });
    expect(screen.queryByRole("button", { name: "Ansicht" })).toBeNull();

    const relationships = screen.getByRole("button", { name: "Beziehungen" });
    expect(relationships).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(relationships);
    expect(props.onRelationshipsVisibleChange).toHaveBeenCalledWith(false);

    const time = screen.getByRole("button", { name: "Zeit" });
    expect(time).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(time);
    expect(props.onTimelineOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Wege" }));
    expect(props.onJourneyOverlayOpenChange).toHaveBeenCalledWith(true);
  });

  it("keeps the grid and arranging in the one overflow menu as a setting and an action", async () => {
    stubCompactToolbar(false);
    const props = renderToolbar({ snapToGrid: true });
    const trigger = screen.getByRole("button", { name: "Weitere Aktionen" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Weitere Aktionen" });

    expectStructuredItems(menu);
    const grid = within(menu).getByRole("menuitemcheckbox", { name: "Am Raster ausrichten" });
    expect(grid).toHaveAttribute("aria-checked", "true");
    fireEvent.click(grid);
    expect(props.onSnapToGridChange).toHaveBeenCalledWith(false);
    expect(within(menu).queryByRole("menuitemcheckbox", { name: "Zeit" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Automatisch anordnen" }));
    expect(props.onAlignAllNodes).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("moves time and paths into the overflow menu on a compact row, never undo", () => {
    stubCompactToolbar(true);
    const props = renderToolbar({ timelineOpen: true });
    expect(screen.queryByRole("button", { name: "Zeit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Wege" })).toBeNull();
    expect(screen.getByRole("button", { name: "Beziehungen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const menu = screen.getByRole("menu", { name: "Weitere Aktionen" });
    const time = within(menu).getByRole("menuitemcheckbox", { name: "Zeit" });
    expect(time).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Wege" }));
    expect(props.onJourneyOverlayOpenChange).toHaveBeenCalledWith(true);
  });

  it("names undo and redo plainly and the area in their group", () => {
    renderToolbar({ canUndo: true });
    expect(screen.getAllByRole("group", { name: "Verlauf: Figuren" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toHaveAttribute(
      "aria-keyshortcuts",
      expect.stringMatching(/^(Control|Meta)\+Z$/),
    );
  });

  it("uses the shared dropdown focus path for import from the overflow menu", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "Weitere Aktionen" });

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const menu = screen.getByRole("menu", { name: "Weitere Aktionen" });
    expectStructuredItems(menu);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Import" }));

    expect(inputClick).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
