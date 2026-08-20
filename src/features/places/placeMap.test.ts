import { describe, expect, it } from "vitest";
import type { MessageKey } from "../../language";
import { de } from "../../language/de";
import { allMapDistances, formatDistance, mapDistance } from "./placeMap";

const t = (key: MessageKey) => de[key];

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
