import type { ApplicationGateway } from "../application";
import type { PlatformGateway } from "../PlatformGateway";
import { createAssistantHttpGateway } from "./assistant";
import { createBackupHttpGateway } from "./backup";
import {
  createDocumentsHttpGateway,
  createManuscriptHttpGateway,
  createStoryboardsHttpGateway,
  createStoryWorldHttpGateway,
} from "./documents";
import { createHistoryHttpGateway } from "./history";
import { createIdentityHttpGateway } from "./identity";
import { createMetadataHttpGateway } from "./metadata";
import { createManuscriptImportHttpGateway } from "./manuscriptImport";
import { createPlaceMapsHttpGateway } from "./placeMaps";
import { createProjectTransferHttpGateway } from "./projectTransfer";
import { createSynchronizationHttpGateway } from "./synchronization";
import { createHttpApplicationState } from "./request";
import { createWorldsHttpGateway } from "./worlds";
import { createWritingAssistanceHttpGateway } from "./writingAssistance";

/** Executable hosts compose this adapter; every port implementation remains independently owned. */
export function createHttpApplicationGateway(platform: PlatformGateway): ApplicationGateway {
  const state = createHttpApplicationState();
  return {
    metadata: createMetadataHttpGateway(),
    worlds: createWorldsHttpGateway(state),
    identity: createIdentityHttpGateway(),
    storyWorld: createStoryWorldHttpGateway(state),
    storyboards: createStoryboardsHttpGateway(state),
    manuscript: createManuscriptHttpGateway(state),
    manuscriptImport: createManuscriptImportHttpGateway(),
    backup: createBackupHttpGateway(state),
    history: createHistoryHttpGateway(state),
    assistant: createAssistantHttpGateway(state),
    writingAssistance: createWritingAssistanceHttpGateway(),
    documents: createDocumentsHttpGateway(state, platform),
    placeMaps: createPlaceMapsHttpGateway(state),
    projectTransfer: createProjectTransferHttpGateway(),
    synchronization: createSynchronizationHttpGateway(state),
  };
}
