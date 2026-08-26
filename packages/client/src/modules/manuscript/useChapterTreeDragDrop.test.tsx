import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManuscriptStructure } from "./model";
import { CHAPTER_TREE_DRAG_TYPE, useChapterTreeDragDrop } from "./useChapterTreeDragDrop";

const structure: ManuscriptStructure = {
  folders: [
    { id: "part", title: "Part" },
    { id: "arc", title: "Arc" },
  ],
  items: [
    { id: "part-item", kind: "folder", folderId: "part", position: 0 },
    {
      id: "arc-item",
      kind: "folder",
      folderId: "arc",
      parentFolderId: "part",
      position: 0,
    },
    { id: "chapter-item", kind: "chapter", chapterId: "chapter", position: 1 },
  ],
};

function transfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
  } as unknown as DataTransfer;
}

function dragEvent(dataTransfer = transfer()) {
  const currentTarget = document.createElement("div");
  return {
    currentTarget,
    dataTransfer,
    clientY: 0,
    relatedTarget: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as DragEvent<HTMLElement>;
}

describe("useChapterTreeDragDrop", () => {
  it("owns the transfer contract and rejects folder cycles before a drop", () => {
    const onStructureChange = vi.fn();
    const { result } = renderHook(() => useChapterTreeDragDrop({ structure, onStructureChange }));
    const event = dragEvent();

    act(() => result.current.beginDrag(event, "part-item"));
    expect(event.dataTransfer.setData).toHaveBeenCalledWith(CHAPTER_TREE_DRAG_TYPE, "part-item");

    act(() => {
      expect(result.current.allowDrop(event, { key: "folder:arc", parentFolderId: "arc" })).toBe(
        false,
      );
    });
    expect(event.dataTransfer.dropEffect).toBe("none");
    expect(onStructureChange).not.toHaveBeenCalled();
  });

  it("applies a valid move and resets its visible drag state", () => {
    const onStructureChange = vi.fn();
    const { result } = renderHook(() => useChapterTreeDragDrop({ structure, onStructureChange }));
    const event = dragEvent();

    act(() => result.current.beginDrag(event, "chapter-item", true));
    act(() => {
      expect(result.current.allowDrop(event, { key: "folder:arc", parentFolderId: "arc" })).toBe(
        true,
      );
    });
    expect(result.current.dropTarget).toBe("folder:arc");

    act(() => {
      expect(result.current.drop(event, { key: "folder:arc", parentFolderId: "arc" })).toBe(true);
    });
    expect(onStructureChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "chapter-item", parentFolderId: "arc" }),
        ]),
      }),
    );
    expect(result.current.draggedItemId).toBeUndefined();
    expect(result.current.dropTarget).toBeUndefined();
  });
});
