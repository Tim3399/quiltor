import { Plus, Redo2, Undo2 } from "lucide-react";
import { Button, IconButton } from "../../../design";
import type { TimeSystem, TimeSystemKind } from "../model";
import type { Translate, UiLocale } from "../../../i18n";
import { useShortcut } from "../../../shared/ui/shortcuts";
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
  const keys = useShortcut();
  return (
    <div className="context-bar">
      <div className="context-title">
        <strong>{t("timeline")}</strong>
        <span>
          {t("nMoments", { n: momentCount })} · {t("nRelationships", { n: relationshipCount })}
        </span>
      </div>
      <div className="context-tools">
        <TimeSystemControls
          system={system}
          onKindChange={onKindChange}
          onPatch={onPatchSystem}
          locale={locale}
          t={t}
        />
        <div className="tool-group">
          <Button appearance="primary" icon={<Plus />} onClick={onAddMoment}>
            {t("addMoment")}
          </Button>
        </div>
        <div className="tool-group">
          <IconButton
            label={t("timelineUndo")}
            icon={<Undo2 />}
            appearance="ghost"
            size="regular"
            disabled={!canUndo}
            onClick={onUndo}
            title={`${t("timelineUndo")} · ${keys("Z")}`}
          />
          <IconButton
            label={t("timelineRedo")}
            icon={<Redo2 />}
            appearance="ghost"
            size="regular"
            disabled={!canRedo}
            onClick={onRedo}
            title={`${t("timelineRedo")} · ${keys("Z", { shift: true })}`}
          />
        </div>
      </div>
    </div>
  );
}
