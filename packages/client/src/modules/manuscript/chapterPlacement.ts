import { childrenOf, moveTreeItem } from "./binder/manuscriptTree";
import type { Chapter, ManuscriptStructure } from "./model";

export interface ChapterPlacement {
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** The structure after moving the chapter, or null when it cannot move that way. */
  move: (delta: number) => ManuscriptStructure | null;
}

/**
 * Where the selected chapter sits among its siblings, and how to move it.
 *
 * The binder shows these commands on the row and the inspector shows them as buttons.
 * Both read the same answer from here so the two can never disagree about whether a
 * chapter can still move up.
 */
export function chapterPlacement(
  structure: ManuscriptStructure,
  current?: Chapter,
): ChapterPlacement {
  const item = current
    ? structure.items.find((entry) => entry.kind === "chapter" && entry.chapterId === current.id)
    : undefined;
  const siblings = item ? childrenOf(structure, item.parentFolderId) : [];
  const index = item ? siblings.findIndex((entry) => entry.id === item.id) : -1;

  return {
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < siblings.length - 1,
    move: (delta) => {
      if (!item) return null;
      if (delta < 0 && index <= 0) return null;
      if (delta > 0 && index >= siblings.length - 1) return null;
      const beforeItemId = delta < 0 ? siblings[index - 1]?.id : siblings[index + 2]?.id;
      return moveTreeItem(structure, item.id, item.parentFolderId, beforeItemId);
    },
  };
}
