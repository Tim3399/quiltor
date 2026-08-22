import { describe, expect, it } from "vitest";
import type { FigureNode, PresenceEntry, TimelineMoment, TimeSystem } from "../model";
import {
  figureJourney,
  journeyLegs,
  patchPresence,
  placeChronicle,
  placeJourney,
  presenceByPlace,
  presenceFieldEditor,
  prunePresence,
  resolvePresence,
  stopDateDiff,
} from "./presence";

const timeline: TimelineMoment[] = [
  { id: "before", title: "Vorher" },
  { id: "betrayal", title: "Verrat", date: "1420-03-12" },
  { id: "after", title: "Danach" },
];

const ada: FigureNode = { id: "ada", x: 0, y: 0, name: "Ada", type: "person" };
const arcene: FigureNode = { id: "arcene", x: 0, y: 0, name: "Arcène", type: "ort" };
const hafen: FigureNode = { id: "hafen", x: 100, y: 0, name: "Hafen", type: "ort" };

describe("presence resolution", () => {
  it("applies the base entry everywhere until overridden", () => {
    const presence: PresenceEntry[] = [{ id: "p1", elementId: "ada", placeId: "arcene" }];
    expect(resolvePresence("ada", presence, timeline, null)?.placeId).toBe("arcene");
    expect(resolvePresence("ada", presence, timeline, "before")?.placeId).toBe("arcene");
    expect(resolvePresence("ada", presence, timeline, "after")?.placeId).toBe("arcene");
  });

  it("lets a later moment entry win over the base state", () => {
    const presence: PresenceEntry[] = [
      { id: "p1", elementId: "ada", placeId: "arcene" },
      { id: "p2", elementId: "ada", placeId: "hafen", momentId: "betrayal" },
    ];
    expect(resolvePresence("ada", presence, timeline, "before")?.placeId).toBe("arcene");
    expect(resolvePresence("ada", presence, timeline, "betrayal")?.placeId).toBe("hafen");
    expect(resolvePresence("ada", presence, timeline, "after")?.placeId).toBe("hafen");
  });

  it("ignores an entry pointing at a moment that no longer exists", () => {
    const presence: PresenceEntry[] = [
      { id: "p1", elementId: "ada", placeId: "hafen", momentId: "deleted-moment" },
    ];
    expect(resolvePresence("ada", presence, timeline, "after")).toBeUndefined();
  });

  it("replaces rather than duplicates an entry at the same moment, and removes it on null", () => {
    let presence: PresenceEntry[] = [];
    presence = patchPresence(presence, "ada", "betrayal", "arcene");
    expect(presence).toHaveLength(1);
    presence = patchPresence(presence, "ada", "betrayal", "hafen");
    expect(presence).toHaveLength(1);
    expect(presence[0].placeId).toBe("hafen");
    presence = patchPresence(presence, "ada", "betrayal", null);
    expect(presence).toHaveLength(0);
  });

  it("patches the base state without a momentId", () => {
    const presence = patchPresence([], "ada", null, "arcene");
    expect(presence).toEqual([{ id: expect.any(String), elementId: "ada", placeId: "arcene" }]);
    expect(presence[0]).not.toHaveProperty("momentId");
  });

  it("builds a journey, collapsing consecutive stays and truncating after death", () => {
    const presence: PresenceEntry[] = [
      { id: "p1", elementId: "ada", placeId: "arcene" },
      { id: "p2", elementId: "ada", placeId: "arcene", momentId: "before" },
      { id: "p3", elementId: "ada", placeId: "hafen", momentId: "betrayal" },
      { id: "p4", elementId: "ada", placeId: "arcene", momentId: "after" },
    ];
    const alive = figureJourney(ada, presence, timeline);
    expect(alive.map((stop) => stop.placeId)).toEqual(["arcene", "hafen", "arcene"]);

    const dead: FigureNode = { ...ada, diedMomentId: "betrayal" };
    const truncated = figureJourney(dead, presence, timeline);
    expect(truncated.map((stop) => stop.placeId)).toEqual(["arcene", "hafen"]);
  });

  it("marks exactly the most recently walked leg as current", () => {
    const stops = figureJourney(
      ada,
      [
        { id: "p1", elementId: "ada", placeId: "arcene" },
        { id: "p2", elementId: "ada", placeId: "hafen", momentId: "betrayal" },
      ],
      timeline,
    );
    const legsAtBefore = journeyLegs(stops, timeline, "before");
    expect(legsAtBefore.filter((leg) => leg.walked)).toHaveLength(0);
    const legsAtAfter = journeyLegs(stops, timeline, "after");
    expect(legsAtAfter.filter((leg) => leg.current)).toHaveLength(1);
    expect(legsAtAfter.find((leg) => leg.current)?.to.placeId).toBe("hafen");
  });

  it("groups occupants by place at the active moment only", () => {
    const nodes = [ada, arcene, hafen];
    const presence: PresenceEntry[] = [{ id: "p1", elementId: "ada", placeId: "arcene" }];
    expect(presenceByPlace(nodes, presence, timeline, null).size).toBe(0);
    const atBefore = presenceByPlace(nodes, presence, timeline, "before");
    expect(atBefore.get("arcene")?.map((node) => node.id)).toEqual(["ada"]);
  });

  it("excludes a deceased figure from occupancy", () => {
    const dead: FigureNode = { ...ada, diedMomentId: "before" };
    const presence: PresenceEntry[] = [{ id: "p1", elementId: "ada", placeId: "arcene" }];
    const atAfter = presenceByPlace([dead, arcene], presence, timeline, "after");
    expect(atAfter.get("arcene")).toBeUndefined();
  });

  it("field editor shows the own value, or the inherited place when left blank", () => {
    const presence: PresenceEntry[] = [{ id: "p1", elementId: "ada", placeId: "arcene" }];
    expect(presenceFieldEditor("ada", presence, timeline, null)).toEqual({ placeId: "arcene" });
    expect(presenceFieldEditor("ada", presence, timeline, "before")).toEqual({
      placeId: "",
      inheritedPlaceId: "arcene",
    });
    const withOverride = patchPresence(presence, "ada", "betrayal", "hafen");
    expect(presenceFieldEditor("ada", withOverride, timeline, "betrayal")).toEqual({
      placeId: "hafen",
    });
    expect(presenceFieldEditor("ada", withOverride, timeline, "after")).toEqual({
      placeId: "",
      inheritedPlaceId: "hafen",
    });
  });

  it("prunes entries whose element, place, or moment no longer exists", () => {
    const presence: PresenceEntry[] = [
      { id: "p1", elementId: "ada", placeId: "arcene" },
      { id: "p2", elementId: "missing", placeId: "arcene" },
      { id: "p3", elementId: "ada", placeId: "missing" },
      { id: "p4", elementId: "ada", placeId: "arcene", momentId: "missing-moment" },
    ];
    expect(prunePresence(presence, [ada, arcene], timeline)).toEqual([
      { id: "p1", elementId: "ada", placeId: "arcene" },
    ]);
  });
});

