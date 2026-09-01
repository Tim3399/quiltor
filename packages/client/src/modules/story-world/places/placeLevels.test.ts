import { describe, expect, it } from "vitest";
import type { FigureNode } from "../model";
import {
  anchorForPoint,
  anchoredPoint,
  ancestorsOf,
  expandedRect,
  hasLevelContents,
  levelTrail,
  placesOnLevel,
  reparent,
  scaleForLevel,
  scaleForPair,
  subtreeOf,
  wouldCycle,
} from "./placeLevels";

function place(id: string, extra: Partial<FigureNode> = {}): FigureNode {
  return { id, name: id, x: 0, y: 0, type: "ort", ...extra } as FigureNode;
}

/** Weltkarte → Rom → Subura, plus ein Gasthaus, das nirgends drinsteckt. */
const world: FigureNode[] = [
  place("welt", { mapExpanded: true, mapWidth: 1000, mapHeight: 800 }),
  place("rom", { parentPlaceId: "welt", mapU: 0.5, mapV: 0.25, mapExpanded: true }),
  place("subura", { parentPlaceId: "rom", mapU: 0.2, mapV: 0.8 }),
  place("gasthaus"),
  { id: "figur", name: "Livia", x: 0, y: 0, type: "person" } as FigureNode,
];

describe("place levels", () => {
  it("keeps the root level for places that sit in nothing", () => {
    expect(placesOnLevel(world, undefined).map((node) => node.id)).toEqual(["welt", "gasthaus"]);
  });

  it("does not treat a figure as a place", () => {
    expect(placesOnLevel(world, undefined).some((node) => node.id === "figur")).toBe(false);
  });

  it("lists what is inside a level", () => {
    expect(placesOnLevel(world, "rom").map((node) => node.id)).toEqual(["subura"]);
  });

  describe("whether a card offers a door or an invitation", () => {
    it("has contents when something sits inside it", () => {
      expect(hasLevelContents(world, "rom")).toBe(true);
    });

    it("has contents when it carries a backdrop, even with nothing on it", () => {
      const wald = [place("wald", { mapImageId: "abc" })];
      expect(hasLevelContents(wald, "wald")).toBe(true);
    });

    it("is empty when nothing is inside and no backdrop is set", () => {
      expect(hasLevelContents(world, "gasthaus")).toBe(false);
      expect(hasLevelContents(world, "subura")).toBe(false);
    });

    it("does not count a figure that happens to point at it", () => {
      const mixed = [
        place("gasthaus"),
        { id: "wirt", name: "Wirt", x: 0, y: 0, parentPlaceId: "gasthaus" } as FigureNode,
      ];
      expect(hasLevelContents(mixed, "gasthaus")).toBe(false);
    });
  });

  it("reads the trail from the parent pointers, not from how the user got there", () => {
    expect(levelTrail(world, "subura").map((node) => node.id)).toEqual(["welt", "rom", "subura"]);
    expect(levelTrail(world, "gasthaus").map((node) => node.id)).toEqual(["gasthaus"]);
    expect(levelTrail(world, undefined)).toEqual([]);
  });

  it("returns nothing for a level that no longer exists", () => {
    expect(levelTrail(world, "atlantis")).toEqual([]);
  });

  describe("cycles", () => {
    it("refuses a place as its own parent", () => {
      expect(wouldCycle(world, "rom", "rom")).toBe(true);
    });

    it("refuses a parent that already sits inside the place", () => {
      expect(wouldCycle(world, "rom", "subura")).toBe(true);
    });

    it("allows an unrelated parent", () => {
      expect(wouldCycle(world, "gasthaus", "subura")).toBe(false);
    });

    it("allows moving to the root", () => {
      expect(wouldCycle(world, "subura", undefined)).toBe(false);
    });

    it("leaves the world untouched when a move would close a loop", () => {
      expect(reparent(world, "rom", "subura")).toBe(world);
    });

    it("survives a chain that was already broken", () => {
      const broken = [place("a", { parentPlaceId: "b" }), place("b", { parentPlaceId: "a" })];
      expect(ancestorsOf(broken, "a").map((node) => node.id)).toEqual(["b"]);
      expect(levelTrail(broken, "a").map((node) => node.id)).toEqual(["b", "a"]);
    });
  });

  it("moves a place onto another level and records where it landed", () => {
    const moved = reparent(world, "gasthaus", "rom", { u: 0.25, v: 0.75 });
    const found = moved.find((node) => node.id === "gasthaus");
    expect(found?.parentPlaceId).toBe("rom");
    expect([found?.mapU, found?.mapV]).toEqual([0.25, 0.75]);
  });

  it("clamps an anchor that fell outside its host", () => {
    const moved = reparent(world, "gasthaus", "rom", { u: -3, v: 42 });
    const found = moved.find((node) => node.id === "gasthaus");
    expect([found?.mapU, found?.mapV]).toEqual([0, 1]);
  });

  describe("geometry", () => {
    const host = { x: 100, y: 200, width: 1000, height: 800 };

    it("places an anchored card inside its host", () => {
      const rom = world.find((node) => node.id === "rom") as FigureNode;
      expect(anchoredPoint(rom, host)).toEqual({ x: 600, y: 400 });
    });

    it("centres a card that carries no anchor yet", () => {
      expect(anchoredPoint(place("neu"), host)).toEqual({ x: 600, y: 600 });
    });

    it("turns a point back into the anchor it came from", () => {
      expect(anchorForPoint({ x: 600, y: 400 }, host)).toEqual({ u: 0.5, v: 0.25 });
    });

    it("survives a host with no area", () => {
      expect(anchorForPoint({ x: 5, y: 5 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
        u: 0.5,
        v: 0.5,
      });
    });

    it("draws an expanded place around its anchor", () => {
      const rom = world.find((node) => node.id === "rom") as FigureNode;
      expect(expandedRect({ ...rom, mapWidth: 200, mapHeight: 100 }, host)).toEqual({
        x: 500,
        y: 350,
        width: 200,
        height: 100,
      });
    });

    it("falls back to a default extent, so an expanded place is never invisible", () => {
      const rect = expandedRect(place("neu", { mapExpanded: true }), host);
      expect([rect.width, rect.height]).toEqual([640, 420]);
    });
  });

  describe("which scale a distance is read with", () => {
    const kilometres = { unitsPer100px: 5, unitLabel: "km" };
    const metres = { unitsPer100px: 20, unitLabel: "m" };
    const scaled: FigureNode[] = [
      place("rom", { mapExpanded: true, mapScale: metres }),
      place("forum", { parentPlaceId: "rom" }),
      place("kolosseum", { parentPlaceId: "rom" }),
      place("neapel"),
    ];

    it("uses the expanded place's own scale for two points inside it", () => {
      expect(scaleForPair(scaled, scaled[1], scaled[2], kilometres)).toEqual(metres);
    });

    it("uses the level's scale when the points do not share a host", () => {
      expect(scaleForPair(scaled, scaled[1], scaled[3], kilometres)).toEqual(kilometres);
    });

    it("uses the level's scale when the shared host is not expanded", () => {
      const collapsed = scaled.map((node) =>
        node.id === "rom" ? { ...node, mapExpanded: false } : node,
      );
      expect(scaleForPair(collapsed, collapsed[1], collapsed[2], kilometres)).toEqual(kilometres);
    });

    it("falls back to the world scale for a level that declares none", () => {
      expect(scaleForLevel(scaled, "forum", kilometres)).toEqual(kilometres);
      expect(scaleForLevel(scaled, "rom", kilometres)).toEqual(metres);
      expect(scaleForLevel(scaled, undefined, kilometres)).toEqual(kilometres);
    });
  });

  it("collects everything beneath a level so deleting it strands nothing", () => {
    expect(subtreeOf(world, "welt")).toEqual(new Set(["welt", "rom", "subura"]));
    expect(subtreeOf(world, "subura")).toEqual(new Set(["subura"]));
  });

  it("does not loop forever collecting a broken subtree", () => {
    const broken = [place("a", { parentPlaceId: "b" }), place("b", { parentPlaceId: "a" })];
    expect(subtreeOf(broken, "a")).toEqual(new Set(["a", "b"]));
  });
});
