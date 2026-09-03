const NUMERALS = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
] as const;

/**
 * A chapter number as a reader of a printed book would see it.
 *
 * Beyond the range a novel plausibly reaches, the arabic number is the honest answer --
 * "MMMCMXCIX" tells nobody anything.
 */
export function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 399) return String(value);
  let rest = value;
  let out = "";
  for (const [amount, numeral] of NUMERALS) {
    while (rest >= amount) {
      out += numeral;
      rest -= amount;
    }
  }
  return out;
}
