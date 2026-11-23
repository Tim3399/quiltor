import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureNode, FigureState } from "../model";
import { atMapEdge } from "./placeCanvasModel";
import { usePlaceCanvas } from "./usePlaceCanvas";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  useUpdateNodeInternals: () => () => undefined,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// A 1000 x 1000 sheet on a 1000 x 500 surface: the zoom floor is exactly 1.
const sheet: FigureNode = {
  id: "sheet",
  name: "Hafenstadt",
  type: "ort",
  x: 0,
  y: 0,
  mapImageId: "image",
  mapWidth: 1000,
  mapHeight: 1000,
};
const state: FigureState = { nodes: [sheet], edges: [] };

// Stable references: fresh ones on every render would feed the hook's effects forever.
const NONE: never[] = [];
const noop = vi.fn();
const imageUrl = (id: string) => `/${id}`;

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider>{children}</I18nProvider>
  );
  const view = renderHook(
    () =>
      usePlaceCanvas({
        state,
        places: NONE,
        levelId: "sheet",
        measuring: false,
        measureSelection: NONE,
        measurePoints: NONE,
        onOpenLevel: noop,
        mapImageUrl: imageUrl,
        onExpandMap: noop,
        onPlaceDisplayChange: noop,
        onResizeMap: noop,
        onCropMap: noop,
        adjustingId: undefined,
        levelScale: undefined,
        onChange: noop,
      }),
    { wrapper },
  );
  act(() => view.result.current.onSurfaceResize({ width: 1000, height: 500 }));
  return view;
}

const moveTo = (view: ReturnType<typeof mount>, zoom: number) =>
  act(() => view.result.current.onMove({ x: 0, y: 0, zoom }));

describe("the map edge hint", () => {
  it("is held to the map by default, with the floor at the sheet", () => {
    const view = mount();
    expect(view.result.current.boundToGround).toBe(true);
    expect(view.result.current.minZoom).toBe(1);
    expect(view.result.current.mapEdgeReached).toBe(false);
  });

  it("appears when a zoom-out arrives at the edge, and not before", () => {
    const view = mount();
    moveTo(view, 2);
    expect(view.result.current.mapEdgeReached).toBe(false);
    moveTo(view, 1.2);
    expect(view.result.current.mapEdgeReached).toBe(false);
    moveTo(view, 1);
    expect(view.result.current.mapEdgeReached).toBe(true);
  });

  it("does not repeat itself while the view rests on the edge", () => {
    vi.useFakeTimers();
    const view = mount();
    moveTo(view, 1);
    expect(view.result.current.mapEdgeReached).toBe(true);
    act(() => vi.advanceTimersByTime(7000));
    expect(view.result.current.mapEdgeReached).toBe(false);
    moveTo(view, 1);
    expect(view.result.current.mapEdgeReached).toBe(false);
  });

  it("stays silent for a view that opened on the edge", () => {
    const view = mount();
    act(() => view.result.current.onInit({ getZoom: () => 1 } as never));
    moveTo(view, 1);
    expect(view.result.current.mapEdgeReached).toBe(false);
  });

  it("goes as soon as the view leaves the edge", () => {
    const view = mount();
    moveTo(view, 1);
    moveTo(view, 1.5);
    expect(view.result.current.mapEdgeReached).toBe(false);
  });

  it("lets go of the map when the view is no longer limited, and says nothing further out", () => {
    const view = mount();
    moveTo(view, 1);
    act(() => view.result.current.setBoundToGround(false));
    expect(view.result.current.mapEdgeReached).toBe(false);
    expect(view.result.current.minZoom).toBeUndefined();
    expect(view.result.current.translateExtent).toBeUndefined();
    moveTo(view, 0.4);
    expect(view.result.current.mapEdgeReached).toBe(false);
  });
});

describe("atMapEdge", () => {
  it("counts a zoom on the floor, within rounding, as the edge", () => {
    expect(atMapEdge(0.5, 0.5)).toBe(true);
    expect(atMapEdge(0.4999, 0.5)).toBe(true);
    expect(atMapEdge(0.52, 0.5)).toBe(false);
  });

  it("knows no edge where nothing limits the view", () => {
    expect(atMapEdge(0.01, undefined)).toBe(false);
  });
});
