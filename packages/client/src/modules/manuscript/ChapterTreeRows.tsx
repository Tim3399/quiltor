import {
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  GripVertical,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { Button, DropdownMenu, IconButton, MenuItem, MenuSeparator, TextField } from "../../design";
import { useI18n } from "../../i18n";
import type { ChapterFolder, ManuscriptTreeItem } from "./model";
import type { ChapterTreeDragDrop } from "./useChapterTreeDragDrop";

function depthStyle(depth: number) {
  return { "--binder-depth": depth } as CSSProperties;
}

export function ChapterTreeDragHandle({
  item,
  dragDrop,
  dragSource = false,
}: {
  item: ManuscriptTreeItem;
  dragDrop: ChapterTreeDragDrop;
  dragSource?: boolean;
}) {
  return (
    <span
      className="binder-drag-handle"
      draggable={dragSource || undefined}
      onDragStart={dragSource ? (event) => dragDrop.beginDrag(event, item.id) : undefined}
      onDragEnd={dragSource ? dragDrop.endDrag : undefined}
      aria-hidden="true"
    >
      <GripVertical />
    </span>
  );
}

export function ChapterTreeDropBefore({
  item,
  depth,
  dragDrop,
}: {
  item: ManuscriptTreeItem;
  depth: number;
  dragDrop: ChapterTreeDragDrop;
}) {
  const destination = {
    key: `before:${item.id}`,
    parentFolderId: item.parentFolderId,
    beforeItemId: item.id,
  };
  return (
    <div
      role="presentation"
      className={`binder-drop-before ${dragDrop.draggedItemId ? "is-visible" : ""} ${
        dragDrop.dropTarget === destination.key ? "is-active" : ""
      }`}
      style={depthStyle(depth)}
      onDragEnter={(event) => dragDrop.allowDrop(event, destination)}
      onDragOver={(event) => dragDrop.allowDrop(event, destination)}
      onDragLeave={(event) => dragDrop.leaveDropTarget(event, destination.key)}
      onDrop={(event) => dragDrop.drop(event, destination)}
      aria-hidden="true"
    />
  );
}

export function ChapterTreeEntry({
  item,
  depth,
  dragDrop,
  folder = false,
  children,
}: {
  item: ManuscriptTreeItem;
  depth: number;
  dragDrop: ChapterTreeDragDrop;
  folder?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={`binder-tree-entry${folder ? " binder-folder-entry" : ""}`}
      data-binder-depth={depth}
      style={depthStyle(depth)}
    >
      <ChapterTreeDropBefore item={item} depth={depth} dragDrop={dragDrop} />
      {children}
    </li>
  );
}

export interface ChapterTreeChapterRowProps {
  item: ManuscriptTreeItem;
  depth: number;
  selected: boolean;
  label: string;
  number: string;
  words: ReactNode;
  storyTime: ReactNode;
  actions?: ReactNode;
  dragDrop: ChapterTreeDragDrop;
  onSelect: () => void;
}

export function ChapterTreeChapterRow({
  item,
  depth,
  selected,
  label,
  number,
  words,
  storyTime,
  actions,
  dragDrop,
  onSelect,
}: ChapterTreeChapterRowProps) {
  const rowDestination = (event: DragEvent<HTMLElement>) =>
    dragDrop.chapterRowDestination(event, item);
  return (
    // The action trigger must remain a sibling of the selection button: nested controls are invalid.
    // biome-ignore lint/a11y/noStaticElementInteractions: native drag-and-drop is owned by the focused controls inside this layout wrapper.
    <div
      data-binder-depth={depth}
      className={`binder-chapter-row ${selected ? "active" : ""} ${actions ? "has-actions" : ""}`.trim()}
      onDragEnter={(event) => dragDrop.allowDrop(event, rowDestination(event))}
      onDragOver={(event) => dragDrop.allowDrop(event, rowDestination(event))}
      onDragLeave={(event) => {
        dragDrop.leaveDropTarget(event, `row-before:${item.id}`);
        dragDrop.leaveDropTarget(event, `row-after:${item.id}`);
      }}
      onDrop={(event) => dragDrop.drop(event, rowDestination(event))}
      data-drop-position={
        dragDrop.dropTarget === `row-before:${item.id}`
          ? "before"
          : dragDrop.dropTarget === `row-after:${item.id}`
            ? "after"
            : undefined
      }
    >
      <ChapterTreeDragHandle item={item} dragDrop={dragDrop} dragSource />
      <Button
        appearance="ghost"
        size="touch"
        draggable
        data-binder-item
        aria-current={selected ? "page" : undefined}
        className="binder-chapter-select"
        onClick={(event) => {
          if (dragDrop.suppressSelectionRef.current) {
            event.preventDefault();
            return;
          }
          onSelect();
        }}
        onDragStart={(event) => dragDrop.beginDrag(event, item.id, true)}
        onDragEnd={dragDrop.endDrag}
      >
        <span className="binder-chapter-content">
          <span className="chapter-number">{number}</span>
          <span className="chapter-name">{label}</span>
          <span className="chapter-meta">
            <span className="chapter-words">{words}</span>
            <span className="chapter-story-time-summary">{storyTime}</span>
          </span>
        </span>
      </Button>
      {actions}
    </div>
  );
}

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
      <DropdownMenu
        label={menuLabel}
        renderTrigger={({ ref, ...triggerProps }) => (
          <IconButton
            {...triggerProps}
            ref={ref}
            className="binder-folder-action binder-folder-more"
            icon={<Ellipsis />}
            label={menuLabel}
          />
        )}
      >
        <MenuItem
          icon={<Pencil />}
          label={t("renameFolder")}
          onSelect={() => queueMicrotask(onRename)}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 />}
          label={t("deleteFolderKeepsContents")}
          tone="danger"
          onSelect={onDelete}
        />
      </DropdownMenu>
    </div>
  );
}

