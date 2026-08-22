import { describe, expect, it } from "vitest";
import { formatDuration, momentDateDiffDays } from "./date";

describe("momentDateDiffDays", () => {
  it("returns undefined when either date is missing", () => {
    expect(momentDateDiffDays(undefined, "1420-03-12")).toBeUndefined();
    expect(momentDateDiffDays("1420-03-12", undefined)).toBeUndefined();
    expect(momentDateDiffDays(undefined, undefined)).toBeUndefined();
  });

  it("returns undefined for malformed dates", () => {
    expect(momentDateDiffDays("not-a-date", "1420-03-12")).toBeUndefined();
  });

  it("returns 0 for the same day", () => {
    expect(momentDateDiffDays("1420-03-12", "1420-03-12")).toBe(0);
  });

  it("counts days correctly across a month boundary", () => {
    expect(momentDateDiffDays("1420-03-30", "1420-04-02")).toBe(3);
  });

  it("counts days correctly across a year boundary", () => {
    expect(momentDateDiffDays("1420-12-30", "1421-01-02")).toBe(3);
  });

  it("returns a negative count when the dates are reversed", () => {
    expect(momentDateDiffDays("1420-03-12", "1420-03-10")).toBe(-2);
  });
});

describe("formatDuration", () => {
  it("formats zero, singular, and plural day counts", () => {
    expect(formatDuration(0)).toBe("am selben Tag");
    expect(formatDuration(1)).toBe("1 Tag");
    expect(formatDuration(3)).toBe("3 Tage");
  });
});
