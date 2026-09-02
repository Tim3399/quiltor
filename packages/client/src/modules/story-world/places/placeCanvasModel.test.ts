import { describe, expect, it } from "vitest";
import { de } from "../../../../../../locales/de";
import type { Translate } from "../../../i18n";
import type { FigureNode } from "../model";
import {
  createMeasurementPoints,
  createPinNodes,
  createPlaceFlowNodes,
  createPlaceMapNodes,
} from "./placeCanvasModel";

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
      data: { zoomTier: "overview", zoom: 0.2 },
    });
    // Unlocked says nothing: a node claiming to be draggable overrides the
    // surface's own interactivity switch, so only the locked one spells it out.
    expect(nodes[0].draggable).toBeUndefined();
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

describe("what a distance can be taken to", () => {
  const card = (id: string, name: string, x: number, y: number) =>
    ({ id, position: { x, y }, data: { place: { id, name } } }) as Parameters<
      typeof createMeasurementPoints
    >[0][number];

  const map: FigureNode = {
    id: "welt",
    x: 0,
    y: 0,
    mapX: 100,
    mapY: 200,
    name: "Weltkarte",
    type: "ort",
    mapImageId: "sha",
    mapExpanded: true,
    mapWidth: 800,
    mapHeight: 400,
  };

  it("counts the places standing on a map, not only the ones beside it", () => {
    // A place on a laid-out map belongs to that map's own level while being
    // drawn here. Leaving those out made the things most obviously on the
    // surface the only ones that could not be measured.
    const points = createMeasurementPoints(
      [card("a", "Hafen", 10, 20), card("b", "Turm", 40, 60)],
      [],
    );
    expect(points).toEqual([
      { id: "a", name: "Hafen", mapX: 10, mapY: 20 },
      { id: "b", name: "Turm", mapX: 40, mapY: 60 },
    ]);
  });

  it("takes a map at its middle", () => {
    expect(createMeasurementPoints([], [map])).toEqual([
      { id: "welt", name: "Weltkarte", mapX: 500, mapY: 400 },
    ]);
  });

  it("puts cards and maps in one list, so any pair can be measured", () => {
    const points = createMeasurementPoints([card("a", "Hafen", 10, 20)], [map]);
    expect(points.map((point) => point.id)).toEqual(["a", "welt"]);
  });
});

describe("a card standing on a map", () => {
  const map: FigureNode = {
    id: "welt",
    x: 0,
    y: 0,
    mapX: 0,
    mapY: 0,
    name: "Weltkarte",
    type: "ort",
    mapImageId: "sha",
    mapExpanded: true,
    mapWidth: 1000,
    mapHeight: 500,
  };
  const pin: FigureNode = {
    id: "rom",
    x: 0,
    y: 0,
    name: "Rom",
    type: "ort",
    parentPlaceId: "welt",
    mapU: 0.5,
    mapV: 0.5,
  };

  const build = (livePosition?: { id: string; x: number; y: number } | null) =>
    createPinNodes({
      nodes: [map, pin],
      maps: [map],
      measuring: false,
      measureSelection: [],
      onOpenLevel: () => {},
      onExpandMap: () => {},
      sourceUrl: (id: string) => `/api/place-map?id=${id}`,
      livePosition,
      zoomTier: "detail",
      viewportZoom: 1,
      t,
    });

  it("stands where its anchor puts it on the map", () => {
    expect(build()[0].position).toEqual({ x: 500, y: 250 });
  });

  it("follows the pointer while it is being dragged", () => {
    // It is derived from the map's anchor rather than held in the flow's own
    // list, so the movement React Flow reports has nothing to be applied to --
    // without this the card sits still and appears elsewhere on release.
    expect(build({ id: "rom", x: 120, y: 40 })[0].position).toEqual({ x: 120, y: 40 });
  });

  it("ignores a drag that belongs to something else", () => {
    expect(build({ id: "welt", x: 120, y: 40 })[0].position).toEqual({ x: 500, y: 250 });
  });
});
