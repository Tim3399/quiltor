import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quiltorClient } from "../../platform";
import { logoutDestination, useShellStatus } from "./useShellStatus";

afterEach(() => vi.restoreAllMocks());

describe("logout destination", () => {
  it("uses the validated provider URL and otherwise falls back to the local login", () => {
    expect(logoutDestination({ logoutUrl: "https://identity.example.test/logout" })).toBe(
      "https://identity.example.test/logout",
    );
    expect(logoutDestination({})).toBe("/login");
  });
});

describe("device sync availability", () => {
  function shellWith(current: () => Promise<unknown>) {
    vi.spyOn(quiltorClient.application.identity, "current").mockImplementation(
      current as typeof quiltorClient.application.identity.current,
    );
    vi.spyOn(quiltorClient.application.metadata, "version").mockResolvedValue({
      version: "3.25.0",
    } as Awaited<ReturnType<typeof quiltorClient.application.metadata.version>>);
    return renderHook(() => useShellStatus());
  }

  it("is unknown until whoami answers, then follows the server", async () => {
    let answer!: (value: unknown) => void;
    const { result } = shellWith(() => new Promise((resolve) => (answer = resolve)));
    expect(result.current.syncAvailable).toBeNull();
    answer({ ok: true, multiUser: true, syncAvailable: false });
    await waitFor(() => expect(result.current.syncAvailable).toBe(false));
  });

  it("keeps local behavior for a server that does not say or cannot be asked", async () => {
    const quiet = shellWith(() => Promise.resolve({ ok: true }));
    await waitFor(() => expect(quiet.result.current.syncAvailable).toBe(true));
    const failing = shellWith(() => Promise.reject(new Error("offline")));
    await waitFor(() => expect(failing.result.current.syncAvailable).toBe(true));
  });
});
