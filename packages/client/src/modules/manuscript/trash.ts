import { chapterBreadcrumb, childrenOf, manuscriptStructure } from "./binder/manuscriptTree";
import type { ChapterTrashEntry, Manuscript, ManuscriptStructure } from "./model";

export class ChapterRestoreError extends Error {}

const cloneEntry = (entry: ChapterTrashEntry): ChapterTrashEntry =>
  structuredClone(entry) as ChapterTrashEntry;

export function moveChapterToTrash(
  manuscript: Manuscript,
  chapterId: string,
  deletedAt = new Date().toISOString(),
): Manuscript {
  const chapter = manuscript.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error(`Missing chapter ${chapterId}`);
  const structure = manuscriptStructure(manuscript);
  const treeItem = structure.items.find(
    (item) => item.kind === "chapter" && item.chapterId === chapterId,
  );
  if (treeItem?.kind !== "chapter") throw new Error(`Missing chapter item ${chapterId}`);
  const entry: ChapterTrashEntry = {
    chapter: structuredClone(chapter) as typeof chapter,
    deletedAt,
    originalFolderPath: chapterBreadcrumb(structure, chapterId).map((folder) => ({ ...folder })),
    treeItem: { ...treeItem },
  };
  return {
    ...manuscript,
    chapters: manuscript.chapters.filter((candidate) => candidate.id !== chapterId),
    structure: normalizeStructure({
      ...structure,
      folders: structure.folders,
      items: structure.items.filter((item) => item.id !== treeItem.id),
    }),
    trash: [...(manuscript.trash ?? []).map(cloneEntry), entry],
  };
}

export function restoreTrashedChapter(
  manuscript: Manuscript,
  chapterId: string,
  options: { availableMomentIds?: ReadonlySet<string> } = {},
): { manuscript: Manuscript; restoredToRoot: boolean } {
  if (manuscript.chapters.some((chapter) => chapter.id === chapterId)) {
    throw new ChapterRestoreError("active-id-collision");
  }
  const entry = manuscript.trash?.find((candidate) => candidate.chapter.id === chapterId);
  if (!entry) throw new ChapterRestoreError("missing-trash-entry");
  const storyTime = entry.chapter.storyTime;
  if (
    storyTime &&
    options.availableMomentIds &&
    (!options.availableMomentIds.has(storyTime.startMomentId) ||
      (storyTime.endMomentId !== undefined &&
        !options.availableMomentIds.has(storyTime.endMomentId)))
  ) {
    throw new ChapterRestoreError("missing-story-time-target");
  }
  const structure = manuscriptStructure(manuscript);
  if (structure.items.some((item) => item.id === entry.treeItem.id)) {
    throw new ChapterRestoreError("tree-item-id-collision");
  }
  const requestedParent = entry.treeItem.parentFolderId;
  const parentExists =
    !requestedParent || structure.folders.some((folder) => folder.id === requestedParent);
  const parentFolderId = parentExists ? requestedParent : undefined;
  const siblings = childrenOf(structure, parentFolderId);
  const position = Math.min(entry.treeItem.position, siblings.length);
  const shifted = structure.items.map((item) => {
    const sameParent = (item.parentFolderId || undefined) === parentFolderId;
    return sameParent && item.position >= position
      ? { ...item, position: item.position + 1 }
      : item;
  });
  const treeItem = { ...entry.treeItem, position };
  if (parentFolderId) treeItem.parentFolderId = parentFolderId;
  else delete treeItem.parentFolderId;
  return {
    manuscript: {
      ...manuscript,
      chapters: [...manuscript.chapters, structuredClone(entry.chapter) as typeof entry.chapter],
      structure: normalizeStructure({
        ...structure,
        folders: structure.folders,
        items: [...shifted, treeItem],
      }),
      trash: manuscript.trash?.filter((candidate) => candidate !== entry),
    },
    restoredToRoot: Boolean(requestedParent && !parentExists),
  };
}

export function purgeTrashedChapter(manuscript: Manuscript, chapterId: string): Manuscript {
  return {
    ...manuscript,
    trash: manuscript.trash?.filter((entry) => entry.chapter.id !== chapterId),
  };
}

export function searchChapterTrash(
  entries: readonly ChapterTrashEntry[],
  query: string,
): ChapterTrashEntry[] {
  const needle = query.trim().toLocaleLowerCase("de-DE");
  if (!needle) return entries.map(cloneEntry);
  return entries
    .filter((entry) =>
      `${entry.chapter.title}\n${entry.chapter.body}`.toLocaleLowerCase("de-DE").includes(needle),
    )
    .map(cloneEntry);
}

function normalizeStructure(structure: ManuscriptStructure): ManuscriptStructure {
  const items = structure.items.map((item) => ({ ...item }));
  const parents = new Set(items.map((item) => item.parentFolderId || undefined));
  for (const parent of parents) {
    childrenOf({ folders: structure.folders, items }, parent).forEach((item, position) => {
      item.position = position;
    });
  }
  return {
    ...structure,
    folders: structure.folders.map((folder) => ({ ...folder })),
    items,
  };
}
