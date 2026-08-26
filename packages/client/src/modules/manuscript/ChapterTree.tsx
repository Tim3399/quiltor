import { FolderPlus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { Button, EmptyState, ScrollArea } from "../../design";
import { useI18n } from "../../i18n";
import { quiltorClient } from "../../platform";
import type { ViewportMode } from "../../shared";
import { uid } from "../../shared/id";
import type { TimelineMoment, TimeSystem } from "../story-world";
import {
  addFolder,
  childrenOf,
  deleteFolder,
  flattenChapterIds,
  renameFolder,
} from "./binder/manuscriptTree";
import { ChapterActionsMenu, type ChapterActionsMenuProps } from "./ChapterActionsMenu";
import { chapterStoryTimeLabel } from "./ChapterStoryTimeFields";
import { ChapterTreeChapterRow, ChapterTreeEntry, ChapterTreeFolderRow } from "./ChapterTreeRows";
import type { Chapter, Manuscript, ManuscriptStructure, ManuscriptTreeItem } from "./model";
import { useChapterTreeDragDrop } from "./useChapterTreeDragDrop";
import { wordCount } from "./wordCount";
import "./ChapterBinder.css";
import "./ChapterFolderTree.css";

const collapsedKey = (folderId: string) => `quiltor:binder:collapsed:${folderId}`;

export interface ChapterTreeProps {
  manuscript: Manuscript;
  structure: ManuscriptStructure;
  current?: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  viewportMode: ViewportMode;
  onClose: () => void;
  onSelect: (id: string) => void;
  onStructureChange: (structure: ManuscriptStructure) => void;
  chapterActions?: ChapterActionsMenuProps;
}

export function ChapterTree({
  manuscript,
  structure,
  current,
  timeline,
  timeSystem,
  viewportMode,
  onClose,
  onSelect,
  onStructureChange,
  chapterActions,
}: ChapterTreeProps) {
  const { t } = useI18n();
  const chapterById = useMemo(
    () => new Map(manuscript.chapters.map((chapter) => [chapter.id, chapter])),
    [manuscript.chapters],
  );
  const numberById = useMemo(
    () => new Map(flattenChapterIds(structure).map((chapterId, index) => [chapterId, index + 1])),
    [structure],
  );
  const currentItem = current
    ? structure.items.find((item) => item.kind === "chapter" && item.chapterId === current.id)
    : undefined;
  const chapterCountByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    const countChapters = (folderId: string, ancestors = new Set<string>()): number => {
      if (ancestors.has(folderId)) return 0;
      const cached = counts.get(folderId);
      if (cached !== undefined) return cached;
      const nextAncestors = new Set(ancestors).add(folderId);
      const count = childrenOf(structure, folderId).reduce(
        (total, item) =>
          total + (item.kind === "chapter" ? 1 : countChapters(item.folderId, nextAncestors)),
        0,
      );
      counts.set(folderId, count);
      return count;
    };
    structure.folders.forEach((folder) => {
      countChapters(folder.id);
    });
    return counts;
  }, [structure]);
  const [editingFolderId, setEditingFolderId] = useState<string>();
  const [folderTitle, setFolderTitle] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        structure.folders
          .filter(
            (folder) => quiltorClient.platform.preferences.get(collapsedKey(folder.id)) === "true",
          )
          .map((folder) => folder.id),
      ),
  );
  const dragDrop = useChapterTreeDragDrop({ structure, onStructureChange });

  const setFolderCollapsed = (folderId: string, nextCollapsed: boolean) => {
    const next = new Set(collapsed);
    if (nextCollapsed) next.add(folderId);
    else next.delete(folderId);
    quiltorClient.platform.preferences.set(collapsedKey(folderId), String(nextCollapsed));
    setCollapsed(next);
  };

  const toggleFolder = (folderId: string) => setFolderCollapsed(folderId, !collapsed.has(folderId));

  const createFolder = () => {
    const folderId = uid("folder");
    onStructureChange(
      addFolder(
        structure,
        { id: folderId, title: t("newFolderTitle") },
        uid("tree"),
        currentItem?.parentFolderId,
      ),
    );
    setEditingFolderId(folderId);
    setFolderTitle(t("newFolderTitle"));
  };

  const commitFolderTitle = (folderId: string) => {
    onStructureChange(renameFolder(structure, folderId, folderTitle.trim() || t("untitledFolder")));
    setEditingFolderId(undefined);
  };

  const moveTreeFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-binder-item]"))
      return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-binder-item]")];
    const currentIndex = items.indexOf(event.target);
    if (currentIndex < 0 || items.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : Math.max(
              0,
              Math.min(items.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)),
            );
    items[nextIndex]?.focus();
  };

  const renderItem = (item: ManuscriptTreeItem, depth: number): ReactNode => {
    if (item.kind === "chapter") {
      const chapter = chapterById.get(item.chapterId);
      if (!chapter) return null;
      return (
        <ChapterTreeEntry key={item.id} item={item} depth={depth} dragDrop={dragDrop}>
          <ChapterTreeChapterRow
            item={item}
            depth={depth}
            selected={chapter.id === current?.id}
            label={chapter.title || t("untitled")}
            number={String(numberById.get(chapter.id) ?? 0).padStart(2, "0")}
            words={
              <>
                {wordCount(chapter.body)} {t("words")}
              </>
            }
            storyTime={chapterStoryTimeLabel(chapter, timeline, timeSystem, t)}
            dragDrop={dragDrop}
            actions={
              chapter.id === current?.id && chapterActions ? (
                <ChapterActionsMenu {...chapterActions} />
              ) : undefined
            }
            onSelect={() => {
              onSelect(chapter.id);
              if (viewportMode === "compact") onClose();
            }}
          />
        </ChapterTreeEntry>
      );
    }

    const folder = structure.folders.find((candidate) => candidate.id === item.folderId);
    if (!folder) return null;
    const isCollapsed = collapsed.has(folder.id);
    const displayTitle = folder.title || t("untitledFolder");
    const childItems = childrenOf(structure, folder.id);
    const childrenId = `binder-folder-children-${folder.id}`;
    return (
      <ChapterTreeEntry key={item.id} item={item} depth={depth} dragDrop={dragDrop} folder>
        <ChapterTreeFolderRow
          item={item}
          folder={folder}
          depth={depth}
          collapsed={isCollapsed}
          editing={editingFolderId === folder.id}
          title={displayTitle}
          chapterCount={chapterCountByFolder.get(folder.id) ?? 0}
          childrenId={childrenId}
          folderTitle={folderTitle}
          dragDrop={dragDrop}
          onFolderTitle={setFolderTitle}
          onToggle={() => toggleFolder(folder.id)}
          onRename={() => {
            setEditingFolderId(folder.id);
            setFolderTitle(folder.title);
          }}
          onDelete={() => onStructureChange(deleteFolder(structure, folder.id))}
          onCommit={() => commitFolderTitle(folder.id)}
          onCancel={() => setEditingFolderId(undefined)}
          onDropIntoFolder={() => {
            if (isCollapsed) setFolderCollapsed(folder.id, false);
          }}
        />
        {!isCollapsed && (
          <ul id={childrenId} className="binder-folder-children">
            {childItems.length ? (
              renderLevel(folder.id, depth + 1)
            ) : (
              <li className="binder-folder-empty">{t("emptyFolder")}</li>
            )}
          </ul>
        )}
      </ChapterTreeEntry>
    );
  };

  const renderLevel = (parentFolderId?: string, depth = 0): ReactNode =>
    childrenOf(structure, parentFolderId).map((item) => renderItem(item, depth));

  return (
    <>
      <div className="binder-tree-toolbar">
        <Button
          appearance="secondary"
          icon={<FolderPlus />}
          className="binder-add-folder"
          onClick={createFolder}
        >
          {t("addFolder")}
        </Button>
      </div>
      <div className="binder-tree-shell">
        {structure.items.length ? (
          <ScrollArea
            as="ul"
            axis="y"
            gutter="stable"
            overscroll="auto"
            scrollbar="thin"
            surface="panel"
            className="chapter-list binder-tree"
            aria-label={t("chapterStructure")}
            onKeyDown={moveTreeFocus}
            onDragOverCapture={dragDrop.autoScroll}
          >
            {renderLevel()}
          </ScrollArea>
        ) : (
          <EmptyState title={t("chapterStructure")} size="compact">
            {t("emptyFolder")}
          </EmptyState>
        )}
        <div
          className={`binder-root-drop ${dragDrop.draggedItemId ? "is-visible" : ""} ${
            dragDrop.dropTarget === "root" ? "is-active" : ""
          }`}
          onDragEnter={(event) => dragDrop.allowDrop(event, { key: "root" })}
          onDragOver={(event) => dragDrop.allowDrop(event, { key: "root" })}
          onDragLeave={(event) => dragDrop.leaveDropTarget(event, "root")}
          onDrop={(event) => dragDrop.drop(event, { key: "root" })}
          aria-hidden={!dragDrop.draggedItemId}
        >
          {t("moveToRoot")}
        </div>
      </div>
    </>
  );
}
