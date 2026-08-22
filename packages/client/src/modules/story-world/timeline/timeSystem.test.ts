import { describe, expect, it } from "vitest";
import type { TimeSystem } from "../model";
import {
  calendarCoordinate,
  normalizeTimeSystem,
  parseRelativeTime,
  projectMomentTime,
  projectTime,
  relativeTimeLabel,
  timeFromCalendarCoordinate,
} from "./timeSystem";

describe("time-system projection", () => {
  it("formats the signed canonical coordinate in relative mode", () => {
    expect(relativeTimeLabel(-12)).toBe("t-12");
    expect(relativeTimeLabel(0)).toBe("t0");
    expect(relativeTimeLabel(4)).toBe("t+4");
    expect(parseRelativeTime("t-12")).toBe(-12);
    expect(parseRelativeTime("t+4")).toBe(4);
    expect(parseRelativeTime("4")).toBeNull();
  });

  it("projects Gregorian days with integer calendar arithmetic", () => {
    const system = normalizeTimeSystem({
      kind: "gregorian",
      epochTime: 10,
      epochYear: 2024,
      epochMonth: 2,
      epochDay: 28,
    });
    expect(projectTime(system, 9)).toBe("2024-02-27");
    expect(projectTime(system, 11)).toBe("2024-02-29");
    expect(projectTime(system, 12)).toBe("2024-03-01");
    expect(calendarCoordinate(system, 12)).toEqual({ year: 2024, month: 3, day: 1 });
    expect(timeFromCalendarCoordinate(system, { year: 2024, month: 3, day: 1 })).toBe(12);
    expect(timeFromCalendarCoordinate(system, { year: 2023, month: 2, day: 29 })).toBeNull();
    expect(projectMomentTime(system, 12, "month")).toBe("03 2024");
    expect(projectMomentTime(system, 12, "year")).toBe("2024");
  });

  it("projects custom months, years, weekdays and eras", () => {
    const system: TimeSystem = {
      ...normalizeTimeSystem(),
      kind: "custom",
      eraAbbreviation: "NZ",
      epochTime: 0,
      epochYear: 7,
      epochMonth: 2,
      epochDay: 3,
      epochWeekday: 1,
      displayFormat: "{weekdayName}, {day} {monthName}, {year} {era}",
      months: [
        { name: "Frost", shortName: "Fr", dayCount: 4 },
        { name: "Tau", shortName: "Ta", dayCount: 3 },
      ],
      weekdays: [
        { name: "Sonne", shortName: "So" },
        { name: "Mond", shortName: "Mo" },
      ],
    };
    expect(projectTime(system, 0)).toBe("Mond, 3 Tau, 7 NZ");
    expect(projectTime(system, 1)).toBe("Sonne, 1 Frost, 8 NZ");
    expect(projectTime(system, -7)).toBe("Sonne, 3 Tau, 6 NZ");
    expect(timeFromCalendarCoordinate(system, { year: 8, month: 1, day: 1 })).toBe(1);
    expect(projectMomentTime(system, 1, "month")).toBe("Frost 8 NZ");
  });
});
