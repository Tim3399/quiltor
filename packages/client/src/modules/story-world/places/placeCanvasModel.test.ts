import { describe, expect, it } from "vitest";
import { de } from "../../../../../../locales/de";
import type { Translate } from "../../../i18n";
import type { FigureNode } from "../model";
import { createPlaceFlowNodes, createPlaceMapNodes } from "./placeCanvasModel";

const t = ((key: keyof typeof de, variables?: Record<string, string | number>) => {
  let value: string = de[key];
  for (const [name, replacement] of Object.entries(variables ?? {})) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}) as Translate;

const places: FigureNode[] = [
  { id: "a", x: 1, y: 2, mapX: 10, mapY: 20, name: "A", type: "ort" },
  { id: "b", x: 3, y: 4, name: "B", type: "ort", pinned: true, important: true },
];

describe("place canvas model", () => {
  it("projects persisted map coordinates, lock/favorite data and semantic LOD", () => {
    const nodes = createPlaceFlowNodes({
      nodes: places,
      onOpenLevel: () => {},
      onExpandMap: () => {},
      sourceUrl: (id: string) => `/api/place-map?id=${id}`,
      places,
      measuring: false,
      measureSelection: [],
      zoomTier: "overview",
      viewportZoom: 0.2,
      t,
    });

    expect(nodes[0]).toMatchObject({
      position: { x: 10, y: 20 },
      ariaLabel: "Ort: A",
      ariaRole: "group",
      draggable: true,
      data: { zoomTier: "overview", zoom: 0.2 },
    });
    expect(nodes[1]).toMatchObject({
      position: { x: 3, y: 4 },
      draggable: false,
      data: { place: { important: true, pinned: true } },
    });
  });

  it("marks exactly the first measurement selection", () => {
    const nodes = createPlaceFlowNodes({
      nodes: places,
      onOpenLevel: () => {},
      onExpandMap: () => {},
      sourceUrl: (id: string) => `/api/place-map?id=${id}`,
      places,
      measuring: true,
      measureSelection: ["b"],
      zoomTier: "detail",
      viewportZoom: 1,
      t,
    });

    expect(nodes.map((node) => node.data.measureStart)).toEqual([false, true]);
  });
});

describe("a map laid out on the level", () => {
  const map: FigureNode = {
    id: "m",
    x: 0,
    y: 0,
    mapX: 100,
    mapY: 200,
    name: "Weltkarte",
    type: "ort",
    mapImageId: "sha",
    mapExpanded: true,
    mapWidth: 800,
    mapHeight: 600,
  };

  const build = (overrides: Partial<Parameters<typeof createPlaceMapNodes>[0]> = {}) =>
    createPlaceMapNodes({
      places: [map],
      sourceUrl: (id: string) => `/api/place-map?id=${id}`,
      onResize: () => {},
      onResizeLive: () => {},
      onCropDraft: () => {},
      onCropCommit: () => {},
      cropOverride: null,
      adjustingId: undefined,
      liveSize: null,
      livePosition: null,
      gridSize: 48,
      zoom: 1,
      picturesVisible: true,
      gridVisible: true,
      ...overrides,
    });

  it("stands where the level remembers it", () => {
    expect(build()[0].position).toEqual({ x: 100, y: 200 });
  });

  it("follows the pointer while a drag is running", () => {
    // Without this the map would sit still through the whole gesture and appear
    // at its new place the moment the pointer is let go: React Flow reports the
    // movement as a change, and a derived node is not in the list those changes
    // are applied to.
    const nodes = build({ livePosition: { id: "m", x: 340, y: 90 } });
    expect(nodes[0].position).toEqual({ x: 340, y: 90 });
  });

  it("ignores a drag that belongs to a different map", () => {
    const nodes = build({ livePosition: { id: "other", x: 340, y: 90 } });
    expect(nodes[0].position).toEqual({ x: 100, y: 200 });
  });

  it("follows a resize handle the same way", () => {
    const nodes = build({ liveSize: { id: "m", width: 1200, height: 900 } });
    expect(nodes[0]).toMatchObject({ width: 1200, height: 900 });
  });
});
