import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

afterEach(() => {
  cleanup();
  if (originalScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

function setup(items?: CommandPaletteItem[]) {
  const onClose = vi.fn();
  const onQueryChange = vi.fn();
  const first = vi.fn();
  const second = vi.fn();
  render(
    <CommandPalette
      open
      label="Befehle"
      closeLabel="Palette schließen"
      inputLabel="Befehl suchen"
      placeholder="Suchen"
      emptyLabel="Nichts gefunden"
      onClose={onClose}
      onQueryChange={onQueryChange}
      items={
        items ?? [
          { id: "one", label: "Manuskript öffnen", detail: "Kapitel", onSelect: first },
          { id: "two", label: "Timeline öffnen", keywords: ["Moment"], onSelect: second },
        ]
      }
    />,
  );
  return { first, second, onClose, onQueryChange };
}

describe("CommandPalette", () => {
  it("exposes an explicitly labelled combobox and filters across item copy", () => {
    const { onQueryChange } = setup();
    const input = screen.getByRole("combobox", { name: "Befehl suchen" });
    expect(input).toHaveAttribute("aria-controls");

    fireEvent.change(input, { target: { value: "Moment" } });
    expect(onQueryChange).toHaveBeenCalledWith("Moment");
    expect(screen.queryByRole("option", { name: /Manuskript/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Timeline/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("executes the active command and closes the palette", () => {
    const { first, onClose } = setup();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Manu" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
  });

  it("skips disabled commands during arrow navigation", () => {
    const first = vi.fn();
    const third = vi.fn();
    setup([
      { id: "one", label: "Erster", onSelect: first },
      { id: "two", label: "Gesperrt", disabled: true, onSelect: vi.fn() },
      { id: "three", label: "Dritter", onSelect: third },
    ]);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Dritter" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(third).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("renders query-gated items only after input and announces an empty result", () => {
    setup([
      {
        id: "hidden",
        label: "Versteckter Treffer",
        requiresQuery: true,
        onSelect: vi.fn(),
      },
    ]);
    const input = screen.getByRole("combobox");
    expect(screen.getByRole("status")).toHaveTextContent("Nichts gefunden");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");

    fireEvent.change(input, { target: { value: "Treffer" } });
    expect(screen.getByRole("option", { name: "Versteckter Treffer" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(screen.getByText("Treffer", { selector: "mark" })).toBeInTheDocument();
  });

  it("uses caller-owned copy for both dialog close and empty state", () => {
    setup([]);
    expect(screen.getByRole("button", { name: "Palette schließen" })).toBeInTheDocument();
    expect(screen.getByText("Nichts gefunden")).toBeInTheDocument();
  });

  it("keeps keyboard navigation visible in a long result list", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    setup(
      Array.from({ length: 18 }, (_, index) => ({
        id: `item-${index}`,
        label: `Eintrag ${String(index + 1).padStart(2, "0")}`,
        onSelect: vi.fn(),
      })),
    );
    scrollIntoView.mockClear();
    const input = screen.getByRole("combobox");
    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }

    expect(screen.getByRole("option", { name: "Eintrag 13" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
  });
});
