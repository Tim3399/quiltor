import { useCallback, useEffect, useMemo, useState } from "react";
import { quiltorClient } from "../../../platform";
import { useInstanceCapabilities, useUserCapabilities } from "../../../shared/capabilities";
import { availableEngines, effectiveEngine, readEngineChoice, writeEngineChoice } from "./choice";
import { type ClientEngineSlot, type ClientEngineSlots, clientEngineSlots } from "./registry";
import type { AssistantEngineKind } from "./types";
import { browserWebGpu } from "./webllm/webgpu";

export type EngineChoice = {
  /** The engines this user can pick, in display order. */
  available: AssistantEngineKind[];
  /** The engine a new job runs on. */
  engine: AssistantEngineKind;
  /** The browser engine's slot when one is chosen, else null. */
  slot: ClientEngineSlot | null;
  /**
   * A hosted server offers the in-browser engine, but this browser has no hardware WebGPU for
   * it (Safari, Firefox, an older device). False while the probe has not answered yet.
   */
  browserUnsupported: boolean;
  /**
   * She chose the browser engine, this browser cannot run it, and the choice stays: nothing is
   * sent, and only she can switch to the server AI.
   */
  blocked: boolean;
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
  const ownComputer = instance?.assistantInstall === true;
  const preferences = quiltorClient.platform.preferences;
  const [stored, setStored] = useState(() => readEngineChoice(preferences));
  // A hardware adapter, asked once per page: "gpu" in navigator also holds for a software one.
  // null until the probe answers, so no note about a missing WebGPU flashes up meanwhile.
  const [webgpu, setWebgpu] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    void browserWebGpu().then((value) => current && setWebgpu(value));
    return () => {
      current = false;
    };
  }, []);
  const available = useMemo(
    () => availableEngines({ serverAi, clientAi, webgpu: webgpu === true, ownComputer, slots }),
    [serverAi, clientAi, webgpu, ownComputer, slots],
  );
  const browserUnsupported = !ownComputer && clientAi && Boolean(slots.webllm) && webgpu === false;
  // Only an explicitly stored choice is kept, and only where the server AI would be the silent
  // fallback; without the premium role nothing would move to the server anyway. It is kept
  // until it is known that the browser engine can run: while the capabilities are not loaded
  // (or the whoami fallback stood in for them and says nothing about `clientAi`) and while the
  // WebGPU probe has not answered, a missing engine is no reason to send her text to the
  // server (D-T-275-F5). A computer of one's own is the one case where the server is the only
  // engine, and the capabilities say so as soon as they are there.
  const unknown = !ownComputer && (instance === null || instance.clientAi === undefined);
  const unsupported = clientAi && Boolean(slots.webllm) && webgpu !== true;
  const kept =
    serverAi && stored === "webllm" && !ownComputer && (unknown || unsupported) ? "webllm" : null;
  const engine = effectiveEngine(stored, available, kept);
  const choose = useCallback(
    (kind: AssistantEngineKind) => {
      writeEngineChoice(preferences, kind);
      setStored(kind);
    },
    [preferences],
  );
  const slot = engine === "server" ? null : (slots[engine] ?? null);
  const current = useCallback(() => {
    const now = effectiveEngine(readEngineChoice(preferences), available, kept);
    return { engine: now, slot: now === "server" ? null : (slots[now] ?? null) };
  }, [available, kept, preferences, slots]);
  const blocked = kept !== null && engine === kept;
  return { available, engine, slot, browserUnsupported, blocked, choose, current };
}
