import type { ComponentType } from "react";
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

// Filled one engine at a time: the cloud executor in T-61 part 8, WebLLM in part 7. An engine
// without a slot is not offered, so this part changes nothing a user sees.
const SLOTS: ClientEngineSlots = {};

export function clientEngineSlots(): ClientEngineSlots {
  return SLOTS;
}
