import { describe, expect, it } from "vitest";
import type { WorldReferenceCandidate } from "../world-references";
import { groupLibraryCandidates } from "./storyboardLibraryModel";

const make = (id: string, cardKind: WorldReferenceCandidate["cardKind"]) =>
  ({
    id,
    target: { kind: "entity", id },
    label: id,
    detail: "",
    keywords: [],
    workspace: "figures",
    cardKind,
  }) as WorldReferenceCandidate;

describe("groupLibraryCandidates", () => {
  it("orders the groups by kind and keeps the incoming order inside a group", () => {
    const groups = groupLibraryCandidates([
      make("board", "storyboard"),
      make("ort-b", "ort"),
      make("ada", "person"),
      make("kapitel", "chapter"),
      make("ort-a", "ort"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["chapter", "person", "ort", "storyboard"]);
    expect(groups[2]?.candidates.map((candidate) => candidate.id)).toEqual(["ort-b", "ort-a"]);
  });

  it("leaves out kinds without an entry and returns nothing for no results", () => {
    expect(groupLibraryCandidates([])).toEqual([]);
    expect(groupLibraryCandidates([make("ada", "person")]).map((group) => group.kind)).toEqual([
      "person",
    ]);
  });
});
