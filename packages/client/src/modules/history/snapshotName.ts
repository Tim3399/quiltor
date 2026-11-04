import type { Translate } from "../../i18n";
import type { SnapshotInfo } from "./model";

/** A snapshot's moment in the reader's locale, to the minute: "28.10.2026, 12:20". */
function formatSnapshotDate(date: string, locale: string): string {
  const moment = new Date(date);
  if (Number.isNaN(moment.getTime())) return date;
  return moment.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** "Kapitel „Der Hafen“ bearbeitet", "2 Kapitel, 1 Profil bearbeitet", or no names. */
function changesName(snapshot: SnapshotInfo, t: Translate, date: string): string {
  const chapters = snapshot.changes?.chapters ?? [];
  const profiles = snapshot.changes?.profiles ?? [];
  if (chapters.length === 1 && profiles.length === 0)
    return t("snapshotChapterEdited", { name: chapters[0], date });
  if (profiles.length === 1 && chapters.length === 0)
    return t("snapshotProfileEdited", { name: profiles[0], date });
  const parts = [
    chapters.length === 1
      ? t("snapshotChapterCountOne")
      : chapters.length > 1
        ? t("snapshotChapterCountMany", { n: chapters.length })
        : "",
    profiles.length === 1
      ? t("snapshotProfileCountOne")
      : profiles.length > 1
        ? t("snapshotProfileCountMany", { n: profiles.length })
        : "",
  ].filter(Boolean);
  if (parts.length === 0) return t("snapshotChangesName", { date });
  return t("snapshotCountsEdited", { counts: parts.join(", "), date });
}

/**
 * The name to show for a snapshot. Every name the server generated is replaced by the
 * product's own wording; an author's name is shown as written, after its date.
 */
export function snapshotName(snapshot: SnapshotInfo, t: Translate, locale: string): string {
  const date = formatSnapshotDate(snapshot.date, locale);
  switch (snapshot.kind) {
    case "automatic":
      return t("automaticBackupName", { date });
    case "changes":
      return changesName(snapshot, t, date);
    case "before-restore":
      return t("snapshotBeforeRestore", { date });
    case "cloud-sync":
      return t("snapshotCloudSync", { date });
    case "before-cloud-sync":
      return t("snapshotBeforeCloudSync", { date });
    case "cloud-sync-conflict":
      return t("snapshotCloudSyncConflict", { date });
    default:
      if (!snapshot.subject) return t("automaticBackupName", { date });
      return `${date} · ${snapshot.subject}`;
  }
}
