import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Ellipsis,
  Folder,
  FolderPlus,
  GripVertical,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, IconButton } from "../../design";
import { useI18n } from "../../i18n";
import { quiltorClient } from "../../platform";
import type { ViewportMode } from "../../shared";
import { uid } from "../../shared/id";
import { Menu, MenuItem, Popover } from "../../shared/ui";
import type { TimelineMoment, TimeSystem } from "../story-world";
import {
  addFolder,
  canMoveTreeItem,
  chapterBreadcrumb,
  childrenOf,
  deleteFolder,
  flattenChapterIds,
  manuscriptStructure,
  moveTreeItem,
  renameFolder,
} from "./binder/manuscriptTree";
import { ChapterStoryTimeFields, chapterStoryTimeLabel } from "./ChapterStoryTimeFields";
import type { Chapter, Manuscript, ManuscriptStructure, ManuscriptTreeItem } from "./model";
import { wordCount } from "./wordCount";
import "./ChapterBinder.css";
import "./ChapterFolderTree.css";

interface ChapterBinderProps {
  manuscript: Manuscript;
  current?: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  totalWords: number;
  viewportMode: ViewportMode;
  onClose: () => void;
  onSelect: (id: string) => void;
  onStructureChange: (structure: ManuscriptStructure) => void;
  onUpdateCurrent: (patch: Partial<Chapter>) => void;
  onExportCurrent: () => void;
  onRequestDelete: () => void;
}

const collapsedKey = (folderId: string) => `quiltor:binder:collapsed:${folderId}`;
const binderDragType = "application/x-quiltor-binder-item";

