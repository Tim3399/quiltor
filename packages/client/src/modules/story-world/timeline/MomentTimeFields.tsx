import { Plus, X } from "lucide-react";
import type { TimeSystem, TimelineMoment } from "../model";
import type { Translate, UiLocale } from "../../../i18n";
import {
  type CalendarCoordinate,
  calendarCoordinate,
  timeFromCalendarCoordinate,
  timeOfMoment,
} from "./timeSystem";
import { calendarDayCount, gregorianMonthLabel, momentTimeLabel } from "./timelinePresentation";
import "./MomentTimeFields.css";

function CalendarCoordinateInput({
  system,
  time,
  precision,
  label,
  onChange,
  locale,
  t,
}: {
  system: TimeSystem;
  time: number;
  precision: NonNullable<TimelineMoment["precision"]>;
  label: string;
  onChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  locale: UiLocale;
  t: Translate;
}) {
  const coordinate = calendarCoordinate(system, time) || {
    year: system.epochYear,
    month: system.epochMonth,
    day: system.epochDay,
  };
  const apply = (
    patch: Partial<CalendarCoordinate>,
    nextPrecision: NonNullable<TimelineMoment["precision"]> = precision,
  ) => {
    const next = { ...coordinate, ...patch };
    const maxDay = calendarDayCount(system, next.year, next.month);
    next.day = Math.min(Math.max(next.day, 1), maxDay);
    const nextTime = timeFromCalendarCoordinate(system, next);
    if (nextTime !== null) onChange(nextTime, nextPrecision);
  };
  const monthOptions =
    system.kind === "custom"
      ? system.months.map((month, index) => ({ value: index + 1, label: month.name }))
      : Array.from({ length: 12 }, (_, index) => ({
          value: index + 1,
          label: gregorianMonthLabel(locale, index + 1),
        }));
  return (
    <fieldset className="timeline-calendar-date">
      <legend>{label}</legend>
      <label>
        <span>{t("timelineDay")}</span>
        <select
          disabled={precision === "year"}
          value={precision === "day" ? coordinate.day : ""}
          onChange={(event) =>
            event.target.value
              ? apply({ day: Number(event.target.value) }, "day")
              : apply({ day: 1 }, "month")
          }
        >
          <option value="">{t("timelineUnknown")}</option>
          {Array.from(
            { length: calendarDayCount(system, coordinate.year, coordinate.month) },
            (_, index) => (
              <option value={index + 1} key={index + 1}>
                {index + 1}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        <span>{t("timelineMonth")}</span>
        <select
          value={precision === "year" ? "" : coordinate.month}
          onChange={(event) =>
            event.target.value
              ? apply({ month: Number(event.target.value), day: 1 }, "month")
              : apply({ month: 1, day: 1 }, "year")
          }
        >
          <option value="">{t("timelineUnknown")}</option>
          {monthOptions.map((month) => (
            <option value={month.value} key={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("timelineYear")}</span>
        <input
          type="number"
          value={coordinate.year}
          min={system.kind === "gregorian" ? 1 : -Number.MAX_SAFE_INTEGER}
          max={system.kind === "gregorian" ? 9999 : Number.MAX_SAFE_INTEGER}
          onChange={(event) => apply({ year: Math.trunc(Number(event.target.value) || 1) })}
        />
      </label>
    </fieldset>
  );
}

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
      <label>
        <span>{t("timelineBaseMoment")}</span>
        <select
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
        </select>
      </label>
      <label>
        <span>{t("timelineDirection")}</span>
        <select
          value={direction}
          onChange={(event) =>
            onChange(amount, event.target.value as "before" | "after", effectiveBaseId)
          }
        >
          <option value="before">{t("timelineBefore")}</option>
          <option value="after">{t("timelineAfter")}</option>
        </select>
      </label>
      <label>
        <span>{distanceLabel}</span>
        <input
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
      </label>
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
  return (
    <div className="timeline-calendar-range">
      <CalendarCoordinateInput
        system={system}
        time={startTime}
        precision={precision}
        label={
          Number.isSafeInteger(moment.endTime) ? t("timelineDateStart") : t("timelineDateSingle")
        }
        onChange={onStartChange}
        locale={locale}
        t={t}
      />
      {Number.isSafeInteger(moment.endTime) ? (
        <div className="timeline-calendar-end">
          <CalendarCoordinateInput
            system={system}
            time={moment.endTime as number}
            precision={moment.endPrecision || precision}
            label={t("timelineDateEnd")}
            onChange={(time, endPrecision) => onEndChange(Math.max(time, startTime), endPrecision)}
            locale={locale}
            t={t}
          />
          <button type="button" className="timeline-inline-remove" onClick={onClearEnd}>
            <X />
            {t("timelineRemoveEnd")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="timeline-inline-add"
          onClick={() => onEndChange(startTime, precision)}
        >
          <Plus />
          {t("timelineAddEnd")}
        </button>
      )}
    </div>
  );
}
