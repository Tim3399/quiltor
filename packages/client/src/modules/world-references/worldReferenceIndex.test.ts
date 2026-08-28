import { describe, expect, it } from "vitest";
import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import {
  buildWorldReferenceCandidates,
  resolveWorldReferenceCandidate,
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

  it("gives unfinished targets selectable fallback labels", () => {
    const candidates = buildWorldReferenceCandidates({
      manuscript: {
        chapters: [{ id: "draft-chapter", title: "  ", body: "", note: "" }],
      },
      figures: {
        nodes: [{ id: "draft", name: "  ", type: "person", x: 0, y: 0 }],
        edges: [],
        timeline: [{ id: "draft-moment", title: " " }],
      },
      storyboards: [{ id: "draft-board", title: "" }],
      labels,
    });

    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "Ohne Titel",
      "person",
      "Zeitpunkt",
      "Ohne Titel",
    ]);
  });

  it("keeps imported source IDs intact while bounding extreme visible labels", () => {
    const longId = "id".repeat(300);
    const candidates = buildWorldReferenceCandidates({
      manuscript,
      figures: {
        nodes: [{ id: longId, name: "N".repeat(1001), type: "person", x: 0, y: 0 }],
        edges: [],
      },
      labels,
    });
    const imported = candidates.find((item) => item.target.id === longId);

    expect(imported?.target.id).toBe(longId);
    expect(imported?.label).toHaveLength(1000);
    expect(imported?.label.endsWith("…")).toBe(true);
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

  it("follows a figure identity when its live kind changes to or from place", () => {
    const candidates = buildWorldReferenceCandidates({
      manuscript,
      figures: {
        nodes: [{ id: "mara", name: "Maras Haus", type: "ort", x: 0, y: 0 }],
        edges: [],
      },
      labels,
    });

    expect(
      resolveWorldReferenceCandidate(candidates, { kind: "entity", id: "mara" })?.target,
    ).toEqual({ kind: "place", id: "mara" });
  });
});
