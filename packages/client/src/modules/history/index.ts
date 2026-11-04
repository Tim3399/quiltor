export type { SnapshotInfo } from "./model";
export {
  diffVersion,
  type VersionDiffProjection,
} from "./versionDiff";

export type { VersionsOpenOptions } from "./VersionsDialog";

export const loadVersionsDialog = () =>
  import("./VersionsDialog").then(({ VersionsDialog }) => ({ default: VersionsDialog }));
