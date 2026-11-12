import type { AssistantProviderGateway, ProviderProfileId } from "../../../../platform";
import type { ClientEngineExecutor, ClientEngineResult } from "../types";

/**
 * A provider the cloud executor talks to: an OpenAI-compatible chat completions endpoint,
 * named by its profile id. Where it lives only the transport knows (platform/http/providerCall).
 * T-61 part 8a ships exactly one, the test profile; the real profiles and dialects are T-264.
 */
export type CloudProfile = {
  id: ProviderProfileId;
  key: string;
  /** The `error.code` of a 400 that means the request does not fit the model's context. */
  contextErrorCode: string;
};

type Completion = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { code?: unknown };
};

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The error a failed provider answer maps to, the same for every profile. */
function failure(
  status: number,
  body: Completion | null,
  profile: CloudProfile,
): ClientEngineResult {
  if (status >= 500) return { error: { code: "engine_unavailable", status } };
  if (status === 400 && body?.error?.code === profile.contextErrorCode) {
    return { error: { code: "context_too_large", status } };
  }
  return { error: { code: "provider_error", status } };
}

/**
 * Sends the server's request body unchanged to the profile and reads the first choice.
 * An abort through `signal` rejects: the relay loop sees the abort and answers `cancelled`
 * itself, so nothing is reported to the provider.
 */
export function createCloudExecutor(
  profile: CloudProfile,
  transport: AssistantProviderGateway,
): ClientEngineExecutor {
  return {
    async execute(payload, signal) {
      const answer = await transport.callProvider(profile.id, {
        key: profile.key,
        body: JSON.stringify(payload),
        signal,
      });
      if (answer.kind === "network") {
        return { error: { code: "engine_unavailable", detail: "network" } };
      }
      const { status } = answer;
      const body =
        typeof answer.body === "object" && answer.body !== null
          ? (answer.body as Completion)
          : null;
      if (status < 200 || status >= 300) return failure(status, body, profile);
      const choice = body?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== "string") {
        return { error: { code: "provider_error", status, detail: "no content" } };
      }
      const usage = {
        promptTokens: count(body?.usage?.prompt_tokens),
        completionTokens: count(body?.usage?.completion_tokens),
      };
      return {
        content,
        finishReason: choice?.finish_reason === "length" ? "length" : "stop",
        ...(usage.promptTokens !== undefined || usage.completionTokens !== undefined
          ? { usage }
          : {}),
      };
    },
  };
}
