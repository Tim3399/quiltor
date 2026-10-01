import { describe, expect, it } from "vitest";
import type { Manuscript } from "./model";
import {
  ChapterRestoreError,
  moveChapterToTrash,
  purgeTrashedChapter,
  restoreTrashedChapter,
  searchChapterTrash,
} from "./trash";

const manuscript = (): Manuscript => ({
  chapters: [
    {
      id: "c1",
      title: "Ankunft",
      body: "Mara betritt das Archiv.",
      note: "Wichtig",
      marks: [{ from: 0, to: 4, kind: "italic" }],
      storyTime: { startMomentId: "arrival", futureAnchor: true },
      futureChapter: { kept: true },
    },
    { id: "c2", title: "Danach", body: "Später", note: "" },
  ],
  structure: {
    futureStructure: { kept: true },
    folders: [{ id: "f1", title: "Teil Eins", futureFolder: true }],
    items: [
      { id: "folder:f1", kind: "folder", folderId: "f1", position: 0 },
      {
        id: "chapter:c1",
        kind: "chapter",
        chapterId: "c1",
        parentFolderId: "f1",
        position: 0,
        futurePlacement: "kept",
      },
      { id: "chapter:c2", kind: "chapter", chapterId: "c2", position: 1 },
    ],
  },
});

describe("manuscript chapter trash", () => {
  it("moves and restores every chapter and placement field without overwriting later edits", () => {
    const source = manuscript();
    source.chapters[0].inBook = false;
    const deleted = moveChapterToTrash(source, "c1", "2026-09-19T10:00:00.000Z");
    expect(deleted.chapters.map((chapter) => chapter.id)).toEqual(["c2"]);
    expect(deleted.structure?.futureStructure).toEqual({ kept: true });
    expect(deleted.trash?.[0]).toMatchObject({
      deletedAt: "2026-09-19T10:00:00.000Z",
      chapter: { id: "c1", futureChapter: { kept: true } },
      treeItem: { id: "chapter:c1", futurePlacement: "kept" },
      originalFolderPath: [{ id: "f1", title: "Teil Eins", futureFolder: true }],
    });
    deleted.chapters[0].body = "Nach dem Löschen bearbeitet";

    const restored = restoreTrashedChapter(deleted, "c1");
    expect(restored.restoredToRoot).toBe(false);
    expect(restored.manuscript.structure?.futureStructure).toEqual({ kept: true });
    expect(restored.manuscript.chapters.find((chapter) => chapter.id === "c2")?.body).toBe(
      "Nach dem Löschen bearbeitet",
    );
    expect(restored.manuscript.chapters.find((chapter) => chapter.id === "c1")).toMatchObject({
      marks: [{ from: 0, to: 4, kind: "italic" }],
      storyTime: { startMomentId: "arrival", futureAnchor: true },
      futureChapter: { kept: true },
      inBook: false,
    });
  });

  it("falls back to root after the original folder is removed", () => {
    const deleted = moveChapterToTrash(manuscript(), "c1");
    deleted.structure = {
      folders: [],
      items:
        deleted.structure?.items
          .filter((item) => item.kind !== "folder")
          .map((item, position) => ({ ...item, position })) ?? [],
    };
    const restored = restoreTrashedChapter(deleted, "c1");
    expect(restored.restoredToRoot).toBe(true);
    expect(
      restored.manuscript.structure?.items.find(
        (item) => item.kind === "chapter" && item.chapterId === "c1",
      ),
    ).not.toHaveProperty("parentFolderId");
  });

  it("searches title and body, purges explicitly, and rejects active id collisions", () => {
    const deleted = moveChapterToTrash(manuscript(), "c1");
    expect(searchChapterTrash(deleted.trash ?? [], "archiv")).toHaveLength(1);
    expect(searchChapterTrash(deleted.trash ?? [], "ankunft")).toHaveLength(1);
    expect(searchChapterTrash(deleted.trash ?? [], "danach")).toHaveLength(0);
    expect(purgeTrashedChapter(deleted, "c1").trash).toEqual([]);
    deleted.chapters.push({ id: "c1", title: "Neu", body: "", note: "" });
    expect(() => restoreTrashedChapter(deleted, "c1")).toThrow(ChapterRestoreError);
  });

  it("retains the trash entry when a stored story-time target is missing", () => {
    const deleted = moveChapterToTrash(manuscript(), "c1");
    expect(() =>
      restoreTrashedChapter(deleted, "c1", { availableMomentIds: new Set() }),
    ).toThrowError("missing-story-time-target");
    expect(deleted.trash?.map((entry) => entry.chapter.id)).toEqual(["c1"]);
  });
});
