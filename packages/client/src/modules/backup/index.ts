export type { BackupPreviewDocuments, BackupStatus, BackupStorageLocation } from "./model";

export const loadBackupDialog = () =>
  import("./BackupDialog").then(({ BackupDialog }) => ({ default: BackupDialog }));
