import type { BackupPreviewDocuments } from "../../modules/backup";

export type CloudSyncState =
  | "unconfigured"
  | "unlinked"
  | "synced"
  | "local-pending"
  | "remote-pending"
  | "conflict";

export type CloudSyncStatus = {
  ok: true;
  configured: boolean;
  endpoint: string;
  mode: "manual";
  state: CloudSyncState;
  localFingerprint: string;
  baseGeneration: number | null;
  remote: { generation: number; snapshotId: string | null };
  lastSyncedAt: string | null;
  account?: {
    accountId: string;
    access: "read-write" | "read-only";
    usedBytes: number;
    limitBytes: number | null;
    deleteAfter: string | null;
  };
};

export type CloudSyncAction = "sync" | "keep-local" | "use-remote";

/**
 * Where a world syncs to (`application.sync-target` v1). The world's own address
 * wins; the operator's QUILTOR_BACKUP_URL is only the fallback (`source: "operator"`).
 */
export type SyncTarget = {
  ok: true;
  backupUrl: string;
  source: "world" | "operator" | "none";
  worldUrl: string;
  operatorUrl: string;
};
export type CloudSyncPreview = {
  ok: true;
  generation: number;
  snapshotId: string;
  documents: BackupPreviewDocuments;
};

export interface SynchronizationGateway {
  status(): Promise<CloudSyncStatus>;
  preview(): Promise<CloudSyncPreview>;
  target(): Promise<SyncTarget>;
  /** Sets the world's own address; an empty string removes it. */
  setTarget(backupUrl: string): Promise<SyncTarget>;
  synchronize(request: {
    action: CloudSyncAction;
    expectedGeneration?: number;
    expectedLocalFingerprint?: string;
  }): Promise<{
    ok: true;
    status: CloudSyncStatus;
    reloadRequired: boolean;
    localSnapshotId?: string;
    warnings?: Array<"sync.state_not_saved">;
  }>;
}