describe("place history", () => {
  const kai: FigureNode = { id: "kai", x: 0, y: 100, name: "Kai", type: "person" };
  const nodes = [ada, kai, arcene, hafen];
  const presence: PresenceEntry[] = [
    { id: "p1", elementId: "ada", placeId: "arcene" },
    { id: "p2", elementId: "ada", placeId: "hafen", momentId: "betrayal" },
    { id: "p3", elementId: "ada", placeId: "arcene", momentId: "after" },
    { id: "p4", elementId: "kai", placeId: "hafen" },
    { id: "p5", elementId: "kai", placeId: "arcene", momentId: "before" },
  ];
  const dyingKai: FigureNode = { ...kai, diedMomentId: "after" };

  it("builds stays per character at a place, including a synthetic death boundary", () => {
    const stays = placeJourney("arcene", [ada, dyingKai, arcene, hafen], presence, timeline);
    expect(stays).toHaveLength(3);
    const adaStays = stays.filter((stay) => stay.elementId === "ada");
    expect(adaStays.map((stay) => [stay.arrivedAt.index, stay.leftAt?.index, stay.died])).toEqual([
      [-1, 1, false],
      [2, undefined, false],
    ]);
    const kaiStay = stays.find((stay) => stay.elementId === "kai");
    expect(kaiStay).toMatchObject({
      arrivedAt: { index: 0 },
      leftAt: { index: 2, momentId: "after" },
      died: true,
    });
  });

  it("drops a zero-length stay when a character dies the same moment they arrive", () => {
    const milo: FigureNode = {
      id: "milo",
      x: 0,
      y: 0,
      name: "Milo",
      type: "person",
      diedMomentId: "betrayal",
    };
    const stays = placeJourney(
      "arcene",
      [milo, arcene],
      [{ id: "p6", elementId: "milo", placeId: "arcene", momentId: "betrayal" }],
      timeline,
    );
    expect(stays).toHaveLength(0);
  });

  it("finds no stays for a character who never visits the place", () => {
    expect(
      placeJourney(
        "hafen",
        [ada, arcene, hafen],
        [{ id: "p1", elementId: "ada", placeId: "arcene" }],
        timeline,
      ),
    ).toHaveLength(0);
  });

  it("builds a chronicle whose occupants match presenceByPlace at every real moment, and drops the deceased", () => {
    const rows = placeChronicle("arcene", [ada, dyingKai, arcene, hafen], presence, timeline);
    const rowByIndex = new Map(rows.map((row) => [row.index, row]));
    expect(
      rowByIndex
        .get(-1)
        ?.occupants.map((node) => node.id)
        .sort(),
    ).toEqual(["ada"]);
    for (const moment of timeline) {
      const index = timeline.indexOf(moment);
      const expected =
        presenceByPlace([ada, dyingKai, arcene, hafen], presence, timeline, moment.id)
          .get("arcene")
          ?.map((node) => node.id)
          .sort() ?? [];
      expect(
        rowByIndex
          .get(index)
          ?.occupants.map((node) => node.id)
          .sort() ?? [],
      ).toEqual(expected);
    }
    expect(rowByIndex.get(2)?.left.map((node) => node.id)).toEqual(["kai"]);
  });
});