function FolderRowActions({
  title,
  editing,
  onRename,
  onDelete,
  onCommit,
  onCancel,
}: {
  title: string;
  editing: boolean;
  onRename: () => void;
  onDelete: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const menuLabel = `${t("menuActions")}: ${title}`;

  if (editing)
    return (
      <div className="binder-folder-actions">
        <IconButton
          className="binder-folder-action"
          icon={<Check />}
          label={t("apply")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onCommit}
        />
        <IconButton
          className="binder-folder-action"
          icon={<X />}
          label={t("cancel")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onCancel}
        />
      </div>
    );

  return (
    <div className="binder-folder-actions">
      <div className="binder-folder-direct-actions">
        <IconButton
          className="binder-folder-action"
          icon={<Pencil />}
          label={`${t("renameFolder")}: ${title}`}
          onClick={onRename}
        />
        <IconButton
          className="binder-folder-action chapter-action-delete"
          icon={<Trash2 />}
          label={`${t("deleteFolder")}: ${title}`}
          tone="danger"
          onClick={onDelete}
          title={t("deleteFolderKeepsContents")}
        />
      </div>
      <IconButton
        ref={menuAnchor}
        className="binder-folder-action binder-folder-more"
        icon={<Ellipsis />}
        label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      />
      <Popover
        anchorRef={menuAnchor}
        open={menuOpen}
        label={menuLabel}
        onClose={() => setMenuOpen(false)}
      >
        <Menu label={menuLabel} onClose={() => setMenuOpen(false)}>
          <MenuItem
            onSelect={() => {
              setMenuOpen(false);
              // Let the popover restore focus to its trigger before the trigger is replaced by
              // the auto-focused editor. Otherwise focus restoration immediately blurs and
              // commits the freshly opened field again.
              queueMicrotask(onRename);
            }}
          >
            <Pencil />
            {t("renameFolder")}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2 />
            {t("deleteFolderKeepsContents")}
          </MenuItem>
        </Menu>
      </Popover>
    </div>
  );
}

export function ChapterBinder({
  manuscript,
  current,
  timeline,
  timeSystem,
  totalWords,
  viewportMode,
  onClose,
  onSelect,
  onStructureChange,
  onUpdateCurrent,
  onExportCurrent,
  onRequestDelete,
}: ChapterBinderProps) {
  const { t } = useI18n();
  const structure = useMemo(() => manuscriptStructure(manuscript), [manuscript]);
  const chapterById = useMemo(
    () => new Map(manuscript.chapters.map((chapter) => [chapter.id, chapter])),
    [manuscript.chapters],
  );
  const orderedIds = useMemo(() => flattenChapterIds(structure), [structure]);
  const numberById = useMemo(
    () => new Map(orderedIds.map((chapterId, index) => [chapterId, index + 1])),
    [orderedIds],
  );
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
    structure.folders.forEach((folder) => countChapters(folder.id));
    return counts;
  }, [structure]);
  const [draggedItemId, setDraggedItemId] = useState<string>();
  const draggedItemIdRef = useRef<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string>();
  const suppressChapterClickRef = useRef(false);
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
  const currentItem = current
    ? structure.items.find((item) => item.kind === "chapter" && item.chapterId === current.id)
    : undefined;

  const finishDrag = () => {
    draggedItemIdRef.current = undefined;
    setDraggedItemId(undefined);
    setDropTarget(undefined);
    window.setTimeout(() => {
      suppressChapterClickRef.current = false;
    }, 0);
  };
  const beginDrag = (
    event: React.DragEvent<HTMLElement>,
    itemId: string,
    suppressChapterClick = false,
  ) => {
    draggedItemIdRef.current = itemId;
    suppressChapterClickRef.current = suppressChapterClick;
    setDraggedItemId(itemId);
    setDropTarget(undefined);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(binderDragType, itemId);
      event.dataTransfer.setData("text/plain", itemId);
    }
  };
  const endDrag = () => finishDrag();
  const dragItemId = (event?: React.DragEvent<HTMLElement>) =>
    draggedItemIdRef.current ||
    draggedItemId ||
    event?.dataTransfer?.getData(binderDragType) ||
    undefined;
  const allowDrop = (
    event: React.DragEvent<HTMLElement>,
    targetKey: string,
    parentFolderId?: string,
    beforeItemId?: string,
  ) => {
    const itemId = dragItemId(event);
    if (!itemId || !canMoveTreeItem(structure, itemId, parentFolderId, beforeItemId)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      setDropTarget(undefined);
      return false;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(targetKey);
    return true;
  };
  const leaveDropTarget = (event: React.DragEvent<HTMLElement>, targetKey: string) => {
    const entered = event.relatedTarget;
    if (entered instanceof Node && event.currentTarget.contains(entered)) return;
    setDropTarget((currentTarget) => (currentTarget === targetKey ? undefined : currentTarget));
  };
  const applyMove = (itemId: string, parentFolderId?: string, beforeItemId?: string) => {
    if (!canMoveTreeItem(structure, itemId, parentFolderId, beforeItemId)) {
      finishDrag();
      return false;
    }
    onStructureChange(moveTreeItem(structure, itemId, parentFolderId, beforeItemId));
    finishDrag();
    return true;
  };
  const handleDrop = (
    event: React.DragEvent<HTMLElement>,
    parentFolderId?: string,
    beforeItemId?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const itemId = dragItemId(event);
    return itemId ? applyMove(itemId, parentFolderId, beforeItemId) : false;
  };
  const moveCurrent = (delta: number) => {
    if (!currentItem) return;
    const parent = currentItem.parentFolderId;
    const siblings = childrenOf(structure, parent);
    const index = siblings.findIndex((item) => item.id === currentItem.id);
    if (delta < 0 && index > 0) applyMove(currentItem.id, parent, siblings[index - 1].id);
    if (delta > 0 && index >= 0 && index < siblings.length - 1) {
      applyMove(currentItem.id, parent, siblings[index + 2]?.id);
    }
  };
  const toggleFolder = (folderId: string) => {
    const next = new Set(collapsed);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    quiltorClient.platform.preferences.set(collapsedKey(folderId), String(next.has(folderId)));
    setCollapsed(next);
  };
  const createFolder = () => {
    const parentFolderId = currentItem?.parentFolderId;
    const folderId = uid("folder");
    onStructureChange(
      addFolder(
        structure,
        { id: folderId, title: t("newFolderTitle") },
        uid("tree"),
        parentFolderId,
      ),
    );
    setEditingFolderId(folderId);
    setFolderTitle(t("newFolderTitle"));
  };
  const commitFolderTitle = (folderId: string) => {
    const clean = folderTitle.trim() || t("untitledFolder");
    onStructureChange(renameFolder(structure, folderId, clean));
    setEditingFolderId(undefined);
  };
  const moveTreeFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-binder-item]"))
      return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-binder-item]")];
    const current = items.indexOf(event.target);
    if (current < 0 || items.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
    items[nextIndex]?.focus();
  };

  const dragHandle = (item: ManuscriptTreeItem, dragSource = false) => (
    <span
      className="binder-drag-handle"
      draggable={dragSource || undefined}
      onDragStart={dragSource ? (event) => beginDrag(event, item.id) : undefined}
      onDragEnd={dragSource ? endDrag : undefined}
      aria-hidden="true"
    >
      <GripVertical />
    </span>
  );
  const dropBefore = (item: ManuscriptTreeItem, depth: number) => (
    <div
      className={`binder-drop-before ${draggedItemId ? "is-visible" : ""} ${
        dropTarget === `before:${item.id}` ? "is-active" : ""
      }`}
      style={{ "--binder-depth": depth } as React.CSSProperties}
      onDragEnter={(event) => allowDrop(event, `before:${item.id}`, item.parentFolderId, item.id)}
      onDragOver={(event) => allowDrop(event, `before:${item.id}`, item.parentFolderId, item.id)}
      onDragLeave={(event) => leaveDropTarget(event, `before:${item.id}`)}
      onDrop={(event) => handleDrop(event, item.parentFolderId, item.id)}
      aria-hidden="true"
    />
  );

  const chapterRowDestination = (event: React.DragEvent<HTMLElement>, item: ManuscriptTreeItem) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const placeAfter = event.clientY >= bounds.top + bounds.height / 2;
    if (!placeAfter) {
      return { key: `row-before:${item.id}`, beforeItemId: item.id };
    }
    const siblings = childrenOf(structure, item.parentFolderId);
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    return {
      key: `row-after:${item.id}`,
      beforeItemId: siblings[index + 1]?.id,
    };
  };

  const renderItem = (item: ManuscriptTreeItem, depth: number): React.ReactNode => {
    if (item.kind === "chapter") {
      const chapter = chapterById.get(item.chapterId);
      if (!chapter) return null;
      const breadcrumb = chapterBreadcrumb(structure, chapter.id)
        .map((folder) => folder.title)
        .join(" / ");
      return (
        <div
          className="binder-tree-entry"
          key={item.id}
          role="listitem"
          data-binder-depth={depth}
          style={{ "--binder-depth": depth } as React.CSSProperties}
        >
          {dropBefore(item, depth)}
          <button
            type="button"
            draggable
            data-binder-item
            data-binder-depth={depth}
            aria-current={chapter.id === current?.id ? "page" : undefined}
            className={`binder-chapter-row ${chapter.id === current?.id ? "active" : ""}`}
            style={{ "--binder-depth": depth } as React.CSSProperties}
            onClick={(event) => {
              if (suppressChapterClickRef.current) {
                event.preventDefault();
                return;
              }
              onSelect(chapter.id);
              if (viewportMode === "compact") onClose();
            }}
            onDragStart={(event) => beginDrag(event, item.id, true)}
            onDragEnd={endDrag}
            onDragEnter={(event) => {
              const destination = chapterRowDestination(event, item);
              allowDrop(event, destination.key, item.parentFolderId, destination.beforeItemId);
            }}
            onDragOver={(event) => {
              const destination = chapterRowDestination(event, item);
              allowDrop(event, destination.key, item.parentFolderId, destination.beforeItemId);
            }}
            onDragLeave={(event) => {
              leaveDropTarget(event, `row-before:${item.id}`);
              leaveDropTarget(event, `row-after:${item.id}`);
            }}
            onDrop={(event) => {
              const destination = chapterRowDestination(event, item);
              handleDrop(event, item.parentFolderId, destination.beforeItemId);
            }}
            data-drop-position={
              dropTarget === `row-before:${item.id}`
                ? "before"
                : dropTarget === `row-after:${item.id}`
                  ? "after"
                  : undefined
            }
          >
            {dragHandle(item)}
            <span className="chapter-number">
              {String(numberById.get(chapter.id) ?? 0).padStart(2, "0")}
            </span>
            <span className="chapter-name">{chapter.title || t("untitled")}</span>
            <span className="chapter-words">
              {wordCount(chapter.body)} {t("words")}
            </span>
            <span className="chapter-story-time-summary">
              {chapterStoryTimeLabel(chapter, timeline, timeSystem, t)}
            </span>
            {breadcrumb && <span className="chapter-breadcrumb">{breadcrumb}</span>}
          </button>
        </div>
      );
    }

    const folder = structure.folders.find((candidate) => candidate.id === item.folderId);
    if (!folder) return null;
    const isCollapsed = collapsed.has(folder.id);
    const displayTitle = folder.title || t("untitledFolder");
    const childItems = childrenOf(structure, folder.id);
    const chapterCount = chapterCountByFolder.get(folder.id) ?? 0;
    const childrenId = `binder-folder-children-${folder.id}`;
    return (
      <div
        className="binder-tree-entry binder-folder-entry"
        key={item.id}
        role="listitem"
        data-binder-depth={depth}
        style={{ "--binder-depth": depth } as React.CSSProperties}
      >
        {dropBefore(item, depth)}
        <div
          className={`binder-folder-row ${
            dropTarget === `folder:${folder.id}` ? "is-drop-target" : ""
          }`}
          data-binder-depth={depth}
          onDragOver={(event) => {
            allowDrop(event, `folder:${folder.id}`, folder.id);
          }}
          onDragEnter={(event) => allowDrop(event, `folder:${folder.id}`, folder.id)}
          onDragLeave={(event) => leaveDropTarget(event, `folder:${folder.id}`)}
          onDrop={(event) => {
            if (!handleDrop(event, folder.id)) return;
            if (collapsed.has(folder.id)) {
              const next = new Set(collapsed);
              next.delete(folder.id);
              quiltorClient.platform.preferences.set(collapsedKey(folder.id), "false");
              setCollapsed(next);
            }
          }}
        >
          {dragHandle(item, true)}
          {editingFolderId === folder.id ? (
            <div className="binder-folder-editor">
              <Folder className="binder-folder-icon" aria-hidden="true" />
              <input
                className="binder-folder-input"
                value={folderTitle}
                autoFocus
                onChange={(event) => setFolderTitle(event.target.value)}
                onBlur={() => commitFolderTitle(folder.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitFolderTitle(folder.id);
                  if (event.key === "Escape") setEditingFolderId(undefined);
                }}
                aria-label={t("folderName")}
              />
            </div>
          ) : (
            <Button
              appearance="ghost"
              size="touch"
              className="binder-folder-toggle"
              icon={isCollapsed ? <ChevronRight /> : <ChevronDown />}
              onClick={() => toggleFolder(folder.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" && isCollapsed) {
                  event.preventDefault();
                  toggleFolder(folder.id);
                }
                if (event.key === "ArrowLeft" && !isCollapsed) {
                  event.preventDefault();
                  toggleFolder(folder.id);
                }
              }}
              data-binder-item
              aria-expanded={!isCollapsed}
              aria-controls={childrenId}
              aria-label={`${displayTitle}, ${t("folderChapterCount", { count: chapterCount })}: ${
                isCollapsed ? t("expandFolder") : t("collapseFolder")
              }`}
              title={displayTitle}
            >
              <span className="binder-folder-label">
                <Folder className="binder-folder-icon" aria-hidden="true" />
                <span className="binder-folder-name">{displayTitle}</span>
                <span
                  className="binder-folder-count"
                  aria-label={t("folderChapterCount", { count: chapterCount })}
                >
                  {chapterCount}
                </span>
              </span>
            </Button>
          )}
          <FolderRowActions
            title={displayTitle}
            editing={editingFolderId === folder.id}
            onRename={() => {
              setEditingFolderId(folder.id);
              setFolderTitle(folder.title);
            }}
            onDelete={() => onStructureChange(deleteFolder(structure, folder.id))}
            onCommit={() => commitFolderTitle(folder.id)}
            onCancel={() => setEditingFolderId(undefined)}
          />
        </div>
        {!isCollapsed && (
          <div id={childrenId} className="binder-folder-children" role="list">
            {childItems.length > 0 ? (
              renderLevel(folder.id, depth + 1)
            ) : (
              <p className="binder-folder-empty">{t("emptyFolder")}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLevel = (parentFolderId?: string, depth = 0): React.ReactNode =>
    childrenOf(structure, parentFolderId).map((item) => renderItem(item, depth));

  return (
    <>
      <div className="panel-heading panel-heading--binder">
        <span>{t("chapters")}</span>
        <IconButton
          icon={<X />}
          label={t("closeNavigation")}
          onClick={onClose}
          title={t("closeNavigation")}
        />
      </div>
      {current && (
        <section className="binder-chapter-actions">
          <span>{t("chapterActions")}</span>
          <div
            role="group"
            aria-label={`${t("chapterActions")}: ${current.title || t("untitled")}`}
          >
            <IconButton
              className="binder-chapter-action"
              icon={<ChevronUp />}
              label={t("moveUp")}
              disabled={!currentItem || currentItem.position <= 0}
              onClick={() => moveCurrent(-1)}
              title={t("moveUp")}
            />
            <IconButton
              className="binder-chapter-action"
              icon={<ChevronDown />}
              label={t("moveDown")}
              disabled={
                !currentItem ||
                currentItem.position >= childrenOf(structure, currentItem.parentFolderId).length - 1
              }
              onClick={() => moveCurrent(1)}
              title={t("moveDown")}
            />
            <IconButton
              className="binder-chapter-action"
              icon={<Download />}
              label={t("chapterMarkdown")}
              onClick={onExportCurrent}
              title={t("chapterMarkdown")}
            />
            <IconButton
              className="binder-chapter-action chapter-action-delete"
              icon={<Trash2 />}
              label={t("deleteChapter")}
              tone="danger"
              onClick={onRequestDelete}
              title={t("deleteChapter")}
            />
          </div>
        </section>
      )}
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
        <div
          className="chapter-list binder-tree"
          role="list"
          aria-label={t("chapterStructure")}
          onKeyDown={moveTreeFocus}
          onDragOverCapture={(event) => {
            if (!draggedItemIdRef.current) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const edge = 42;
            if (event.clientY < bounds.top + edge) event.currentTarget.scrollTop -= 14;
            if (event.clientY > bounds.bottom - edge) event.currentTarget.scrollTop += 14;
          }}
        >
          {renderLevel()}
        </div>
        <div
          className={`binder-root-drop ${draggedItemId ? "is-visible" : ""} ${
            dropTarget === "root" ? "is-active" : ""
          }`}
          onDragEnter={(event) => allowDrop(event, "root")}
          onDragOver={(event) => allowDrop(event, "root")}
          onDragLeave={(event) => leaveDropTarget(event, "root")}
          onDrop={(event) => handleDrop(event)}
          aria-hidden={!draggedItemId}
        >
          {t("moveToRoot")}
        </div>
      </div>
      {current && (
        <>
          <ChapterStoryTimeFields
            key={current.id}
            chapter={current}
            timeline={timeline}
            timeSystem={timeSystem}
            onChange={(storyTime) => onUpdateCurrent({ storyTime })}
          />
          <label className="field binder-note">
            <span>{t("chapterNote")}</span>
            <textarea
              value={current.note}
              onChange={(event) => onUpdateCurrent({ note: event.target.value })}
              placeholder={t("chapterNotePlaceholder")}
            />
          </label>
        </>
      )}
      <footer>
        {orderedIds.length} {t("chapters")} · {(totalWords / 250).toFixed(1).replace(".", ",")}{" "}
        {t("standardPages")}
      </footer>
    </>
  );
}
