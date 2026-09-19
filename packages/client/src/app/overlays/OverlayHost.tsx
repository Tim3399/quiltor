import { lazy } from "react";
import { ConfirmDialog } from "../../design";
import { useI18n } from "../../i18n";
import { applyAssistantProposalsWithResult, loadAssistantDrawer } from "../../modules/assistant";
import { loadBackupDialog } from "../../modules/backup";
import { loadHistoryDialog, loadSnapshotDialog } from "../../modules/history";
import {
  isChapterInBook,
  type Manuscript,
  orderedChapters,
  replaceEntityMentions,
} from "../../modules/manuscript";
import { loadSearchDialog } from "../../modules/search";
import type { FigureState } from "../../modules/story-world";
import type { StoryboardState } from "../../modules/storyboard";
import type { Workspace, WorkspaceTarget } from "../../shared";
import type { Overlay } from "./useOverlayController";

const AssistantDrawer = lazy(loadAssistantDrawer);
const SearchDialog = lazy(loadSearchDialog);
const SnapshotDialog = lazy(loadSnapshotDialog);
const HistoryDialog = lazy(loadHistoryDialog);
const BackupDialog = lazy(loadBackupDialog);

export type PendingEntityRename = {
  id: string;
  from: string;
  to: string;
};

export function OverlayHost({
  overlay,
  onCloseOverlay,
  assistantOpen,
  assistantEverOpened,
  onCloseAssistant,
  worldId,
  manuscript,
  currentChapterId,
  figures,
  storyboards,
  onAssistantFiguresChange,
  onShowFigures,
  onNavigate,
  onWorkspace,
  onTarget,
  onCommand,
  flushAll,
  pendingRename,
  onManuscriptChange,
  onCloseRename,
  onShowSetAside,
  onOpenChapterTrash,
}: {
  overlay: Overlay;
  onCloseOverlay: () => void;
  assistantOpen: boolean;
  assistantEverOpened: boolean;
  onCloseAssistant: () => void;
  worldId: string;
  manuscript: Manuscript;
  currentChapterId: string;
  figures: FigureState;
  storyboards: StoryboardState;
  onAssistantFiguresChange: (figures: FigureState) => void;
  onShowFigures: () => void;
  onNavigate: (target: WorkspaceTarget) => void;
  onWorkspace: (workspace: Workspace) => void;
  onTarget: (target: WorkspaceTarget) => void;
  onCommand: (command: string) => void;
  flushAll: () => Promise<void>;
  pendingRename: PendingEntityRename | null;
  onManuscriptChange: (manuscript: Manuscript) => void;
  onCloseRename: () => void;
  onShowSetAside: () => void;
  onOpenChapterTrash: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {assistantEverOpened && (
        <AssistantDrawer
          worldId={worldId}
          figures={figures}
          chapters={orderedChapters(manuscript)}
          chapterStatuses={
            new Map([
              ...manuscript.chapters
                .filter((chapter) => !isChapterInBook(chapter))
                .map((chapter) => [chapter.id, "set_aside" as const] as const),
              ...(manuscript.trash ?? []).map(
                (entry) => [entry.chapter.id, "deleted" as const] as const,
              ),
            ])
          }
          currentChapterId={currentChapterId}
          open={assistantOpen}
          onClose={onCloseAssistant}
          onApply={(proposals) => {
            const result = applyAssistantProposalsWithResult(figures, proposals, t);
            if (result.appliedIndices.length) {
              onAssistantFiguresChange(result.state);
              onShowFigures();
            }
            return result;
          }}
          onNavigate={onNavigate}
          onBeforeSend={flushAll}
        />
      )}
      {overlay === "palette" && (
        <SearchDialog
          manuscript={manuscript}
          figures={figures}
          storyboards={storyboards}
          onClose={onCloseOverlay}
          onWorkspace={onWorkspace}
          onSelect={onTarget}
          onCommand={onCommand}
          onShowSetAside={onShowSetAside}
          onOpenChapterTrash={onOpenChapterTrash}
        />
      )}
      {overlay === "snapshot" && <SnapshotDialog onClose={onCloseOverlay} flush={flushAll} />}
      {overlay === "history" && <HistoryDialog onClose={onCloseOverlay} flush={flushAll} />}
      {overlay === "backups" && <BackupDialog onClose={onCloseOverlay} flush={flushAll} />}
      {pendingRename && (
        <ConfirmDialog
          title={t("updateEntityMentions")}
          description={t("updateEntityMentionsDescription")
            .replace("{from}", pendingRename.from)
            .replace("{to}", pendingRename.to)}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("updateMentions")}
          onConfirm={() => {
            onManuscriptChange(
              replaceEntityMentions(manuscript, pendingRename.id, pendingRename.to),
            );
            onCloseRename();
          }}
          onClose={onCloseRename}
        />
      )}
    </>
  );
}
