import { describe, expect, it, vi } from "vitest";
import { createModelStore } from "./modelStore";
import { probeWebGpu } from "./webgpu";
import { createWebllmExecutor, webllmRequest } from "./webllmExecutor";
import { CONTEXT_WINDOW_SIZE, createWebllmRuntime, MODEL_ID } from "./webllmRuntime";
import type { WebllmCompletion, WebllmEngine, WebllmPackage, WebllmRuntime } from "./webllmTypes";

const SCHEMA = { type: "object", properties: { step: { type: "object" } }, required: ["step"] };
const PAYLOAD = {
  model: "server-model",
  messages: [{ role: "user", content: "Wo wohnt Ada?" }],
  temperature: 0.2,
  max_tokens: 512,
  response_format: { type: "json_schema", json_schema: { name: "s", schema: SCHEMA } },
};

function engineAnswering(
  answer: WebllmCompletion | (() => Promise<WebllmCompletion>),
): WebllmEngine {
  return {
    chat: {
      completions: {
        create: vi.fn(typeof answer === "function" ? answer : async () => answer),
      },
    },
    interruptGenerate: vi.fn(),
    unload: vi.fn(async () => {}),
  };
}

function runtimeWith(engine: WebllmEngine, cached = true): WebllmRuntime {
  return {
    load: vi.fn(async (onProgress) => {
      onProgress({ progress: 0.5, text: "half" });
      return engine;
    }),
    isCached: vi.fn(async () => cached),
    remove: vi.fn(async () => {}),
  };
}

function executorFor(engine: WebllmEngine, { cached = true, grammar = true } = {}) {
  const store = createModelStore(runtimeWith(engine, cached), { persist: async () => true });
  return createWebllmExecutor(store, { grammar });
}

