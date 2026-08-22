export type { BackupStatus } from "./model";

export const loadBackupDialog = () =>
  import("./BackupDialog").then(({ BackupDialog }) => ({ default: BackupDialog }));
