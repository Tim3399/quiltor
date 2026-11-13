import type { ClientEngineSlot } from "../registry";
import { createModelStore } from "./modelStore";
import { createWebllmExecutor } from "./webllmExecutor";
import { createWebllmRuntime } from "./webllmRuntime";
import type { WebllmPackage, WebllmRuntime } from "./webllmTypes";
import { createWebllmPanel } from "./WebllmPanel";

// The package is loaded on first use: it is large, and most users never pick this engine.
let runtime: Promise<WebllmRuntime> | null = null;
function loaded(): Promise<WebllmRuntime> {
  runtime ??= import("@mlc-ai/web-llm").then((webllm) =>
    createWebllmRuntime(
      webllm as unknown as WebllmPackage,
      () => new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" }),
    ),
  );
  return runtime;
}

const store = createModelStore({
  load: async (onProgress) => (await loaded()).load(onProgress),
  isCached: async () => (await loaded()).isCached(),
  remove: async () => (await loaded()).remove(),
});

/** The in-browser engine, registered when the server reports instance.clientAi. */
export const WEBLLM_SLOT: ClientEngineSlot = {
  executor: createWebllmExecutor(store, { grammar: true }),
  wire: () => ({ kind: "webllm", grammar: true }),
  Panel: createWebllmPanel(store),
};
