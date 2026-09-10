import { describe, expect, it } from "vitest";
import type { FigureNode } from "../model";
import {
  activePlaceMapForSelection,
  projectMapChrome,
  projectMapVisualClip,
  resolveActivePlaceMap,
} from "./placeMapChromeModel";

const first: FigureNode = {
  id: "karte-a",
  type: "ort",
  name: "Weltkarte",
  x: 0,
  y: 0,
  mapImageId: "bild-a",
  mapExpanded: true,
};
const second: FigureNode = { ...first, id: "karte-b", name: "Seekarte" };
const child: FigureNode = {
  id: "hafen",
  type: "ort",
  name: "Hafen",
  x: 0,
  y: 0,
  parentPlaceId: first.id,
};

describe("active place map", () => {
  it("uses the sole expanded map without requiring selection", () => {
    expect(resolveActivePlaceMap([first, child], undefined, undefined)).toBe(first);
    expect(resolveActivePlaceMap([first, second], undefined, undefined)).toBeUndefined();
  });

  it("resolves map clicks and direct child selections on the current level", () => {
    const nodes = [first, second, child, { ...child, id: "kai", parentPlaceId: child.id }];
    expect(activePlaceMapForSelection(nodes, undefined, first.id)).toBe(first);
    expect(activePlaceMapForSelection(nodes, undefined, second.id)).toBe(second);
    expect(activePlaceMapForSelection(nodes, undefined, child.id)).toBe(first);
    expect(activePlaceMapForSelection(nodes, undefined, "kai")).toBeUndefined();
    expect(activePlaceMapForSelection(nodes, first.id, child.id)).toBeUndefined();
  });

  it("keeps the remembered surface and rejects deleted or collapsed identities", () => {
    const active = { levelId: undefined, mapId: first.id };
    expect(resolveActivePlaceMap([first, second, child], undefined, active)).toBe(first);
    expect(resolveActivePlaceMap([second, child], undefined, active)).toBe(second);
    expect(
      resolveActivePlaceMap([{ ...first, mapExpanded: false }, second], undefined, active),
    ).toBe(second);
    expect(
      resolveActivePlaceMap([{ ...first, mapImageId: undefined }], undefined, active),
    ).toBeUndefined();
    expect(resolveActivePlaceMap([], undefined, active)).toBeUndefined();
  });

  it("never carries a remembered identity between levels", () => {
    const nested = { ...first, parentPlaceId: child.id };
    expect(
      resolveActivePlaceMap([nested, { ...second, parentPlaceId: child.id }], child.id, {
        levelId: undefined,
        mapId: first.id,
      }),
    ).toBeUndefined();
    expect(
      resolveActivePlaceMap([nested], undefined, { levelId: child.id, mapId: first.id }),
    ).toBeUndefined();
  });
});

