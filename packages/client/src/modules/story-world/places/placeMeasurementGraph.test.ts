import { describe, expect, it } from "vitest";
import { de } from "../../../../../../locales/de";
import type { Translate } from "../../../i18n";
import { createPlaceMeasurementEdges, type PlaceMeasurementPoint } from "./placeMeasurementGraph";

const t = ((key: keyof typeof de, variables?: Record<string, string | number>) => {
  let value: string = de[key];
  for (const [name, replacement] of Object.entries(variables ?? {})) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}) as Translate;

const points: PlaceMeasurementPoint[] = [
  { id: "a", name: "A", mapX: 0, mapY: 0 },
  { id: "b", name: "B", mapX: 300, mapY: 0 },
  { id: "c", name: "C", mapX: 0, mapY: 400 },
];

describe("place measurement graph", () => {
  it("creates deduplicated, localized and non-focusable nearest edges", () => {
    const edges = createPlaceMeasurementEdges({
      points,
      selection: [],
      scaleFor: () => ({ unitsPer100px: 1, unitLabel: "km" }),
      t,
    });

    expect(edges.map((edge) => edge.id)).toEqual(["distance:a:b", "distance:a:c", "distance:b:c"]);
    expect(edges[0]).toMatchObject({
      label: "3 km",
      ariaLabel: "A – B: 3 km",
      labelBgStyle: {
        fill: "var(--edge-label-bg)",
        stroke: "var(--line)",
        strokeWidth: 1,
      },
      labelStyle: {
        fill: "var(--edge-label-text)",
        fontSize: 12,
        fontWeight: 600,
      },
      labelBgPadding: [7, 4],
      labelBgBorderRadius: 6,
      focusable: false,
      selectable: false,
      className: "distance-edge",
    });
  });

  it("adds and marks an arbitrary targeted pair without duplicating automatic pairs", () => {
    const farPoints = [
      ...points,
      { id: "d", name: "D", mapX: 10_000, mapY: 0 },
      { id: "e", name: "E", mapX: 10_100, mapY: 0 },
    ];
    const edges = createPlaceMeasurementEdges({
      points: farPoints,
      selection: ["a", "e"],
      scaleFor: () => undefined,
      t,
    });
    const target = edges.find((edge) => edge.id === "distance:a:e");

    expect(target).toMatchObject({
      className: "distance-edge is-targeted",
      labelBgStyle: {
        fill: "var(--selection-surface)",
        stroke: "var(--selection-border)",
      },
      labelStyle: { fontWeight: 700 },
    });
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
  });

  it("depends only on stable map coordinates, not LOD or favorite presentation", () => {
    const before = createPlaceMeasurementEdges({
      points,
      selection: [],
      scaleFor: () => ({ unitsPer100px: 1, unitLabel: "km" }),
      t,
    });
    const afterPresentationChange = createPlaceMeasurementEdges({
      points: points.map((point) => ({ ...point })),
      selection: [],
      scaleFor: () => ({ unitsPer100px: 1, unitLabel: "km" }),
      t,
    });

    expect(afterPresentationChange.map((edge) => edge.label)).toEqual(
      before.map((edge) => edge.label),
    );
  });
});

describe("a distance in the units of what it crossed", () => {
  it("reads each pair in its own scale, not the surface's", () => {
    // A hundred pixels across a city plan and a hundred across the continent it
    // stands on are not the same distance. One reading for the whole surface
    // would be a lie it tells confidently.
    const edges = createPlaceMeasurementEdges({
      points: [
        { id: "a", name: "A", mapX: 0, mapY: 0 },
        { id: "b", name: "B", mapX: 100, mapY: 0 },
        { id: "c", name: "C", mapX: 0, mapY: 100 },
      ],
      selection: [],
      scaleFor: (from, to) =>
        [from, to].includes("c")
          ? { unitsPer100px: 1, unitLabel: "km" }
          : { unitsPer100px: 25, unitLabel: "m" },
      t,
    });

    const labels = new Map(edges.map((edge) => [edge.id, edge.label]));
    expect(labels.get("distance:a:b")).toBe("25 m");
    expect(labels.get("distance:a:c")).toBe("1 km");
  });
});
