import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import hostedFixture from "../../../../../contracts/fixtures/application-api/capabilities/hosted.v1.json";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
import { installAllowed } from "../../shared/capabilities";
import { STATUS_POLL_MS } from "../../shared/hooks/useStatusTick";
import { useCapabilities } from "./useCapabilities";

afterEach(() => vi.restoreAllMocks());

type Current = typeof quiltorClient.application.identity.current;

function render(capabilities: () => Promise<unknown>, whoami: () => Promise<unknown>) {
  vi.spyOn(quiltorClient.application.capabilities, "current").mockImplementation(
    capabilities as typeof quiltorClient.application.capabilities.current,
  );
  const identity = vi
    .spyOn(quiltorClient.application.identity, "current")
    .mockImplementation(whoami as Current);
  return { ...renderHook(() => useCapabilities()), identity };
}

const notFound = () => Promise.reject(new ApplicationGatewayError("Not found", "not_found"));

describe("useCapabilities", () => {
  it("is null until the server answers, then reports its flags", async () => {
    let answer!: (value: unknown) => void;
    const { result, identity } = render(
      () => new Promise((resolve) => (answer = resolve)),
      () => Promise.reject(new Error("unused")),
    );
    expect(result.current.instance).toBeNull();
    answer({ instance: hostedFixture.instance, user: {} });
    await waitFor(() => expect(result.current.instance).toEqual(hostedFixture.instance));
    expect(identity).not.toHaveBeenCalled();
  });

  it.each([
    ["a 404 from an older server", notFound],
    ["no network", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["an answer that is not v1", () => Promise.resolve(null)],
  ])("falls back to whoami on %s", async (_, capabilities) => {
    const { result } = render(capabilities, () =>
      Promise.resolve({ ok: true, multiUser: true, syncAvailable: false }),
    );
    await waitFor(() =>
      expect(result.current.instance).toEqual({
        multiUser: true,
        signOut: true,
        deviceSync: false,
      }),
    );
  });

  it("keeps sync and hides signing out when whoami cannot say either", async () => {
    const quiet = render(notFound, () => Promise.resolve({ ok: true }));
    await waitFor(() =>
      expect(quiet.result.current.instance).toEqual({
        multiUser: false,
        signOut: false,
        deviceSync: true,
      }),
    );
    const failing = render(notFound, () => Promise.reject(new Error("offline")));
    await waitFor(() =>
      expect(failing.result.current.instance).toEqual({
        multiUser: false,
        signOut: false,
        deviceSync: true,
      }),
    );
  });
});

describe("useCapabilities user flags (T-102 D, D-T-102-F1)", () => {
  afterEach(() => vi.useRealTimers());

  const local = { ...hostedFixture.instance, multiUser: false };

  function serve(instance = hostedFixture.instance) {
    const state = { serverAi: false };
    const current = vi
      .spyOn(quiltorClient.application.capabilities, "current")
      .mockImplementation(async () => ({ instance, user: { serverAi: state.serverAi } }));
    return { state, current };
  }

  async function tick(ms = STATUS_POLL_MS) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("re-reads serverAi on the status tick while the drawer is open, so a granted or withdrawn role shows without a reload", async () => {
    vi.useFakeTimers();
    const { state, current } = serve();
    const { result } = renderHook(() => useCapabilities(true));
    await act(async () => {});
    expect(result.current.user).toEqual({ serverAi: false });

    state.serverAi = true;
    await tick();
    expect(result.current.user).toEqual({ serverAi: true });

    state.serverAi = false;
    await tick();
    expect(result.current.user).toEqual({ serverAi: false });
    expect(current).toHaveBeenCalledTimes(3);
  });

  it("does not poll an open tab without the drawer, so an idle session can expire", async () => {
    vi.useFakeTimers();
    const { current } = serve();
    renderHook(() => useCapabilities(false));
    await act(async () => {});
    expect(current).toHaveBeenCalledTimes(1);
    await tick(60_000);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the drawer closes", async () => {
    vi.useFakeTimers();
    const { current } = serve();
    const { rerender } = renderHook(({ open }) => useCapabilities(open), {
      initialProps: { open: true },
    });
    await act(async () => {});
    await tick();
    expect(current).toHaveBeenCalledTimes(2);
    rerender({ open: false });
    await tick(60_000);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["gains focus", () => window.dispatchEvent(new Event("focus"))],
    ["becomes visible", () => document.dispatchEvent(new Event("visibilitychange"))],
  ])("re-reads once when the window %s", async (_, signal) => {
    vi.useFakeTimers();
    const { current } = serve();
    renderHook(() => useCapabilities(false));
    await act(async () => {});
    await act(async () => {
      signal();
    });
    expect(current).toHaveBeenCalledTimes(2);
  });

  it("re-reads exactly once when the window gains focus and becomes visible", async () => {
    vi.useFakeTimers();
    const { state, current } = serve();
    const { result } = renderHook(() => useCapabilities(false));
    await act(async () => {});
    state.serverAi = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(current).toHaveBeenCalledTimes(2);
    expect(result.current.user).toEqual({ serverAi: true });
    await tick(60_000);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it("ignores a visibilitychange to hidden", async () => {
    vi.useFakeTimers();
    const { current } = serve();
    renderHook(() => useCapabilities(false));
    await act(async () => {});
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    hidden.mockRestore();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["401", "unauthorized"],
    ["404", "not_found"],
  ])("ends re-reading on a %s", async (_, code) => {
    vi.useFakeTimers();
    const current = vi
      .spyOn(quiltorClient.application.capabilities, "current")
      .mockResolvedValueOnce({ instance: hostedFixture.instance, user: { serverAi: true } })
      .mockRejectedValue(new ApplicationGatewayError("refused", code));
    const { result } = renderHook(() => useCapabilities(true));
    await act(async () => {});
    await tick();
    expect(current).toHaveBeenCalledTimes(2);
    await tick(60_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(current).toHaveBeenCalledTimes(2);
    expect(result.current.user).toEqual({ serverAi: true });
  });

  it("never re-reads without a session, drawer open or not", async () => {
    vi.useFakeTimers();
    const { current } = serve(local);
    renderHook(() => useCapabilities(true));
    await act(async () => {});
    await tick(60_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("keeps the known user flags and keeps polling when a re-read fails otherwise", async () => {
    vi.useFakeTimers();
    const current = vi
      .spyOn(quiltorClient.application.capabilities, "current")
      .mockResolvedValueOnce({ instance: hostedFixture.instance, user: { serverAi: true } })
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useCapabilities(true));
    await act(async () => {});
    await tick();
    await tick();
    expect(current).toHaveBeenCalledTimes(3);
    expect(result.current.user).toEqual({ serverAi: true });
  });
});

describe("installAllowed", () => {
  it("prefers the capability, then the status route, then allows", () => {
    expect(installAllowed(false, true)).toBe(false);
    expect(installAllowed(true, false)).toBe(true);
    expect(installAllowed(undefined, false)).toBe(false);
    expect(installAllowed(undefined, true)).toBe(true);
    expect(installAllowed(undefined, undefined)).toBe(true);
  });
});
