import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quiltorClient } from "../../platform";
import { CapabilitiesProvider } from "../../shared/capabilities";
import { useAssistantConversation } from "./useAssistantConversation";

afterEach(() => vi.restoreAllMocks());

describe("a send while the capabilities are not loaded (D-T-275-F5)", () => {
  it("sends nothing when the browser engine is the stored choice: a job without its engine would run on the server", async () => {
    vi.spyOn(quiltorClient.platform.preferences, "get").mockReturnValue("webllm");
    const chat = vi.spyOn(quiltorClient.application.assistant, "chat");
    const { result } = renderHook(
      () =>
        useAssistantConversation({
          worldId: "relay-fixture",
          forcedChapterIds: [],
          onApply: () => ({ appliedIndices: [], skipped: [] }),
          onBeforeSend: async () => {},
          t: (key) => key,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <CapabilitiesProvider value={null}>{children}</CapabilitiesProvider>
        ),
      },
    );
    await act(async () => result.current.send(undefined, undefined, "Wer ist Tarek?"));
    expect(chat).not.toHaveBeenCalled();
    expect(result.current.entries).toEqual([]);
  });
});
