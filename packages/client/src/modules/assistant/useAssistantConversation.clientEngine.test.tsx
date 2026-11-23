import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translateUiMessage } from "../../i18n";
import { ApplicationGatewayError, quiltorClient, type RelayAnswerV1 } from "../../platform";
import { CapabilitiesProvider } from "../../shared/capabilities";
import type { ClientEngineResult } from "./engines/types";
import type { AssistantJobState } from "./model";
import { useAssistantConversation } from "./useAssistantConversation";

const engine = vi.hoisted(() => ({
  execute: vi.fn<(payload: unknown, signal: AbortSignal) => Promise<ClientEngineResult>>(),
}));

vi.mock("./engines/registry", () => ({
  clientEngineSlots: () => ({
    cloud: { executor: engine, wire: () => ({ kind: "cloud", provider: "openai" }) },
  }),
}));

afterEach(() => vi.restoreAllMocks());

function wrapper({ children }: { children: ReactNode }) {
  return (
    <CapabilitiesProvider
      value={{ multiUser: true, signOut: true, deviceSync: true, clientAi: true }}
      // A browser engine computes only where the server AI is not allowed (D-205).
      user={{ serverAi: false }}
    >
      {children}
    </CapabilitiesProvider>
  );
}

describe("a job on a browser engine", () => {
  it("names the engine, answers the relay, and cancel sends both cancelled and cancel", async () => {
    const stored = new Map<string, string>([["quiltor-assistant-engine", "cloud"]]);
    vi.spyOn(quiltorClient.platform.preferences, "get").mockImplementation(
      (key) => stored.get(key) ?? null,
    );
    vi.spyOn(quiltorClient.platform.preferences, "set").mockImplementation((key, value) => {
      stored.set(key, value);
    });
    const assistant = quiltorClient.application.assistant;
    const chat = vi.spyOn(assistant, "chat").mockImplementation(
      (_question, _history, signal, _chapters, _batch, _key, onJobCreated) =>
        new Promise((_resolve, reject) => {
          onJobCreated?.({ id: "job-1", status: "running" } as AssistantJobState);
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.spyOn(assistant, "relayNext").mockResolvedValueOnce({
      kind: "request",
      request: {
        ticket: "t1",
        seq: 1,
        engine: { kind: "cloud", grammar: false, provider: "openai" },
        payload: { messages: [] },
        limits: { maxOutputBytes: 262_144, answerBySeconds: 60 },
      },
    });
    const answers: RelayAnswerV1[] = [];
    vi.spyOn(assistant, "relayAnswer").mockImplementation(async (answer) => {
      answers.push(answer);
      return { kind: "ok" };
    });
    const cancelJob = vi
      .spyOn(assistant, "cancelJob")
      .mockResolvedValue({ id: "job-1", status: "cancelled" } as AssistantJobState);
    engine.execute.mockImplementation(
      (_payload, signal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve({ content: "", finishReason: "stop" })),
        ),
    );

    const { result } = renderHook(
      () =>
        useAssistantConversation({
          worldId: "relay-fixture",
          forcedChapterIds: [],
          onApply: () => ({ appliedIndices: [], skipped: [] }),
          onBeforeSend: async () => {},
          t: (key) => key,
        }),
      { wrapper },
    );

    let sending: Promise<void> | undefined;
    act(() => {
      sending = result.current.send(undefined, undefined, "Wer ist Tarek?");
    });
    await waitFor(() => expect(engine.execute).toHaveBeenCalled());
    expect(chat.mock.calls[0][7]).toEqual({ kind: "cloud", provider: "openai" });

    await act(async () => result.current.cancel());
    await act(async () => sending);

    expect(answers).toEqual([{ ticket: "t1", seq: 1, error: { code: "cancelled" } }]);
    expect(cancelJob).toHaveBeenCalledWith("job-1");
  });
});

// D-T-61-30: a failed job on the user's own engine reaches the conversation in German words,
// never as the engine's code or the browser's English detail.
describe("a failed job on a browser engine", () => {
  const german = (key: Parameters<typeof translateUiMessage>[1]) => translateUiMessage("de", key);

  async function failWith(engineError: { code: string; detail?: string }) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(quiltorClient.platform.preferences, "get").mockReturnValue("cloud");
    vi.spyOn(quiltorClient.application.assistant, "chat").mockRejectedValue(
      // What terminalReply throws for the job (platform/http/assistantJobs.ts).
      new ApplicationGatewayError(engineError.detail ?? "", "unavailable", {
        params: { engineError },
      }),
    );
    const { result } = renderHook(
      () =>
        useAssistantConversation({
          worldId: "relay-fixture",
          forcedChapterIds: [],
          onApply: () => ({ appliedIndices: [], skipped: [] }),
          onBeforeSend: async () => {},
          t: german,
        }),
      { wrapper },
    );
    await act(async () => result.current.send(undefined, undefined, "Wer ist Tarek?"));
    const failed = result.current.entries.find((entry) => entry.error);
    expect(failed).toBeDefined();
    return failed?.error ?? "";
  }

  it.each([
    [
      { code: "engine_unavailable", detail: "model not loaded" },
      "assistantEngineErrorModelNotLoaded",
    ],
    [
      { code: "engine_unavailable", detail: "WebGPU device lost" },
      "assistantEngineErrorUnavailable",
    ],
    [{ code: "client_unavailable" }, "assistantEngineErrorClientUnavailable"],
    [{ code: "provider_error", detail: "401" }, "assistantEngineErrorProvider"],
    [{ code: "context_too_large" }, "assistantEngineErrorContextTooLarge"],
    [{ code: "world_too_large" }, "assistantErrorWorldTooLarge"],
    [{ code: "chapter_too_long" }, "assistantErrorChapterTooLong"],
    [{ code: "extraction_incomplete", detail: "part 3" }, "assistantErrorExtractionIncomplete"],
    [{ code: "extraction_part_failed", detail: "part 2" }, "assistantErrorExtractionPartFailed"],
    [{ code: "client_error", detail: "gpu_on_fire" }, "assistantEngineErrorUnknown"],
    [{ code: "something_new" }, "assistantEngineErrorUnknown"],
  ] as const)("words %o in German, without the raw code", async (engineError, key) => {
    const message = await failWith(engineError);
    expect(message).toBe(german(key));
    expect(message).not.toContain(engineError.code);
    if ("detail" in engineError) expect(message).not.toContain(engineError.detail);
  });
});
