export type { SnapshotInfo } from "./model";
export {
  diffVersion,
  diffVersionText,
  type VersionDiffKind,
  type VersionDiffProjection,
  type VersionDiffSegment,
  type VersionEqualSpan,
  type VersionFormattingChange,
  type VersionTextChange,
} from "./versionDiff";

export const loadHistoryDialog = () =>
  import("./HistoryDialog").then(({ HistoryDialog }) => ({ default: HistoryDialog }));

export const loadSnapshotDialog = () =>
  import("./SnapshotDialog").then(({ SnapshotDialog }) => ({ default: SnapshotDialog }));
