import type { WebllmPackage, WebllmRuntime } from "./webllmTypes";

/** The model T-54 measured (D-42): Qwen3-4B, 4-bit, about 2.5 GB. */
export const MODEL_ID = "Qwen3-4B-q4f16_1-MLC";

/**
 * The context the server plans its prompts for (CLIENT_CONTEXT_TOKENS). WebLLM's own default
 * for this model is smaller, so without it every planning prompt would be too large.
 */
export const CONTEXT_WINDOW_SIZE = 8192;

/**
 * The runtime of one model on the package: loaded in a web worker so inference never blocks
 * the page, from the package's own model catalog.
 */
export function createWebllmRuntime(
  webllm: WebllmPackage,
  createWorker: () => Worker,
): WebllmRuntime {
  const appConfig = webllm.prebuiltAppConfig;
  return {
    load: (onProgress) =>
      webllm.CreateWebWorkerMLCEngine(
        createWorker(),
        MODEL_ID,
        { appConfig, initProgressCallback: onProgress },
        { context_window_size: CONTEXT_WINDOW_SIZE },
      ),
    isCached: () => webllm.hasModelInCache(MODEL_ID, appConfig),
    remove: () => webllm.deleteModelAllInfoInCache(MODEL_ID, appConfig),
  };
}
