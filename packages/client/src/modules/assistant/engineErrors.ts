import type { MessageKey, Translate } from "../../i18n";
import { ApplicationGatewayError, applicationErrorMessage } from "../../platform";
import type { AssistantEngineError } from "./model";

// The codes a job on the user's own engine fails with (CLIENT_FAILURE_CODES on the server).
// Each has its own words; the browser's detail goes to the console, never into the
// conversation (D-T-61-30).
const MESSAGES: Readonly<Record<string, MessageKey>> = {
  engine_unavailable: "assistantEngineErrorUnavailable",
  client_unavailable: "assistantEngineErrorClientUnavailable",
  provider_error: "assistantEngineErrorProvider",
  context_too_large: "assistantEngineErrorContextTooLarge",
  // The server's own refusal: the world state alone fills the window (T-330).
  world_too_large: "assistantEngineErrorWorldTooLarge",
  cancelled: "requestAborted",
};

// What the in-browser executor answers when no model is loaded (webllmExecutor.ts).
const MODEL_NOT_LOADED = "model not loaded";

function engineErrorOf(error: unknown): AssistantEngineError | null {
  if (!(error instanceof ApplicationGatewayError)) return null;
  const value = error.params.engineError as AssistantEngineError | undefined;
  return value && typeof value.code === "string" ? value : null;
}

/** The message for a failed assistant request, with a client engine's code put in words. */
export function assistantErrorMessage(error: unknown, t: Translate): string {
  const engineError = engineErrorOf(error);
  if (!engineError) return applicationErrorMessage(error);
  if (engineError.detail) console.warn("assistant engine:", engineError.code, engineError.detail);
  if (engineError.code === "engine_unavailable" && engineError.detail === MODEL_NOT_LOADED) {
    return t("assistantEngineErrorModelNotLoaded");
  }
  return t(MESSAGES[engineError.code] ?? "assistantEngineErrorUnknown");
}
