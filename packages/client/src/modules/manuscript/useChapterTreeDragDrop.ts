import { type DragEvent, type RefObject, useRef, useState } from "react";
import { canMoveTreeItem, childrenOf, moveTreeItem } from "./binder/manuscriptTree";
import type { ManuscriptStructure, ManuscriptTreeItem } from "./model";

export const CHAPTER_TREE_DRAG_TYPE = "application/x-quiltor-binder-item";

export interface ChapterTreeDestination {
  key: string;
  parentFolderId?: string;
  beforeItemId?: string;
}

interface UseChapterTreeDragDropOptions {
  structure: ManuscriptStructure;
  onStructureChange: (structure: ManuscriptStructure) => void;
}

export interface ChapterTreeDragDrop {
  draggedItemId?: string;
  dropTarget?: string;
  suppressSelectionRef: RefObject<boolean>;
  beginDrag: (event: DragEvent<HTMLElement>, itemId: string, suppressSelection?: boolean) => void;
  endDrag: () => void;
  allowDrop: (event: DragEvent<HTMLElement>, destination: ChapterTreeDestination) => boolean;
  leaveDropTarget: (event: DragEvent<HTMLElement>, targetKey: string) => void;
  drop: (event: DragEvent<HTMLElement>, destination: ChapterTreeDestination) => boolean;
  move: (itemId: string, destination: Omit<ChapterTreeDestination, "key">) => boolean;
  chapterRowDestination: (
    event: DragEvent<HTMLElement>,
    item: ManuscriptTreeItem,
  ) => ChapterTreeDestination;
  autoScroll: (event: DragEvent<HTMLElement>) => void;
}

export function useChapterTreeDragDrop({
  structure,
  onStructureChange,
}: UseChapterTreeDragDropOptions): ChapterTreeDragDrop {
  const [draggedItemId, setDraggedItemId] = useState<string>();
  const draggedItemIdRef = useRef<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string>();
  const suppressSelectionRef = useRef(false);

  const finishDrag = () => {
    draggedItemIdRef.current = undefined;
    setDraggedItemId(undefined);
    setDropTarget(undefined);
    window.setTimeout(() => {
      suppressSelectionRef.current = false;
    }, 0);
  };

  const beginDrag = (event: DragEvent<HTMLElement>, itemId: string, suppressSelection = false) => {
    draggedItemIdRef.current = itemId;
    suppressSelectionRef.current = suppressSelection;
    setDraggedItemId(itemId);
    setDropTarget(undefined);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CHAPTER_TREE_DRAG_TYPE, itemId);
      event.dataTransfer.setData("text/plain", itemId);
    }
  };

  const draggedId = (event?: DragEvent<HTMLElement>) =>
    draggedItemIdRef.current ||
    draggedItemId ||
    event?.dataTransfer?.getData(CHAPTER_TREE_DRAG_TYPE) ||
    undefined;

  const canDropAt = (event: DragEvent<HTMLElement>, destination: ChapterTreeDestination) => {
    const itemId = draggedId(event);
    return Boolean(
      itemId &&
        canMoveTreeItem(structure, itemId, destination.parentFolderId, destination.beforeItemId),
    );
  };

  const allowDrop = (event: DragEvent<HTMLElement>, destination: ChapterTreeDestination) => {
    if (!canDropAt(event, destination)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      setDropTarget(undefined);
      return false;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(destination.key);
    return true;
  };

  const leaveDropTarget = (event: DragEvent<HTMLElement>, targetKey: string) => {
    const entered = event.relatedTarget;
    if (entered instanceof Node && event.currentTarget.contains(entered)) return;
    setDropTarget((currentTarget) => (currentTarget === targetKey ? undefined : currentTarget));
  };

  const move = (itemId: string, destination: Omit<ChapterTreeDestination, "key">) => {
    if (!canMoveTreeItem(structure, itemId, destination.parentFolderId, destination.beforeItemId)) {
      finishDrag();
      return false;
    }
    onStructureChange(
      moveTreeItem(structure, itemId, destination.parentFolderId, destination.beforeItemId),
    );
    finishDrag();
    return true;
  };

  const drop = (event: DragEvent<HTMLElement>, destination: ChapterTreeDestination) => {
    event.preventDefault();
    event.stopPropagation();
    const itemId = draggedId(event);
    return itemId ? move(itemId, destination) : false;
  };

  const chapterRowDestination = (
    event: DragEvent<HTMLElement>,
    item: ManuscriptTreeItem,
  ): ChapterTreeDestination => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientY < bounds.top + bounds.height / 2) {
      return {
        key: `row-before:${item.id}`,
        parentFolderId: item.parentFolderId,
        beforeItemId: item.id,
      };
    }
    const siblings = childrenOf(structure, item.parentFolderId);
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    return {
      key: `row-after:${item.id}`,
      parentFolderId: item.parentFolderId,
      beforeItemId: siblings[index + 1]?.id,
    };
  };

  const autoScroll = (event: DragEvent<HTMLElement>) => {
    if (!draggedItemIdRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = 42;
    if (event.clientY < bounds.top + edge) event.currentTarget.scrollTop -= 14;
    if (event.clientY > bounds.bottom - edge) event.currentTarget.scrollTop += 14;
  };

  return {
    draggedItemId,
    dropTarget,
    suppressSelectionRef,
    beginDrag,
    endDrag: finishDrag,
    allowDrop,
    leaveDropTarget,
    drop,
    move,
    chapterRowDestination,
    autoScroll,
  };
}
