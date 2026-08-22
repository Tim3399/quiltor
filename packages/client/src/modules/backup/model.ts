export interface BackupStatus {
  ok: true;
  endpoint?: string | null;
  changes: string[];
  changeCount: number;
  suggestedMessage: string;
}
