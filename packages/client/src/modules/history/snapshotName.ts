import type { Translate } from "../../i18n";
import type { SnapshotInfo } from "./model";

/** A snapshot's moment in the reader's locale, to the minute: "28.10.2026, 12:20". */
function formatSnapshotDate(date: string, locale: string): string {
  const moment = new Date(date);
  if (Number.isNaN(moment.getTime())) return date;
  return moment.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The name to show for a snapshot. A name the server generated is replaced by the
 * product's own wording; an author's name is shown as written, after its date.
 */
export function snapshotName(snapshot: SnapshotInfo, t: Translate, locale: string): string {
  const date = formatSnapshotDate(snapshot.date, locale);
  if (snapshot.kind === "before-restore") return t("beforeRestoreName", { date });
  if (snapshot.kind === "automatic" || !snapshot.subject) return t("automaticBackupName", { date });
  return `${date} · ${snapshot.subject}`;
}
