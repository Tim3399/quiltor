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
export type CloudSyncPreview = {
  ok: true;
  generation: number;
  snapshotId: string;
  documents: BackupPreviewDocuments;
};

export interface SynchronizationGateway {
  status(): Promise<CloudSyncStatus>;
  preview(): Promise<CloudSyncPreview>;
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
