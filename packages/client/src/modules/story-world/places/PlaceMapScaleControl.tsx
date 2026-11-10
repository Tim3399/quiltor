import { Ruler } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { Button, IconButton, Popover, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import type { MapScale } from "../model";
import { parseScaleInput } from "./placeMap";
import { formatPlaceNumber } from "./placeNumber";
import "./PlaceMapScaleControl.css";

export interface PlaceMapScaleControlProps {
  name: string;
  scale: MapScale | undefined;
  onScale: (patch: Partial<MapScale>) => void;
  /** Starts setting this map's scale by measuring a stretch on it. */
  onCalibrate?: () => void;
  /** Expanded maps expose the reading itself as the scale editor trigger. */
  valueLabel?: string;
  /** A projected map can move without a browser scroll or resize event. */
  anchorPositionKey?: string;
}

/** What the field shows for a stored scale: a measured 66.666… reads as 66.67. */
function shownScale(value: number, locale: string): string {
  return formatPlaceNumber(value, locale, { significant: 4 });
}

/**
 * The number of units a hundred pixels stand for, typed by hand.
 *
 * The text is a draft held here: "0." on the way to "0.05" is no scale, and writing
 * nothing for it must not throw the field back to the stored value mid-word. Only a
 * positive number is written, which is also the only one the server accepts.
 */
export function ScaleValueField({
  value,
  onValue,
  fieldClassName,
  className,
}: {
  value: number;
  onValue: (value: number) => void;
  fieldClassName?: string;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(() => shownScale(value, locale));
  const [shownFor, setShownFor] = useState(value);
  if (shownFor !== value) {
    setShownFor(value);
    if (parseScaleInput(draft, locale) !== value) setDraft(shownScale(value, locale));
  }
  return (
    <TextField
      fieldClassName={fieldClassName}
      className={className}
      label={t("scale")}
      labelHidden
      inputMode="decimal"
      value={draft}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        setDraft(event.target.value);
        const parsed = parseScaleInput(event.target.value, locale);
        if (parsed !== undefined) onValue(parsed);
      }}
      onBlur={() => setDraft(shownScale(value, locale))}
    />
  );
}

/** One editor for the authoritative map scale in both map presentations. */
export function PlaceMapScaleControl({
  name,
  scale,
  onScale,
  onCalibrate,
  valueLabel,
  anchorPositionKey,
}: PlaceMapScaleControlProps) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Opening the editor leaves the key unchanged; only a moved anchor closes it.
  const [openAt, setOpenAt] = useState(anchorPositionKey);
  if (openAt !== anchorPositionKey) {
    setOpenAt(anchorPositionKey);
    setOpen(false);
  }
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
          <ScaleValueField
            fieldClassName="place-map-scale-control__value"
            value={scale?.unitsPer100px ?? 1}
            onValue={(unitsPer100px) => onScale({ unitsPer100px })}
          />
          <span className="place-map-scale-control__per">{t("perHundredPx")}</span>
          <TextField
            fieldClassName="place-map-scale-control__unit"
            label={t("unitLabelField")}
            value={scale?.unitLabel ?? t("unitsDefault")}
            onChange={(event) => onScale({ unitLabel: event.target.value })}
          />
          {onCalibrate ? (
            <Button
              size="compact"
              appearance="secondary"
              className="place-map-scale-control__calibrate"
              icon={<Ruler />}
              onClick={() => {
                setOpen(false);
                onCalibrate();
              }}
            >
              {t("calibrateScale")}
            </Button>
          ) : null}
        </div>
      </Popover>
    </>
  );
}
