import { Plus } from "lucide-react";
import {
  Button,
  UndoRedoControls,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../../design";
import type { Translate, UiLocale } from "../../../i18n";
import type { TimeSystem, TimeSystemKind } from "../model";
import { TimeSystemControls } from "./TimeSystemControls";

export function TimelineToolbar({
  system,
  momentCount,
  relationshipCount,
  onKindChange,
  onPatchSystem,
  onAddMoment,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  locale,
  t,
}: {
  system: TimeSystem;
  momentCount: number;
  relationshipCount: number;
  onKindChange: (kind: TimeSystemKind) => void;
  onPatchSystem: (patch: Partial<TimeSystem>) => void;
  onAddMoment: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  locale: UiLocale;
  t: Translate;
}) {
  return (
    <WorkspaceToolbar className="timeline-toolbar" label={t("timeline")}>
      <WorkspaceToolbarTitle
        title={t("timeline")}
        detail={
          <>
            {t("nMoments", { n: momentCount })} · {t("nRelationships", { n: relationshipCount })}
          </>
        }
      />
      <WorkspaceToolbarActions className="timeline-toolbar-actions">
        <WorkspaceToolbarGroup className="timeline-time-group" label={t("timelineTimeSystem")}>
          <TimeSystemControls
            system={system}
            onKindChange={onKindChange}
            onPatch={onPatchSystem}
            locale={locale}
            t={t}
          />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup className="timeline-add-group" label={t("addMoment")}>
          <Button appearance="primary" icon={<Plus />} onClick={onAddMoment}>
            {t("addMoment")}
          </Button>
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup
          className="timeline-history-group"
          label={`${t("timelineUndo")} / ${t("timelineRedo")}`}
        >
          <UndoRedoControls
            label={`${t("timelineUndo")} / ${t("timelineRedo")}`}
            undoLabel={t("timelineUndo")}
            redoLabel={t("timelineRedo")}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => onUndo?.()}
            onRedo={() => onRedo?.()}
          />
        </WorkspaceToolbarGroup>
      </WorkspaceToolbarActions>
    </WorkspaceToolbar>
  );
}
