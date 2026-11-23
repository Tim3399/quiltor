import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDockedStripOffset } from "./useDockedStripOffset";

let resize: (() => void) | null = null;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback;
  }
  observe() {}
  disconnect() {
    resize = null;
  }
}

function Harness({
  open,
  shift,
  height,
}: {
  open: boolean;
  shift: (dy: number) => void;
  height: { value: number };
}) {
  const ref = useRef<HTMLElement>(null);
  useDockedStripOffset(ref, open, shift);
  return open ? (
    <section
      ref={(element) => {
        ref.current = element;
        if (element)
          Object.defineProperty(element, "offsetHeight", {
            get: () => height.value,
            configurable: true,
          });
      }}
    />
  ) : null;
}

describe("useDockedStripOffset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shifts the viewport by every measured change of the strip's height", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const shift = vi.fn();
    const height = { value: 58 };
    const { rerender } = render(<Harness open shift={shift} height={height} />);
    expect(shift).toHaveBeenLastCalledWith(58);

    // Choosing a moment adds the detail row; the toggle is not involved.
    height.value = 138;
    act(() => resize?.());
    expect(shift).toHaveBeenLastCalledWith(80);

    // Back to the overview.
    height.value = 58;
    act(() => resize?.());
    expect(shift).toHaveBeenLastCalledWith(-80);

    rerender(<Harness open={false} shift={shift} height={height} />);
    expect(shift).toHaveBeenLastCalledWith(-58);
    expect(shift).toHaveBeenCalledTimes(4);
  });

  it("does not shift when the height stays the same", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const shift = vi.fn();
    const height = { value: 58 };
    render(<Harness open shift={shift} height={height} />);
    act(() => resize?.());
    expect(shift).toHaveBeenCalledTimes(1);
  });
});
