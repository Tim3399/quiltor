import { act, cleanup, render } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FigureNode } from "../model";
import { mapBoxOf, type PlaceMapFlowNode, PlaceMapNode } from "./PlaceMapNode";
import { mapBoxPatch } from "./placeCanvasModel";

type ResizerProps = {
  minWidth?: number;
  minHeight?: number;
  keepAspectRatio?: boolean;
  handleClassName?: string;
  lineClassName?: string;
  onResizeStart?: (event: unknown, box: Record<string, unknown>) => void;
  onResize?: (event: unknown, box: Record<string, unknown>) => void;
  onResizeEnd?: (event: unknown, box: Record<string, unknown>) => void;
};

const resizer = vi.hoisted(() => ({ props: undefined as unknown, shift: false }));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Bottom: "bottom", Top: "top" },
  NodeResizer: (props: unknown) => {
    resizer.props = props;
    return null;
  },
  useKeyPress: () => resizer.shift,
}));

afterEach(cleanup);

const place: FigureNode = { id: "m", x: 0, y: 0, name: "Welt", type: "ort" };

function renderMap() {
  const onResize = vi.fn();
  const onResizeLive = vi.fn();
  const props = {
    selected: true,
    data: {
      place,
      origin: { x: 100, y: 200 },
      source: "map.png",
      crop: { x: 0, y: 0, zoom: 1 },
      adjusting: false,
      onResize,
      onResizeLive,
      onCropDraft: () => {},
      onCropCommit: () => {},
      gridSize: 48,
      gridVisible: true,
      zoom: 1,
    },
  } as unknown as NodeProps<PlaceMapFlowNode>;
  render(<PlaceMapNode {...props} />);
  return { onResize, onResizeLive, grip: resizer.props as ResizerProps };
}

// What React Flow reports for a drag on the left grip: the origin moved with the
// width, and the gesture carries more than the box.
const leftGripDrag = { x: 40, y: 200, width: 860, height: 600, direction: [-1, 0] };

describe("resizing a map by its grips", () => {
  it("refuses to shrink a map below 120 by 80 flow units", () => {
    const { grip } = renderMap();
    expect(grip.minWidth).toBe(120);
    expect(grip.minHeight).toBe(80);
  });

  it("reports the dragged box, origin included, while the gesture runs", () => {
    const { grip, onResizeLive, onResize } = renderMap();
    grip.onResize?.({}, leftGripDrag);
    expect(onResizeLive).toHaveBeenCalledWith(place, { x: 40, y: 200, width: 860, height: 600 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("hands over only the four box fields, not the rest of the gesture", () => {
    const { grip, onResizeLive } = renderMap();
    grip.onResize?.({}, leftGripDrag);
    expect(Object.keys(onResizeLive.mock.calls[0][1]).sort()).toEqual([
      "height",
      "width",
      "x",
      "y",
    ]);
  });

  it("reduces a gesture report to a box without aliasing it", () => {
    const reduced = mapBoxOf(leftGripDrag);
    expect(reduced).toEqual({ x: 40, y: 200, width: 860, height: 600 });
    expect(reduced).not.toBe(leftGripDrag);
  });

  it("keeps the opposite edge where it was when a left grip is released", () => {
    const { grip, onResize } = renderMap();
    grip.onResizeEnd?.({}, leftGripDrag);
    const written = mapBoxPatch(onResize.mock.calls[0][1]);
    expect(written).toEqual({ mapX: 40, mapY: 200, mapWidth: 860, mapHeight: 600 });
    // The map stood at x 100 with width 800, so its right edge was at 900.
    expect((written.mapX ?? 0) + (written.mapWidth ?? 0)).toBe(900);
  });
});

describe("keeping a map's proportions", () => {
  function renderGrips() {
    const onResize = vi.fn();
    const props = {
      selected: true,
      data: {
        place,
        origin: { x: 0, y: 0 },
        source: "map.png",
        crop: { x: 0, y: 0, zoom: 1 },
        adjusting: false,
        onResize,
        onResizeLive: vi.fn(),
        onCropDraft: () => {},
        onCropCommit: () => {},
        gridSize: 48,
        gridVisible: true,
        zoom: 1,
      },
    } as unknown as NodeProps<PlaceMapFlowNode>;
    const view = render(<PlaceMapNode {...props} />);
    return {
      onResize,
      grip: () => resizer.props as ResizerProps,
      rerender: () => view.rerender(<PlaceMapNode {...props} />),
    };
  }
  const start = { x: 0, y: 0, width: 1500, height: 1000 };
  const end = { x: 0, y: 0, width: 1800, height: 1200 };

  afterEach(() => {
    resizer.shift = false;
  });

  it("keeps the proportions unless Shift is held, and its grips ignore the selection key", () => {
    const { grip } = renderGrips();
    expect(grip().keepAspectRatio).toBe(true);
    expect(grip().handleClassName?.split(" ")).toContain("nokey");
    expect(grip().lineClassName?.split(" ")).toContain("nokey");
  });

  it("freezes the mode at the start: Shift let go halfway leaves the gesture free", () => {
    resizer.shift = true;
    const { grip, rerender, onResize } = renderGrips();
    act(() => grip().onResizeStart?.({}, start));
    expect(grip().keepAspectRatio).toBe(false);
    resizer.shift = false;
    rerender();
    expect(grip().keepAspectRatio).toBe(false);
    act(() => grip().onResizeEnd?.({}, end));
    expect(onResize).toHaveBeenCalledWith(place, end, { start, free: true });
    // Once the gesture is over, the key decides again.
    expect(grip().keepAspectRatio).toBe(true);
  });

  it("hands the drawn start of the gesture to the end", () => {
    const { grip, onResize } = renderGrips();
    act(() => grip().onResizeStart?.({}, { ...start, direction: [1, 1] }));
    act(() => grip().onResizeEnd?.({}, end));
    expect(onResize).toHaveBeenCalledWith(place, end, { start, free: false });
  });
});
