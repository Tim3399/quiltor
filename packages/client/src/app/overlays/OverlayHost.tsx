import { lazy } from "react";
import { applyAssistantProposals, loadAssistantDrawer } from "../../modules/assistant";
import { loadBackupDialog } from "../../modules/backup";
import { loadHistoryDialog, loadSnapshotDialog } from "../../modules/history";
import { replaceEntityMentions, type Manuscript } from "../../modules/manuscript";
import { loadSearchDialog } from "../../modules/search";
import type { FigureState } from "../../modules/story-world";
import type { Workspace, WorkspaceTarget } from "../../shared";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useI18n } from "../../i18n";
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
  figures,
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
}: {
  overlay: Overlay;
  onCloseOverlay: () => void;
  assistantOpen: boolean;
  assistantEverOpened: boolean;
  onCloseAssistant: () => void;
  worldId: string;
  manuscript: Manuscript;
  figures: FigureState;
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
}) {
  const { t } = useI18n();
  return (
    <>
      {assistantEverOpened && (
        <AssistantDrawer
          worldId={worldId}
          figures={figures}
          chapters={manuscript.chapters}
          open={assistantOpen}
          onClose={onCloseAssistant}
          onApply={(proposals) => {
            onAssistantFiguresChange(applyAssistantProposals(figures, proposals, t));
            onShowFigures();
          }}
          onNavigate={onNavigate}
        />
      )}
      {overlay === "palette" && (
        <SearchDialog
          manuscript={manuscript}
          figures={figures}
          onClose={onCloseOverlay}
          onWorkspace={onWorkspace}
          onSelect={onTarget}
          onCommand={onCommand}
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
