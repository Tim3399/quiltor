import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureNode } from "../model";
import { FigureNodeContextMenu, type FigureNodeMenuState } from "./FigureNodeContextMenu";

const nodes: FigureNode[] = [
  { id: "ada", x: 0, y: 0, name: "Ada", type: "person", important: false },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function MenuHarness() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<FigureNodeMenuState | null>(null);
  return (
    <I18nProvider>
      <button
        ref={trigger}
        type="button"
        onClick={() => setMenu({ id: "ada", x: 80, y: 60, trigger: trigger.current })}
      >
        Ada öffnen
      </button>
      <button type="button">Außerhalb</button>
      <FigureNodeContextMenu
        menu={menu}
        nodes={nodes}
        onClose={() => setMenu(null)}
        onOpenInspector={vi.fn()}
        onConnect={vi.fn()}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("FigureNodeContextMenu", () => {
  it("portals and clamps the menu at every viewport edge", () => {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 240);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("node-context-menu")) {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 220,
          bottom: 180,
          width: 220,
          height: 180,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 40,
        bottom: 40,
        width: 40,
        height: 40,
        toJSON: () => ({}),
      };
    });
    const callbacks = {
      onClose: vi.fn(),
      onOpenInspector: vi.fn(),
      onConnect: vi.fn(),
      onPatch: vi.fn(),
      onDelete: vi.fn(),
    };
    const view = render(
      <I18nProvider>
        <FigureNodeContextMenu menu={{ id: "ada", x: 999, y: 999 }} nodes={nodes} {...callbacks} />
      </I18nProvider>,
    );

    const menu = screen.getByRole("menu", { name: "Elementaktionen" });
    const panel = menu.closest<HTMLElement>("[data-figure-node-context-menu]");
    expect(panel?.parentElement).toBe(document.body);
    expect(panel).toHaveStyle({ left: "88px", top: "48px" });

    view.rerender(
      <I18nProvider>
        <FigureNodeContextMenu menu={{ id: "ada", x: -40, y: -60 }} nodes={nodes} {...callbacks} />
      </I18nProvider>,
    );
    expect(panel).toHaveStyle({ left: "12px", top: "12px" });
    expect(screen.getByRole("menuitem", { name: "Element löschen" })).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });

  it("closes on Escape and restores focus to the originating node", async () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole("button", { name: "Ada öffnen" });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Im Inspector öffnen" })).toHaveFocus(),
    );

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes only for an outside pointer and restores focus", async () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole("button", { name: "Ada öffnen" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");

    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Als wichtig markieren" }));
    expect(menu).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Außerhalb" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