function named(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("webllm runtime (T-61 part 7)", () => {
  it("loads the model in a worker with a context window of 8192", async () => {
    const engine = engineAnswering({});
    const appConfig = { model_list: [] };
    const webllm = {
      prebuiltAppConfig: appConfig,
      CreateWebWorkerMLCEngine: vi.fn(async () => engine),
      hasModelInCache: vi.fn(async () => true),
      deleteModelAllInfoInCache: vi.fn(async () => {}),
    } satisfies WebllmPackage;
    const worker = {} as Worker;
    const onProgress = vi.fn();
    await createWebllmRuntime(webllm, () => worker).load(onProgress);
    expect(CONTEXT_WINDOW_SIZE).toBe(8192);
    expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalledWith(
      worker,
      MODEL_ID,
      { appConfig, initProgressCallback: onProgress },
      { context_window_size: 8192 },
    );
  });

  it("asks the package's cache for the same model it removes", async () => {
    const appConfig = { model_list: [] };
    const webllm = {
      prebuiltAppConfig: appConfig,
      CreateWebWorkerMLCEngine: vi.fn(),
      hasModelInCache: vi.fn(async () => false),
      deleteModelAllInfoInCache: vi.fn(async () => {}),
    } satisfies WebllmPackage;
    const runtime = createWebllmRuntime(webllm, () => ({}) as Worker);
    await expect(runtime.isCached()).resolves.toBe(false);
    await runtime.remove();
    expect(webllm.hasModelInCache).toHaveBeenCalledWith(MODEL_ID, appConfig);
    expect(webllm.deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL_ID, appConfig);
  });
});

describe("webllm request", () => {
  it("sends the server's schema as a json_object grammar string with grammar", () => {
    expect(webllmRequest(PAYLOAD, true)).toEqual({
      messages: PAYLOAD.messages,
      temperature: 0.2,
      max_tokens: 512,
      stream: false,
      extra_body: { enable_thinking: false },
      response_format: { type: "json_object", schema: JSON.stringify(SCHEMA) },
    });
  });

  it("sends no response format without grammar", () => {
    expect(webllmRequest(PAYLOAD, false).response_format).toBeUndefined();
  });
});

describe("webllm executor", () => {
  it("answers with the model's text, without Qwen's empty think block", async () => {
    const engine = engineAnswering({
      choices: [
        { message: { content: '<think>\n\n</think>\n{"step":{}}' }, finish_reason: "length" },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 4 },
    });
    await expect(
      executorFor(engine).execute(PAYLOAD, new AbortController().signal),
    ).resolves.toEqual({
      content: '{"step":{}}',
      finishReason: "length",
      usage: { promptTokens: 40, completionTokens: 4 },
    });
  });

  it("maps a context overflow to context_too_large", async () => {
    const engine = engineAnswering(async () => {
      throw named("ContextWindowSizeExceededError", "9000 > 8192");
    });
    await expect(
      executorFor(engine).execute(PAYLOAD, new AbortController().signal),
    ).resolves.toEqual({
      error: { code: "context_too_large", detail: "9000 > 8192" },
    });
  });

  it("maps any other failure, a lost GPU among them, to engine_unavailable", async () => {
    const engine = engineAnswering(async () => {
      throw named("WebGPUNotAvailableError", "no WebGPU");
    });
    await expect(
      executorFor(engine).execute(PAYLOAD, new AbortController().signal),
    ).resolves.toEqual({
      error: { code: "engine_unavailable", detail: "no WebGPU" },
    });
  });

  it("never starts a download: a model not on disk is engine_unavailable", async () => {
    const engine = engineAnswering({});
    await expect(
      executorFor(engine, { cached: false }).execute(PAYLOAD, new AbortController().signal),
    ).resolves.toEqual({ error: { code: "engine_unavailable", detail: "model not loaded" } });
    expect(engine.chat.completions.create).not.toHaveBeenCalled();
  });

  it("stops the generation on abort and rejects", async () => {
    const controller = new AbortController();
    let finish: (value: WebllmCompletion) => void = () => {};
    const engine = engineAnswering(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = executorFor(engine).execute(PAYLOAD, controller.signal);
    await vi.waitFor(() => expect(engine.chat.completions.create).toHaveBeenCalled());
    controller.abort();
    expect(engine.interruptGenerate).toHaveBeenCalled();
    finish({ choices: [{ message: { content: "{}" } }] });
    await expect(pending).rejects.toThrow();
  });
});

describe("webllm model store", () => {
  it("asks for persistent storage and reports progress until ready", async () => {
    const engine = engineAnswering({});
    const runtime = runtimeWith(engine, false);
    const persist = vi.fn(async () => true);
    const store = createModelStore(runtime, { persist });
    const phases: string[] = [];
    store.subscribe(() => phases.push(store.getState().phase));
    await store.refresh();
    expect(store.getState()).toEqual({ phase: "absent" });
    await store.download();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["absent", "downloading", "downloading", "ready"]);
  });

  it("removes the model: unloads the engine and deletes it from the cache", async () => {
    const engine = engineAnswering({});
    const runtime = runtimeWith(engine);
    const store = createModelStore(runtime, {});
    await store.download();
    await store.remove();
    expect(engine.unload).toHaveBeenCalled();
    expect(runtime.remove).toHaveBeenCalled();
    expect(store.getState()).toEqual({ phase: "absent" });
  });
});

describe("webgpu probe", () => {
  const gpu = (adapter: unknown) => ({ requestAdapter: async () => adapter as never });

  it("accepts a hardware adapter", async () => {
    await expect(
      probeWebGpu(gpu({ info: { vendor: "nvidia", architecture: "ampere" } })),
    ).resolves.toBe(true);
  });

  it.each([
    ["no WebGPU", undefined],
    ["no adapter", gpu(null)],
    ["a fallback adapter", gpu({ info: { vendor: "x", isFallbackAdapter: true } })],
    ["SwiftShader", gpu({ info: { vendor: "google", architecture: "swiftshader" } })],
    ["WARP", gpu({ info: { description: "Microsoft Basic Render Driver" } })],
    ["llvmpipe", gpu({ info: { description: "llvmpipe (LLVM 17)" } })],
  ])("refuses %s", async (_name, value) => {
    await expect(probeWebGpu(value)).resolves.toBe(false);
  });
});