export interface ChapterTreeFolderRowProps {
  item: ManuscriptTreeItem;
  folder: ChapterFolder;
  depth: number;
  collapsed: boolean;
  editing: boolean;
  title: string;
  chapterCount: number;
  childrenId: string;
  folderTitle: string;
  dragDrop: ChapterTreeDragDrop;
  onFolderTitle: (title: string) => void;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onDropIntoFolder: () => void;
}

export function ChapterTreeFolderRow({
  item,
  folder,
  depth,
  collapsed,
  editing,
  title,
  chapterCount,
  childrenId,
  folderTitle,
  dragDrop,
  onFolderTitle,
  onToggle,
  onRename,
  onDelete,
  onCommit,
  onCancel,
  onDropIntoFolder,
}: ChapterTreeFolderRowProps) {
  const { t } = useI18n();
  const destination = { key: `folder:${folder.id}`, parentFolderId: folder.id };
  return (
    // Native drag targets do not represent an additional keyboard interaction or ARIA widget.
    // biome-ignore lint/a11y/noStaticElementInteractions: the nested controls own interaction.
    <div
      className={`binder-folder-row ${
        dragDrop.dropTarget === destination.key ? "is-drop-target" : ""
      }`}
      data-binder-depth={depth}
      onDragOver={(event) => dragDrop.allowDrop(event, destination)}
      onDragEnter={(event) => dragDrop.allowDrop(event, destination)}
      onDragLeave={(event) => dragDrop.leaveDropTarget(event, destination.key)}
      onDrop={(event) => {
        if (dragDrop.drop(event, destination)) onDropIntoFolder();
      }}
    >
      <ChapterTreeDragHandle item={item} dragDrop={dragDrop} dragSource />
      {editing ? (
        <TextField
          fieldClassName="binder-folder-editor"
          className="binder-folder-input"
          label={t("folderName")}
          labelHidden
          value={folderTitle}
          autoFocus
          onChange={(event) => onFolderTitle(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit();
            if (event.key === "Escape") onCancel();
          }}
        />
      ) : (
        <Button
          appearance="ghost"
          size="touch"
          className="binder-folder-toggle"
          icon={collapsed ? <ChevronRight /> : <ChevronDown />}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" && collapsed) {
              event.preventDefault();
              onToggle();
            }
            if (event.key === "ArrowLeft" && !collapsed) {
              event.preventDefault();
              onToggle();
            }
          }}
          data-binder-item
          aria-expanded={!collapsed}
          aria-controls={childrenId}
          aria-label={`${title}, ${t("folderChapterCount", { count: chapterCount })}: ${
            collapsed ? t("expandFolder") : t("collapseFolder")
          }`}
          title={title}
        >
          <span className="binder-folder-label">
            <Folder className="binder-folder-icon" aria-hidden="true" />
            <span className="binder-folder-name">{title}</span>
            <span className="binder-folder-count">{chapterCount}</span>
          </span>
        </Button>
      )}
      <FolderRowActions
        title={title}
        editing={editing}
        onRename={onRename}
        onDelete={onDelete}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}
