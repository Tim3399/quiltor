import { Suspense, useCallback, useInsertionEffect, useMemo, useRef, useState } from "react";
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
import { countBoardElements, type FigureState, kindLabel } from "../modules/story-world";
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
import {
  type LoadedWorldDocuments,
  useWorldSession,
  type WorldBinding,
} from "./world/useWorldSession";
import { WorldSessionBoundary } from "./world/WorldSessionBoundary";

type DocumentFamily = "manuscript" | "figures" | "storyboards";
type DocumentsLoad = { worldId: string; generation: number; state: "pending" | "loaded" };

function documentsBindingLoad({ worldId, generation }: WorldBinding) {
  return { worldId, generation };
}

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
  // The world selection the documents in the histories belong to; null once they were released.
  const documentsBinding = useRef<WorldBinding | null>(null);
  // Which load the workspace shows; the editor stays unmounted until it is "loaded".
  const [documentsLoad, setDocumentsLoad] = useState<DocumentsLoad | null>(null);
  // Latest commit's state for the identity-stable loadDocuments; filled by the insertion effect
  // after the save hooks below.
  const liveRef = useRef<{
    saves: {
      manuscript: ReturnType<typeof useAutosave<Manuscript>>;
      figures: ReturnType<typeof useAutosave<FigureState>>;
      storyboards: ReturnType<typeof useAutosave<StoryboardState>>;
    };
    recoveryHasConflict: boolean;
    recoveryFamily: DocumentFamily | null;
    currentChapterId: string;
  } | null>(null);
  // The families whose load rule 2 held back because they had unsaved changes, in the order
  // the author decides them.
  const [pendingLoads, setPendingLoadsState] = useState<readonly DocumentFamily[]>([]);
  // Read synchronously by the dialog's close, which may run in the same tick as the decision.
  const pendingLoadsRef = useRef<readonly DocumentFamily[]>([]);
  const setPendingLoads = useCallback((families: readonly DocumentFamily[]) => {
    pendingLoadsRef.current = families;
    setPendingLoadsState(families);
  }, []);

  const loadDocuments = useCallback(
    (
      {
        manuscript: loadedManuscript,
        figures: loadedFigures,
        storyboards: loadedStoryboards,
        orphanedMentions: count,
      }: LoadedWorldDocuments,
      binding: WorldBinding,
    ) => {
      const latest = liveRef.current;
      const saves = latest?.saves;
      // Rule 2: a load over unsaved changes of the same world never replaces them, in any
      // family; the author decides in the recovery dialog. The order matters (F-69-10): compare
      // with the old binding first, then bind the new load in every branch.
      const sameWorld = documentsBinding.current?.worldId === binding.worldId;
      const held = (["manuscript", "figures", "storyboards"] as const).filter(
        (family) => sameWorld && (saves?.[family].isDirty() ?? false),
      );
      documentsBinding.current = binding;
      // A load is not an edit; the autosave compares by identity, so hand it the same objects.
      if (!held.includes("figures")) {
        saves?.figures.accept(loadedFigures);
        figureHistory.load(loadedFigures);
      }
      if (!held.includes("storyboards")) {
        saves?.storyboards.accept(loadedStoryboards);
        storyboardHistory.load(loadedStoryboards);
      }
      if (!held.includes("manuscript")) {
        saves?.manuscript.accept(loadedManuscript);
        manuscriptHistory.load(loadedManuscript);
        setOrphanedMentions(count);
        setCurrentChapterId(loadedManuscript.chapters[0]?.id || "");
      }
      setMirrorWarnings((current) => ({
        manuscript: held.includes("manuscript") && current.manuscript,
        figures: held.includes("figures") && current.figures,
        storyboards: held.includes("storyboards") && current.storyboards,
      }));
      pendingLoadsRef.current = held;
      setPendingLoadsState(held);
      if (held.length > 0) {
        if (!latest?.recoveryHasConflict && !latest?.recoveryFamily) {
          console.warn("[quiltor] load over unsaved changes", {
            chapterId: latest?.currentChapterId ?? null,
            worldId: binding.worldId,
            source: binding.source,
            generation: binding.generation,
            families: held,
            at: new Date().toISOString(),
          });
        }
        setDocumentsLoad({ ...documentsBindingLoad(binding), state: "pending" });
        setRecoveryFamily(held[0]);
        return;
      }
      setDocumentsLoad({ ...documentsBindingLoad(binding), state: "loaded" });
    },
    [figureHistory.load, manuscriptHistory.load, storyboardHistory.load],
  );
  const session = useWorldSession(loadDocuments);
  const documentsReady =
    documentsLoad?.state === "loaded" && documentsLoad.worldId === session.world?.id;
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
  // No request leaves for documents that are not bound to the world the gateway points at.
  // The check and the request start in the same synchronous step, so no select can slip between.
  const bound = useCallback(
    <R,>(family: DocumentFamily, run: () => Promise<R>, decision = false): Promise<R> => {
      const binding = documentsBinding.current;
      if (!binding || !session.isSelected(binding)) {
        console.warn("[quiltor] save refused: documents are not bound to the selected world", {
          family,
          documentsWorldId: binding?.worldId ?? null,
          at: new Date().toISOString(),
        });
        return Promise.reject(new Error(t("saveUnboundWorld")));
      }
      // Rule 2: while a newer load waits for the author's decision, only that decision may
      // save. An autosave now would write the draft over the version that just arrived.
      if (!decision && pendingLoadsRef.current.includes(family)) {
        console.warn("[quiltor] save held: a newer load awaits a decision", {
          family,
          worldId: binding.worldId,
          at: new Date().toISOString(),
        });
        return Promise.reject(new Error(t("saveFailed")));
      }
      return run();
    },
    [session.isSelected, t],
  );
  const saveManuscript = useCallback(
    async (value: Manuscript) =>
      rememberMirrorWarning(
        "manuscript",
        await bound("manuscript", () => quiltorClient.application.manuscript.save(value)),
      ),
    [bound, rememberMirrorWarning],
  );
  const saveFigures = useCallback(
    async (value: FigureState) =>
      rememberMirrorWarning(
        "figures",
        await bound("figures", () => quiltorClient.application.storyWorld.save(value)),
      ),
    [bound, rememberMirrorWarning],
  );
  const saveStoryboards = useCallback(
    async (value: StoryboardState) =>
      rememberMirrorWarning(
        "storyboards",
        await bound("storyboards", () => quiltorClient.application.storyboards.save(value)),
      ),
    [bound, rememberMirrorWarning],
  );
  const manuscriptSave = useAutosave(manuscript, saveManuscript);
  const figureSave = useAutosave(figures, saveFigures);
  const storyboardSave = useAutosave(storyboards, saveStoryboards);
  const { isDirty: isManuscriptDirty, discard: discardManuscript } = manuscriptSave;
  const { isDirty: isFiguresDirty, discard: discardFigures } = figureSave;
  const { isDirty: isStoryboardsDirty, discard: discardStoryboards } = storyboardSave;
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
  // A held-back load is a conflict as well: the server has another version than the draft.
  const recoveryInConflictMode =
    recoveryHasConflict || (recoveryFamily !== null && pendingLoads.includes(recoveryFamily));
  // The latest commit's state for the identity-stable loadDocuments, assigned the way useLatest
  // does it: in an insertion effect, before any layout effect of the same commit, so no load
  // path started from a child's layout effect sees an older save state, and never during
  // render. useLatest itself cannot be called here: loadDocuments must exist before
  // useWorldSession, and the save states it reads come from hooks that depend on that session,
  // so the ref is declared above it and only filled here.
  useInsertionEffect(() => {
    liveRef.current = {
      saves: { manuscript: manuscriptSave, figures: figureSave, storyboards: storyboardSave },
      recoveryHasConflict,
      recoveryFamily,
      currentChapterId,
    };
  });
  // Once the author has chosen for every held-back family, the workspace shows the chosen
  // versions again.
  const settlePendingLoad = useCallback(
    (family: DocumentFamily) => {
      const rest = pendingLoadsRef.current.filter((pending) => pending !== family);
      setPendingLoads(rest);
      if (rest.length === 0) setDocumentsLoad((load) => load && { ...load, state: "loaded" });
    },
    [setPendingLoads],
  );
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
            await bound(
              "manuscript",
              () =>
                quiltorClient.application.manuscript.saveExpected(
                  snapshot,
                  persisted.manuscript.revision,
                ),
              true,
            ),
          ),
        );
      } else if (recoveryFamily === "figures") {
        await figureSave.resolve(local.figures, async (snapshot) =>
          rememberMirrorWarning(
            "figures",
            await bound(
              "figures",
              () =>
                quiltorClient.application.storyWorld.saveExpected(
                  snapshot,
                  persisted.figures.revision,
                ),
              true,
            ),
          ),
        );
      } else if (recoveryFamily === "storyboards") {
        await storyboardSave.resolve(local.storyboards, async (snapshot) =>
          rememberMirrorWarning(
            "storyboards",
            await bound(
              "storyboards",
              () =>
                quiltorClient.application.storyboards.saveExpected(
                  snapshot,
                  persisted.storyboards.revision,
                ),
              true,
            ),
          ),
        );
      }
      if (recoveryFamily) settlePendingLoad(recoveryFamily);
    },
    [
      bound,
      settlePendingLoad,
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
      if (recoveryFamily) settlePendingLoad(recoveryFamily);
    },
    [
      settlePendingLoad,
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
        <StatusBarItem>
          {t("nElements", { n: countBoardElements(figures?.nodes ?? []) })}
        </StatusBarItem>
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
  // Unbind the documents from their world, so nothing that happens to them later is saved.
  // `force` is for a world the server has just replaced; the documents stay on screen then.
  const releaseDocuments = useCallback(
    ({ clear, force = false }: { clear: boolean; force?: boolean }): boolean => {
      const worldId = documentsBinding.current?.worldId ?? null;
      if (force) {
        // The server already holds other documents; unbind before anything else can run.
        documentsBinding.current = null;
        discardManuscript({ onScreen: true });
        discardFigures({ onScreen: true });
        discardStoryboards({ onScreen: true });
        return true;
      }
      if (isManuscriptDirty() || isFiguresDirty() || isStoryboardsDirty()) {
        console.warn("[quiltor] release refused: unsaved changes", {
          worldId,
          at: new Date().toISOString(),
        });
        return false;
      }
      if (!(discardManuscript() && discardFigures() && discardStoryboards())) {
        console.warn("[quiltor] release refused: a save is still running", {
          worldId,
          at: new Date().toISOString(),
        });
        return false;
      }
      documentsBinding.current = null;
      setDocumentsLoad(null);
      setPendingLoads([]);
      if (clear) {
        manuscriptHistory.clear();
        figureHistory.clear();
        storyboardHistory.clear();
      }
      return true;
    },
    [
      discardFigures,
      discardManuscript,
      discardStoryboards,
      figureHistory.clear,
      isFiguresDirty,
      isManuscriptDirty,
      isStoryboardsDirty,
      manuscriptHistory.clear,
      setPendingLoads,
      storyboardHistory.clear,
    ],
  );
  // A restore replaced the world on the server; the documents on screen must never save over it.
  const releaseReplacedDocuments = useCallback(() => {
    releaseDocuments({ clear: false, force: true });
  }, [releaseDocuments]);
  const returnToWorldSelection = useCallback(async () => {
    try {
      await flushAll();
    } catch {
      // Keep the drafts and their histories open; SaveStatus exposes the failed stream.
      return;
    }
    if (!releaseDocuments({ clear: true })) return;
    setRecoveryFamily(null);
    overlays.close();
    overlays.closeAssistant();
    session.close();
  }, [flushAll, overlays.close, overlays.closeAssistant, releaseDocuments, session.close]);
  const logout = useCallback(async () => {
    try {
      await flushAll();
    } catch {
      return;
    }
    if (!releaseDocuments({ clear: false })) return;
    shell.logout();
  }, [flushAll, releaseDocuments, shell.logout]);

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
            errorId={activeSave.errorId}
            warning={mirrorWarnings[activeSaveFamily] ? t("backupMirrorFailed") : undefined}
            retry={activeSave.retry}
            onRecover={() => setRecoveryFamily(activeSaveFamily)}
            theme={theme}
            onTheme={toggleTheme}
            onSearch={() => overlays.open("palette")}
            onHistory={() => overlays.open("history")}
            onSnapshot={() => overlays.open("snapshot")}
            onBackups={() => overlays.open("backups")}
            onCloud={() => overlays.open("cloud")}
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
                documentsReady={documentsReady}
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
              key={recoveryFamily}
              manuscript={manuscript}
              figures={figures}
              storyboards={storyboards}
              conflictFamily={recoveryInConflictMode ? recoveryFamily : undefined}
              onCompare={recoveryInConflictMode ? comparePersisted : undefined}
              onKeepLocal={recoveryInConflictMode ? keepLocalDraft : undefined}
              onLoadPersisted={recoveryInConflictMode ? loadPersistedDraft : undefined}
              onClose={() => {
                // A held-back load needs a decision; closing would leave the workspace locked.
                // Once it is made, the next held-back family asks for its own.
                const pending = pendingLoadsRef.current;
                if (pending.includes(recoveryFamily)) return;
                setRecoveryFamily(pending[0] ?? null);
              }}
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
            onDocumentsReplaced={releaseReplacedDocuments}
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
