import { Plus, Redo2, Undo2 } from "lucide-react";
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
          <button className="primary" onClick={onAddMoment}>
            <Plus />
            {t("addMoment")}
          </button>
        </div>
        <div className="tool-group">
          <button
            disabled={!canUndo}
            onClick={onUndo}
            aria-label={t("timelineUndo")}
            title={`${t("timelineUndo")} · ${keys("Z")}`}
          >
            <Undo2 />
          </button>
          <button
            disabled={!canRedo}
            onClick={onRedo}
            aria-label={t("timelineRedo")}
            title={`${t("timelineRedo")} · ${keys("Z", { shift: true })}`}
          >
            <Redo2 />
          </button>
        </div>
      </div>
    </div>
  );
}
