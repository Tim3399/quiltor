/// <reference types="node" />
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../language";
import { CommandPalette } from "./CommandPalette";
import { Dialog } from "./Dialog";
import { Menu, MenuItem } from "./Menu";
import { Popover } from "./Popover";
import { SegmentedControl } from "./SegmentedControl";
import { Sheet } from "./Sheet";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("adaptive UI primitives", () => {
  it("uses roving focus and arrow selection in segmented controls", () => {
    function Example() {
      const [value, setValue] = useState("a");
      return (
        <SegmentedControl
          label="Ansicht"
          value={value}
          onChange={setValue}
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
        />
      );
    }
    render(<Example />);
    const first = screen.getByRole("radio", { name: "A" }),
      second = screen.getByRole("radio", { name: "B" });
    expect(first).toHaveAttribute("tabindex", "0");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-checked", "true");
    expect(first).toHaveAttribute("tabindex", "-1");
  });

  it("moves through enabled menu items with arrows and closes with Escape", () => {
    const close = vi.fn();
    render(
      <Menu label="Aktionen" onClose={close}>
        <MenuItem onSelect={() => undefined}>Eins</MenuItem>
        <MenuItem disabled onSelect={() => undefined}>
          Gesperrt
        </MenuItem>
        <MenuItem onSelect={() => undefined}>Zwei</MenuItem>
      </Menu>,
    );
    const first = screen.getByRole("menuitem", { name: "Eins" }),
      second = screen.getByRole("menuitem", { name: "Zwei" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps a popover inside window edges", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 290,
      right: 310,
      top: 194,
      bottom: 214,
      width: 20,
      height: 20,
      x: 290,
      y: 194,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("ui-popover"))
        return {
          left: 0,
          right: 160,
          top: 0,
          bottom: 100,
          width: 160,
          height: 100,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      return {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
    render(
      <Popover anchorRef={{ current: anchor }} open label="Werkzeuge" onClose={() => undefined}>
        <button>Aktion</button>
      </Popover>,
    );
    const popover = screen.getByRole("dialog", { name: "Werkzeuge" });
    await waitFor(() => expect(popover).toHaveStyle({ left: "148px", top: "88px" }));
    anchor.remove();
  });

  it("closes a popover on outside pointer input and restores its trigger", async () => {
    function Example() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={trigger} onClick={() => setOpen(true)}>
            Öffnen
          </button>
          <Popover anchorRef={trigger} open={open} label="Aktionen" onClose={() => setOpen(false)}>
            <button>Innen</button>
          </Popover>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Öffnen" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Aktionen" })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes a popover when its scroll context changes", async () => {
    function Example() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <div data-testid="scroller">
          <button ref={trigger}>Auslöser</button>
          <Popover
            anchorRef={trigger}
            open={open}
            label="Scrollaktionen"
            onClose={() => setOpen(false)}
          >
            <button>Innen</button>
          </Popover>
        </div>
      );
    }
    render(<Example />);
    fireEvent.scroll(screen.getByTestId("scroller"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Scrollaktionen" })).not.toBeInTheDocument(),
    );
  });

  it("turns a compact popover into a modal sheet", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor}>Auslöser</button>
        <Popover anchorRef={anchor} open label="Kompakte Aktionen" onClose={() => undefined}>
          <button>Aktion</button>
        </Popover>
      </>,
    );
    expect(screen.getByRole("dialog", { name: "Kompakte Aktionen" })).toHaveClass("ui-sheet");
  });

  it("closes only the topmost nested overlay with Escape", () => {
    const closeOuter = vi.fn(),
      closeInner = vi.fn();
    render(
      <LanguageProvider>
        <Dialog title="Außen" onClose={closeOuter}>
          <Dialog title="Innen" onClose={closeInner}>
            <button>Aktion</button>
          </Dialog>
        </Dialog>
      </LanguageProvider>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeInner).toHaveBeenCalledOnce();
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it("restores focus when a sheet closes", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const close = () => undefined;
    const { rerender } = render(
      <Sheet open label="Details" onClose={close}>
        <button>Aktion</button>
      </Sheet>,
    );
    rerender(
      <Sheet open={false} label="Details" onClose={close}>
        <button>Aktion</button>
      </Sheet>,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  // React's own `autoFocus` prop never reaches the DOM as an attribute, so the overlay's focus frame
  // used to find nothing and park focus on the container instead -- the search field of the command
  // palette and the title field of the world sheet both opened unfocused because of it.
  it("gives first focus to the element an overlay marks with data-autofocus", async () => {
    const close = () => undefined;
    render(
      <Sheet open label="Details" onClose={close}>
        <button>Erste</button>
        <input data-autofocus aria-label="Titel" />
      </Sheet>,
    );
    await waitFor(() => expect(screen.getByLabelText("Titel")).toHaveFocus());
  });

  it("filters and executes commands with the keyboard", () => {
    const run = vi.fn(),
      close = vi.fn();
    render(
      <LanguageProvider>
        <CommandPalette
          open
          label="Befehle"
          placeholder="Suchen"
          emptyLabel="Nichts gefunden"
          onClose={close}
          items={[
            { id: "one", label: "Manuskript öffnen", onSelect: run },
            { id: "two", label: "Timeline öffnen", onSelect: vi.fn() },
          ]}
        />
      </LanguageProvider>,
    );
    const input = screen.getByPlaceholderText("Suchen");
    fireEvent.change(input, { target: { value: "Manu" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps reduced-motion behavior in the shared motion foundation", () => {
    const motionCss = readFileSync(join(process.cwd(), "src/design/motion.css"), "utf8");
    expect(motionCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(motionCss).toContain("animation-duration: var(--motion-instant) !important");
    expect(motionCss).toContain("transition-duration: var(--motion-instant) !important");
  });
});
