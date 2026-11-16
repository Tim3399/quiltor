import { Ruler } from "lucide-react";
import type { ReactNode } from "react";
import { Button, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import { ModeBanner } from "../ModeBanner";
import type { FigureState } from "../model";
import { ScaleValueField } from "./PlaceMapScaleControl";
import "./PlaceMeasurementOverlay.css";

export function PlaceMeasurementOverlay({
  measureSelection,
  scale,
  onScale,
  onStop,
  onCalibrate,
  trail,
}: {
  measureSelection: string[];
  scale?: FigureState["mapScale"];
  onScale: (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) => void;
  onStop: () => void;
  /** Starts setting this level's scale by measuring a stretch: the same target as the field. */
  onCalibrate?: () => void;
  /** The level trail joins the column, so trail, hint and scale never share a spot. */
  trail?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="places-measure-overlays">
      {trail}
      <ModeBanner tone="info" icon={<Ruler />} dismissLabel={t("stopMeasuring")} onDismiss={onStop}>
        <span>
          {measureSelection.length === 1
            ? t("selectDistanceTargetHint")
            : t("nearestDistancesHint")}
        </span>
      </ModeBanner>
      <div className="places-scale-legend">
        <div className="places-scale-value-group">
          <ScaleValueField
            fieldClassName="places-scale-value-field"
            className="places-scale-value"
            value={scale?.unitsPer100px ?? 1}
            onValue={(unitsPer100px) => onScale({ unitsPer100px })}
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
        {onCalibrate ? (
          <Button size="compact" appearance="secondary" icon={<Ruler />} onClick={onCalibrate}>
            {t("calibrateScale")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
