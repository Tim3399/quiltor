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
});

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

describe("FigureToolbar menus", () => {
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

  it("routes every view action through the shared dropdown contract", async () => {
    const props = renderToolbar();
    const trigger = screen.getByRole("button", { name: "Ansicht" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Ansicht" });

    expectStructuredItems(menu);
    expect(within(menu).getByRole("menuitem", { name: "Anordnen" })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: "Beziehungen ausblenden" })).toBeEnabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Wege einblenden" }));

    expect(props.onJourneyOverlayOpenChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("uses the shared dropdown focus path for the manage/import menu", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "Verwalten" });

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const menu = screen.getByRole("menu", { name: "Verwalten" });
    expectStructuredItems(menu);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Import" }));

    expect(inputClick).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
