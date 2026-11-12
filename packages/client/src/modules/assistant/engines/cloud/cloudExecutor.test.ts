import { describe, expect, it, vi } from "vitest";
import type { AssistantProviderGateway, ProviderAnswer } from "../../../../platform";
import { createCloudExecutor } from "./cloudExecutor";

const PROFILE = {
  id: "test" as const,
  key: "test-key",
  contextErrorCode: "context_length_exceeded",
};
const PAYLOAD = { model: "m", messages: [{ role: "user", content: "Wer ist Ada?" }] };

function transport(answer: ProviderAnswer) {
  return { callProvider: vi.fn(async () => answer) } satisfies AssistantProviderGateway;
}

function run(gateway: AssistantProviderGateway, signal = new AbortController().signal) {
  return createCloudExecutor(PROFILE, gateway).execute(PAYLOAD, signal);
}

function status(code: number, body: unknown = { error: { code: "x" } }): ProviderAnswer {
  return { kind: "answer", status: code, body };
}

describe("cloud executor (T-61 part 8a)", () => {
  it("sends the payload unchanged to its profile and reads the first choice", async () => {
    const gateway = transport(
      status(200, {
        choices: [{ message: { content: '{"message":"Ada."}' }, finish_reason: "length" }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    await expect(run(gateway)).resolves.toEqual({
      content: '{"message":"Ada."}',
      finishReason: "length",
      usage: { promptTokens: 12, completionTokens: 3 },
    });
    const [profile, call] = gateway.callProvider.mock.calls[0] as unknown as [
      string,
      { key: string; body: string },
    ];
    expect(profile).toBe("test");
    expect(call.key).toBe("test-key");
    expect(JSON.parse(call.body)).toEqual(PAYLOAD);
  });

  it.each([
    [401, { code: "provider_error", status: 401 }],
    [403, { code: "provider_error", status: 403 }],
    [429, { code: "provider_error", status: 429 }],
    [500, { code: "engine_unavailable", status: 500 }],
    [503, { code: "engine_unavailable", status: 503 }],
  ])("maps status %i", async (code, error) => {
    await expect(run(transport(status(code)))).resolves.toEqual({ error });
  });

  it("maps a 400 with the profile's context code to context_too_large", async () => {
    await expect(
      run(transport(status(400, { error: { code: "context_length_exceeded" } }))),
    ).resolves.toEqual({ error: { code: "context_too_large", status: 400 } });
  });

  it("keeps any other 400 a provider error", async () => {
    await expect(
      run(transport(status(400, { error: { code: "invalid_request" } }))),
    ).resolves.toEqual({ error: { code: "provider_error", status: 400 } });
  });

  it("maps a network or CORS failure to engine_unavailable", async () => {
    await expect(run(transport({ kind: "network" }))).resolves.toEqual({
      error: { code: "engine_unavailable", detail: "network" },
    });
  });

  it("rejects on abort instead of reporting an error", async () => {
    const controller = new AbortController();
    const gateway: AssistantProviderGateway = {
      callProvider: (_profile, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    };
    const pending = run(gateway, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("Aborted");
  });
});
