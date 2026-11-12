import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quiltorClient, type RelayAnswerV1 } from "../../platform";
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
      value={{ multiUser: false, signOut: false, deviceSync: true, clientAi: true }}
      user={{ serverAi: true }}
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
