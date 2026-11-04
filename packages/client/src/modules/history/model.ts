import type { SnapshotChangesWire, SnapshotKindWire } from "../../platform/application";

export interface SnapshotInfo {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  /** Who named it. Every kind but "manual" is worded by the client; absent from an older server. */
  kind?: SnapshotKindWire;
  /** For "changes": the chapter and profile titles it touched, when the server knows them. */
  changes?: SnapshotChangesWire;
}
