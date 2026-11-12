import { useCallback, useMemo, useState } from "react";
import { quiltorClient } from "../../../platform";
import { useInstanceCapabilities, useUserCapabilities } from "../../../shared/capabilities";
import {
  availableEngines,
  browserHasWebGpu,
  effectiveEngine,
  readEngineChoice,
  writeEngineChoice,
} from "./choice";
import { type ClientEngineSlot, type ClientEngineSlots, clientEngineSlots } from "./registry";
import type { AssistantEngineKind } from "./types";

export type EngineChoice = {
  /** The engines this user can pick, in display order. */
  available: AssistantEngineKind[];
  /** The engine a new job runs on. */
  engine: AssistantEngineKind;
  /** The browser engine's slot when one is chosen, else null. */
  slot: ClientEngineSlot | null;
  choose(kind: AssistantEngineKind): void;
  /** The engine and slot as stored right now; for code that runs outside a render. */
  current(): { engine: AssistantEngineKind; slot: ClientEngineSlot | null };
};

/**
 * The engine choice of the status view. `serverAiFallback` is what the assistant status says
 * when the capabilities do not (an older server). `override` is for tests; the app uses the
 * registry the engine parts fill, as far as the instance's capabilities allow.
 */
export function useEngineChoice(
  serverAiFallback = true,
  override?: ClientEngineSlots,
): EngineChoice {
  const instance = useInstanceCapabilities();
  const slots = override ?? clientEngineSlots(instance);
  const serverAi = useUserCapabilities().serverAi ?? serverAiFallback;
  const clientAi = instance?.clientAi === true;
  const preferences = quiltorClient.platform.preferences;
  const [stored, setStored] = useState(() => readEngineChoice(preferences));
  const available = useMemo(
    () => availableEngines({ serverAi, clientAi, webgpu: browserHasWebGpu(), slots }),
    [serverAi, clientAi, slots],
  );
  const engine = effectiveEngine(stored, available);
  const choose = useCallback(
    (kind: AssistantEngineKind) => {
      writeEngineChoice(preferences, kind);
      setStored(kind);
    },
    [preferences],
  );
  const slot = engine === "server" ? null : (slots[engine] ?? null);
  const current = useCallback(() => {
    const now = effectiveEngine(readEngineChoice(preferences), available);
    return { engine: now, slot: now === "server" ? null : (slots[now] ?? null) };
  }, [available, preferences, slots]);
  return { available, engine, slot, choose, current };
}
