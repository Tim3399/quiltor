const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago something happened, in the coarsest unit that still says something true.
 *
 * Below a minute the answer is `null`, not "vor 0 Sekunden": a writer does not need the
 * second count, and a label that counts up next to the sentence they are writing pulls the
 * eye away from it. Callers show their plain label until the first minute has passed.
 */
export function relativeTime(locale: string, from: number, now = Date.now()): string | null {
  const elapsed = now - from;
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return null;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (elapsed < HOUR) return format.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), "hour");
  return format.format(-Math.floor(elapsed / DAY), "day");
}
