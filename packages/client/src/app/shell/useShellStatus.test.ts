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
    expect(logoutDestination({})).toBe("/login?ui_locales=de");
    quiltorClient.platform.preferences.set("quiltor-interface-language", "en");
    expect(logoutDestination({})).toBe("/login?ui_locales=en");
    localStorage.clear();
  });
});

describe("shell account", () => {
  function shellWith(current: () => Promise<unknown>) {
    vi.spyOn(quiltorClient.application.identity, "current").mockImplementation(
      current as typeof quiltorClient.application.identity.current,
    );
    vi.spyOn(quiltorClient.application.metadata, "version").mockResolvedValue({
      version: "3.26.0",
    } as Awaited<ReturnType<typeof quiltorClient.application.metadata.version>>);
    return renderHook(() => useShellStatus());
  }

  // The account keys the drafts a refused save keeps (T-58 P7b); signing out is a
  // capability of its own now (T-102), so the account must not follow it (F-102-3).
  it("keeps the signed-in user of a shared server, whatever else whoami says", async () => {
    const { result } = shellWith(() =>
      Promise.resolve({ ok: true, sub: "alice", multiUser: true, syncAvailable: false }),
    );
    await waitFor(() => expect(result.current.account?.sub).toBe("alice"));
  });

  it("has no account where there is only one user or whoami fails", async () => {
    const local = shellWith(() => Promise.resolve({ ok: true, sub: "local", multiUser: false }));
    await waitFor(() => expect(local.result.current.version).toBe("3.26.0"));
    expect(local.result.current.account).toBeNull();
    const failing = shellWith(() => Promise.reject(new Error("offline")));
    await waitFor(() => expect(failing.result.current.version).toBe("3.26.0"));
    expect(failing.result.current.account).toBeNull();
  });
});
