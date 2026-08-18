export function momentDateDiffDays(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const start = new Date(`${from}T00:00:00`),
    end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function formatMomentDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDuration(days: number): string {
  if (days === 0) return "am selben Tag";
  return days === 1 ? "1 Tag" : `${days} Tage`;
}
