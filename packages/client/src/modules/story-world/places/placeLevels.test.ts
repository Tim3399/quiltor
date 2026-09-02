import { describe, expect, it } from "vitest";
import type { FigureNode } from "../model";
import {
  anchorForPoint,
  anchorOf,
  anchoredPoint,
  ancestorsOf,
  expandedRect,
  hasLevelContents,
  levelTrail,
  mapRect,
  mapUnder,
  placementForDrop,
  placesOnLevel,
  reparent,
  spreadAnchor,
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

describe("maps as ground for pins", () => {
  const karte = place("karte", {
    mapExpanded: true,
    mapImageId: "abc",
    mapX: 100,
    mapY: 200,
    mapWidth: 400,
    mapHeight: 300,
  });

  it("reads a map's rectangle from where it was put and how large it was made", () => {
    expect(mapRect(karte)).toEqual({ x: 100, y: 200, width: 400, height: 300 });
  });

  it("falls back to a default extent so a map is never a point", () => {
    const rect = mapRect(place("blank", { mapExpanded: true, mapX: 0, mapY: 0 }));
    expect([rect.width, rect.height]).toEqual([640, 420]);
  });

  it("finds the map a point lands on, and none when it lands beside it", () => {
    expect(mapUnder({ x: 150, y: 250 }, [karte])?.id).toBe("karte");
    expect(mapUnder({ x: 100, y: 200 }, [karte])?.id).toBe("karte");
    expect(mapUnder({ x: 500, y: 500 }, [karte])?.id).toBe("karte");
    expect(mapUnder({ x: 99, y: 250 }, [karte])).toBeUndefined();
    expect(mapUnder({ x: 501, y: 250 }, [karte])).toBeUndefined();
  });

  it("gives an overlap to the map drawn on top", () => {
    const oben = place("oben", {
      mapExpanded: true,
      mapImageId: "def",
      mapX: 100,
      mapY: 200,
      mapWidth: 400,
      mapHeight: 300,
    });
    expect(mapUnder({ x: 150, y: 250 }, [karte, oben])?.id).toBe("oben");
  });
});

describe("places that carry no anchor yet", () => {
  it("centres a lone one", () => {
    expect(spreadAnchor(0, 1)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("spreads a handful so none hides behind another", () => {
    const four = [0, 1, 2, 3].map((index) => spreadAnchor(index, 4));
    expect(new Set(four.map((a) => `${a.u},${a.v}`)).size).toBe(4);
    expect(four[0]).toEqual({ u: 0.25, v: 0.25 });
    expect(four[3]).toEqual({ u: 0.75, v: 0.75 });
  });

  it("keeps every guess on the map it belongs to", () => {
    for (let total = 1; total <= 12; total += 1) {
      for (let index = 0; index < total; index += 1) {
        const { u, v } = spreadAnchor(index, total);
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(1);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("gives way to a real anchor as soon as there is one", () => {
    const guess = { u: 0.1, v: 0.9 };
    expect(anchorOf(place("frei"), guess)).toEqual(guess);
    expect(anchorOf(place("gesetzt", { mapU: 0.4, mapV: 0.6 }), guess)).toEqual({ u: 0.4, v: 0.6 });
  });
});

describe("where a drag leaves a place", () => {
  const karte = place("karte", {
    mapExpanded: true,
    mapImageId: "abc",
    mapX: 0,
    mapY: 0,
    mapWidth: 400,
    mapHeight: 200,
  });
  const frei = place("frei");
  const nodes = [karte, frei];
  const size = { width: 40, height: 20 };

  it("adopts a place that came to rest on a map", () => {
    const placement = placementForDrop({
      grid: 0,
      dragged: frei,
      nodes,
      maps: [karte],
      levelId: undefined,
      position: { x: 180, y: 90 },
      size,
    });
    expect(placement).toEqual({ parentPlaceId: "karte", mapU: 0.5, mapV: 0.5 });
  });

  it("aims by the middle of the card, not its corner", () => {
    // The corner is off the map, the middle is on it.
    const placement = placementForDrop({
      grid: 0,
      dragged: frei,
      nodes,
      maps: [karte],
      levelId: undefined,
      position: { x: -10, y: 90 },
      size,
    });
    expect(placement.parentPlaceId).toBe("karte");
  });

  it("returns a place to the level when it lands beside every map", () => {
    const placement = placementForDrop({
      grid: 0,
      dragged: { ...frei, parentPlaceId: "karte", mapU: 0.2, mapV: 0.2 },
      nodes,
      maps: [karte],
      levelId: "welt",
      position: { x: 900, y: 900 },
      size,
    });
    expect(placement).toEqual({
      parentPlaceId: "welt",
      mapX: 900,
      mapY: 900,
      mapU: undefined,
      mapV: undefined,
    });
  });

  it("places a map outright, because it is the ground the fractions measure against", () => {
    expect(
      placementForDrop({
        grid: 0,
        dragged: karte,
        nodes,
        maps: [karte],
        levelId: undefined,
        position: { x: 40, y: 60 },
        size,
      }),
    ).toEqual({ mapX: 40, mapY: 60 });
  });

  it("refuses a drop that would put a place inside something it contains", () => {
    const eltern = place("eltern");
    const kind = place("kind", {
      parentPlaceId: "eltern",
      mapExpanded: true,
      mapImageId: "x",
      mapX: 0,
      mapY: 0,
      mapWidth: 400,
      mapHeight: 200,
    });
    const placement = placementForDrop({
      grid: 0,
      dragged: eltern,
      nodes: [eltern, kind],
      maps: [kind],
      levelId: "welt",
      position: { x: 180, y: 90 },
      size,
    });
    expect(placement.parentPlaceId).toBe("welt");
  });
});

describe("a level that is itself a picture", () => {
  const grund = { x: 0, y: 0, width: 400, height: 200 };
  const frei = place("frei");

  it("holds a place against the picture rather than placing it outright", () => {
    expect(
      placementForDrop({
        grid: 0,
        dragged: frei,
        nodes: [frei],
        maps: [],
        levelId: "rom",
        levelGround: grund,
        position: { x: 90, y: 40 },
        size: { width: 20, height: 20 },
      }),
    ).toEqual({ parentPlaceId: "rom", mapU: 0.25, mapV: 0.25 });
  });

  it("still places outright on a level with no picture under it", () => {
    expect(
      placementForDrop({
        grid: 0,
        dragged: frei,
        nodes: [frei],
        maps: [],
        levelId: "rom",
        position: { x: 90, y: 40 },
        size: { width: 20, height: 20 },
      }),
    ).toMatchObject({ parentPlaceId: "rom", mapX: 90, mapY: 40 });
  });
});

describe("a map coming to rest", () => {
  const map: FigureNode = {
    id: "m",
    x: 0,
    y: 0,
    name: "Karte",
    type: "ort",
    mapImageId: "sha",
    mapExpanded: true,
    mapWidth: 2400,
    mapHeight: 1350,
  };

  const drop = (position: { x: number; y: number }, grid: number) =>
    placementForDrop({
      dragged: map,
      nodes: [map],
      maps: [map],
      levelId: undefined,
      position,
      size: { width: 2400, height: 1350 },
      grid,
    });

  it("lands on the nearest ruled line", () => {
    // The canvas rules from the level's origin and so does the sheet. A corner
    // between two lines leaves the two rulings permanently out of step.
    expect(drop({ x: 137, y: 70 }, 48)).toEqual({ mapX: 144, mapY: 48 });
    expect(drop({ x: 96, y: 240 }, 48)).toEqual({ mapX: 96, mapY: 240 });
  });

  it("lands where it was dropped when nothing is ruled", () => {
    expect(drop({ x: 137, y: 70 }, 0)).toEqual({ mapX: 137, mapY: 70 });
  });

  it("leaves a place exactly where it was dropped, ruling or no ruling", () => {
    // Only ground is ruled. A place is anchored as a fraction of whatever it
    // stands on, so rounding its corner would fight the thing holding it there.
    const place: FigureNode = { id: "p", x: 0, y: 0, name: "Hafen", type: "ort" };
    expect(
      placementForDrop({
        dragged: place,
        nodes: [place],
        maps: [],
        levelId: undefined,
        position: { x: 137, y: 70 },
        size: { width: 200, height: 80 },
        grid: 48,
      }),
    ).toMatchObject({ mapX: 137, mapY: 70 });
  });
});
