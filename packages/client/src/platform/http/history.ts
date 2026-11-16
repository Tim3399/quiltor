import {
  ApplicationGatewayError,
  type ChapterComparisonResult,
  type ChapterTimelineChange,
  type ChapterTimelineEntry,
  type ChapterTimelinePage,
  type ChapterTimelineRequest,
  type HistoryGateway,
  type SnapshotChangesWire,
  type SnapshotKindWire,
} from "../application";
import { currentMessages } from "./locale";
import { type HttpApplicationState, postJson, requestJson, withWorldQuery } from "./request";

const SNAPSHOT_KINDS: ReadonlySet<SnapshotKindWire> = new Set<SnapshotKindWire>([
  "manual",
  "automatic",
  "changes",
  "before-restore",
  "cloud-sync",
  "before-cloud-sync",
  "cloud-sync-conflict",
]);
const TIMELINE_CHANGES: ReadonlySet<ChapterTimelineChange> = new Set<ChapterTimelineChange>([
  "created",
  "edited",
  "deleted",
  "unknown",
]);

function isTimelineEntry(value: unknown): value is ChapterTimelineEntry {
  const entry = value as Record<string, unknown> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.hash === "string" &&
    typeof entry.shortHash === "string" &&
    typeof entry.date === "string" &&
    typeof entry.subject === "string" &&
    SNAPSHOT_KINDS.has(entry.kind as SnapshotKindWire) &&
    TIMELINE_CHANGES.has(entry.change as ChapterTimelineChange)
  );
}

/** The timeline answer, checked: the panel words every change itself, so an unknown one is
 * a server it does not understand rather than something to show. */
function chapterTimelineResult(value: unknown): ChapterTimelinePage {
  const wire = value as { ok?: unknown; entries?: unknown; skipped?: unknown; next?: unknown };
  if (
    wire?.ok !== true ||
    !Array.isArray(wire.entries) ||
    !wire.entries.every(isTimelineEntry) ||
    typeof wire.skipped !== "number" ||
    !Number.isInteger(wire.skipped) ||
    wire.skipped < 0 ||
    (wire.next !== null && typeof wire.next !== "string")
  ) {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
  return {
    entries: wire.entries.map(({ hash, shortHash, date, subject, kind, change }) => ({
      hash,
      shortHash,
      date,
      subject,
      kind,
      change,
    })),
    skipped: wire.skipped,
    next: wire.next,
  };
}

function timelineQuery(chapterId: string, { limit, before }: ChapterTimelineRequest): string {
  const query = new URLSearchParams({ chapterId });
  if (limit !== undefined) query.set("limit", String(limit));
  if (before) query.set("before", before);
  return `/api/history/chapter-timeline?${query.toString()}`;
}

export function createHistoryHttpGateway(state: HttpApplicationState): HistoryGateway {
  return {
    log: () =>
      requestJson<{
        ok: boolean;
        commits: Array<{
          hash: string;
          shortHash: string;
          date: string;
          subject: string;
          kind?: SnapshotKindWire;
          changes?: SnapshotChangesWire;
        }>;
      }>(withWorldQuery(state, "/api/history")),
    restore: async (id: string) => {
      await postJson<{ ok: true }>(withWorldQuery(state, "/api/history/restore"), { id });
    },
    diff: (ref = "WORK", word = true, all = false) =>
      requestJson<{ ok: boolean; diff: string; newFiles: string[]; mode: "word" | "line" }>(
        withWorldQuery(
          state,
          `/api/history/diff?ref=${encodeURIComponent(ref)}&mode=${word ? "word" : "line"}&all=${all ? 1 : 0}`,
        ),
      ),
    textVersion: (ref: string, chapter: number, title: string) =>
      requestJson<{ ok: boolean; isNew: boolean; text: string }>(
        withWorldQuery(
          state,
          `/api/history/chapter-text?ref=${encodeURIComponent(ref)}&chapter=${chapter}&title=${encodeURIComponent(title)}`,
        ),
      ),
    chapterComparison: (ref: string, chapterId: string) =>
      requestJson<ChapterComparisonResult>(
        withWorldQuery(
          state,
          `/api/history/chapter-comparison?ref=${encodeURIComponent(ref)}&chapterId=${encodeURIComponent(chapterId)}`,
        ),
      ),
    chapterTimeline: async (chapterId: string, request: ChapterTimelineRequest = {}) =>
      chapterTimelineResult(
        await requestJson<unknown>(withWorldQuery(state, timelineQuery(chapterId, request)), {
          signal: request.signal,
        }),
      ),
  };
}
