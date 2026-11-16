import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
import { STATUS_POLL_MS } from "../../shared/hooks/useStatusTick";
import { useAssistantAvailability } from "./useAssistantAvailability";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Status = Awaited<ReturnType<typeof quiltorClient.application.assistant.status>>;
type Install = Awaited<ReturnType<typeof quiltorClient.application.assistant.installStatus>>;

function serve() {
  const status = vi
    .spyOn(quiltorClient.application.assistant, "status")
    .mockResolvedValue({ available: true, reason: "", installed: true, chunks: 0 } as Status);
  vi.spyOn(quiltorClient.application.assistant, "installStatus").mockResolvedValue({
    running: false,
    phase: "",
    percent: 0,
    error: "",
  } as Install);
  return status;
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("assistant status polling", () => {
  it("asks once at start and then every 15 seconds while the drawer is open, until unmounted", async () => {
    const status = serve();
    expect(STATUS_POLL_MS).toBe(15000);

    const hook = renderHook(() => useAssistantAvailability(true));
    await act(async () => {});
    expect(status).toHaveBeenCalledTimes(1);
    await advance(STATUS_POLL_MS - 1);
    expect(status).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(status).toHaveBeenCalledTimes(2);
    await advance(STATUS_POLL_MS);
    expect(status).toHaveBeenCalledTimes(3);

    hook.unmount();
    await advance(STATUS_POLL_MS * 2);
    expect(status).toHaveBeenCalledTimes(3);
  });

  it("stops the tick once the drawer is closed again, so an idle tab lets the session expire", async () => {
    const status = serve();
    const { rerender } = renderHook(({ open }) => useAssistantAvailability(open), {
      initialProps: { open: true },
    });
    await act(async () => {});
    await advance(STATUS_POLL_MS);
    expect(status).toHaveBeenCalledTimes(2);

    rerender({ open: false });
    await advance(60_000);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("does not tick while the drawer was never open", async () => {
    const status = serve();
    renderHook(() => useAssistantAvailability(false));
    await act(async () => {});
    await advance(60_000);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["gains focus", () => window.dispatchEvent(new Event("focus"))],
    ["becomes visible", () => document.dispatchEvent(new Event("visibilitychange"))],
  ])("asks once when the window %s with the drawer closed", async (_, signal) => {
    const status = serve();
    renderHook(() => useAssistantAvailability(false));
    await act(async () => {});
    await act(async () => {
      signal();
    });
    expect(status).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("answers focus and visibility arriving together with one request", async () => {
    const status = serve();
    renderHook(() => useAssistantAvailability(false));
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("ignores a change to hidden", async () => {
    const status = serve();
    renderHook(() => useAssistantAvailability(false));
    await act(async () => {});
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    hidden.mockRestore();
    expect(status).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["401", "unauthorized"],
    ["404", "not_found"],
  ])("ends re-reading on a %s", async (_, code) => {
    const status = serve();
    status
      .mockResolvedValueOnce({ available: true, reason: "", installed: true, chunks: 0 } as Status)
      .mockRejectedValue(new ApplicationGatewayError("refused", code));
    const { result } = renderHook(() => useAssistantAvailability(true));
    await act(async () => {});
    await advance(STATUS_POLL_MS);
    expect(status).toHaveBeenCalledTimes(2);
    expect(result.current.status?.available).toBe(false);

    await advance(60_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a failure that is not a refusal", async () => {
    const status = serve();
    status.mockRejectedValue(new TypeError("Failed to fetch"));
    renderHook(() => useAssistantAvailability(true));
    await act(async () => {});
    await advance(STATUS_POLL_MS);
    await advance(STATUS_POLL_MS);
    expect(status).toHaveBeenCalledTimes(3);
  });
});
