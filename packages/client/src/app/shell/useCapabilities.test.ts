import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import hostedFixture from "../../../../../contracts/fixtures/application-api/capabilities/hosted.v1.json";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
import { installAllowed } from "../../shared/capabilities";
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

describe("installAllowed", () => {
  it("prefers the capability, then the status route, then allows", () => {
    expect(installAllowed(false, true)).toBe(false);
    expect(installAllowed(true, false)).toBe(true);
    expect(installAllowed(undefined, false)).toBe(false);
    expect(installAllowed(undefined, true)).toBe(true);
    expect(installAllowed(undefined, undefined)).toBe(true);
  });
});
