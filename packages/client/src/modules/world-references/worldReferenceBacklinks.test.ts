import { describe, expect, it } from "vitest";
import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import type { StoryboardState } from "../storyboard";
import {
  backlinksForWorldReference,
  buildWorldReferenceBacklinks,
  workspaceTargetForBacklink,
  worldReferenceKey,
} from ".";

const entityTarget = { kind: "entity", id: "mara" } as const;

function storyboardFixture(): StoryboardState {
  return {
    boards: [
      { id: "later-board", title: "Spätere Ideen" },
      { id: "first-board", title: "Erste Ideen" },
    ],
    nodes: [
      {
        id: "first-board-note",
        boardId: "first-board",
        kind: "note",
        x: 0,
        y: 0,
        text: "Mara",
        noteReferences: [
          { id: "first-board-ref", target: entityTarget, from: 0, to: 4, surface: "Mara" },
        ],
      },
      {
        id: "direct-card",
        boardId: "later-board",
        kind: "reference",
        x: 0,
        y: 0,
        label: "Mara-Karte",
        target: entityTarget,
        text: "später Mara zuerst Mara",
        noteReferences: [
          { id: "late-ref", target: entityTarget, from: 19, to: 23, surface: "Mara" },
          { id: "early-ref", target: entityTarget, from: 7, to: 11, surface: "Mara" },
        ],
      },
      {
        id: "later-board-note",
        boardId: "later-board",
        kind: "note",
        x: 0,
        y: 0,
        text: "Mara im Nebel",
        noteReferences: [
          { id: "later-note-ref", target: entityTarget, from: 0, to: 4, surface: "Mara" },
        ],
      },
      {
        id: "board-card",
        boardId: "later-board",
        kind: "storyboard",
        x: 0,
        y: 0,
        label: "Zu den ersten Ideen",
        target: { kind: "storyboard", id: "first-board" },
      },
    ],
    edges: [],
  };
}

function fixture(): { manuscript: Manuscript; figures: FigureState } {
  return {
    manuscript: {
      chapters: [
        {
          id: "later-in-array",
          title: "Zweites Kapitel",
          body: "Mara kommt.",
          note: "Mara und der Hafen",
          noteReferences: [
            { id: "note-late", target: entityTarget, from: 9, to: 12, surface: "der" },
            { id: "note-first", target: entityTarget, from: 0, to: 4, surface: "Mara" },
            {
              id: "unknown",
              target: { kind: "storyboard", id: "future-board" },
              from: 13,
              to: 18,
              surface: "Hafen",
            },
          ],
          mentions: [
            {
              id: "mention",
              elementId: "mara",
              from: 0,
              to: 4,
              surface: "Mara",
              source: "deterministic",
              confidence: 1,
            },
          ],
        },
        {
          id: "first-in-array",
          title: "Erstes Kapitel",
          body: "",
          note: "Mara",
          noteReferences: [
            { id: "other-chapter", target: entityTarget, from: 0, to: 4, surface: "Mara" },
          ],
        },
      ],
      structure: {
        folders: [{ id: "part", title: "Teil I" }],
        items: [
          { id: "part-item", kind: "folder", folderId: "part", position: 0 },
          {
            id: "chapter-first",
            kind: "chapter",
            chapterId: "first-in-array",
            parentFolderId: "part",
            position: 0,
          },
          {
            id: "chapter-later",
            kind: "chapter",
            chapterId: "later-in-array",
            position: 1,
          },
        ],
      },
    },
    figures: {
      nodes: [
        {
          id: "harbour",
          name: "Alter Hafen",
          type: "ort",
          x: 0,
          y: 0,
          profile: {
            notizen: "Mara",
            noteReferences: [
              { id: "place-note", target: entityTarget, from: 0, to: 4, surface: "Mara" },
            ],
          },
        },
        { id: "mara", name: "Mara", type: "person", x: 0, y: 0 },
      ],
      edges: [],
      timeline: [
        {
          id: "arrival",
          title: "Ankunft",
          date: "Tag 1",
          note: "Mara",
          noteReferences: [
            { id: "moment-note", target: entityTarget, from: 0, to: 4, surface: "Mara" },
          ],
        },
      ],
    },
  };
}

