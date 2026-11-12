import type { ComponentType } from "react";
import { TEST_PROFILE_SLOT } from "./cloud/testProfile";
import type { AssistantEngineWire, ClientEngineExecutor, ClientEngineKind } from "./types";

/**
 * One browser engine as the assistant drawer offers it: the executor that answers relay
 * tickets, what a job names as its engine, and the panel shown in the status view while the
 * engine is chosen (key entry, model download, ...).
 */
export type ClientEngineSlot = {
  executor: ClientEngineExecutor;
  wire(): AssistantEngineWire;
  Panel?: ComponentType;
};

export type ClientEngineSlots = Partial<Record<ClientEngineKind, ClientEngineSlot>>;

// Filled one engine at a time: the cloud executor's test profile in T-61 part 8a, WebLLM in
// part 7, the real cloud profiles in T-264. An engine without a slot is not offered, so a user
// sees no cloud option before T-264. Constants, so a render gets the same object each time.
const NO_SLOTS: ClientEngineSlots = {};
const TEST_HOOK_SLOTS: ClientEngineSlots = { cloud: TEST_PROFILE_SLOT };

/** The browser engines this server lets the client offer (capabilities `instance`). */
export function clientEngineSlots(instance: { testHooks?: boolean } | null): ClientEngineSlots {
  return instance?.testHooks === true ? TEST_HOOK_SLOTS : NO_SLOTS;
}
