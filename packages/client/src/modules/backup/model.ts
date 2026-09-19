import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import type { StoryboardState } from "../storyboard";

export interface BackupStatus {
  ok: true;
  endpoint?: string | null;
  changes: string[];
  changeCount: number;
  suggestedMessage: string;
  lastSuccessfulTransfer: string | null;
  transferredSnapshotId: string | null;
}

export interface BackupStorageLocation {
  databasePath: string;
  backupDirectory: string;
  lastSuccessfulBackup: string | null;
  scope: "application-host";
  canOpenFolder: false;
}

export interface BackupPreviewDocuments {
  manuscript: Manuscript;
  figures: FigureState;
  storyboards: StoryboardState;
}
