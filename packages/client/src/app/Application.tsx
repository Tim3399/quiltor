import { Suspense, useCallback, useMemo, useState } from "react";
import { PRODUCT_MARK } from "../config/branding";
import { PageState } from "../design";
import { useI18n } from "../i18n";
import type { Manuscript } from "../modules/manuscript";
import { NoteReferenceProvider } from "../modules/notes";
import { type FigureState, kindLabel } from "../modules/story-world";
import {
  buildWorldReferenceBacklinks,
  buildWorldReferenceCandidates,
  resolveWorldReferenceCandidate,
  type WorldReferenceBacklink,
  type WorldReferenceBacklinkIndex,
  workspaceTargetForBacklink,
  workspaceTargetForReference,
} from "../modules/world-references";
import { quiltorClient } from "../platform";
import { AppShell } from "./AppShell";
import { OverlayHost, type PendingEntityRename } from "./overlays/OverlayHost";
import { useOverlayController } from "./overlays/useOverlayController";
import { useShellStatus } from "./shell/useShellStatus";
import { useTheme } from "./shell/useTheme";
import { useApplicationShortcuts } from "./shortcuts/useApplicationShortcuts";
import { useAutosave } from "./workspace/useAutosave";
import { useHistoryState } from "./workspace/useHistoryState";
import { useWorkspaceController } from "./workspace/useWorkspaceController";
import { WorkspaceSurface } from "./workspace/WorkspaceSurface";
import { type LoadedWorldDocuments, useWorldSession } from "./world/useWorldSession";
import { WorldSessionBoundary } from "./world/WorldSessionBoundary";

