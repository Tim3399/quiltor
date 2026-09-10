import { Ruler } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Popover, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import type { MapScale } from "../model";
import "./PlaceMapScaleControl.css";

export interface PlaceMapScaleControlProps {
  name: string;
  scale: MapScale | undefined;
  onScale: (patch: Partial<MapScale>) => void;
  /** Expanded maps expose the reading itself as the scale editor trigger. */
  valueLabel?: string;
  /** A projected map can move without a browser scroll or resize event. */
  anchorPositionKey?: string;
}

/** One editor for the authoritative map scale in both map presentations. */
export function PlaceMapScaleControl({
  name,
  scale,
  onScale,
  valueLabel,
  anchorPositionKey,
}: PlaceMapScaleControlProps) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Opening the editor leaves the key unchanged; only a moved anchor closes it.
    setOpen(false);
  }, [anchorPositionKey]);
  const label = t("placeMapScale", { name });
  const triggerProps = {
    ref: anchor,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": open,
    onClick: () => setOpen((value) => !value),
  };
  return (
    <>
      {valueLabel !== undefined ? (
        <Button
          {...triggerProps}
          size="compact"
          appearance="ghost"
          className="place-map-scale-control__trigger"
          aria-label={label}
          title={valueLabel}
        >
          {valueLabel}
        </Button>
      ) : (
        <IconButton
          {...triggerProps}
          size="compact"
          appearance="ghost"
          label={label}
          icon={<Ruler />}
        />
      )}
      <Popover
        anchorRef={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        compactMode="popover"
      >
        <div className="place-map-scale-control">
          <TextField
            fieldClassName="place-map-scale-control__value"
            label={t("scale")}
            type="number"
            min="0.01"
            step="0.01"
            value={scale?.unitsPer100px ?? 1}
            onChange={(event) => {
              const value = Number(event.target.value);
              onScale({ unitsPer100px: Number.isFinite(value) ? Math.max(0.01, value) : 1 });
            }}
          />
          <span className="place-map-scale-control__per">{t("perHundredPx")}</span>
          <TextField
            fieldClassName="place-map-scale-control__unit"
            label={t("unitLabelField")}
            value={scale?.unitLabel ?? t("unitsDefault")}
            onChange={(event) => onScale({ unitLabel: event.target.value })}
          />
        </div>
      </Popover>
    </>
  );
}
