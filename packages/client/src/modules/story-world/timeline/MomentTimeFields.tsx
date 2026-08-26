import { Plus, X } from "lucide-react";
import { Button, Select, TextField } from "../../../design";
import type { Translate, UiLocale } from "../../../i18n";
import type { TimelineMoment, TimeSystem } from "../model";
import { CalendarCoordinateFields } from "./CalendarCoordinateFields";
import { momentTimeLabel } from "./timelinePresentation";
import { calendarCoordinate, timeFromCalendarCoordinate, timeOfMoment } from "./timeSystem";
import "./MomentTimeFields.css";

export function RelativeMomentFields({
  system,
  timeline,
  selected,
  amount,
  direction,
  baseId,
  onChange,
  t,
}: {
  system: TimeSystem;
  timeline: TimelineMoment[];
  selected: TimelineMoment;
  amount: number;
  direction: "before" | "after";
  baseId: string;
  onChange: (amount: number, direction: "before" | "after", baseId: string) => void;
  t: Translate;
}) {
  const candidates = timeline.filter((moment) => moment.id !== selected.id);
  const effectiveBaseId = candidates.some((moment) => moment.id === baseId)
    ? baseId
    : candidates[0]?.id || "";
  const distanceLabel =
    system.unit === "day" ? t("timelineDistanceDays") : t("timelineDistanceSteps");
  return (
    <fieldset className="timeline-relative-position">
      <legend>{t("timelineRelativePlacement")}</legend>
      <p>{t("timelineRelativePlacementHelp")}</p>
      <Select
        className="timeline-relative-control"
        fieldClassName="timeline-relative-field"
        label={t("timelineBaseMoment")}
        value={effectiveBaseId}
        onChange={(event) => onChange(amount, direction, event.target.value)}
      >
        {candidates.map((moment) => (
          <option key={moment.id} value={moment.id}>
            {moment.title ||
              t("timelinePoint", {
                number: timeline.findIndex((item) => item.id === moment.id) + 1,
              })}
            {" · "}
            {momentTimeLabel(system, moment, timeline.indexOf(moment), t)}
          </option>
        ))}
      </Select>
      <Select
        className="timeline-relative-control"
        fieldClassName="timeline-relative-field"
        label={t("timelineDirection")}
        value={direction}
        onChange={(event) =>
          onChange(amount, event.target.value as "before" | "after", effectiveBaseId)
        }
      >
        <option value="before">{t("timelineBefore")}</option>
        <option value="after">{t("timelineAfter")}</option>
      </Select>
      <TextField
        className="timeline-relative-control"
        fieldClassName="timeline-relative-field"
        label={distanceLabel}
        type="number"
        min="0"
        max={Number.MAX_SAFE_INTEGER}
        step="1"
        value={amount}
        onChange={(event) =>
          onChange(
            Math.max(0, Math.trunc(Number(event.target.value) || 0)),
            direction,
            effectiveBaseId,
          )
        }
      />
    </fieldset>
  );
}

export function MomentCalendarFields({
  system,
  moment,
  fallback,
  onStartChange,
  onEndChange,
  onClearEnd,
  locale,
  t,
}: {
  system: TimeSystem;
  moment: TimelineMoment;
  fallback: number;
  onStartChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  onEndChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  onClearEnd: () => void;
  locale: UiLocale;
  t: Translate;
}) {
  const startTime = timeOfMoment(moment, fallback);
  const precision = moment.precision || "day";
  const coordinateFor = (time: number) =>
    calendarCoordinate(system, time) || {
      year: system.epochYear,
      month: system.epochMonth,
      day: system.epochDay,
    };
  const changeTime = (
    coordinate: ReturnType<typeof coordinateFor>,
    nextPrecision: NonNullable<TimelineMoment["precision"]>,
    onChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void,
  ) => {
    const nextTime = timeFromCalendarCoordinate(system, coordinate);
    if (nextTime !== null) onChange(nextTime, nextPrecision);
  };
  return (
    <div className="timeline-calendar-range">
      <CalendarCoordinateFields
        system={system}
        coordinate={coordinateFor(startTime)}
        precision={precision}
        allowUnknown
        label={
          Number.isSafeInteger(moment.endTime) ? t("timelineDateStart") : t("timelineDateSingle")
        }
        onChange={(coordinate, nextPrecision) =>
          changeTime(coordinate, nextPrecision, onStartChange)
        }
        locale={locale}
        t={t}
      />
      {Number.isSafeInteger(moment.endTime) ? (
        <div className="timeline-calendar-end">
          <CalendarCoordinateFields
            system={system}
            coordinate={coordinateFor(moment.endTime as number)}
            precision={moment.endPrecision || precision}
            allowUnknown
            label={t("timelineDateEnd")}
            onChange={(coordinate, endPrecision) => {
              const endTime = timeFromCalendarCoordinate(system, coordinate);
              if (endTime !== null) onEndChange(Math.max(endTime, startTime), endPrecision);
            }}
            locale={locale}
            t={t}
          />
          <Button className="timeline-inline-remove" icon={<X />} onClick={onClearEnd}>
            {t("timelineRemoveEnd")}
          </Button>
        </div>
      ) : (
        <Button
          className="timeline-inline-add"
          icon={<Plus />}
          onClick={() => onEndChange(startTime, precision)}
        >
          {t("timelineAddEnd")}
        </Button>
      )}
    </div>
  );
}
