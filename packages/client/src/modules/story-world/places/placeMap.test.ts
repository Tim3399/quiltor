import { describe, expect, it } from "vitest";
import { de } from "../../../../../../locales/de";
import type { MessageKey } from "../../../i18n";
import {
  allMapDistances,
  formatDistance,
  mapDistance,
  mapDistancePair,
  nearestMapDistances,
  mapScaleBar,
  physicalGridDistance,
} from "./placeMap";

const t = (key: MessageKey) => de[key];

describe("map scale instruments", () => {
  const scale = { unitsPer100px: 25, unitLabel: "km" };

  it("calculates physical grid distance from the authoritative map scale", () => {
    expect(physicalGridDistance(scale, 48)).toBe(12);
    expect(physicalGridDistance({ unitsPer100px: 0.5, unitLabel: "m" }, 48)).toBe(0.24);
    expect(physicalGridDistance(undefined, 48)).toBeUndefined();
    expect(physicalGridDistance({ ...scale, unitsPer100px: 0 }, 48)).toBeUndefined();
    expect(physicalGridDistance(scale, Number.NaN)).toBeUndefined();
  });

  it("uses nice distances and changes their screen length with zoom", () => {
    expect(mapScaleBar(scale, 1)).toEqual({ distance: 20, width: 80 });
    expect(mapScaleBar(scale, 0.5)).toEqual({ distance: 50, width: 100 });
    expect(mapScaleBar(scale, 2)).toEqual({ distance: 10, width: 80 });
    for (const zoom of [0.08, 0.2, 0.75, 1.3, 2.2]) {
      const bar = mapScaleBar(scale, zoom)!;
      expect(bar.width).toBeCloseTo((bar.distance / 25) * 100 * zoom);
      expect(bar.width).toBeGreaterThan(60);
      expect(bar.width).toBeLessThan(175);
    }
  });

  it("does not invent a physical bar without a valid scale or zoom", () => {
    expect(mapScaleBar(undefined, 1)).toBeUndefined();
    expect(mapScaleBar({ ...scale, unitsPer100px: -1 }, 1)).toBeUndefined();
    expect(mapScaleBar({ ...scale, unitsPer100px: Number.POSITIVE_INFINITY }, 1)).toBeUndefined();
    expect(mapScaleBar(scale, 0)).toBeUndefined();
    expect(mapScaleBar(scale, Number.NaN)).toBeUndefined();
  });
});

describe("mapDistance", () => {
  it("computes the straight-line distance for a known 3-4-5 triangle", () => {
    expect(mapDistance({ mapX: 0, mapY: 0 }, { mapX: 300, mapY: 400 })).toBe(500);
  });

  it("returns 0 for the same point", () => {
    expect(mapDistance({ mapX: 10, mapY: 10 }, { mapX: 10, mapY: 10 })).toBe(0);
  });
});

describe("allMapDistances", () => {
  it("returns every place pair exactly once with stable ids", () => {
    expect(
      allMapDistances([
        { id: "c", mapX: 0, mapY: 400 },
        { id: "a", mapX: 0, mapY: 0 },
        { id: "b", mapX: 300, mapY: 0 },
      ]),
    ).toEqual([
      { id: "distance:a:b", from: "a", to: "b", distance: 300 },
      { id: "distance:a:c", from: "a", to: "c", distance: 400 },
      { id: "distance:b:c", from: "b", to: "c", distance: 500 },
    ]);
  });

  it("does not create self-distances for a single place", () => {
    expect(allMapDistances([{ id: "only", mapX: 10, mapY: 20 }])).toEqual([]);
  });
});

describe("nearestMapDistances", () => {
  it("shows every available pair when there are fewer than four places", () => {
    const first = { id: "a", mapX: 0, mapY: 0 };
    const second = { id: "b", mapX: 300, mapY: 0 };
    const points = [{ id: "c", mapX: 0, mapY: 400 }, first, second];

    expect(nearestMapDistances([])).toEqual([]);
    expect(nearestMapDistances([first])).toEqual([]);
    expect(nearestMapDistances([first, second])).toEqual(allMapDistances([first, second]));
    expect(nearestMapDistances(points)).toEqual(allMapDistances(points));
  });

  it("unions each place's three nearest neighbours and deduplicates shared pairs", () => {
    const pairs = nearestMapDistances([
      { id: "f", mapX: 1020, mapY: 0 },
      { id: "a", mapX: 0, mapY: 0 },
      { id: "d", mapX: 1000, mapY: 0 },
      { id: "c", mapX: 20, mapY: 0 },
      { id: "e", mapX: 1010, mapY: 0 },
      { id: "b", mapX: 10, mapY: 0 },
    ]);

    expect(pairs.map((pair) => pair.id)).toEqual([
      "distance:a:b",
      "distance:a:c",
      "distance:a:d",
      "distance:b:c",
      "distance:b:d",
      "distance:c:d",
      "distance:c:e",
      "distance:c:f",
      "distance:d:e",
      "distance:d:f",
      "distance:e:f",
    ]);
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(pairs.length);
    expect(pairs.some((pair) => pair.id === "distance:a:f")).toBe(false);
  });

  it("breaks equal-distance ties by stable place id", () => {
    const pairs = nearestMapDistances(
      [
        { id: "a", mapX: 0, mapY: 0 },
        { id: "b", mapX: 10, mapY: 0 },
        { id: "c", mapX: -10, mapY: 0 },
        { id: "b-near", mapX: 11, mapY: 0 },
        { id: "c-near", mapX: -11, mapY: 0 },
      ],
      1,
    );

    expect(pairs.map((pair) => pair.id)).toContain("distance:a:b");
    expect(pairs.map((pair) => pair.id)).not.toContain("distance:a:c");
  });

  it("normalizes an explicitly selected pair to the same stable id", () => {
    expect(
      mapDistancePair({ id: "far", mapX: 300, mapY: 400 }, { id: "near", mapX: 0, mapY: 0 }),
    ).toEqual({ id: "distance:far:near", from: "far", to: "near", distance: 500 });
  });
});

describe("formatDistance", () => {
  it("shows an abstract unit label when no scale is set", () => {
    expect(formatDistance(500, t)).toBe("500 Einheiten (kein Maßstab gesetzt)");
  });

  it("converts to the configured scale and unit label", () => {
    expect(formatDistance(500, t, { unitsPer100px: 2, unitLabel: "Meilen" })).toBe("10 Meilen");
  });

  it("rounds to two decimal places", () => {
    expect(formatDistance(333, t, { unitsPer100px: 1, unitLabel: "km" })).toBe("3.33 km");
  });
});
