import type { AssistantGateway } from "./assistant";
import type { BackupGateway } from "./backup";
import type { DocumentsGateway } from "./documents";
import type { HistoryGateway } from "./history";
import type { IdentityGateway } from "./identity";
import type { ManuscriptGateway } from "./manuscript";
import type { MetadataGateway } from "./metadata";
import type { StoryWorldGateway } from "./storyWorld";
import type { StoryboardsGateway } from "./storyboards";
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
  readonly backup: BackupGateway;
  readonly history: HistoryGateway;
  readonly assistant: AssistantGateway;
  readonly writingAssistance: WritingAssistanceGateway;
  readonly documents: DocumentsGateway;
}

export type { AssistantBatchRequest, AssistantGateway } from "./assistant";
export type { BackupGateway, BackupLoginStart, BackupLoginStatus } from "./backup";
export type { DocumentsGateway } from "./documents";
export { ApplicationGatewayError, applicationErrorMessage } from "./errors";
export type { HistoryGateway } from "./history";
export type { IdentityGateway, IdentityLogoutResult } from "./identity";
export type { ManuscriptGateway } from "./manuscript";
export type { MetadataGateway } from "./metadata";
export type { StoryWorldGateway } from "./storyWorld";
export type { StoryboardsGateway } from "./storyboards";
export type { WorldsGateway } from "./worlds";
export type {
  GrammarStatus,
  WritingAssistanceGateway,
  WritingAssistanceLookupMode,
  WritingAssistanceLookupResult,
  WritingAssistanceStatus,
} from "./writingAssistance";
