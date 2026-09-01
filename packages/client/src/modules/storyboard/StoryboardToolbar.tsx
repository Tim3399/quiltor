import {
  BringToFront,
  Check,
  Frame,
  Library,
  Pencil,
  Plus,
  SendToBack,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  ListboxSelect,
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
  const moveForwardLabel = t(
    selectionLayer === "group" ? "storyboardMoveFrameForward" : "storyboardMoveForward",
  );
  const moveBackwardLabel = t(
    selectionLayer === "group" ? "storyboardMoveFrameBackward" : "storyboardMoveBackward",
  );

  useEffect(() => {
    setBoardTitleDraft(currentBoardTitle);
    setRenamingBoard(false);
  }, [currentBoardTitle]);

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
      <WorkspaceToolbarActions className="storyboard-toolbar__board-actions" layout="wrap">
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
                autoFocus
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
          <ToolbarButton
            className="storyboard-board-rename"
            label={renamingBoard ? t("storyboardSaveBoardName") : t("storyboardRenameBoard")}
            labelMode="hidden"
            icon={renamingBoard ? <Check /> : <Pencil />}
            onPointerDown={(event) => {
              if (renamingBoard) event.preventDefault();
            }}
            onClick={() => (renamingBoard ? commitBoardTitle() : setRenamingBoard(true))}
          />
          <ToolbarButton
            className="storyboard-board-add"
            label={t("storyboardAddBoard")}
            collapseAt="medium"
            icon={<Plus />}
            onClick={() => onAddBoard(t("storyboardNewBoardTitle", { count: boards.length + 1 }))}
          />
        </WorkspaceToolbarGroup>
      </WorkspaceToolbarActions>
      <WorkspaceToolbarActions className="storyboard-toolbar__tool-actions" layout="wrap">
        <WorkspaceToolbarGroup label={t("storyboardAddNote")}>
          <WorkspaceToolbarCreateButton
            label={t("storyboardAddNote")}
            icon={<StickyNote />}
            onClick={onAddNote}
          />
          <ToolbarButton
            label={t("storyboardAddGroup")}
            collapseAt="medium"
            icon={<Frame />}
            onClick={() => onAddGroup(t("storyboardGroupKind"))}
          />
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
        <WorkspaceToolbarGroup label={t("storyboardLayerOrderLabel")}>
          <ToolbarButton
            label={moveForwardLabel}
            collapseAt="medium"
            icon={<BringToFront />}
            disabled={!hasSelection || selectionLayer === null || !canMoveForward}
            onClick={onMoveForward}
          />
          <ToolbarButton
            label={moveBackwardLabel}
            collapseAt="medium"
            icon={<SendToBack />}
            disabled={!hasSelection || selectionLayer === null || !canMoveBackward}
            onClick={onMoveBackward}
          />
        </WorkspaceToolbarGroup>
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
        <WorkspaceToolbarGroup label={t("storyboardDeleteNode")}>
          <ToolbarButton
            label={t("storyboardDeleteNode")}
            collapseAt="medium"
            icon={<Trash2 />}
            disabled={!hasSelection}
            onClick={onDeleteSelection}
          />
        </WorkspaceToolbarGroup>
      </WorkspaceToolbarActions>
    </WorkspaceToolbar>
  );
}