describe("world reference backlinks", () => {
  it("keeps every occurrence in stable document and text order", () => {
    const backlinks = backlinksForWorldReference(
      buildWorldReferenceBacklinks(fixture()),
      entityTarget,
    );

    expect(
      backlinks.map((item) => [item.source.target.id, item.source.kind, item.surface]),
    ).toEqual([
      ["first-in-array", "chapter-note", "Mara"],
      ["later-in-array", "chapter-note", "Mara"],
      ["later-in-array", "chapter-note", "der"],
      ["later-in-array", "chapter-mention", "Mara"],
      ["harbour", "place-note", "Mara"],
      ["arrival", "timeline-note", "Mara"],
    ]);
    expect(backlinks[0].source).toMatchObject({
      target: { kind: "chapter", id: "first-in-array" },
      workspace: "text",
      label: "Erstes Kapitel",
      detail: "Teil I",
    });
    expect(new Set(backlinks.map((item) => item.id)).size).toBe(backlinks.length);
  });

  it("indexes unknown targets by stable ID instead of requiring a live candidate", () => {
    const index = buildWorldReferenceBacklinks(fixture());
    const backlinks = index.get("storyboard:future-board");

    expect(backlinks).toHaveLength(1);
    expect(backlinks?.[0].target).toEqual({ kind: "storyboard", id: "future-board" });
    expect(backlinks?.[0].surface).toBe("Hafen");
  });

  it("survives source and target renames without changing link identity", () => {
    const beforeFixture = fixture();
    const before = backlinksForWorldReference(
      buildWorldReferenceBacklinks(beforeFixture),
      entityTarget,
    );
    beforeFixture.manuscript.chapters[1].title = "Umbenanntes Kapitel";
    beforeFixture.figures.nodes[0].name = "Neuer Hafenname";
    beforeFixture.figures.nodes[1].name = "Marina";
    const after = backlinksForWorldReference(
      buildWorldReferenceBacklinks(beforeFixture),
      entityTarget,
    );

    expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
    expect(after.map((item) => worldReferenceKey(item.target))).toEqual(
      before.map((item) => worldReferenceKey(item.target)),
    );
    expect(after[0].source.label).toBe("Umbenanntes Kapitel");
    expect(after[4].source.label).toBe("Neuer Hafenname");
  });

  it("canonicalizes entity/place kinds from the live node while stale lookups still resolve", () => {
    const data = fixture();
    data.figures.nodes[1].type = "ort";
    const index = buildWorldReferenceBacklinks(data);

    expect(index.has("entity:mara")).toBe(false);
    expect(index.get("place:mara")?.every((item) => item.target.kind === "place")).toBe(true);
    expect(backlinksForWorldReference(index, entityTarget)).toBe(index.get("place:mara"));
  });

  it("resolves a stale place lookup when the live target is an entity", () => {
    const index = buildWorldReferenceBacklinks(fixture());

    expect(backlinksForWorldReference(index, { kind: "place", id: "mara" })).toBe(
      index.get("entity:mara"),
    );
  });

  it("encodes backlink IDs without collisions between source and item IDs", () => {
    const data = fixture();
    data.manuscript = {
      chapters: [
        {
          id: "a:b",
          title: "A",
          body: "",
          note: "Mara",
          noteReferences: [{ id: "c", target: entityTarget, from: 0, to: 4, surface: "Mara" }],
        },
        {
          id: "a",
          title: "B",
          body: "",
          note: "Mara",
          noteReferences: [{ id: "b:c", target: entityTarget, from: 0, to: 4, surface: "Mara" }],
        },
      ],
    };
    data.figures.nodes = data.figures.nodes.filter((node) => node.id === "mara");
    data.figures.timeline = [];

    const ids = backlinksForWorldReference(buildWorldReferenceBacklinks(data), entityTarget).map(
      (backlink) => backlink.id,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("opens manuscript mentions at their exact body range", () => {
    const mention = backlinksForWorldReference(
      buildWorldReferenceBacklinks(fixture()),
      entityTarget,
    ).find((backlink) => backlink.source.kind === "chapter-mention");

    expect(mention && workspaceTargetForBacklink(mention)).toEqual({
      workspace: "text",
      id: "later-in-array",
      textSearch: { query: "Mara", from: 0, to: 4 },
    });
  });

  it("indexes Storyboard notes and direct cards in board, node and text order", () => {
    const data = fixture();
    data.manuscript = { chapters: [] };
    data.figures.nodes = data.figures.nodes.filter((node) => node.id === "mara");
    data.figures.timeline = [];

    const backlinks = backlinksForWorldReference(
      buildWorldReferenceBacklinks({ ...data, storyboards: storyboardFixture() }),
      entityTarget,
    );

    expect(
      backlinks.map((item) => [item.source.nodeId, item.source.kind, item.origin, item.surface]),
    ).toEqual([
      ["direct-card", "storyboard-note", "text", "Mara"],
      ["direct-card", "storyboard-note", "text", "Mara"],
      ["direct-card", "storyboard-reference", "card", undefined],
      ["later-board-note", "storyboard-note", "text", "Mara"],
      ["first-board-note", "storyboard-note", "text", "Mara"],
    ]);
    expect(backlinks.map((item) => item.id)).toEqual([
      '["storyboard-note","storyboard:direct-card","early-ref"]',
      '["storyboard-note","storyboard:direct-card","late-ref"]',
      '["storyboard-reference","storyboard:direct-card"]',
      '["storyboard-note","storyboard:later-board-note","later-note-ref"]',
      '["storyboard-note","storyboard:first-board-note","first-board-ref"]',
    ]);
    expect(backlinks[0].source).toMatchObject({
      target: { kind: "storyboard", id: "direct-card" },
      workspace: "storyboard",
      label: "Mara-Karte",
      detail: "Spätere Ideen",
      boardId: "later-board",
      nodeId: "direct-card",
    });
  });

  it("represents a direct Storyboard card without inventing a text range", () => {
    const data = fixture();
    const index = buildWorldReferenceBacklinks({ ...data, storyboards: storyboardFixture() });
    const card = backlinksForWorldReference(index, entityTarget).find(
      (item) => item.source.kind === "storyboard-reference",
    );

    expect(card).toMatchObject({
      origin: "card",
      target: entityTarget,
      source: {
        target: { kind: "storyboard", id: "direct-card" },
        boardId: "later-board",
        nodeId: "direct-card",
      },
    });
    expect(card).not.toHaveProperty("surface");
    expect(card).not.toHaveProperty("from");
    expect(card).not.toHaveProperty("to");
    expect(card && workspaceTargetForBacklink(card)).toEqual({
      workspace: "storyboard",
      id: "direct-card",
    });
  });

  it("indexes direct board cards and keeps occurrence IDs stable across display renames", () => {
    const data = fixture();
    const storyboards = storyboardFixture();
    const before = buildWorldReferenceBacklinks({ ...data, storyboards }).get(
      "storyboard:first-board",
    );

    storyboards.boards[0].title = "Umbenannte Ideen";
    const boardCard = storyboards.nodes.find((node) => node.id === "board-card");
    expect(boardCard).toBeDefined();
    if (boardCard) boardCard.label = "Neues Kartenlabel";
    const after = buildWorldReferenceBacklinks({ ...data, storyboards }).get(
      "storyboard:first-board",
    );

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after?.[0].id).toBe(before?.[0].id);
    expect(after?.[0]).toMatchObject({
      origin: "card",
      source: {
        kind: "storyboard-reference",
        nodeId: "board-card",
        label: "Neues Kartenlabel",
        detail: "Umbenannte Ideen",
      },
    });
  });
});
