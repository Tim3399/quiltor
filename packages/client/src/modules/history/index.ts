export type { SnapshotInfo } from "./model";
export { formatSnapshotDate, snapshotName } from "./snapshotName";
export {
  diffVersion,
  type VersionDiffProjection,
} from "./versionDiff";

export const loadHistoryDialog = () =>
  import("./HistoryDialog").then(({ HistoryDialog }) => ({ default: HistoryDialog }));

export const loadSnapshotDialog = () =>
  import("./SnapshotDialog").then(({ SnapshotDialog }) => ({ default: SnapshotDialog }));
