import type { BackupStatus } from "../../modules/backup";

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
  ): Promise<{ ok: true; log: string[]; status: BackupStatus }>;
  loginStatus(): Promise<BackupLoginStatus>;
  beginLogin(): Promise<BackupLoginStart>;
  signOut(): Promise<{ ok: true; signedIn: false }>;
  list(): Promise<{
    ok: true;
    backups: Array<{ name: string; created: string; size: number }>;
  }>;
  restore(name: string): Promise<{ ok: true }>;
}