describe("projectMapChrome", () => {
  const safe = { x: 14, y: 14, width: 972, height: 700 };
  const size = { headerHeight: 56, footerHeight: 60 };

  it("docks outside a fully visible map without changing its rectangle", () => {
    const map = { x: 100, y: 200, width: 600, height: 400 };
    expect(projectMapChrome(map, { x: 0, y: 0, zoom: 1 }, safe, size)).toEqual({
      left: 100,
      width: 600,
      headerTop: 144,
      footerTop: 600,
      imageTop: 200,
      imageHeight: 400,
      frameHeight: 516,
    });
    expect(map).toEqual({ x: 100, y: 200, width: 600, height: 400 });
  });

  it("projects viewport pan and zoom and keeps clipped edges reachable", () => {
    expect(
      projectMapChrome(
        { x: 100, y: 200, width: 2000, height: 1800 },
        { x: -100, y: -250, zoom: 0.5 },
        safe,
        size,
      ),
    ).toEqual({
      left: 14,
      width: 936,
      headerTop: 14,
      footerTop: 654,
      imageTop: 70,
      imageHeight: 584,
      frameHeight: 700,
    });
  });

  it("hides offscreen maps, tiny visible corners and overlapping bars", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    expect(
      projectMapChrome({ x: 1100, y: 200, width: 600, height: 400 }, viewport, safe, size),
    ).toBeUndefined();
    expect(
      projectMapChrome({ x: 970, y: 200, width: 600, height: 400 }, viewport, safe, size),
    ).toBeUndefined();
    expect(
      projectMapChrome({ x: 100, y: 700, width: 600, height: 400 }, viewport, safe, size),
    ).toBeUndefined();
    expect(
      projectMapChrome(
        { x: 100, y: 0, width: 600, height: 1000 },
        viewport,
        { ...safe, height: 130 },
        size,
      ),
    ).toBeUndefined();
  });

  it("honors measured wrapped bars and rejects invalid geometry", () => {
    const map = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(
      projectMapChrome(
        map,
        { x: 0, y: 0, zoom: 1 },
        { x: 74, y: 14, width: 302, height: 500 },
        { headerHeight: 106, footerHeight: 64 },
      ),
    ).toEqual({
      left: 74,
      width: 302,
      headerTop: 14,
      footerTop: 450,
      imageTop: 120,
      imageHeight: 330,
      frameHeight: 500,
    });
    expect(projectMapChrome(map, { x: 0, y: 0, zoom: 0 }, safe)).toBeUndefined();
    expect(
      projectMapChrome({ ...map, width: Number.NaN }, { x: 0, y: 0, zoom: 1 }, safe),
    ).toBeUndefined();
  });

  it("does not let stale narrow measurements hide a wider chrome before it can mount", () => {
    expect(
      projectMapChrome(
        { x: 0, y: 0, width: 1000, height: 1000 },
        { x: 0, y: 0, zoom: 1 },
        { x: 14, y: 14, width: 800, height: 160 },
        { headerHeight: 106, footerHeight: 64, measuredWidth: 302 },
      ),
    ).toEqual({
      left: 14,
      width: 800,
      headerTop: 14,
      footerTop: 132,
      imageTop: 60,
      imageHeight: 72,
      frameHeight: 160,
    });
  });

  it("moves the complete footer above a minimap and keeps shared frame edges", () => {
    expect(
      projectMapChrome(
        { x: 100, y: 200, width: 800, height: 400 },
        { x: 0, y: 0, zoom: 1 },
        safe,
        size,
        { bounds: safe, obstacles: [{ x: 750, y: 550, width: 236, height: 164 }] },
      ),
    ).toEqual({
      left: 100,
      width: 800,
      headerTop: 144,
      footerTop: 490,
      imageTop: 200,
      imageHeight: 290,
      frameHeight: 406,
    });
  });

  it("leaves a fully visible footer wide when its row does not cross the minimap", () => {
    expect(
      projectMapChrome(
        { x: 100, y: 200, width: 800, height: 200 },
        { x: 0, y: 0, zoom: 1 },
        safe,
        size,
        { bounds: safe, obstacles: [{ x: 750, y: 550, width: 236, height: 164 }] },
      ),
    ).toEqual({
      left: 100,
      width: 800,
      headerTop: 144,
      footerTop: 400,
      imageTop: 200,
      imageHeight: 200,
      frameHeight: 316,
    });
  });

  it("keeps a narrow footer complete by moving it above an obstacle", () => {
    expect(
      projectMapChrome(
        { x: 100, y: 200, width: 300, height: 400 },
        { x: 0, y: 0, zoom: 1 },
        safe,
        size,
        { bounds: safe, obstacles: [{ x: 250, y: 550, width: 736, height: 164 }] },
      ),
    ).toEqual({
      left: 100,
      width: 300,
      headerTop: 144,
      footerTop: 490,
      imageTop: 200,
      imageHeight: 290,
      frameHeight: 406,
    });
  });

  it("converts the shared image rectangle into world-space visual insets", () => {
    const map = { x: 100, y: 200, width: 2000, height: 1800 };
    const viewport = { x: -100, y: -250, zoom: 0.5 };
    const layout = projectMapChrome(map, viewport, safe, size);
    if (!layout) throw new Error("Expected a visible map frame");
    expect(projectMapVisualClip("weltkarte", map, viewport, layout)).toEqual({
      mapId: "weltkarte",
      bounds: { x: 228, y: 640, width: 1872, height: 1168 },
      top: 440,
      right: 0,
      bottom: 192,
      left: 128,
    });
  });
});