describe("duration", () => {
  const timeSystem: TimeSystem = {
    id: "primary",
    name: "Relative Zeit",
    kind: "relative",
    unit: "day",
    eraName: "",
    eraAbbreviation: "",
    epochTime: 0,
    epochYear: 1,
    epochMonth: 1,
    epochDay: 1,
    epochWeekday: 0,
    displayFormat: "",
    months: [],
    weekdays: [],
  };
  const datedTimeline: TimelineMoment[] = [
    { id: "before", title: "Vorher" },
    { id: "betrayal", title: "Verrat", date: "1420-03-12" },
    { id: "after", title: "Danach", date: "1420-03-15" },
  ];

  it("computes the day count between two dated stops", () => {
    const diff = stopDateDiff(
      { placeId: "arcene", momentId: "betrayal", index: 1 },
      { placeId: "hafen", momentId: "after", index: 2 },
      datedTimeline,
    );
    expect(diff).toEqual({ days: 3, label: "3 Tage" });
  });

  it("reports an unknown duration when either stop is undated or is the base stop", () => {
    expect(
      stopDateDiff(
        { placeId: "arcene", momentId: "before", index: 0 },
        { placeId: "hafen", momentId: "after", index: 2 },
        datedTimeline,
      ).label,
    ).toBe("Dauer unbekannt");
    expect(
      stopDateDiff(
        { placeId: "arcene", index: -1 },
        { placeId: "hafen", momentId: "betrayal", index: 1 },
        datedTimeline,
      ).label,
    ).toBe("Dauer unbekannt");
  });

  it("flags a stop pair whose dates run backwards", () => {
    const diff = stopDateDiff(
      { placeId: "arcene", momentId: "after", index: 2 },
      { placeId: "hafen", momentId: "betrayal", index: 1 },
      datedTimeline,
    );
    expect(diff).toEqual({ days: -3, label: "Datumsfolge unstimmig" });
  });

  it("uses canonical time for day systems and disables pretend durations for abstract time", () => {
    const canonical = [
      { id: "from", title: "Von", time: -4, date: "2099-01-01" },
      { id: "to", title: "Nach", time: 2, date: "1900-01-01" },
    ];
    const from = { placeId: "arcene", momentId: "from", index: 0 };
    const to = { placeId: "hafen", momentId: "to", index: 1 };
    expect(stopDateDiff(from, to, canonical, timeSystem)).toEqual({ days: 6, label: "6 Tage" });
    expect(stopDateDiff(from, to, canonical, { ...timeSystem, unit: "abstract" }).label).toBe(
      "Dauer unbekannt",
    );
  });
});
