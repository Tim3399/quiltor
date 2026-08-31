import type { ApplicationGateway } from "../application";
import type { PlatformGateway } from "../PlatformGateway";
import { createAssistantHttpGateway } from "./assistant";
import { createBackupHttpGateway } from "./backup";
import {
  createDocumentsHttpGateway,
  createManuscriptHttpGateway,
  createStoryWorldHttpGateway,
  createStoryboardsHttpGateway,
} from "./documents";
import { createHistoryHttpGateway } from "./history";
import { createIdentityHttpGateway } from "./identity";
import { createMetadataHttpGateway } from "./metadata";
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
    backup: createBackupHttpGateway(state),
    history: createHistoryHttpGateway(state),
    assistant: createAssistantHttpGateway(state),
    writingAssistance: createWritingAssistanceHttpGateway(),
    documents: createDocumentsHttpGateway(state, platform),
  };
}
