import { describe, expect, it } from "vitest";
import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import {
  buildWorldReferenceCandidates,
  searchWorldReferences,
  workspaceTargetForReference,
} from ".";

const manuscript: Manuscript = {
  chapters: [
    { id: "c2", title: "Der Hafen", body: "Mara wartet am Kai.", note: "Nebel" },
    { id: "c1", title: "Ankunft", body: "Ein Schiff erscheint.", note: "" },
  ],
  structure: {
    folders: [{ id: "part", title: "Teil I" }],
    items: [
      { id: "folder-item", kind: "folder", folderId: "part", position: 0 },
      {
        id: "chapter-item",
        kind: "chapter",
        chapterId: "c1",
        parentFolderId: "part",
        position: 0,
      },
      { id: "root-chapter", kind: "chapter", chapterId: "c2", position: 1 },
    ],
  },
};

const figures: FigureState = {
  nodes: [
    {
      id: "mara",
      name: "Mára",
      type: "person",
      x: 0,
      y: 0,
      aliases: [{ alias: "Die Kartografin" }],
    },
    { id: "harbour", name: "Alter Hafen", type: "ort", x: 0, y: 0 },
  ],
  edges: [],
  timeline: [{ id: "arrival", title: "Ankunft des Schiffes", time: 4 }],
};

const labels = {
  untitled: "Ohne Titel",
  moment: "Zeitpunkt",
  figureKind: (kind: string) => kind,
};

describe("world reference index", () => {
  it("uses flattened manuscript order and keeps places on the existing figure identity", () => {
    const candidates = buildWorldReferenceCandidates({ manuscript, figures, labels });
    expect(candidates.map((item) => item.id)).toEqual([
      "chapter:c1",
      "chapter:c2",
      "entity:mara",
      "place:harbour",
      "timeline:arrival",
    ]);
    expect(candidates[0].detail).toContain("Teil I");
    expect(candidates[3].target).toEqual({ kind: "place", id: "harbour" });
  });

  it("finds labels, aliases, notes and body text without depending on accents", () => {
    const candidates = buildWorldReferenceCandidates({ manuscript, figures, labels });
    expect(searchWorldReferences(candidates, "mara")[0].target).toEqual({
      kind: "entity",
      id: "mara",
    });
    expect(searchWorldReferences(candidates, "Kartografin")[0].target.id).toBe("mara");
    expect(searchWorldReferences(candidates, "Nebel")[0].target.id).toBe("c2");
    expect(searchWorldReferences(candidates, "Schiff").map((item) => item.target.id)).toEqual([
      "arrival",
      "c1",
    ]);
  });

  it("maps stable targets to the existing workspace navigation contract", () => {
    expect(workspaceTargetForReference({ kind: "place", id: "harbour" })).toEqual({
      workspace: "places",
      id: "harbour",
    });
    expect(workspaceTargetForReference({ kind: "chapter", id: "c1" })).toEqual({
      workspace: "text",
      id: "c1",
    });
  });
});
