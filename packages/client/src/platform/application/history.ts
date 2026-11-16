import type { TextMarkWireV1 } from "../contracts/v1/manuscript";

export interface SnapshotChapterRecord {
  available: boolean;
  exists: boolean;
  text: string;
  marks: TextMarkWireV1[];
}

export interface ChapterComparisonResult {
  ok: boolean;
  selected: SnapshotChapterRecord;
  previous: SnapshotChapterRecord;
}

/** Who named a snapshot; the client words each kind itself. One list with the server
 * (`SNAPSHOT_KINDS`) and contracts/persistence/history-labels. */
export type SnapshotKindWire =
  | "manual"
  | "automatic"
  | "changes"
  | "before-restore"
  | "cloud-sync"
  | "before-cloud-sync"
  | "cloud-sync-conflict";

/** The chapters and profiles a "changes" snapshot touched. Absent when the server
 * could not compare it with its parent. */
export interface SnapshotChangesWire {
  chapters: string[];
  profiles: string[];
}

/** How a version touched one chapter (contracts/application-api/history-chapter-timeline). */
export type ChapterTimelineChange = "created" | "edited" | "deleted" | "unknown";

export interface ChapterTimelineEntry {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  kind: SnapshotKindWire;
  change: ChapterTimelineChange;
}

/** One page of a chapter's timeline, newest first. `next` continues it, null ends it. */
export interface ChapterTimelinePage {
  entries: ChapterTimelineEntry[];
  /** Versions read for this page in which the chapter stayed the same. */
  skipped: number;
  next: string | null;
}

export interface ChapterTimelineRequest {
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

export interface HistoryGateway {
  log(): Promise<{
    ok: boolean;
    commits: Array<{
      hash: string;
      shortHash: string;
      date: string;
      subject: string;
      kind?: SnapshotKindWire;
      changes?: SnapshotChangesWire;
    }>;
  }>;
  /** Restores the world to a snapshot. The server records the current state first. */
  restore(id: string): Promise<void>;
  diff(
    ref?: string,
    word?: boolean,
    all?: boolean,
  ): Promise<{ ok: boolean; diff: string; newFiles: string[]; mode: "word" | "line" }>;
  textVersion(
    ref: string,
    chapter: number,
    title: string,
  ): Promise<{ ok: boolean; isNew: boolean; text: string }>;
  chapterComparison(ref: string, chapterId: string): Promise<ChapterComparisonResult>;
  chapterTimeline(
    chapterId: string,
    request?: ChapterTimelineRequest,
  ): Promise<ChapterTimelinePage>;
}
