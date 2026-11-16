/**
 * Every number the places show or read, in the interface language.
 *
 * Shown: one formatter (`formatPlaceNumber`), so "0,15 km" on German and "0.15 km" on
 * English come from the same place and cannot drift apart. Grouping is off: a scale
 * reads "1500 m", and what is shown in a field must parse back to the same number.
 * Stored values stay plain numbers; only the text is localised.
 *
 * Read: a typed number takes comma and point (`parsePlaceNumber`).
 */

export type PlaceNumberDigits = { significant: number } | { fraction: number };

export function formatPlaceNumber(
  value: number,
  locale: string,
  digits: PlaceNumberDigits,
): string {
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    ...("significant" in digits
      ? { maximumSignificantDigits: digits.significant }
      : { maximumFractionDigits: digits.fraction }),
  }).format(value);
}

const DOT_GROUPS = /^\d{1,3}(\.\d{3})+$/;
const COMMA_GROUPS = /^\d{1,3}(,\d{3})+$/;

function separators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1000000.5);
  const pick = (type: string, fallback: string) =>
    parts.find((part) => part.type === type)?.value ?? fallback;
  return { decimal: pick("decimal", "."), group: pick("group", ",") };
}

/**
 * A typed number, or `undefined` when it is not one.
 *
 * Comma and point both work as the decimal mark. When both appear, the last one is the
 * decimal mark and the other groups thousands ("1.234,5" and "1,234.5" are 1234.5).
 *
 * The one real ambiguity is a single separator followed by exactly three digits after
 * a short non-zero integer part: "1.000" is one thousand to a German reader and one to
 * an English one. It is not guessed from the digits; the interface language decides, so
 * "1.000" is 1000 on German and 1 on English, and "1,000" the other way round. A leading
 * zero ("0.150") is never a group. Repeated separators are only accepted as proper
 * groups of three ("1.000.000"), anything else ("1.0.0") is not a number.
 * Spaces and apostrophes between digits are ignored (thin space, "1 000", "1'000").
 */
export function parsePlaceNumber(text: string, locale: string): number | undefined {
  const compact = text.replace(/[\s\u00a0\u202f'’]/g, "");
  const match = /^([+-]?)(\d[\d.,]*|[.,]\d+)$/.exec(compact);
  if (!match) return undefined;
  const sign = match[1] === "-" ? -1 : 1;
  const body = match[2] ?? "";
  const last = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  let integer = body;
  let fraction = "";
  if (last >= 0) {
    const mark = body[last] as string;
    const other = mark === "." ? "," : ".";
    const before = body.slice(0, last);
    const after = body.slice(last + 1);
    const grouped = (text: string, group: string) =>
      (group === "." ? DOT_GROUPS : COMMA_GROUPS).test(text);
    if (before.includes(other)) {
      // Both kinds: the last one is the decimal mark.
      if (!grouped(before, other) || before.includes(mark)) return undefined;
      integer = before.replaceAll(other, "");
      fraction = after;
    } else if (before.includes(mark)) {
      // The same mark repeated can only be grouping.
      if (!grouped(body, mark)) return undefined;
      integer = body.replaceAll(mark, "");
    } else if (/^[1-9]\d{0,2}$/.test(before) && /^\d{3}$/.test(after)) {
      if (mark === separators(locale).group) integer = before + after;
      else {
        integer = before;
        fraction = after;
      }
    } else {
      integer = before;
      fraction = after;
    }
  }
  if (!integer && !fraction) return undefined;
  const value = Number(`${integer || "0"}${fraction ? `.${fraction}` : ""}`);
  return Number.isFinite(value) ? sign * value : undefined;
}
