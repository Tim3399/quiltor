import {
  BringToFront,
  Ellipsis,
  Frame,
  Library,
  Pencil,
  Plus,
  SendToBack,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  ListboxSelect,
  MenuItem,
  MenuSeparator,
  TextField,
  ToolbarButton,
  UndoRedoControls,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../design";
import { useI18n } from "../../i18n";
import type { StoryboardBoard } from "./model";
import "./StoryboardToolbar.css";

export type StoryboardToolbarProps = {
  boards: readonly StoryboardBoard[];
  currentBoardId: string;
  currentBoardTitle: string;
  nodeCount: number;
  libraryOpen: boolean;
  hasSelection: boolean;
  selectionLayer: "card" | "group" | null;
  canMoveForward: boolean;
  canMoveBackward: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelectBoard: (id: string) => void;
  onRenameBoard: (title: string) => void;
  onAddBoard: (title: string) => void;
  onAddNote: () => void;
  onAddGroup: (label: string) => void;
  onLibraryOpenChange: (open: boolean) => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDeleteSelection: () => void;
};

export function StoryboardToolbar({
  boards,
  currentBoardId,
  currentBoardTitle,
  nodeCount,
  libraryOpen,
  hasSelection,
  selectionLayer,
  canMoveForward,
  canMoveBackward,
  canUndo,
  canRedo,
  onSelectBoard,
  onRenameBoard,
  onAddBoard,
  onAddNote,
  onAddGroup,
  onLibraryOpenChange,
  onMoveForward,
  onMoveBackward,
  onUndo,
  onRedo,
  onDeleteSelection,
}: StoryboardToolbarProps) {
  const { t } = useI18n();
  const [boardTitleDraft, setBoardTitleDraft] = useState(currentBoardTitle);
  const [renamingBoard, setRenamingBoard] = useState(false);
  const boardNameField = useRef<HTMLInputElement>(null);
  const moveForwardLabel = t(
    selectionLayer === "group" ? "storyboardMoveFrameForward" : "storyboardMoveForward",
  );
  const moveBackwardLabel = t(
    selectionLayer === "group" ? "storyboardMoveFrameBackward" : "storyboardMoveBackward",
  );

  // A changed board title ends an unfinished rename and refills the draft. Adjusted during
  // render, React redoes the render at once, so the stale draft is never painted.
  const [syncedBoardTitle, setSyncedBoardTitle] = useState(currentBoardTitle);
  if (syncedBoardTitle !== currentBoardTitle) {
    setSyncedBoardTitle(currentBoardTitle);
    setBoardTitleDraft(currentBoardTitle);
    setRenamingBoard(false);
  }

  // Renaming starts from the overflow menu. The menu hands focus back to its trigger as it
  // closes, which is a passive-effect cleanup and so runs after autoFocus would have fired --
  // the field would lose focus at once and commit unchanged. A passive effect runs after that
  // cleanup, so the field keeps the focus.
  useEffect(() => {
    if (renamingBoard) boardNameField.current?.focus();
  }, [renamingBoard]);

  const commitBoardTitle = () => {
    const title = boardTitleDraft.trim() || currentBoardTitle || t("untitled");
    setBoardTitleDraft(title);
    setRenamingBoard(false);
    onRenameBoard(title);
  };

  return (
    <WorkspaceToolbar className="storyboard-toolbar" label={t("storyboardToolbarLabel")}>
      <WorkspaceToolbarTitle
        className="storyboard-toolbar__title"
        title={t("storyboardTitle")}
        detail={t("storyboardNodeCount", { count: nodeCount })}
      />
      <WorkspaceToolbarActions
        className="storyboard-toolbar__actions"
        create={
          <WorkspaceToolbarGroup label={t("storyboardAddNote")}>
            <WorkspaceToolbarCreateButton
              label={t("storyboardAddNote")}
              icon={<StickyNote />}
              onClick={onAddNote}
            />
          </WorkspaceToolbarGroup>
        }
        view={
          <>
            <WorkspaceToolbarGroup
              className="storyboard-toolbar__board-group"
              label={t("storyboardBoardSelect")}
              data-renaming={renamingBoard || undefined}
            >
              <div className="storyboard-board-current">
                {renamingBoard ? (
                  <TextField
                    fieldClassName="storyboard-board-name-field"
                    className="storyboard-board-name-control"
                    label={t("storyboardBoardName")}
                    labelHidden
                    value={boardTitleDraft}
                    ref={boardNameField}
                    onChange={(event) => setBoardTitleDraft(event.target.value)}
                    onBlur={commitBoardTitle}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                ) : (
                  <ListboxSelect
                    className="storyboard-board-select"
                    label={t("storyboardBoardSelect")}
                    value={currentBoardId}
                    options={boards.map((board) => ({ value: board.id, label: board.title }))}
                    onChange={onSelectBoard}
                  />
                )}
              </div>
            </WorkspaceToolbarGroup>
            <WorkspaceToolbarGroup label={t("storyboardToggleLibrary")}>
              <ToolbarButton
                label={t("storyboardToggleLibrary")}
                collapseAt="medium"
                icon={<Library />}
                aria-pressed={libraryOpen}
                onClick={() => onLibraryOpenChange(!libraryOpen)}
              />
            </WorkspaceToolbarGroup>
          </>
        }
        history={
          <WorkspaceToolbarGroup label={t("storyboardHistoryLabel")}>
            <UndoRedoControls
              label={t("storyboardHistoryLabel")}
              undoLabel={t("storyboardUndo")}
              redoLabel={t("storyboardRedo")}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => onUndo?.()}
              onRedo={() => onRedo?.()}
            />
          </WorkspaceToolbarGroup>
        }
        overflow={
          // Secondary by frequency: groups, layer order, deleting (also the Delete key) and
          // managing boards are occasional; notes, the board, the library and history are not.
          <DropdownMenu
            label={t("toolbarMoreActions")}
            renderTrigger={({ ref, ...triggerProps }) => (
              <ToolbarButton
                {...triggerProps}
                ref={ref}
                className="storyboard-toolbar__more"
                label={t("toolbarMoreActions")}
                labelMode="hidden"
                icon={<Ellipsis />}
              />
            )}
          >
            <MenuItem
              icon={<Frame />}
              label={t("storyboardAddGroup")}
              onSelect={() => onAddGroup(t("storyboardGroupKind"))}
            />
            <MenuItem
              icon={<BringToFront />}
              label={moveForwardLabel}
              disabled={!hasSelection || selectionLayer === null || !canMoveForward}
              onSelect={onMoveForward}
            />
            <MenuItem
              icon={<SendToBack />}
              label={moveBackwardLabel}
              disabled={!hasSelection || selectionLayer === null || !canMoveBackward}
              onSelect={onMoveBackward}
            />
            <MenuSeparator />
            <MenuItem
              icon={<Pencil />}
              label={t("storyboardRenameBoard")}
              onSelect={() => setRenamingBoard(true)}
            />
            <MenuItem
              icon={<Plus />}
              label={t("storyboardAddBoard")}
              onSelect={() =>
                onAddBoard(t("storyboardNewBoardTitle", { count: boards.length + 1 }))
              }
            />
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 />}
              label={t("storyboardDeleteNode")}
              tone="danger"
              disabled={!hasSelection}
              onSelect={onDeleteSelection}
            />
          </DropdownMenu>
        }
      />
    </WorkspaceToolbar>
  );
}
