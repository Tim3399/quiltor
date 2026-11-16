import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLTIP_HOVER_DELAY_MS, Tooltip } from "./Tooltip";

function renderTooltip() {
  render(
    <Tooltip content="Nur mit Premium">
      {(props) => (
        <button type="button" {...props}>
          Server-KI
        </button>
      )}
    </Tooltip>,
  );
  return screen.getByRole("button", { name: "Server-KI" });
}

describe("Tooltip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("describes its trigger while closed and stays hidden", () => {
    const trigger = renderTooltip();
    expect(trigger).toHaveAccessibleDescription("Nur mit Premium");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on hover after the delay and closes when the pointer leaves", () => {
    const trigger = renderTooltip();
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Nur mit Premium");
    fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens at once on keyboard focus and closes on blur and Escape", () => {
    const trigger = renderTooltip();
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("toggles on a tap, since touch has no hover", () => {
    const trigger = renderTooltip();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
