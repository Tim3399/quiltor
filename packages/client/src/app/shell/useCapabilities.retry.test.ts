import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import hostedFixture from "../../../../../contracts/fixtures/application-api/capabilities/hosted.v1.json";
import { quiltorClient } from "../../platform";
import { CAPABILITIES_RETRY_MS, useCapabilities } from "./useCapabilities";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCapabilities asks again after a failed start (D-T-275-F5)", () => {
  it("replaces the whoami fallback by the real answer once the request goes through", async () => {
    vi.useFakeTimers();
    let up = false;
    const current = vi
      .spyOn(quiltorClient.application.capabilities, "current")
      .mockImplementation(async () => {
        if (!up) throw new TypeError("Failed to fetch");
        return { instance: hostedFixture.instance, user: { serverAi: true } };
      });
    vi.spyOn(quiltorClient.application.identity, "current").mockResolvedValue({
      ok: true,
      multiUser: true,
    } as Awaited<ReturnType<typeof quiltorClient.application.identity.current>>);
    const { result, unmount } = renderHook(() => useCapabilities());
    await act(async () => {});
    expect(result.current.instance?.clientAi).toBeUndefined();

    up = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPABILITIES_RETRY_MS);
    });
    expect(result.current.instance).toEqual(hostedFixture.instance);
    expect(result.current.user).toEqual({ serverAi: true });

    // Answered: it does not ask again.
    const calls = current.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPABILITIES_RETRY_MS * 3);
    });
    expect(current).toHaveBeenCalledTimes(calls);
    unmount();
  });
});
