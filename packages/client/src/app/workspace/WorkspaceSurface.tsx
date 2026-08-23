import { lazy } from "react";
import { loadTextWorkspace, type Manuscript } from "../../modules/manuscript";
import {
  loadFigureWorkspace,
  loadPlacesWorkspace,
  loadTimelineWorkspace,
  type FigureState,
} from "../../modules/story-world";
import type { Workspace, WorkspaceTarget } from "../../shared";
import { useWorkspaceLayout } from "./useWorkspaceLayout";

const TextWorkspace = lazy(loadTextWorkspace);
const FigureWorkspace = lazy(loadFigureWorkspace);
const TimelineWorkspace = lazy(loadTimelineWorkspace);
const PlacesWorkspace = lazy(loadPlacesWorkspace);

type HistoryActions<T> = {
  change: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function WorkspaceSurface({
  worldId,
  worldTitle,
  workspace,
  manuscript,
  figures,
  orphanedMentions,
  manuscriptHistory,
  figureHistory,
  onFiguresChange,
  target,
  onNavigate,
  focus,
  onFocus,
  onSave,
  onCurrentChapterId,
}: {
  worldId: string;
  worldTitle: string;
  workspace: Workspace;
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions: number;
  manuscriptHistory: HistoryActions<Manuscript>;
  figureHistory: HistoryActions<FigureState>;
  onFiguresChange: (value: FigureState) => void;
  target: WorkspaceTarget | null;
  onNavigate: (target: WorkspaceTarget) => void;
  focus: boolean;
  onFocus: (focus: boolean) => void;
  onSave: () => Promise<void>;
  onCurrentChapterId: (chapterId: string) => void;
}) {
  const layout = useWorkspaceLayout(worldId, workspace);
  if (workspace === "text")
    return (
      <TextWorkspace
        worldTitle={worldTitle}
        manuscript={manuscript}
        figures={figures}
        orphanedMentions={orphanedMentions}
        onChange={manuscriptHistory.change}
        onOpenEntity={onNavigate}
        onCurrentChapterId={onCurrentChapterId}
        focus={focus}
        onFocus={onFocus}
        targetId={target?.workspace === "text" ? target.id : undefined}
        textSearch={target?.workspace === "text" ? target.textSearch : undefined}
        onUndo={manuscriptHistory.undo}
        onRedo={manuscriptHistory.redo}
        canUndo={manuscriptHistory.canUndo}
        canRedo={manuscriptHistory.canRedo}
        onSave={onSave}
        viewportMode={layout.mode}
        binderOpen={layout.layout.navigationOpen}
        onBinderOpen={layout.setNavigationOpen}
        inspectorOpen={layout.layout.inspectorOpen}
        onInspectorOpen={layout.setInspectorOpen}
        sidebarWidth={layout.layout.sidebarWidth}
        onSidebarWidth={layout.setSidebarWidth}
        inspectorWidth={layout.layout.inspectorWidth}
        onInspectorWidth={layout.setInspectorWidth}
      />
    );
  if (workspace === "figures")
    return (
      <FigureWorkspace
        state={figures}
        onChange={onFiguresChange}
        targetId={target?.workspace === "figures" ? target.id : undefined}
        onUndo={figureHistory.undo}
        onRedo={figureHistory.redo}
        canUndo={figureHistory.canUndo}
        canRedo={figureHistory.canRedo}
      />
    );
  if (workspace === "timeline")
    return (
      <TimelineWorkspace
        state={figures}
        onChange={onFiguresChange}
        manuscript={manuscript}
        onOpenChapter={(chapterId) => onNavigate({ workspace: "text", id: chapterId })}
        targetId={target?.workspace === "timeline" ? target.id : undefined}
        onUndo={figureHistory.undo}
        onRedo={figureHistory.redo}
        canUndo={figureHistory.canUndo}
        canRedo={figureHistory.canRedo}
      />
    );
  return (
    <PlacesWorkspace
      state={figures}
      onChange={onFiguresChange}
      targetId={target?.workspace === "places" ? target.id : undefined}
      onUndo={figureHistory.undo}
      onRedo={figureHistory.redo}
      canUndo={figureHistory.canUndo}
      canRedo={figureHistory.canRedo}
      onOpen={onNavigate}
    />
  );
}
