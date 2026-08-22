export type {
  ClipboardGateway,
  ExternalNavigationGateway,
  FileGateway,
  PlatformGateway,
  PreferenceStore,
  SaveFileResult,
} from "./PlatformGateway";
export { createPlatformGateway } from "./createPlatformGateway";
export { saveBlob, saveTextFile } from "./fileSave";
export {
  configureQuiltorClient,
  createQuiltorClient,
  quiltorClient,
  type QuiltorClient,
} from "./QuiltorClient";
export type {
  ApplicationGateway,
  AssistantGateway,
  AssistantBatchRequest,
  BackupGateway,
  BackupLoginStart,
  BackupLoginStatus,
  DocumentsGateway,
  GrammarStatus,
  HistoryGateway,
  IdentityGateway,
  IdentityLogoutResult,
  ManuscriptGateway,
  MetadataGateway,
  StoryWorldGateway,
  WorldsGateway,
  WritingAssistanceGateway,
  WritingAssistanceLookupMode,
  WritingAssistanceLookupResult,
  WritingAssistanceStatus,
} from "./application";
export { ApplicationGatewayError, applicationErrorMessage } from "./application";