export function App() {
  const { t } = useI18n();
  const { theme, preference, setPreference, toggleTheme } = useTheme();
  const manuscriptHistory = useHistoryState<Manuscript>();
  const figureHistory = useHistoryState<FigureState>();
  const manuscript = manuscriptHistory.value;
  const figures = figureHistory.value;
  const [orphanedMentions, setOrphanedMentions] = useState(0);
  const [pendingRename, setPendingRename] = useState<PendingEntityRename | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState("");

  const loadDocuments = useCallback(
    ({
      manuscript: loadedManuscript,
      figures: loadedFigures,
      orphanedMentions: count,
    }: LoadedWorldDocuments) => {
      manuscriptHistory.load(loadedManuscript);
      figureHistory.load(loadedFigures);
      setOrphanedMentions(count);
      setCurrentChapterId(loadedManuscript.chapters[0]?.id || "");
    },
    [figureHistory.load, manuscriptHistory.load],
  );
  const session = useWorldSession(loadDocuments);
  const workspace = useWorkspaceController();
  const overlays = useOverlayController();
  const shell = useShellStatus();
  const noteReferenceCandidates = useMemo(
    () =>
      manuscript && figures
        ? buildWorldReferenceCandidates({
            manuscript,
            figures,
            labels: {
              untitled: t("untitled"),
              moment: t("moment"),
              figureKind: (kind) => kindLabel(kind, t),
            },
          })
        : [],
    [figures, manuscript, t],
  );
  const noteReferenceBacklinks = useMemo(
    (): WorldReferenceBacklinkIndex =>
      manuscript && figures
        ? buildWorldReferenceBacklinks({
            manuscript,
            figures,
          })
        : new Map(),
    [figures, manuscript],
  );
  const openNoteReference = useCallback(
    (target: Parameters<typeof workspaceTargetForReference>[0]) => {
      const currentTarget =
        resolveWorldReferenceCandidate(noteReferenceCandidates, target)?.target ?? target;
      const next = workspaceTargetForReference(currentTarget);
      if (next) workspace.navigate(next);
    },
    [noteReferenceCandidates, workspace.navigate],
  );
  const openNoteBacklink = useCallback(
    (backlink: WorldReferenceBacklink) => {
      const next = workspaceTargetForBacklink(backlink);
      if (next) workspace.navigate(next);
    },
    [workspace.navigate],
  );

  const saveManuscript = useCallback(
    (value: Manuscript) => quiltorClient.application.manuscript.save(value),
    [],
  );
  const saveFigures = useCallback(
    (value: FigureState) => quiltorClient.application.storyWorld.save(value),
    [],
  );
  const manuscriptSave = useAutosave(manuscript, saveManuscript);
  const figureSave = useAutosave(figures, saveFigures);
  const activeSave = workspace.workspace === "text" ? manuscriptSave : figureSave;
  const flushAll = useCallback(async () => {
    await Promise.all([manuscriptSave.flush(), figureSave.flush()]);
  }, [manuscriptSave.flush, figureSave.flush]);
  const returnToWorldSelection = useCallback(async () => {
    await flushAll();
    overlays.close();
    overlays.closeAssistant();
    session.close();
  }, [flushAll, overlays.close, overlays.closeAssistant, session.close]);

  const changeFigures = useCallback(
    (next: FigureState) => {
      const renamed =
        figures &&
        next.nodes.find((node) =>
          figures.nodes.some((previous) => previous.id === node.id && previous.name !== node.name),
        );
      if (renamed) {
        const previous = figures.nodes.find((node) => node.id === renamed.id);
        if (previous) setPendingRename({ id: renamed.id, from: previous.name, to: renamed.name });
      }
      figureHistory.change(next);
    },
    [figureHistory.change, figures],
  );

  const executeCommand = useCallback(
    (command: string) => {
      overlays.close();
      if (workspace.execute(command)) return;
      if (command === "history" || command === "snapshot" || command === "backups")
        overlays.open(command);
    },
    [overlays.close, overlays.open, workspace.execute],
  );

  useApplicationShortcuts({
    focus: workspace.focus,
    setFocus: workspace.setFocus,
    openOverlay: overlays.open,
    flushAll,
    workspace: workspace.workspace,
    undoManuscript: manuscriptHistory.undo,
    redoManuscript: manuscriptHistory.redo,
    undoFigures: figureHistory.undo,
    redoFigures: figureHistory.redo,
  });

  return (
    <WorldSessionBoundary
      worlds={session.worlds}
      world={session.world}
      needsSignIn={session.needsSignIn}
      authError={session.authError}
      loadError={session.loadError}
      ready={Boolean(session.world && manuscript && figures)}
      theme={preference}
      onTheme={setPreference}
      onOpen={session.open}
      onCreate={session.create}
      onDelete={session.remove}
    >
      {session.world && manuscript && figures && (
        <Suspense
          fallback={
            <PageState kind="loading" mark={PRODUCT_MARK}>
              <p>{t("openingWorkshop")}</p>
            </PageState>
          }
        >
          <AppShell
            title={session.world.title}
            workspace={workspace.workspace}
            onWorkspace={workspace.selectWorkspace}
            phase={activeSave.phase}
            error={activeSave.error}
            retry={activeSave.retry}
            theme={theme}
            onTheme={toggleTheme}
            onSearch={() => overlays.open("palette")}
            onHistory={() => overlays.open("history")}
            onSnapshot={() => overlays.open("snapshot")}
            onBackups={() => overlays.open("backups")}
            onAssistant={overlays.toggleAssistant}
            onExitWorld={returnToWorldSelection}
            whoami={shell.account}
            onLogout={shell.logout}
            version={shell.version}
          >
            <NoteReferenceProvider
              candidates={noteReferenceCandidates}
              backlinks={noteReferenceBacklinks}
              onOpenReference={openNoteReference}
              onOpenBacklink={openNoteBacklink}
            >
              <WorkspaceSurface
                worldId={session.world.id}
                worldTitle={session.world.title}
                workspace={workspace.workspace}
                manuscript={manuscript}
                figures={figures}
                orphanedMentions={orphanedMentions}
                manuscriptHistory={manuscriptHistory}
                figureHistory={figureHistory}
                onFiguresChange={changeFigures}
                target={workspace.target}
                onNavigate={workspace.navigate}
                focus={workspace.focus}
                onFocus={workspace.setFocus}
                onSave={flushAll}
                onCurrentChapterId={setCurrentChapterId}
              />
            </NoteReferenceProvider>
          </AppShell>
          <OverlayHost
            overlay={overlays.overlay}
            onCloseOverlay={overlays.close}
            assistantOpen={overlays.assistantOpen}
            assistantEverOpened={overlays.assistantEverOpened}
            onCloseAssistant={overlays.closeAssistant}
            worldId={session.world.id}
            manuscript={manuscript}
            currentChapterId={currentChapterId}
            figures={figures}
            onAssistantFiguresChange={figureHistory.change}
            onShowFigures={() => workspace.selectWorkspace("figures")}
            onNavigate={workspace.navigate}
            onWorkspace={workspace.setWorkspace}
            onTarget={workspace.setTarget}
            onCommand={executeCommand}
            flushAll={flushAll}
            pendingRename={pendingRename}
            onManuscriptChange={manuscriptHistory.change}
            onCloseRename={() => setPendingRename(null)}
          />
        </Suspense>
      )}
    </WorldSessionBoundary>
  );
}
