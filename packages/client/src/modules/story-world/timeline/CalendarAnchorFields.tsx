import type { TimeSystem } from "../model";
import type { Translate, UiLocale } from "../../../i18n";
import type { CalendarCoordinate } from "./timeSystem";
import { calendarDayCount, gregorianMonthLabel } from "./timelinePresentation";

export function CalendarAnchorFields({
  system,
  onPatch,
  locale,
  t,
}: {
  system: TimeSystem;
  onPatch: (patch: Partial<TimeSystem>) => void;
  locale: UiLocale;
  t: Translate;
}) {
  const monthOptions =
    system.kind === "custom"
      ? system.months.map((month, index) => ({ value: index + 1, label: month.name }))
      : Array.from({ length: 12 }, (_, index) => ({
          value: index + 1,
          label: gregorianMonthLabel(locale, index + 1),
        }));
  const patchDate = (patch: Partial<CalendarCoordinate>) => {
    const next = {
      year: patch.year ?? system.epochYear,
      month: patch.month ?? system.epochMonth,
      day: patch.day ?? system.epochDay,
    };
    next.month = Math.min(Math.max(next.month, 1), Math.max(monthOptions.length, 1));
    next.day = Math.min(Math.max(next.day, 1), calendarDayCount(system, next.year, next.month));
    onPatch({ epochYear: next.year, epochMonth: next.month, epochDay: next.day });
  };
  return (
    <fieldset className="timeline-calendar-date timeline-anchor-date">
      <legend>{t("timelineAnchorDate")}</legend>
      <label>
        <span>{t("timelineDay")}</span>
        <select
          value={Math.min(
            system.epochDay,
            calendarDayCount(system, system.epochYear, system.epochMonth),
          )}
          onChange={(event) => patchDate({ day: Number(event.target.value) })}
        >
          {Array.from(
            { length: calendarDayCount(system, system.epochYear, system.epochMonth) },
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
          value={Math.min(system.epochMonth, Math.max(monthOptions.length, 1))}
          onChange={(event) => patchDate({ month: Number(event.target.value) })}
        >
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
          value={system.epochYear}
          min={system.kind === "gregorian" ? 1 : -Number.MAX_SAFE_INTEGER}
          max={system.kind === "gregorian" ? 9999 : Number.MAX_SAFE_INTEGER}
          onChange={(event) => patchDate({ year: Math.trunc(Number(event.target.value) || 1) })}
        />
      </label>
    </fieldset>
  );
}
