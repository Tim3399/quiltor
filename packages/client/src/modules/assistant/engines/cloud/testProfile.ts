import { quiltorClient } from "../../../../platform";
import type { ClientEngineSlot } from "../registry";
import { type CloudProfile, createCloudExecutor } from "./cloudExecutor";

// No secret: nothing real listens on the test profile's origin. No key entry before T-264.
const TEST_PROFILE: CloudProfile = {
  id: "test",
  key: "quiltor-test-profile",
  contextErrorCode: "context_length_exceeded",
};

/**
 * The cloud slot of the test profile, registered only when the server reports
 * instance.testHooks. It names "openai" as its provider: the server takes only the providers
 * of CLOUD_PROVIDERS, and that list gets no test value.
 */
export const TEST_PROFILE_SLOT: ClientEngineSlot = {
  // Looked up per call, so the slot never holds a gateway from before the client was set up.
  executor: createCloudExecutor(TEST_PROFILE, {
    callProvider: (profile, call) =>
      quiltorClient.application.assistant.callProvider(profile, call),
  }),
  wire: () => ({ kind: "cloud", provider: "openai" }),
};
