import type { FigureState, TimeSystem, TimeSystemKind, TimelineMoment } from "../model";
import type { Translate, UiLocale } from "../../../i18n";
import { projectMomentTime, timeOfMoment } from "./timeSystem";

export function relativeMomentTimeLabel(system: TimeSystem, time: number, t: Translate): string {
  if (time === 0) return t("timelineRelativeStart");
  return t(system.unit === "day" ? "timelineRelativeDay" : "timelineRelativeStep", { time });
}

export function momentTimeLabel(
  system: TimeSystem,
  moment: TimelineMoment,
  fallback: number,
  t: Translate,
): string {
  if (system.kind === "relative") {
    const start = relativeMomentTimeLabel(system, timeOfMoment(moment, fallback), t);
    return Number.isSafeInteger(moment.endTime)
      ? `${start} – ${relativeMomentTimeLabel(system, moment.endTime as number, t)}`
      : start;
  }
  const start = projectMomentTime(system, timeOfMoment(moment, fallback), moment.precision);
  return Number.isSafeInteger(moment.endTime)
    ? `${start} – ${projectMomentTime(system, moment.endTime as number, moment.endPrecision)}`
    : start;
}

export function defaultDisplayFormat(kind: TimeSystemKind): string {
  return kind === "custom"
    ? "{day} {monthName}, {year} {era}"
    : "{day:02d}.{month:02d}.{year:04d} {era}";
}

export function gregorianMonthLabel(locale: UiLocale, month: number): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );
}

export function calendarDayCount(system: TimeSystem, year: number, month: number): number {
  if (system.kind === "custom") return system.months[month - 1]?.dayCount || 1;
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function countMomentChanges(state: FigureState, momentId: string): number {
  return (
    state.edges.filter((edge) => edge.versions?.some((version) => version.momentId === momentId))
      .length +
    state.nodes.filter((node) => node.diedMomentId === momentId).length +
    (state.presence || []).filter((entry) => entry.momentId === momentId).length
  );
}
