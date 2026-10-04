import type { AssistantGateway } from "./assistant";
import type { BackupGateway } from "./backup";
import type { DocumentsGateway } from "./documents";
import type { HistoryGateway } from "./history";
import type { IdentityGateway } from "./identity";
import type { ManuscriptGateway } from "./manuscript";
import type { ManuscriptImportGateway } from "./manuscriptImport";
import type { MetadataGateway } from "./metadata";
import type { PlaceMapsGateway } from "./placeMaps";
import type { ProjectTransferGateway } from "./projectTransfer";
import type { StoryboardsGateway } from "./storyboards";
import type { StoryWorldGateway } from "./storyWorld";
import type { SynchronizationGateway } from "./synchronization";
import type { WorldsGateway } from "./worlds";
import type { WritingAssistanceGateway } from "./writingAssistance";

/** Small composition root over independently replaceable product ports. */
export interface ApplicationGateway {
  readonly metadata: MetadataGateway;
  readonly worlds: WorldsGateway;
  readonly identity: IdentityGateway;
  readonly storyWorld: StoryWorldGateway;
  readonly storyboards: StoryboardsGateway;
  readonly manuscript: ManuscriptGateway;
  readonly manuscriptImport: ManuscriptImportGateway;
  readonly backup: BackupGateway;
  readonly history: HistoryGateway;
  readonly assistant: AssistantGateway;
  readonly writingAssistance: WritingAssistanceGateway;
  readonly documents: DocumentsGateway;
  readonly placeMaps: PlaceMapsGateway;
  readonly projectTransfer: ProjectTransferGateway;
  readonly synchronization: SynchronizationGateway;
}

export type { AssistantBatchRequest, AssistantGateway } from "./assistant";
export type { BackupGateway, BackupLoginStart, BackupLoginStatus } from "./backup";
export type {
  DocumentsGateway,
  ManuscriptDocxPreset,
  ManuscriptDocxPreview,
  ManuscriptDocxWarningCode,
  ManuscriptEpubPreview,
  ManuscriptExportPreset,
  ManuscriptExportPreview,
  ManuscriptExportWarningCode,
} from "./documents";
export { ApplicationGatewayError, applicationErrorMessage } from "./errors";
export type { ChapterComparisonResult, HistoryGateway, SnapshotChapterRecord } from "./history";
export type { IdentityGateway, IdentityLogoutResult } from "./identity";
export type { ManuscriptGateway } from "./manuscript";
export {
  MANUSCRIPT_IMPORT_MAX_BYTES,
  type ManuscriptImportChapter,
  type ManuscriptImportFormat,
  type ManuscriptImportGateway,
  type ManuscriptImportMark,
  type ManuscriptImportPreview,
  type ManuscriptImportRequest,
  type ManuscriptImportSelection,
  type ManuscriptImportSource,
  type ManuscriptImportUnit,
  type ManuscriptImportWarningCode,
} from "./manuscriptImport";
export type { MetadataGateway } from "./metadata";
export type { PlaceMapsGateway, StoredMapImage } from "./placeMaps";
export type {
  ProjectTransferCounts,
  ProjectTransferGateway,
  ProjectTransferPreview,
} from "./projectTransfer";
export type { StoryboardsGateway } from "./storyboards";
export type { StoryWorldGateway } from "./storyWorld";
export type {
  CloudSyncAction,
  CloudSyncPreview,
  CloudSyncState,
  CloudSyncStatus,
  SynchronizationGateway,
} from "./synchronization";
export type { VersionedDocument, VersionedDocumentGateway } from "./versionedDocument";
export type { WorldsGateway } from "./worlds";
export type {
  GrammarStatus,
  WritingAssistanceGateway,
  WritingAssistanceLookupMode,
  WritingAssistanceLookupResult,
  WritingAssistanceStatus,
} from "./writingAssistance";
