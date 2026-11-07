import { type ComponentProps, lazy, type RefObject, useCallback, useRef, useState } from "react";
import {
  loadTextWorkspace,
  type Manuscript,
  type ManuscriptEditorSessionState,
} from "../../modules/manuscript";
import { type ElementNoteTarget, resolveElementNote } from "../../modules/notes";
import {
  type FigureState,
  loadFigureWorkspace,
  loadPlacesWorkspace,
  loadTimelineWorkspace,
} from "../../modules/story-world";
import { loadStoryboardWorkspace, type StoryboardState } from "../../modules/storyboard";
import {
  type WorldReferenceCandidate,
  type WorldReferenceTarget,
  workspaceTargetForReference,
} from "../../modules/world-references";
import type { Workspace, WorkspaceTarget } from "../../shared";
import type { WorkspaceNavigationRequest } from "./useWorkspaceController";
import { useWorkspaceLayout } from "./useWorkspaceLayout";

const TextWorkspace = lazy(loadTextWorkspace);
const FigureWorkspace = lazy(loadFigureWorkspace);
const TimelineWorkspace = lazy(loadTimelineWorkspace);
const PlacesWorkspace = lazy(loadPlacesWorkspace);
const StoryboardWorkspace = lazy(loadStoryboardWorkspace);

type StoredSession = { worldId: string; state: ManuscriptEditorSessionState };

/**
 * Seeds the text workspace with the editor session stored for this world.
 *
 * The seed is read once per mount, in the state initializer: the editor takes it only as its
 * starting selection and scroll position, and later captures must not re-render it. Reading
 * it here rather than in the surface keeps that true for every mount -- the text workspace is
 * unmounted whenever another workspace shows and mounts again on return, and each mount needs
 * the session as it was left.
 */
function SeededTextWorkspace({
  sessionStore,
  worldId,
  ...props
}: Omit<ComponentProps<typeof TextWorkspace>, "sessionState"> & {
  sessionStore: RefObject<StoredSession | null>;
  worldId: string;
}) {
  const [seed] = useState(() =>
    sessionStore.current?.worldId === worldId ? sessionStore.current.state : null,
  );
  return <TextWorkspace {...props} sessionState={seed} />;
}

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
  documentsReady = true,
  workspace,
  manuscript,
  figures,
  storyboards,
  orphanedMentions,
  manuscriptHistory,
  figureHistory,
  storyboardHistory,
  referenceCandidates,
  onFiguresChange,
  onElementNoteChange,
  target,
  onNavigate,
  focus,
  onFocus,
  onSave,
  currentChapterId,
  onCurrentChapterId,
  openChapterTrashToken,
  chapterFilter,
  onChapterFilter,
}: {
  worldId: string;
  worldTitle: string;
  /** False while the world's documents are still loading; the text editor waits for it. */
  documentsReady?: boolean;
  workspace: Workspace;
  manuscript: Manuscript;
  figures: FigureState;
  storyboards: StoryboardState;
  orphanedMentions: number;
  manuscriptHistory: HistoryActions<Manuscript>;
  figureHistory: HistoryActions<FigureState>;
  storyboardHistory: HistoryActions<StoryboardState>;
  referenceCandidates: readonly WorldReferenceCandidate[];
  onFiguresChange: (value: FigureState) => void;
  /** Writes an element's one note into its own document (T-177). */
  onElementNoteChange?: ComponentProps<typeof StoryboardWorkspace>["onElementNoteChange"];
  target: WorkspaceNavigationRequest | null;
  onNavigate: (target: WorkspaceTarget) => void;
  focus: boolean;
  onFocus: (focus: boolean) => void;
  onSave: () => Promise<void>;
  currentChapterId: string;
  onCurrentChapterId: (chapterId: string) => void;
  openChapterTrashToken?: number;
  chapterFilter?: "all" | "in-book" | "set-aside";
  onChapterFilter?: (filter: "all" | "in-book" | "set-aside") => void;
}) {
  // Identity changes with the documents only, so Storyboard cards re-derive when a note does.
  const elementNote = useCallback(
    (noteTarget: ElementNoteTarget) => resolveElementNote(noteTarget, manuscript, figures),
    [figures, manuscript],
  );
  const layout = useWorkspaceLayout(worldId, workspace);
  const manuscriptSession = useRef<StoredSession | null>(null);
  const captureManuscriptSession = useCallback(
    (state: ManuscriptEditorSessionState) => {
      manuscriptSession.current = { worldId, state };
    },
    [worldId],
  );
  const openStoryboardReference = (reference: WorldReferenceTarget) => {
    const destination = workspaceTargetForReference(reference);
    if (destination) onNavigate(destination);
  };
  if (workspace === "text")
    return (
      <SeededTextWorkspace
        key={worldId}
        worldId={worldId}
        sessionStore={manuscriptSession}
        worldTitle={worldTitle}
        documentsReady={documentsReady}
        manuscript={manuscript}
        figures={figures}
        orphanedMentions={orphanedMentions}
        onChange={manuscriptHistory.change}
        onOpenEntity={onNavigate}
        currentChapterId={currentChapterId}
        onCurrentChapterId={onCurrentChapterId}
        onSessionStateChange={captureManuscriptSession}
        focus={focus}
        onFocus={onFocus}
        targetId={target?.workspace === "text" ? target.id : undefined}
        targetRequestId={target?.workspace === "text" ? target.requestId : undefined}
        textSearch={target?.workspace === "text" ? target.textSearch : undefined}
        openChapterTrashToken={openChapterTrashToken}
        chapterFilter={chapterFilter}
        onChapterFilter={onChapterFilter}
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
        worldId={worldId}
        onChange={onFiguresChange}
        targetId={target?.workspace === "figures" ? target.id : undefined}
        targetRequestId={target?.workspace === "figures" ? target.requestId : undefined}
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
        targetRequestId={target?.workspace === "timeline" ? target.requestId : undefined}
        onUndo={figureHistory.undo}
        onRedo={figureHistory.redo}
        canUndo={figureHistory.canUndo}
        canRedo={figureHistory.canRedo}
      />
    );
  if (workspace === "places")
    return (
      <PlacesWorkspace
        state={figures}
        onChange={onFiguresChange}
        targetId={target?.workspace === "places" ? target.id : undefined}
        targetRequestId={target?.workspace === "places" ? target.requestId : undefined}
        onUndo={figureHistory.undo}
        onRedo={figureHistory.redo}
        canUndo={figureHistory.canUndo}
        canRedo={figureHistory.canRedo}
        onOpen={onNavigate}
      />
    );
  return (
    <StoryboardWorkspace
      worldId={worldId}
      state={storyboards}
      onChange={storyboardHistory.change}
      candidates={referenceCandidates}
      onOpenReference={openStoryboardReference}
      elementNote={elementNote}
      onElementNoteChange={onElementNoteChange}
      targetId={target?.workspace === "storyboard" ? target.id : undefined}
      targetRequestId={target?.workspace === "storyboard" ? target.requestId : undefined}
      onUndo={storyboardHistory.undo}
      onRedo={storyboardHistory.redo}
      canUndo={storyboardHistory.canUndo}
      canRedo={storyboardHistory.canRedo}
    />
  );
}
