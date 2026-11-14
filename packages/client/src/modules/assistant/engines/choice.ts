import type { ClientEngineSlots } from "./registry";
import type { AssistantEngineKind } from "./types";

// Not a secret: which engine the user picked. A provider key never goes here (T-61 part 8a / T-264).
const ENGINE_PREFERENCE_KEY = "quiltor-assistant-engine";

type Preferences = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

const KINDS: readonly AssistantEngineKind[] = ["server", "webllm", "cloud"];

export type EngineOffer = {
  /** May this session use the server's model (capabilities `user.serverAi`). */
  serverAi: boolean;
  /** May jobs run on a browser engine here (capabilities `instance.clientAi`). */
  clientAi: boolean;
  /** Does this browser have WebGPU, which the in-browser engine needs. */
  webgpu: boolean;
  /**
   * Does the server's model run on the author's own computer (capabilities
   * `instance.assistantInstall`: she installs it herself). Then it is the only engine.
   */
  ownComputer: boolean;
  slots: ClientEngineSlots;
};

/**
 * The engines this user can pick right now, in display order (D-205, T-275 Nachtrag 3).
 *
 * On a computer of one's own the model already runs there: it is the only engine, and a
 * browser engine would add nothing. On a hosted server the browser engine is always offered,
 * so a text need not go to the server; the server AI joins it with the premium role.
 */
export function availableEngines(offer: EngineOffer): AssistantEngineKind[] {
  if (offer.ownComputer) return ["server"];
  const engines: AssistantEngineKind[] = offer.serverAi ? ["server"] : [];
  if (offer.clientAi && offer.webgpu && offer.slots.webllm) engines.push("webllm");
  if (offer.clientAi && offer.slots.cloud) engines.push("cloud");
  return engines;
}

export function readEngineChoice(preferences: Preferences): AssistantEngineKind | null {
  const stored = preferences.get(ENGINE_PREFERENCE_KEY);
  return KINDS.find((kind) => kind === stored) ?? null;
}

export function writeEngineChoice(preferences: Preferences, kind: AssistantEngineKind): void {
  preferences.set(ENGINE_PREFERENCE_KEY, kind);
}

/** The stored choice while it is still on offer, else the first engine offered, else the server. */
export function effectiveEngine(
  stored: AssistantEngineKind | null,
  available: readonly AssistantEngineKind[],
): AssistantEngineKind {
  if (stored && available.includes(stored)) return stored;
  return available[0] ?? "server";
}
