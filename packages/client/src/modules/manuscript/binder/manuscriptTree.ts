import type {
  Chapter,
  ChapterFolder,
  Manuscript,
  ManuscriptStructure,
  ManuscriptTreeItem,
} from "../model";

const parentOf = (item: ManuscriptTreeItem): string | undefined => item.parentFolderId || undefined;

export function flatManuscriptStructure(chapters: readonly Chapter[]): ManuscriptStructure {
  return {
    folders: [],
    items: chapters.map((chapter, position) => ({
      id: `chapter:${chapter.id}`,
      kind: "chapter" as const,
      chapterId: chapter.id,
      position,
    })),
  };
}

export function childrenOf(
  structure: ManuscriptStructure,
  parentFolderId?: string,
): ManuscriptTreeItem[] {
  return structure.items
    .filter((item) => parentOf(item) === parentFolderId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

function canonicalStructure(structure: ManuscriptStructure): ManuscriptStructure {
  const folderById = new Map(structure.folders.map((folder) => [folder.id, folder]));
  const folders: ChapterFolder[] = [];
  const items: ManuscriptTreeItem[] = [];
  const visit = (parentFolderId?: string) => {
    for (const item of childrenOf(structure, parentFolderId)) {
      items.push(item);
      if (item.kind === "folder") {
        const folder = folderById.get(item.folderId);
        if (folder) folders.push(folder);
        visit(item.folderId);
      }
    }
  };
  visit();
  return { folders, items };
}

export function structureIssues(
  chapters: readonly Chapter[],
  structure: ManuscriptStructure,
): string[] {
  const issues: string[] = [];
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const folderIds = new Set<string>();
  for (const folder of structure.folders) {
    if (!folder.id || folderIds.has(folder.id) || typeof folder.title !== "string") {
      issues.push("folder");
    }
    folderIds.add(folder.id);
  }
  const itemIds = new Set<string>();
  const ownedChapters = new Set<string>();
  const ownedFolders = new Set<string>();
  const folderParents = new Map<string, string | undefined>();
  const positions = new Map<string, Set<number>>();
  for (const item of structure.items) {
    const parent = parentOf(item);
    const parentKey = parent ?? "";
    const siblingPositions = positions.get(parentKey) ?? new Set<number>();
    if (
      !item.id ||
      itemIds.has(item.id) ||
      !Number.isInteger(item.position) ||
      item.position < 0 ||
      siblingPositions.has(item.position) ||
      (parent !== undefined && !folderIds.has(parent))
    ) {
      issues.push("item");
    }
    itemIds.add(item.id);
    siblingPositions.add(item.position);
    positions.set(parentKey, siblingPositions);
    if (item.kind === "chapter") {
      if (!chapterIds.has(item.chapterId) || ownedChapters.has(item.chapterId)) {
        issues.push("chapter-owner");
      }
      ownedChapters.add(item.chapterId);
    } else {
      if (!folderIds.has(item.folderId) || ownedFolders.has(item.folderId)) {
        issues.push("folder-owner");
      }
      if (parent === item.folderId) issues.push("self-parent");
      ownedFolders.add(item.folderId);
      folderParents.set(item.folderId, parent);
    }
  }
  if (
    ownedChapters.size !== chapterIds.size ||
    [...chapterIds].some((id) => !ownedChapters.has(id))
  ) {
    issues.push("chapter-coverage");
  }
  if (ownedFolders.size !== folderIds.size || [...folderIds].some((id) => !ownedFolders.has(id))) {
    issues.push("folder-coverage");
  }
  for (const siblingPositions of positions.values()) {
    if ([...siblingPositions].some((position) => position >= siblingPositions.size)) {
      issues.push("positions");
    }
  }
  for (const folderId of folderIds) {
    const seen = new Set([folderId]);
    let parent = folderParents.get(folderId);
    while (parent) {
      if (seen.has(parent)) {
        issues.push("cycle");
        break;
      }
      seen.add(parent);
      parent = folderParents.get(parent);
    }
  }
  return [...new Set(issues)];
}

export function manuscriptStructure(manuscript: Readonly<Manuscript>): ManuscriptStructure {
  const structure = manuscript.structure ?? flatManuscriptStructure(manuscript.chapters);
  const issues = structureIssues(manuscript.chapters, structure);
  if (issues.length) throw new Error(`Invalid manuscript structure: ${issues.join(", ")}`);
  return canonicalStructure({
    folders: structure.folders.map((folder) => ({ ...folder })),
    items: structure.items.map((item) => ({ ...item })),
  });
}

export function flattenChapterIds(structure: ManuscriptStructure): string[] {
  const result: string[] = [];
  const visit = (parentFolderId?: string) => {
    for (const item of childrenOf(structure, parentFolderId)) {
      if (item.kind === "chapter") result.push(item.chapterId);
      else visit(item.folderId);
    }
  };
  visit();
  return result;
}

export function orderedChapters(manuscript: Readonly<Manuscript>): Chapter[] {
  const byId = new Map(manuscript.chapters.map((chapter) => [chapter.id, chapter]));
  return flattenChapterIds(manuscriptStructure(manuscript)).map((id) => {
    const chapter = byId.get(id);
    if (!chapter) throw new Error(`Binder references missing chapter ${id}`);
    return chapter;
  });
}

export function chapterBreadcrumb(
  structure: ManuscriptStructure,
  chapterId: string,
): ChapterFolder[] {
  const folderById = new Map(structure.folders.map((folder) => [folder.id, folder]));
  const parentByFolder = new Map(
    structure.items
      .filter(
        (item): item is Extract<ManuscriptTreeItem, { kind: "folder" }> => item.kind === "folder",
      )
      .map((item) => [item.folderId, parentOf(item)]),
  );
  const item = structure.items.find(
    (candidate) => candidate.kind === "chapter" && candidate.chapterId === chapterId,
  );
  if (!item) return [];
  const result: ChapterFolder[] = [];
  let parent = parentOf(item);
  while (parent) {
    const folder = folderById.get(parent);
    if (!folder) break;
    result.push(folder);
    parent = parentByFolder.get(parent);
  }
  return result.reverse();
}

export function folderDescendants(structure: ManuscriptStructure, folderId: string): Set<string> {
  const result = new Set<string>();
  const pending = [folderId];
  while (pending.length) {
    const parent = pending.pop();
    for (const item of structure.items) {
      if (item.kind === "folder" && parentOf(item) === parent && !result.has(item.folderId)) {
        result.add(item.folderId);
        pending.push(item.folderId);
      }
    }
  }
  return result;
}

export function canMoveTreeItem(
  structure: ManuscriptStructure,
  itemId: string,
  targetFolderId?: string,
  beforeItemId?: string,
): boolean {
  const item = structure.items.find((candidate) => candidate.id === itemId);
  if (!item) return false;
  if (targetFolderId && !structure.folders.some((folder) => folder.id === targetFolderId)) {
    return false;
  }
  if (
    item.kind === "folder" &&
    (targetFolderId === item.folderId ||
      folderDescendants(structure, item.folderId).has(targetFolderId ?? ""))
  ) {
    return false;
  }

  const targetSiblings = childrenOf(structure, targetFolderId).filter(
    (candidate) => candidate.id !== itemId,
  );
  const targetIndex = beforeItemId
    ? targetSiblings.findIndex((candidate) => candidate.id === beforeItemId)
    : targetSiblings.length;
  if (targetIndex < 0) return false;

  const sourceParent = parentOf(item);
  if (sourceParent !== targetFolderId) return true;
  const sourceIndex = childrenOf(structure, sourceParent).findIndex(
    (candidate) => candidate.id === itemId,
  );
  return sourceIndex !== targetIndex;
}

function normalizePositions(structure: ManuscriptStructure): ManuscriptStructure {
  const items = structure.items.map((item) => ({ ...item }));
  const parents = new Set(items.map(parentOf));
  for (const parent of parents) {
    childrenOf({ folders: structure.folders, items }, parent).forEach((item, position) => {
      item.position = position;
    });
  }
  return canonicalStructure({ folders: structure.folders.map((folder) => ({ ...folder })), items });
}

export function moveTreeItem(
  structure: ManuscriptStructure,
  itemId: string,
  targetFolderId?: string,
  beforeItemId?: string,
): ManuscriptStructure {
  if (!canMoveTreeItem(structure, itemId, targetFolderId, beforeItemId)) return structure;
  const next = normalizePositions(structure);
  const item = next.items.find((candidate) => candidate.id === itemId);
  if (!item) return structure;
  const targetSiblings = childrenOf(next, targetFolderId).filter(
    (candidate) => candidate.id !== itemId,
  );
  const targetIndex = beforeItemId
    ? targetSiblings.findIndex((candidate) => candidate.id === beforeItemId)
    : targetSiblings.length;
  if (targetIndex < 0) return structure;
  if (targetFolderId) item.parentFolderId = targetFolderId;
  else delete item.parentFolderId;
  targetSiblings.splice(targetIndex, 0, item);
  targetSiblings.forEach((sibling, position) => {
    sibling.position = position;
  });
  return normalizePositions(next);
}

export function addFolder(
  structure: ManuscriptStructure,
  folder: ChapterFolder,
  itemId: string,
  parentFolderId?: string,
): ManuscriptStructure {
  const next = normalizePositions(structure);
  next.folders.push(folder);
  next.items.push({
    id: itemId,
    kind: "folder",
    folderId: folder.id,
    ...(parentFolderId ? { parentFolderId } : {}),
    position: childrenOf(next, parentFolderId).length,
  });
  return normalizePositions(next);
}

export function addChapterItem(
  structure: ManuscriptStructure,
  chapterId: string,
  itemId: string,
  parentFolderId?: string,
): ManuscriptStructure {
  const next = normalizePositions(structure);
  next.items.push({
    id: itemId,
    kind: "chapter",
    chapterId,
    ...(parentFolderId ? { parentFolderId } : {}),
    position: childrenOf(next, parentFolderId).length,
  });
  return normalizePositions(next);
}

export function removeChapterItem(
  structure: ManuscriptStructure,
  chapterId: string,
): ManuscriptStructure {
  return normalizePositions({
    folders: structure.folders,
    items: structure.items.filter(
      (item) => item.kind !== "chapter" || item.chapterId !== chapterId,
    ),
  });
}

export function renameFolder(
  structure: ManuscriptStructure,
  folderId: string,
  title: string,
): ManuscriptStructure {
  return {
    ...structure,
    folders: structure.folders.map((folder) =>
      folder.id === folderId ? { ...folder, title } : folder,
    ),
  };
}

export function deleteFolder(
  structure: ManuscriptStructure,
  folderId: string,
): ManuscriptStructure {
  const next = normalizePositions(structure);
  const folderItem = next.items.find(
    (item) => item.kind === "folder" && item.folderId === folderId,
  );
  if (!folderItem) return next;
  const parent = parentOf(folderItem);
  const children = childrenOf(next, folderId);
  for (const child of children) {
    if (parent) child.parentFolderId = parent;
    else delete child.parentFolderId;
  }
  next.items = next.items.filter((item) => item.id !== folderItem.id);
  next.folders = next.folders.filter((folder) => folder.id !== folderId);
  const siblings = childrenOf(next, parent).filter((item) => !children.includes(item));
  siblings.splice(folderItem.position, 0, ...children);
  siblings.forEach((item, position) => {
    item.position = position;
  });
  return normalizePositions(next);
}
