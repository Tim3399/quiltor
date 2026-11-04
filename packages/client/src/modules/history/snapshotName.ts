import type { Translate } from "../../i18n";
import type { SnapshotInfo } from "./model";

/** A snapshot's moment in the reader's locale, to the minute: "28.10.2026, 12:20". */
function formatSnapshotDate(date: string, locale: string): string {
  const moment = new Date(date);
  if (Number.isNaN(moment.getTime())) return date;
  return moment.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

// The summaries the server writes for an unnamed change (`_describe_changes` in
// src/quiltor/infrastructure/backup/snapshots.py). They are persisted in English and
// translated here; anything else is the author's own words and stays as written.
const ONE_CHAPTER = /^Chapter "(.+)" edited$/;
const ONE_PROFILE = /^Profile "(.+)" edited$/;
const COUNTS = /^(?:(\d+) chapters?)?(?:, )?(?:(\d+) profiles?)? edited$/;

/** The server's change summary in the reader's language; any other text unchanged. */
export function localizedSummary(subject: string, t: Translate): string {
  const chapter = ONE_CHAPTER.exec(subject);
  if (chapter) return t("chapterEditedSummary", { title: chapter[1] });
  const profile = ONE_PROFILE.exec(subject);
  if (profile) return t("profileEditedSummary", { title: profile[1] });
  const counts = COUNTS.exec(subject);
  if (counts && (counts[1] || counts[2])) {
    const parts: string[] = [];
    if (counts[1]) {
      const count = Number(counts[1]);
      parts.push(count === 1 ? t("chapterCountOne") : t("chapterCountMany", { count }));
    }
    if (counts[2]) {
      const count = Number(counts[2]);
      parts.push(count === 1 ? t("profileCountOne") : t("profileCountMany", { count }));
    }
    return t("editedSummary", { parts: parts.join(", ") });
  }
  return subject;
}

/**
 * The name to show for a snapshot. A name the server generated is replaced by the
 * product's own wording; an author's name is shown as written, after its date.
 */
export function snapshotName(snapshot: SnapshotInfo, t: Translate, locale: string): string {
  const date = formatSnapshotDate(snapshot.date, locale);
  // Widened until the model lists the kind: the server already reports it (T-87 part B).
  const kind: string | undefined = snapshot.kind;
  if (kind === "before-restore") return t("beforeRestoreName", { date });
  if (kind === "automatic" || !snapshot.subject) return t("automaticBackupName", { date });
  return `${date} · ${localizedSummary(snapshot.subject, t)}`;
}
