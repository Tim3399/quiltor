import { describe, expect, it } from "vitest";
import { romanNumeral } from "./romanNumeral";

describe("romanNumeral", () => {
  it("writes the numbers a novel actually reaches", () => {
    expect(romanNumeral(1)).toBe("I");
    expect(romanNumeral(4)).toBe("IV");
    expect(romanNumeral(9)).toBe("IX");
    expect(romanNumeral(14)).toBe("XIV");
    expect(romanNumeral(40)).toBe("XL");
    expect(romanNumeral(399)).toBe("CCCXCIX");
  });

  it("falls back to the arabic number where a numeral stops helping", () => {
    expect(romanNumeral(400)).toBe("400");
    expect(romanNumeral(0)).toBe("0");
    expect(romanNumeral(-3)).toBe("-3");
    expect(romanNumeral(2.5)).toBe("2.5");
  });
});
