import { Suspense, useCallback, useMemo, useState } from "react";
import { PRODUCT_MARK } from "../config/branding";
import { PageState, StatusBarItem } from "../design";
import { useI18n } from "../i18n";
import { GettingStartedDialog } from "../modules/getting-started";
import { chaptersInBook, type Manuscript, wordCount } from "../modules/manuscript";
import { NoteReferenceProvider } from "../modules/notes";
import { ProjectExportDialog } from "../modules/project-transfer";
import {
  type PersistedRecoveryDocuments,
  RecoveryDialog,
  type RecoveryDocuments,
} from "../modules/recovery";
import { type FigureState, kindLabel } from "../modules/story-world";
import type { StoryboardState } from "../modules/storyboard";
import {
  buildWorldReferenceBacklinks,
  buildWorldReferenceCandidates,
  resolveWorldReferenceCandidate,
  type WorldReferenceBacklink,
  type WorldReferenceBacklinkIndex,
  workspaceTargetForBacklink,
  workspaceTargetForReference,
} from "../modules/world-references";
import { ApplicationGatewayError, quiltorClient } from "../platform";
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

type DocumentFamily = "manuscript" | "figures" | "storyboards";

export function App() {
  const { t } = useI18n();
  const { theme, preference, setPreference, toggleTheme } = useTheme();
  const manuscriptHistory = useHistoryState<Manuscript>();
  const figureHistory = useHistoryState<FigureState>();
  const storyboardHistory = useHistoryState<StoryboardState>();
  const manuscript = manuscriptHistory.value;
  const figures = figureHistory.value;
  const storyboards = storyboardHistory.value;
  const [orphanedMentions, setOrphanedMentions] = useState(0);
  const [pendingRename, setPendingRename] = useState<PendingEntityRename | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState("");
  const [recoveryFamily, setRecoveryFamily] = useState<DocumentFamily | null>(null);
  const [chapterFilter, setChapterFilter] = useState<"all" | "in-book" | "set-aside">("all");
  const [openChapterTrashToken, setOpenChapterTrashToken] = useState(0);
  const [projectExportOpen, setProjectExportOpen] = useState(false);
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false);
  const [mirrorWarnings, setMirrorWarnings] = useState<Record<DocumentFamily, boolean>>({
    manuscript: false,
    figures: false,
    storyboards: false,
  });

  const loadDocuments = useCallback(
    ({
      manuscript: loadedManuscript,
      figures: loadedFigures,
      storyboards: loadedStoryboards,
      orphanedMentions: count,
    }: LoadedWorldDocuments) => {
      manuscriptHistory.load(loadedManuscript);
      figureHistory.load(loadedFigures);
      storyboardHistory.load(loadedStoryboards);
      setOrphanedMentions(count);
      setCurrentChapterId(loadedManuscript.chapters[0]?.id || "");
      setMirrorWarnings({ manuscript: false, figures: false, storyboards: false });
    },
    [figureHistory.load, manuscriptHistory.load, storyboardHistory.load],
  );
  const session = useWorldSession(loadDocuments);
  const workspace = useWorkspaceController();
  const overlays = useOverlayController();
  const shell = useShellStatus();
  const noteReferenceCandidates = useMemo(
    () =>
      manuscript && figures && storyboards
        ? buildWorldReferenceCandidates({
            manuscript,
            figures,
            storyboards: storyboards.boards,
            labels: {
              untitled: t("untitled"),
              moment: t("moment"),
              figureKind: (kind) => kindLabel(kind, t),
            },
          })
        : [],
    [figures, manuscript, storyboards, t],
  );
  const noteReferenceBacklinks = useMemo(
    (): WorldReferenceBacklinkIndex =>
      manuscript && figures && storyboards
        ? buildWorldReferenceBacklinks({
            manuscript,
            figures,
            storyboards,
          })
        : new Map(),
    [figures, manuscript, storyboards],
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

  const rememberMirrorWarning = useCallback(
    (family: DocumentFamily, result: { warnings?: readonly string[] }) => {
      const failed = result.warnings?.includes("backup.mirror_failed") ?? false;
      setMirrorWarnings((current) =>
        current[family] === failed ? current : { ...current, [family]: failed },
      );
      return result;
    },
    [],
  );
  const saveManuscript = useCallback(
    async (value: Manuscript) =>
      rememberMirrorWarning("manuscript", await quiltorClient.application.manuscript.save(value)),
    [rememberMirrorWarning],
  );
  const saveFigures = useCallback(
    async (value: FigureState) =>
      rememberMirrorWarning("figures", await quiltorClient.application.storyWorld.save(value)),
    [rememberMirrorWarning],
  );
  const saveStoryboards = useCallback(
    async (value: StoryboardState) =>
      rememberMirrorWarning("storyboards", await quiltorClient.application.storyboards.save(value)),
    [rememberMirrorWarning],
  );
  const manuscriptSave = useAutosave(manuscript, saveManuscript);
  const figureSave = useAutosave(figures, saveFigures);
  const storyboardSave = useAutosave(storyboards, saveStoryboards);
  const saveByFamily = {
    manuscript: manuscriptSave,
    figures: figureSave,
    storyboards: storyboardSave,
  };
  const workspaceSave =
    workspace.workspace === "text"
      ? manuscriptSave
      : workspace.workspace === "storyboard"
        ? storyboardSave
        : figureSave;
  const activeSaveEntry =
    (Object.entries(saveByFamily) as [DocumentFamily, typeof manuscriptSave][]).find(
      ([, save]) => save.phase === "error",
    ) ??
    ([
      workspace.workspace === "text"
        ? "manuscript"
        : workspace.workspace === "storyboard"
          ? "storyboards"
          : "figures",
      workspaceSave,
    ] as const);
  const [activeSaveFamily, activeSave] = activeSaveEntry;
  const recoverySave = recoveryFamily ? saveByFamily[recoveryFamily] : null;
  const recoveryHasConflict =
    recoverySave?.failure instanceof ApplicationGatewayError &&
    recoverySave.failure.category === "conflict";
  const comparePersisted = useCallback(async (): Promise<PersistedRecoveryDocuments> => {
    const [persistedManuscript, persistedFigures, persistedStoryboards] = await Promise.all([
      quiltorClient.application.manuscript.peek(),
      quiltorClient.application.storyWorld.peek(),
      quiltorClient.application.storyboards.peek(),
    ]);
    return {
      manuscript: persistedManuscript,
      figures: persistedFigures,
      storyboards: persistedStoryboards,
    };
  }, []);
  const keepLocalDraft = useCallback(
    async (local: RecoveryDocuments, persisted: PersistedRecoveryDocuments) => {
      if (recoveryFamily === "manuscript") {
        await manuscriptSave.resolve(local.manuscript, async (snapshot) =>
          rememberMirrorWarning(
            "manuscript",
            await quiltorClient.application.manuscript.saveExpected(
              snapshot,
              persisted.manuscript.revision,
            ),
          ),
        );
      } else if (recoveryFamily === "figures") {
        await figureSave.resolve(local.figures, async (snapshot) =>
          rememberMirrorWarning(
            "figures",
            await quiltorClient.application.storyWorld.saveExpected(
              snapshot,
              persisted.figures.revision,
            ),
          ),
        );
      } else if (recoveryFamily === "storyboards") {
        await storyboardSave.resolve(local.storyboards, async (snapshot) =>
          rememberMirrorWarning(
            "storyboards",
            await quiltorClient.application.storyboards.saveExpected(
              snapshot,
              persisted.storyboards.revision,
            ),
          ),
        );
      }
    },
    [
      figureSave.resolve,
      manuscriptSave.resolve,
      recoveryFamily,
      rememberMirrorWarning,
      storyboardSave.resolve,
    ],
  );
  const loadPersistedDraft = useCallback(
    async (local: RecoveryDocuments, persisted: PersistedRecoveryDocuments) => {
      let replaced = false;
      if (recoveryFamily === "manuscript") {
        replaced = manuscriptSave.replace(local.manuscript, persisted.manuscript.document);
        if (replaced) {
          manuscriptHistory.load(
            quiltorClient.application.manuscript.adoptPersisted(persisted.manuscript),
          );
        }
      } else if (recoveryFamily === "figures") {
        replaced = figureSave.replace(local.figures, persisted.figures.document);
        if (replaced) {
          figureHistory.load(
            quiltorClient.application.storyWorld.adoptPersisted(persisted.figures),
          );
        }
      } else if (recoveryFamily === "storyboards") {
        replaced = storyboardSave.replace(local.storyboards, persisted.storyboards.document);
        if (replaced) {
          storyboardHistory.load(
            quiltorClient.application.storyboards.adoptPersisted(persisted.storyboards),
          );
        }
      }
      if (!replaced) throw new Error(t("recoveryDraftChanged"));
    },
    [
      figureHistory.load,
      figureSave.replace,
      manuscriptHistory.load,
      manuscriptSave.replace,
      recoveryFamily,
      storyboardHistory.load,
      storyboardSave.replace,
      t,
    ],
  );
  // What is open belongs in the status line. The numbers are here anyway; every workspace
  // counts the thing it can give an account of.
  const summary = useMemo(() => {
    if (workspace.workspace === "text") {
      const bookChapters = manuscript ? chaptersInBook(manuscript) : [];
      const words = bookChapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0);
      return (
        <>
          <StatusBarItem>{t("nChapters", { n: bookChapters.length })}</StatusBarItem>
          <StatusBarItem>
            {t("nStandardPages", {
              n: ((words ?? 0) / 250).toFixed(1).replace(".", ","),
            })}
          </StatusBarItem>
          <StatusBarItem>{t("nWordsTotal", { n: (words ?? 0).toLocaleString() })}</StatusBarItem>
        </>
      );
    }
    if (workspace.workspace === "storyboard") {
      return (
        <StatusBarItem>
          {t("storyboardNodeCount", { count: storyboards?.nodes.length ?? 0 })}
        </StatusBarItem>
      );
    }
    return (
      <>
        <StatusBarItem>{t("nElements", { n: figures?.nodes.length ?? 0 })}</StatusBarItem>
        <StatusBarItem>{t("nRelationships", { n: figures?.edges.length ?? 0 })}</StatusBarItem>
      </>
    );
  }, [workspace.workspace, manuscript, figures, storyboards, t]);
  const flushAll = useCallback(async () => {
    do {
      await Promise.all([manuscriptSave.flush(), figureSave.flush(), storyboardSave.flush()]);
      // A stream that finished first may have changed while another one was still saving.
    } while (manuscriptSave.isDirty() || figureSave.isDirty() || storyboardSave.isDirty());
  }, [
    manuscriptSave.flush,
    manuscriptSave.isDirty,
    figureSave.flush,
    figureSave.isDirty,
    storyboardSave.flush,
    storyboardSave.isDirty,
  ]);
  const returnToWorldSelection = useCallback(async () => {
    try {
      await flushAll();
    } catch {
      // Keep the drafts and their histories open; SaveStatus exposes the failed stream.
      return;
    }
    overlays.close();
    overlays.closeAssistant();
    session.close();
  }, [flushAll, overlays.close, overlays.closeAssistant, session.close]);
  const logout = useCallback(async () => {
    try {
      await flushAll();
    } catch {
      return;
    }
    shell.logout();
  }, [flushAll, shell.logout]);

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
    undoStoryboards: storyboardHistory.undo,
    redoStoryboards: storyboardHistory.redo,
  });

  return (
    <WorldSessionBoundary
      worlds={session.worlds}
      world={session.world}
      needsSignIn={session.needsSignIn}
      authError={session.authError}
      loadError={session.loadError}
      ready={Boolean(session.world && manuscript && figures && storyboards)}
      theme={preference}
      onTheme={setPreference}
      onOpen={session.open}
      onCreate={session.create}
      onDelete={session.remove}
      trash={session.trash}
      trashError={session.trashError}
      onLoadTrash={session.loadTrash}
      onRestore={session.restore}
      onPurge={session.purge}
      onProjectImported={session.projectImported}
    >
      {session.world && manuscript && figures && storyboards && (
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
            savedAt={activeSave.savedAt}
            error={activeSave.error}
            warning={mirrorWarnings[activeSaveFamily] ? t("backupMirrorFailed") : undefined}
            retry={activeSave.retry}
            onRecover={() => setRecoveryFamily(activeSaveFamily)}
            theme={theme}
            onTheme={toggleTheme}
            onSearch={() => overlays.open("palette")}
            onHistory={() => overlays.open("history")}
            onSnapshot={() => overlays.open("snapshot")}
            onBackups={() => overlays.open("backups")}
            onExportProject={() => setProjectExportOpen(true)}
            onGettingStarted={() => setGettingStartedOpen(true)}
            onAssistant={overlays.toggleAssistant}
            onExitWorld={returnToWorldSelection}
            whoami={shell.account}
            onLogout={logout}
            version={shell.version}
            summary={summary}
          >
            <NoteReferenceProvider
              candidates={noteReferenceCandidates}
              backlinks={noteReferenceBacklinks}
              onOpenReference={openNoteReference}
              onOpenBacklink={openNoteBacklink}
            >
              <WorkspaceSurface
                key={session.world.id}
                worldId={session.world.id}
                worldTitle={session.world.title}
                workspace={workspace.workspace}
                manuscript={manuscript}
                figures={figures}
                storyboards={storyboards}
                orphanedMentions={orphanedMentions}
                manuscriptHistory={manuscriptHistory}
                figureHistory={figureHistory}
                storyboardHistory={storyboardHistory}
                referenceCandidates={noteReferenceCandidates}
                onFiguresChange={changeFigures}
                target={workspace.target}
                onNavigate={workspace.navigate}
                focus={workspace.focus}
                onFocus={workspace.setFocus}
                onSave={flushAll}
                currentChapterId={currentChapterId}
                onCurrentChapterId={setCurrentChapterId}
                openChapterTrashToken={openChapterTrashToken}
                chapterFilter={chapterFilter}
                onChapterFilter={setChapterFilter}
              />
            </NoteReferenceProvider>
          </AppShell>
          {recoveryFamily && (
            <RecoveryDialog
              manuscript={manuscript}
              figures={figures}
              storyboards={storyboards}
              conflictFamily={recoveryHasConflict ? recoveryFamily : undefined}
              onCompare={recoveryHasConflict ? comparePersisted : undefined}
              onKeepLocal={recoveryHasConflict ? keepLocalDraft : undefined}
              onLoadPersisted={recoveryHasConflict ? loadPersistedDraft : undefined}
              onClose={() => setRecoveryFamily(null)}
            />
          )}
          {projectExportOpen && (
            <ProjectExportDialog
              worldId={session.world.id}
              flush={flushAll}
              onClose={() => setProjectExportOpen(false)}
            />
          )}
          {gettingStartedOpen && (
            <GettingStartedDialog
              onWrite={() => workspace.selectWorkspace("text")}
              onImportText={() => workspace.selectWorkspace("text")}
              onSearch={() => overlays.open("palette")}
              onAssistant={overlays.toggleAssistant}
              onClose={() => setGettingStartedOpen(false)}
            />
          )}
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
            storyboards={storyboards}
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
            onShowSetAside={() => {
              overlays.close();
              workspace.selectWorkspace("text");
              setChapterFilter("set-aside");
            }}
            onOpenChapterTrash={() => {
              overlays.close();
              workspace.selectWorkspace("text");
              setOpenChapterTrashToken((token) => token + 1);
            }}
          />
        </Suspense>
      )}
    </WorldSessionBoundary>
  );
}
