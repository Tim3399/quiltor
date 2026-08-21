import type { CalendarMonth, TimeSystem, TimelineMoment } from "../../types";

export interface CalendarCoordinate {
  year: number;
  month: number;
  day: number;
}

export const DEFAULT_TIME_SYSTEM: TimeSystem = {
  id: "primary",
  name: "Relative",
  kind: "relative",
  unit: "day",
  eraName: "",
  eraAbbreviation: "",
  epochTime: 0,
  epochYear: 1,
  epochMonth: 1,
  epochDay: 1,
  epochWeekday: 0,
  displayFormat: "",
  months: [],
  weekdays: [],
};

export const DEFAULT_CUSTOM_MONTHS: CalendarMonth[] = Array.from({ length: 12 }, (_, index) => ({
  name: `Month ${index + 1}`,
  shortName: `M${index + 1}`,
  dayCount: 30,
}));

export function normalizeTimeSystem(value?: Partial<TimeSystem>): TimeSystem {
  return { ...DEFAULT_TIME_SYSTEM, ...value };
}

export function relativeTimeLabel(time: number): string {
  return time === 0 ? "t0" : `t${time > 0 ? "+" : ""}${time}`;
}

// Howard Hinnant's civil-date conversion, adapted to TypeScript. It avoids Date's year
// 0..99 coercion and remains deterministic for fictional epochs outside browser ranges.
function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const era = Math.floor(days / 146097);
  const dayOfEra = days - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPiece = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPiece + 2) / 5) + 1;
  const month = monthPiece + (monthPiece < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return { year, month, day };
}

function customDate(system: TimeSystem, time: number) {
  const months = system.months.filter(
    (month) => Number.isInteger(month.dayCount) && month.dayCount > 0,
  );
  if (!months.length) return null;
  const yearLength = months.reduce((sum, month) => sum + month.dayCount, 0);
  const epochMonth = Math.min(Math.max(system.epochMonth, 1), months.length);
  const epochOffset =
    months.slice(0, epochMonth - 1).reduce((sum, month) => sum + month.dayCount, 0) +
    Math.min(Math.max(system.epochDay, 1), months[epochMonth - 1].dayCount) -
    1;
  const absolute = epochOffset + time - system.epochTime;
  const yearDelta = Math.floor(absolute / yearLength);
  let dayOfYear = absolute - yearDelta * yearLength;
  let monthIndex = 0;
  while (dayOfYear >= months[monthIndex].dayCount) {
    dayOfYear -= months[monthIndex].dayCount;
    monthIndex += 1;
  }
  const weekday = system.weekdays.length
    ? system.weekdays[
        (((system.epochWeekday + time - system.epochTime) % system.weekdays.length) +
          system.weekdays.length) %
          system.weekdays.length
      ]
    : undefined;
  return {
    year: system.epochYear + yearDelta,
    month: months[monthIndex],
    day: dayOfYear + 1,
    weekday,
  };
}

export function calendarCoordinate(
  systemValue: Partial<TimeSystem> | undefined,
  time: number,
): CalendarCoordinate | null {
  const system = normalizeTimeSystem(systemValue);
  if (system.kind === "relative") return null;
  if (system.kind === "gregorian") {
    const epoch = daysFromCivil(system.epochYear, system.epochMonth, system.epochDay);
    return civilFromDays(epoch + time - system.epochTime);
  }
  const date = customDate(system, time);
  if (!date) return null;
  return { year: date.year, month: system.months.indexOf(date.month) + 1, day: date.day };
}

