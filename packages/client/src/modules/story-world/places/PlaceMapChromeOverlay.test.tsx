import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceMapChromeProps } from "./PlaceMapChrome";
import { type ActivePlaceMapChromeProps, PlaceMapChromeOverlay } from "./PlaceMapChromeOverlay";
import type { PlaceCanvasController } from "./usePlaceCanvas";

const layouts: PlaceMapChromeProps["layout"][] = [];

vi.mock("@xyflow/react", () => ({ useViewport: () => ({ x: 0, y: 0, zoom: 1 }) }));
vi.mock("./PlaceMapFrameContext", () => ({
  usePlaceMapVisualClipPublisher: () => () => undefined,
}));
vi.mock("./PlaceMapChrome", () => ({
  // Stands in for the real chrome: it reports a header taller than the 46 px default, the way
  // the real one reports from its own layout effect.
  PlaceMapChrome: ({ layout, onSize }: PlaceMapChromeProps) => {
    layouts.push(layout);
    useLayoutEffect(() => onSize?.({ headerHeight: 60, footerHeight: 42 }), [onSize]);
    return null;
  },
}));

describe("PlaceMapChromeOverlay", () => {
  afterEach(() => {
    layouts.length = 0;
    vi.restoreAllMocks();
  });

  it("keeps the measured header for a wide map instead of falling back to the default", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    const controller = {
      nodes: [
        {
          id: "m",
          type: "placeMap",
          position: { x: 0, y: 100 },
          width: 700,
          height: 400,
          data: {},
        },
      ],
    } as unknown as PlaceCanvasController;
    const chrome = { map: { id: "m" } } as unknown as ActivePlaceMapChromeProps;

    render(
      <div>
        <PlaceMapChromeOverlay controller={controller} chrome={chrome} measuring={false} />
      </div>,
    );

    // 700 px wide is the full density; the measurement was taken at that width, so it holds:
    // the header sits 60 px above the map top at 100, not the default 46.
    expect(layouts.at(-1)?.headerTop).toBe(40);
  });
});
