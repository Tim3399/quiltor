// The part of @mlc-ai/web-llm 0.2.86 the in-browser engine uses (T-61 part 7). Declared here so
// the executor, the model store and their tests depend on this shape, not on the package: the
// only file that imports the package is the one that builds the real engine (webllmSlot.ts).

type WebllmProgress = { progress: number; text: string };

export type WebllmCompletionRequest = {
  messages: unknown[];
  temperature?: number;
  max_tokens?: number;
  stream: false;
  response_format?: { type: "json_object"; schema: string };
  extra_body?: { enable_thinking: boolean };
};

export type WebllmCompletion = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** A loaded engine: an MLCEngine, or its web worker proxy. */
export interface WebllmEngine {
  chat: { completions: { create(request: WebllmCompletionRequest): Promise<WebllmCompletion> } };
  interruptGenerate(): void;
  unload(): Promise<void>;
}

/** What the model store needs from the package for one model. */
export interface WebllmRuntime {
  /** Loads the model, downloading what the browser cache lacks. */
  load(onProgress: (progress: WebllmProgress) => void): Promise<WebllmEngine>;
  isCached(): Promise<boolean>;
  remove(): Promise<void>;
}

type WebllmAppConfig = {
  model_list: Array<{ model_id: string; model: string; model_lib: string }>;
};

/** The package's entry points the runtime calls (`import("@mlc-ai/web-llm")`). */
export interface WebllmPackage {
  prebuiltAppConfig: WebllmAppConfig;
  CreateWebWorkerMLCEngine(
    worker: Worker,
    modelId: string,
    engineConfig: {
      appConfig: WebllmAppConfig;
      initProgressCallback: (progress: WebllmProgress) => void;
    },
    chatOptions: { context_window_size: number },
  ): Promise<WebllmEngine>;
  hasModelInCache(modelId: string, appConfig: WebllmAppConfig): Promise<boolean>;
  deleteModelAllInfoInCache(modelId: string, appConfig: WebllmAppConfig): Promise<void>;
}
