export type { SnapshotInfo } from "./model";

export const loadHistoryDialog = () =>
  import("./HistoryDialog").then(({ HistoryDialog }) => ({ default: HistoryDialog }));

export const loadSnapshotDialog = () =>
  import("./SnapshotDialog").then(({ SnapshotDialog }) => ({ default: SnapshotDialog }));
