import { describe, expect, it } from "vitest";
import { formatPlaceNumber, parsePlaceNumber } from "./placeNumber";

describe("formatPlaceNumber", () => {
  it("writes the decimal mark of the interface language, with the same digits", () => {
    expect(formatPlaceNumber(0.15, "de", { significant: 3 })).toBe("0,15");
    expect(formatPlaceNumber(0.15, "en", { significant: 3 })).toBe("0.15");
    expect(formatPlaceNumber(200 / 3, "de", { significant: 3 })).toBe("66,7");
    expect(formatPlaceNumber(3.333, "de", { fraction: 2 })).toBe("3,33");
    expect(formatPlaceNumber(3.333, "en", { fraction: 2 })).toBe("3.33");
  });

  it("does not group, so a shown value reads back as the same number", () => {
    expect(formatPlaceNumber(1500, "de", { significant: 3 })).toBe("1500");
    expect(formatPlaceNumber(1500, "en", { significant: 3 })).toBe("1500");
  });
});

describe("parsePlaceNumber", () => {
  it("takes comma and point as the decimal mark on both languages", () => {
    for (const locale of ["de", "en"]) {
      expect(parsePlaceNumber("0,15", locale)).toBe(0.15);
      expect(parsePlaceNumber("0.15", locale)).toBe(0.15);
      expect(parsePlaceNumber("12,5", locale)).toBe(12.5);
      expect(parsePlaceNumber("12.5", locale)).toBe(12.5);
      expect(parsePlaceNumber("0.150", locale)).toBe(0.15);
      expect(parsePlaceNumber("50", locale)).toBe(50);
      expect(parsePlaceNumber(" 7 ", locale)).toBe(7);
      expect(parsePlaceNumber("-3,5", locale)).toBe(-3.5);
    }
  });

  it("lets the last separator win when both kinds appear", () => {
    expect(parsePlaceNumber("1.234,5", "de")).toBe(1234.5);
    expect(parsePlaceNumber("1,234.5", "en")).toBe(1234.5);
    expect(parsePlaceNumber("1.234,5", "en")).toBe(1234.5);
    expect(parsePlaceNumber("1.000.000", "de")).toBe(1000000);
    expect(parsePlaceNumber("1,000,000", "en")).toBe(1000000);
  });

  it("does not silently turn 1.000 into 1: the interface language decides", () => {
    expect(parsePlaceNumber("1.000", "de")).toBe(1000);
    expect(parsePlaceNumber("1,000", "de")).toBe(1);
    expect(parsePlaceNumber("1,000", "en")).toBe(1000);
    expect(parsePlaceNumber("1.000", "en")).toBe(1);
    expect(parsePlaceNumber("12.500", "de")).toBe(12500);
    expect(parsePlaceNumber("1 000", "de")).toBe(1000);
  });

  it("refuses what is not a number, including broken grouping", () => {
    for (const text of [
      "",
      "  ",
      "abc",
      "1.0.0",
      "1,2,3",
      "1.2.345",
      "1,5 km",
      ",",
      "--1",
      "1e3",
    ]) {
      expect(parsePlaceNumber(text, "de"), text).toBeUndefined();
    }
  });
});
