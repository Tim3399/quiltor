export interface SnapshotInfo {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  /** The server generated this name; the client shows its own wording instead. */
  automatic?: boolean;
}
