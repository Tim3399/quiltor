import { describe, expect, it } from "vitest";
import { de } from "../../../../../../locales/de";
import type { Translate } from "../../../i18n";
import type { FigureNode } from "../model";
import { createPlaceFlowNodes } from "./placeCanvasModel";

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
      ariaRole: "button",
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