export function timeFromCalendarCoordinate(
  systemValue: Partial<TimeSystem> | undefined,
  coordinate: CalendarCoordinate,
): number | null {
  const system = normalizeTimeSystem(systemValue);
  if (system.kind === "relative") return null;
  const { year, month, day } = coordinate;
  if (![year, month, day].every(Number.isSafeInteger)) return null;
  if (system.kind === "gregorian") {
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const roundtrip = civilFromDays(daysFromCivil(year, month, day));
    if (roundtrip.year !== year || roundtrip.month !== month || roundtrip.day !== day) return null;
    const epoch = daysFromCivil(system.epochYear, system.epochMonth, system.epochDay);
    const result = system.epochTime + daysFromCivil(year, month, day) - epoch;
    return Number.isSafeInteger(result) ? result : null;
  }
  const months = system.months.filter(
    (item) => Number.isSafeInteger(item.dayCount) && item.dayCount > 0,
  );
  if (
    !months.length ||
    month < 1 ||
    month > months.length ||
    day < 1 ||
    day > months[month - 1].dayCount
  )
    return null;
  const yearLength = months.reduce((sum, item) => sum + item.dayCount, 0);
  const offset = (valueYear: number, valueMonth: number, valueDay: number) =>
    (valueYear - system.epochYear) * yearLength +
    months.slice(0, valueMonth - 1).reduce((sum, item) => sum + item.dayCount, 0) +
    valueDay -
    1;
  const result =
    system.epochTime +
    offset(year, month, day) -
    offset(system.epochYear, system.epochMonth, system.epochDay);
  return Number.isSafeInteger(result) ? result : null;
}

export function projectMomentTime(
  systemValue: Partial<TimeSystem> | undefined,
  time: number,
  precision: TimelineMoment["precision"] = "day",
): string {
  const system = normalizeTimeSystem(systemValue);
  if (system.kind === "relative") return relativeTimeLabel(time);
  const coordinate = calendarCoordinate(system, time);
  if (!coordinate) return relativeTimeLabel(time);
  const era = system.eraAbbreviation || system.eraName;
  if (precision === "year") return `${coordinate.year}${era ? ` ${era}` : ""}`;
  if (precision === "month") {
    const month =
      system.kind === "custom"
        ? system.months[coordinate.month - 1]?.name || String(coordinate.month)
        : String(coordinate.month).padStart(2, "0");
    return `${month} ${coordinate.year}${era ? ` ${era}` : ""}`;
  }
  return projectTime(system, time);
}

export function projectTime(systemValue: Partial<TimeSystem> | undefined, time: number): string {
  const system = normalizeTimeSystem(systemValue);
  if (system.kind === "relative") return relativeTimeLabel(time);
  const era = system.eraAbbreviation || system.eraName;
  let result: string;
  if (system.kind === "gregorian") {
    const epoch = daysFromCivil(system.epochYear, system.epochMonth, system.epochDay);
    const date = civilFromDays(epoch + time - system.epochTime);
    const year = String(date.year).padStart(4, "0");
    const month = String(date.month).padStart(2, "0");
    const day = String(date.day).padStart(2, "0");
    const template = system.displayFormat || "{year:04d}-{month:02d}-{day:02d}";
    result = formatTemplate(template, {
      year: date.year,
      month: date.month,
      day: date.day,
      era,
      eraName: system.eraName,
      eraAbbreviation: system.eraAbbreviation,
      time,
    });
  } else {
    const date = customDate(system, time);
    if (!date) return relativeTimeLabel(time);
    const template = system.displayFormat || "{day} {monthName}, {year} {era}";
    result = formatTemplate(template, {
      year: date.year,
      month: system.months.indexOf(date.month) + 1,
      day: date.day,
      monthName: date.month.name,
      monthShortName: date.month.shortName,
      weekdayName: date.weekday?.name || "",
      weekdayShortName: date.weekday?.shortName || "",
      era,
      eraName: system.eraName,
      eraAbbreviation: system.eraAbbreviation,
      time,
    });
  }
  return result;
}

function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template
    .replace(/\{([A-Za-z]+)(?::0?(\d+)d)?\}/g, (token, key: string, width?: string) => {
      if (!(key in values)) return token;
      const value = String(values[key]);
      return width ? value.padStart(Number(width), "0") : value;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRelativeTime(value: string): number | null {
  const match = /^t([+-]?\d+)$/i.exec(value.trim());
  if (!match) return null;
  const time = Number(match[1]);
  return Number.isSafeInteger(time) ? time : null;
}

export function timeOfMoment(moment: TimelineMoment, fallback = 0): number {
  return Number.isInteger(moment.time) ? (moment.time as number) : fallback;
}
