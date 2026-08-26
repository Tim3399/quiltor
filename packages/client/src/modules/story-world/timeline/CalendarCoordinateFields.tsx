import { Select, TextField } from "../../../design";
import type { Translate, UiLocale } from "../../../i18n";
import type { TimelineMoment, TimeSystem } from "../model";
import { calendarDayCount, gregorianMonthLabel } from "./timelinePresentation";
import type { CalendarCoordinate } from "./timeSystem";

export type CalendarPrecision = NonNullable<TimelineMoment["precision"]>;

export interface CalendarCoordinateFieldsProps {
  system: TimeSystem;
  coordinate: CalendarCoordinate;
  label: string;
  locale: UiLocale;
  t: Translate;
  precision?: CalendarPrecision;
  allowUnknown?: boolean;
  className?: string;
  onChange: (coordinate: CalendarCoordinate, precision: CalendarPrecision) => void;
}

/** Shared calendar coordinate editor for both a calendar's epoch and timeline moments. */
export function CalendarCoordinateFields({
  system,
  coordinate,
  label,
  locale,
  t,
  precision = "day",
  allowUnknown = false,
  className = "",
  onChange,
}: CalendarCoordinateFieldsProps) {
  const monthOptions =
    system.kind === "custom"
      ? system.months.map((month, index) => ({ value: index + 1, label: month.name }))
      : Array.from({ length: 12 }, (_, index) => ({
          value: index + 1,
          label: gregorianMonthLabel(locale, index + 1),
        }));

  const apply = (patch: Partial<CalendarCoordinate>, nextPrecision = precision) => {
    const next = { ...coordinate, ...patch };
    next.month = Math.min(Math.max(next.month, 1), Math.max(monthOptions.length, 1));
    next.day = Math.min(Math.max(next.day, 1), calendarDayCount(system, next.year, next.month));
    onChange(next, nextPrecision);
  };

  return (
    <fieldset className={`timeline-calendar-date ${className}`.trim()}>
      <legend>{label}</legend>
      <Select
        className="calendar-coordinate-control"
        label={t("timelineDay")}
        fieldClassName="calendar-coordinate-field"
        disabled={allowUnknown && precision === "year"}
        value={allowUnknown && precision !== "day" ? "" : coordinate.day}
        onChange={(event) => {
          if (allowUnknown && !event.target.value) {
            apply({ day: 1 }, "month");
            return;
          }
          apply({ day: Number(event.target.value) }, "day");
        }}
      >
        {allowUnknown && <option value="">{t("timelineUnknown")}</option>}
        {Array.from(
          { length: calendarDayCount(system, coordinate.year, coordinate.month) },
          (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Calendar day numbers are the stable identity of this static numeric range.
            <option value={index + 1} key={index + 1}>
              {index + 1}
            </option>
          ),
        )}
      </Select>
      <Select
        className="calendar-coordinate-control"
        label={t("timelineMonth")}
        fieldClassName="calendar-coordinate-field"
        value={allowUnknown && precision === "year" ? "" : coordinate.month}
        onChange={(event) => {
          if (allowUnknown && !event.target.value) {
            apply({ month: 1, day: 1 }, "year");
            return;
          }
          apply({ month: Number(event.target.value), day: 1 }, allowUnknown ? "month" : precision);
        }}
      >
        {allowUnknown && <option value="">{t("timelineUnknown")}</option>}
        {monthOptions.map((month) => (
          <option value={month.value} key={month.value}>
            {month.label}
          </option>
        ))}
      </Select>
      <TextField
        className="calendar-coordinate-control"
        label={t("timelineYear")}
        fieldClassName="calendar-coordinate-field"
        type="number"
        value={coordinate.year}
        min={system.kind === "gregorian" ? 1 : -Number.MAX_SAFE_INTEGER}
        max={system.kind === "gregorian" ? 9999 : Number.MAX_SAFE_INTEGER}
        onChange={(event) => apply({ year: Math.trunc(Number(event.target.value) || 1) })}
      />
    </fieldset>
  );
}
