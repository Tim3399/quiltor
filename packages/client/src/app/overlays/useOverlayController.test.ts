import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOverlayController, versionsOptionsForCommand } from "./useOverlayController";

describe("useOverlayController", () => {
  it("opens the versions dialog on the requested tab and starts a new request each time", () => {
    const { result } = renderHook(() => useOverlayController());
    expect(result.current.overlay).toBeNull();

    act(() => result.current.open("versions", { tab: "backups" }));
    const first = result.current.versions;
    expect(result.current.overlay).toBe("versions");
    expect(first).toMatchObject({ tab: "backups", focusNote: false });

    // Asking again while it is open (the palette closes and opens within one tick) must be
    // told apart, or the open dialog would stay on the tab it was on.
    act(() => result.current.open("versions", { tab: "versions", focusNote: true }));
    expect(result.current.versions).toMatchObject({ tab: "versions", focusNote: true });
    expect(result.current.versions.id).not.toBe(first.id);
  });

  it("starts on the versions tab without a note focus when no options are given", () => {
    const { result } = renderHook(() => useOverlayController());
    act(() => result.current.open("versions"));
    expect(result.current.versions).toMatchObject({ tab: "versions", focusNote: false });
  });

  it("leaves the versions request alone when another overlay opens", () => {
    const { result } = renderHook(() => useOverlayController());
    act(() => result.current.open("palette"));
    expect(result.current.overlay).toBe("palette");
    expect(result.current.versions.id).toBe(0);
  });
});

describe("versionsOptionsForCommand", () => {
  it("sends each palette id to its own tab, and the version command to its note field", () => {
    expect(versionsOptionsForCommand("history")).toEqual({ tab: "versions" });
    expect(versionsOptionsForCommand("snapshot")).toEqual({ tab: "versions", focusNote: true });
    expect(versionsOptionsForCommand("backups")).toEqual({ tab: "backups" });
    expect(versionsOptionsForCommand("sync")).toEqual({ tab: "sync" });
  });

  it("leaves every other command alone", () => {
    expect(versionsOptionsForCommand("focus")).toBeUndefined();
    expect(versionsOptionsForCommand("cloud")).toBeUndefined();
  });
});
