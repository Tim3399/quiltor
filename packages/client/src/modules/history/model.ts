export interface SnapshotInfo {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  /** Who named it. "automatic": the server did, and the client shows its own wording. Open for further kinds. */
  kind?: "automatic" | "manual" | "before-restore";
}
