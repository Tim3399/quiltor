import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("exposes a named radio group with roving tab stops", () => {
    render(
      <SegmentedControl
        label="Ansicht"
        value="cards"
        options={[
          { value: "cards", label: "Karten" },
          { value: "list", label: "Liste" },
        ]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Ansicht" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Karten" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Liste" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves and selects with arrows while skipping disabled segments", () => {
    const change = vi.fn();
    render(
      <SegmentedControl
        label="Ansicht"
        value="cards"
        options={[
          { value: "cards", label: "Karten" },
          { value: "board", label: "Board", disabled: true },
          { value: "list", label: "Liste" },
        ]}
        onChange={change}
      />,
    );
    const cards = screen.getByRole("radio", { name: "Karten" });
    cards.focus();
    fireEvent.keyDown(cards, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Liste" })).toHaveFocus();
    expect(change).toHaveBeenCalledWith("list");
  });

  it("supports Home and End", () => {
    const change = vi.fn();
    render(
      <SegmentedControl
        label="Ansicht"
        value="middle"
        options={[
          { value: "first", label: "Erste" },
          { value: "middle", label: "Mitte" },
          { value: "last", label: "Letzte" },
        ]}
        onChange={change}
      />,
    );
    const middle = screen.getByRole("radio", { name: "Mitte" });
    middle.focus();
    fireEvent.keyDown(middle, { key: "End" });
    expect(change).toHaveBeenLastCalledWith("last");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Letzte" }), { key: "Home" });
    expect(change).toHaveBeenLastCalledWith("first");
  });

  it("keeps a segment locked with a hint focusable and described, but never chosen", () => {
    const change = vi.fn();
    render(
      <SegmentedControl
        label="KI-Engine"
        value="own"
        options={[
          { value: "server", label: "Server-KI", disabled: true, hint: "Nur mit Premium" },
          { value: "own", label: "Eigener Schlüssel" },
        ]}
        onChange={change}
      />,
    );
    const locked = screen.getByRole("radio", { name: "Server-KI" });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).not.toBeDisabled();
    expect(locked).toHaveAccessibleDescription("Nur mit Premium");
    // A small lock marks the segment at all times; the reason itself waits for hover or focus.
    expect(locked.querySelector(".ui-segmented__lock svg")).not.toBeNull();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Eigener Schlüssel" }).querySelector(".ui-segmented__lock"),
    ).toBeNull();
    fireEvent.click(locked);
    const own = screen.getByRole("radio", { name: "Eigener Schlüssel" });
    own.focus();
    fireEvent.keyDown(own, { key: "ArrowLeft" });
    expect(locked).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
    fireEvent.focus(locked);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Nur mit Premium");
  });
});
