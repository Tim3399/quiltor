import type {
  BackupPreviewDocuments,
  BackupStatus,
  BackupStorageLocation,
} from "../../modules/backup";

export type BackupLoginStatus = {
  ok: true;
  configured: boolean;
  hosted: boolean;
  endpoint: string;
  signedIn: boolean;
  account?: string;
  email?: string;
  name?: string;
  issuer?: string;
  scope?: string;
  issuerReachable?: boolean | null;
};

export type BackupLoginStart = {
  ok: true;
  endpoint?: string;
  authorizeUrl: string;
  redirectUri: string;
};

export interface BackupGateway {
  status(): Promise<BackupStatus>;
  saveSnapshot(
    message: string,
    upload: boolean,
  ): Promise<{
    ok: true;
    log: string[];
    status: BackupStatus;
    warnings?: Array<"backup.transfer_status_failed">;
  }>;
  loginStatus(): Promise<BackupLoginStatus>;
  beginLogin(): Promise<BackupLoginStart>;
  signOut(): Promise<{ ok: true; signedIn: false }>;
  list(): Promise<{
    ok: true;
    backups: Array<{ name: string; created: string; size: number }>;
  }>;
  location(): Promise<{ ok: true; storage: BackupStorageLocation }>;
  preview(name: string): Promise<{ ok: true; documents: BackupPreviewDocuments }>;
  restore(name: string): Promise<{ ok: true; warnings?: Array<"backup.mirror_failed"> }>;
}
