import { Ruler, X } from "lucide-react";
import { useI18n } from "../../../i18n";
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
      <div className="mode-banner" role="status">
        <Ruler />
        <span>
          {measureSelection.length === 1
            ? t("selectDistanceTargetHint")
            : t("nearestDistancesHint")}
        </span>
        <button type="button" onClick={onStop}>
          <X />
          <span className="sr-only">{t("stopMeasuring")}</span>
        </button>
      </div>
      <div className="places-scale-legend">
        <label>
          <span>{t("scale")}</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={scale?.unitsPer100px ?? 1}
            onChange={(event) => onScale({ unitsPer100px: Number(event.target.value) || 1 })}
          />
          <span>{t("perHundredPx")}</span>
        </label>
        <label>
          <span className="sr-only">{t("unitLabelField")}</span>
          <input
            value={scale?.unitLabel ?? t("unitsDefault")}
            onChange={(event) => onScale({ unitLabel: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
