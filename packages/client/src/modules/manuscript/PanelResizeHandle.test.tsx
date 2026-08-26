import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { PanelResizeHandle } from "./PanelResizeHandle";

describe("PanelResizeHandle", () => {
  it("maps keyboard directions to the physical panel edge and clamps values", () => {
    const containerRef = createRef<HTMLElement>();
    const endChange = vi.fn();
    const { rerender } = render(
      <PanelResizeHandle
        containerRef={containerRef}
        edge="end"
        label="Navigation resize"
        value={246}
        min={220}
        max={250}
        onChange={endChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(endChange).toHaveBeenCalledWith(250);

    const startChange = vi.fn();
    rerender(
      <PanelResizeHandle
        containerRef={containerRef}
        edge="start"
        label="Inspector resize"
        value={294}
        min={240}
        max={380}
        onChange={startChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(startChange).toHaveBeenCalledWith(304);
  });
});
