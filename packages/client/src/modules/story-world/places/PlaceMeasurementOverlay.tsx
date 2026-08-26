import { Ruler } from "lucide-react";
import { TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import { ModeBanner } from "../ModeBanner";
import type { FigureState } from "../model";
import "./PlaceMeasurementOverlay.css";

export function PlaceMeasurementOverlay({
  measureSelection,
  scale,
  onScale,
  onStop,
}: {
  measureSelection: string[];
  scale?: FigureState["mapScale"];
  onScale: (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="places-measure-overlays">
      <ModeBanner icon={<Ruler />} dismissLabel={t("stopMeasuring")} onDismiss={onStop}>
        <span>
          {measureSelection.length === 1
            ? t("selectDistanceTargetHint")
            : t("nearestDistancesHint")}
        </span>
      </ModeBanner>
      <div className="places-scale-legend">
        <div className="places-scale-value-group">
          <TextField
            fieldClassName="places-scale-value-field"
            className="places-scale-value"
            label={t("scale")}
            type="number"
            min="0.01"
            step="0.01"
            value={scale?.unitsPer100px ?? 1}
            onChange={(event) => onScale({ unitsPer100px: Number(event.target.value) || 1 })}
          />
          <span>{t("perHundredPx")}</span>
        </div>
        <TextField
          fieldClassName="places-scale-unit-field"
          className="places-scale-unit"
          label={t("unitLabelField")}
          labelHidden
          value={scale?.unitLabel ?? t("unitsDefault")}
          onChange={(event) => onScale({ unitLabel: event.target.value })}
        />
      </div>
    </div>
  );
}
