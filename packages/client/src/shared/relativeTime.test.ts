import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const minutes = (count: number) => NOW - count * 60_000;

describe("relativeTime", () => {
  it("stays silent for the first minute", () => {
    expect(relativeTime("de", NOW, NOW)).toBeNull();
    expect(relativeTime("de", NOW - 59_000, NOW)).toBeNull();
  });

  it("counts in the coarsest unit that is still true", () => {
    expect(relativeTime("de", minutes(1), NOW)).toContain("1");
    expect(relativeTime("de", minutes(59), NOW)).toContain("59");
    expect(relativeTime("en", minutes(60), NOW)).toBe("1 hr. ago");
    // numeric: "auto" prefers the word a reader would use, so a day back is "yesterday".
    expect(relativeTime("en", minutes(60 * 25), NOW)).toBe("yesterday");
    expect(relativeTime("de", minutes(60 * 25), NOW)).toBe("gestern");
  });

  it("follows the interface language", () => {
    expect(relativeTime("de", minutes(5), NOW)).toBe("vor 5 Min.");
    expect(relativeTime("en", minutes(5), NOW)).toBe("5 min. ago");
  });

  it("treats a clock that jumped backwards as just saved", () => {
    expect(relativeTime("de", NOW + 5 * 60_000, NOW)).toBeNull();
    expect(relativeTime("de", Number.NaN, NOW)).toBeNull();
  });
});
