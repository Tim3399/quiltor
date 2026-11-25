import type { ClientEngineExecutor, ClientEngineResult } from "../types";
import type { ModelStore } from "./modelStore";
import type { WebllmCompletionRequest, WebllmEngine } from "./webllmTypes";

type ServerPayload = {
  messages?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  response_format?: { json_schema?: { schema?: unknown } };
};

// Qwen3 opens with an empty think block even with thinking off; the server parses what follows.
const THINK_BLOCK = /^\s*<think>[\s\S]*?<\/think>\s*/;

/**
 * The request for WebLLM from the server's body. WebLLM knows no `json_schema` format: with
 * `grammar` the schema the server sent goes along as a `json_object` grammar, as a string.
 * Its form is the server's (D-162); nothing here depends on it.
 */
export function webllmRequest(payload: ServerPayload, grammar: boolean): WebllmCompletionRequest {
  const request: WebllmCompletionRequest = {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    stream: false,
    extra_body: { enable_thinking: false },
  };
  if (typeof payload.temperature === "number") request.temperature = payload.temperature;
  if (typeof payload.max_tokens === "number") request.max_tokens = payload.max_tokens;
  const schema = payload.response_format?.json_schema?.schema;
  if (grammar && schema !== undefined) {
    request.response_format = { type: "json_object", schema: JSON.stringify(schema) };
  }
  return request;
}

/** Per engine, the generation the next one waits for (T-349). */
const turns = new WeakMap<object, Promise<void>>();

/** The relay's error for what WebLLM threw. */
function webllmFailure(error: unknown): ClientEngineResult {
  const name = error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : String(error);
  if (name === "ContextWindowSizeExceededError") {
    return { error: { code: "context_too_large", detail } };
  }
  return { error: { code: "engine_unavailable", detail } };
}

/**
 * Whether the engine itself is broken rather than the request (T-362). web-llm disposes a
 * pipeline and its grammar matcher when it unloads (a lost device does that on its own) but
 * keeps the engine object; every later generation on it then fails with "Cannot pass deleted
 * object as a pointer of type GrammarMatcher". The worker proxy may hand the error over with
 * its name folded into the message, so both are read.
 */
function engineBroken(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /deleted object|BindingError|ModelNotLoaded|not loaded|device (?:was )?lost/i.test(text);
}

/**
 * Answers relay tickets with the in-browser model. A model not on disk is `engine_unavailable`:
 * a job never starts a download of gigabytes, the user does that in the panel. An abort stops
 * the generation and rejects; the relay loop answers `cancelled` itself.
 */
export function createWebllmExecutor(
  store: ModelStore,
  { grammar }: { grammar: boolean },
): ClientEngineExecutor {
  return {
    async execute(payload, signal) {
      const first = await attempt(payload, signal);
      if (!("broken" in first)) return first;
      // One fresh engine per ticket: a model that fails the same way after a reload is reported,
      // not reloaded without end.
      await store.discard(first.broken);
      const second = await attempt(payload, signal);
      if (!("broken" in second)) return second;
      await store.discard(second.broken);
      return second.result;
    },
  };

  type Attempt = ClientEngineResult | { broken: WebllmEngine; result: ClientEngineResult };

  async function attempt(payload: Record<string, unknown>, signal: AbortSignal): Promise<Attempt> {
    let engine: Awaited<ReturnType<ModelStore["engine"]>>;
    try {
      engine = await store.engine();
    } catch (error) {
      return webllmFailure(error);
    }
    if (!engine) return { error: { code: "engine_unavailable", detail: "model not loaded" } };
    // One generation at a time on an engine (T-349): web-llm disposes its grammar matcher
    // when a second one starts, and the first then fails with "Cannot pass deleted object
    // as a pointer of type GrammarMatcher". An aborted generation frees the engine only once
    // it has returned, not when the abort was asked for.
    const previous = turns.get(engine) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    turns.set(
      engine,
      previous.then(() => mine),
    );
    await previous;
    try {
      return await generate(engine, payload, signal);
    } finally {
      release();
    }
  }

  async function generate(
    engine: NonNullable<Awaited<ReturnType<ModelStore["engine"]>>>,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Attempt> {
    signal.throwIfAborted();
    const stop = () => engine.interruptGenerate();
    signal.addEventListener("abort", stop, { once: true });
    try {
      const reply = await engine.chat.completions.create(webllmRequest(payload, grammar));
      signal.throwIfAborted();
      const choice = reply.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== "string") {
        return { error: { code: "engine_unavailable", detail: "no content" } };
      }
      const usage = reply.usage;
      return {
        content: content.replace(THINK_BLOCK, ""),
        finishReason: choice?.finish_reason === "length" ? "length" : "stop",
        ...(usage
          ? {
              usage: {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
              },
            }
          : {}),
      };
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      const result = webllmFailure(error);
      if (engineBroken(error)) return { broken: engine, result };
      // web-llm starts the call's grammar matcher alongside the prefill and awaits it only after
      // it. A prompt over the context window throws in the prefill and leaves that start running;
      // it later overwrites the matcher of whatever call runs by then (T-362). The engine is
      // dropped so the next call starts on a fresh one; this ticket keeps its own answer.
      if ("error" in result && result.error.code === "context_too_large") {
        await store.discard(engine);
      }
      return result;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }
}
