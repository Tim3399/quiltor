import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quiltorClient } from "../../platform";
import { STATUS_POLL_MS } from "../../shared/hooks/useStatusTick";
import { useAssistantAvailability } from "./useAssistantAvailability";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("assistant status polling", () => {
  it("asks once at start and then every 15 seconds, until unmounted", () => {
    const status = vi
      .spyOn(quiltorClient.application.assistant, "status")
      .mockResolvedValue({ available: true, reason: "", installed: true, chunks: 0 } as Awaited<
        ReturnType<typeof quiltorClient.application.assistant.status>
      >);
    vi.spyOn(quiltorClient.application.assistant, "installStatus").mockResolvedValue({
      running: false,
      phase: "",
      percent: 0,
      error: "",
    } as Awaited<ReturnType<typeof quiltorClient.application.assistant.installStatus>>);
    expect(STATUS_POLL_MS).toBe(15000);

    const hook = renderHook(() => useAssistantAvailability());
    expect(status).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STATUS_POLL_MS - 1);
    expect(status).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(status).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(STATUS_POLL_MS);
    expect(status).toHaveBeenCalledTimes(3);

    hook.unmount();
    vi.advanceTimersByTime(STATUS_POLL_MS * 2);
    expect(status).toHaveBeenCalledTimes(3);
  });
});
