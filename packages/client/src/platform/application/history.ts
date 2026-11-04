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

/** Who named a snapshot. "before-restore": the server's own commit before a version restore. */
export type SnapshotKindWire = "automatic" | "manual" | "before-restore";

export interface HistoryGateway {
  log(): Promise<{
    ok: boolean;
    commits: Array<{
      hash: string;
      shortHash: string;
      date: string;
      subject: string;
      kind?: SnapshotKindWire;
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
}
