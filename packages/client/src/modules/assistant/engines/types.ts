// The engines an assistant job can run on, and the contract a browser engine fulfils (T-61).
//
// A client engine never sees the server's prompt logic: it gets the unchanged request body the
// server would have sent to its own model, and answers with the model's text or an error code.

/** The engine kinds the server accepts (src/quiltor/modules/assistant/engines.py). */
export type AssistantEngineKind = "server" | "webllm" | "cloud";

export type ClientEngineKind = Exclude<AssistantEngineKind, "server">;

/** What a job names on POST /api/assistant/jobs. Absent means the server's own model. */
export type AssistantEngineWire = {
  kind: ClientEngineKind;
  provider?: string;
  grammar?: boolean;
};

/** The error codes the relay accepts from a browser (CLIENT_ERROR_CODES on the server). */
type ClientEngineErrorCode =
  | "context_too_large"
  | "engine_unavailable"
  | "provider_error"
  | "cancelled";

type ClientEngineOutput = {
  content: string;
  finishReason: "stop" | "length";
  usage?: { promptTokens?: number; completionTokens?: number };
};

type ClientEngineError = {
  error: { code: ClientEngineErrorCode; status?: number; detail?: string };
};

export type ClientEngineResult = ClientEngineOutput | ClientEngineError;

/** One browser engine. `payload` is the server's request body, unchanged. */
export interface ClientEngineExecutor {
  execute(payload: Record<string, unknown>, signal: AbortSignal): Promise<ClientEngineResult>;
}
