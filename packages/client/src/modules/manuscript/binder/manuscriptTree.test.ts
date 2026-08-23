import { describe, expect, it } from "vitest";
import type { Chapter, ManuscriptStructure } from "../model";
import {
  canMoveTreeItem,
  chapterBreadcrumb,
  childrenOf,
  deleteFolder,
  flatManuscriptStructure,
  flattenChapterIds,
  folderDescendants,
  moveTreeItem,
  structureIssues,
} from "./manuscriptTree";

const chapters: Chapter[] = ["c1", "c2", "c3"].map((id) => ({
  id,
  title: id,
  body: "",
  note: "",
}));

const structure = (): ManuscriptStructure => ({
  folders: [
    { id: "part", title: "Teil I" },
    { id: "arc", title: "Ankunft" },
  ],
  items: [
    { id: "part-item", kind: "folder", folderId: "part", position: 0 },
    { id: "c3-item", kind: "chapter", chapterId: "c3", position: 1 },
    {
      id: "arc-item",
      kind: "folder",
      folderId: "arc",
      parentFolderId: "part",
      position: 0,
    },
    {
      id: "c2-item",
      kind: "chapter",
      chapterId: "c2",
      parentFolderId: "part",
      position: 1,
    },
    {
      id: "c1-item",
      kind: "chapter",
      chapterId: "c1",
      parentFolderId: "arc",
      position: 0,
    },
  ],
});

describe("manuscript tree", () => {
  it("migrates flat chapters without changing order", () => {
    expect(flattenChapterIds(flatManuscriptStructure(chapters))).toEqual(["c1", "c2", "c3"]);
  });

  it("flattens nested folders and creates breadcrumbs", () => {
    expect(structureIssues(chapters, structure())).toEqual([]);
    expect(flattenChapterIds(structure())).toEqual(["c1", "c2", "c3"]);
    expect(chapterBreadcrumb(structure(), "c1").map((folder) => folder.title)).toEqual([
      "Teil I",
      "Ankunft",
    ]);
  });

  it("moves complete subtrees but rejects moving a folder into its descendant", () => {
    const original = structure();
    expect(folderDescendants(original, "part")).toEqual(new Set(["arc"]));
    expect(moveTreeItem(original, "part-item", "arc")).toEqual(original);

    const moved = moveTreeItem(original, "c3-item", "arc");
    expect(flattenChapterIds(moved)).toEqual(["c1", "c3", "c2"]);
  });

  it("moves chapters before and after siblings, into folders, and back to root", () => {
    const original = structure();

    const beforeSibling = moveTreeItem(original, "c3-item", undefined, "part-item");
    expect(childrenOf(beforeSibling).map((item) => item.id)).toEqual(["c3-item", "part-item"]);

    const insideFolder = moveTreeItem(beforeSibling, "c3-item", "part", "c2-item");
    expect(childrenOf(insideFolder, "part").map((item) => item.id)).toEqual([
      "arc-item",
      "c3-item",
      "c2-item",
    ]);

    const afterSibling = moveTreeItem(insideFolder, "c3-item", "part");
    expect(childrenOf(afterSibling, "part").map((item) => item.id)).toEqual([
      "arc-item",
      "c2-item",
      "c3-item",
    ]);

    const backAtRoot = moveTreeItem(afterSibling, "c3-item");
    expect(childrenOf(backAtRoot).map((item) => item.id)).toEqual(["part-item", "c3-item"]);
    expect(structureIssues(chapters, backAtRoot)).toEqual([]);
  });

  it("moves folders across levels while rejecting self, descendant, and invalid drops", () => {
    const original = structure();
    const arcAtRoot = moveTreeItem(original, "arc-item", undefined, "c3-item");
    expect(childrenOf(arcAtRoot).map((item) => item.id)).toEqual([
      "part-item",
      "arc-item",
      "c3-item",
    ]);
    expect(childrenOf(arcAtRoot, "part").map((item) => item.id)).toEqual(["c2-item"]);
    expect(structureIssues(chapters, arcAtRoot)).toEqual([]);

    expect(canMoveTreeItem(original, "part-item", "part")).toBe(false);
    expect(canMoveTreeItem(original, "part-item", "arc")).toBe(false);
    expect(canMoveTreeItem(original, "part-item", "missing")).toBe(false);
    expect(moveTreeItem(original, "part-item", "arc")).toBe(original);
    expect(moveTreeItem(original, "missing-item", "part")).toBe(original);
  });

  it("does not persist a move when the requested position is already current", () => {
    const original = structure();
    expect(canMoveTreeItem(original, "part-item", undefined, "c3-item")).toBe(false);
    expect(moveTreeItem(original, "part-item", undefined, "c3-item")).toBe(original);
    expect(canMoveTreeItem(original, "c3-item")).toBe(false);
    expect(moveTreeItem(original, "c3-item")).toBe(original);
  });

  it("deleting a folder moves its content to the parent", () => {
    const result = deleteFolder(structure(), "part");
    expect(flattenChapterIds(result)).toEqual(["c1", "c2", "c3"]);
    expect(result.folders.map((folder) => folder.id)).toEqual(["arc"]);
    expect(result.items.find((item) => item.id === "arc-item")?.parentFolderId).toBeUndefined();
  });
});
