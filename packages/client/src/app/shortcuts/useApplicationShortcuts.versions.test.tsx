import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApplicationShortcuts } from "./useApplicationShortcuts";

afterEach(cleanup);

function pressSaveVersion(versionsAvailable: boolean | undefined) {
  const openOverlay = vi.fn();
  renderHook(() =>
    useApplicationShortcuts({
      focus: false,
      setFocus: vi.fn(),
      openOverlay,
      flushAll: vi.fn().mockResolvedValue(undefined),
      workspace: "text",
      undoManuscript: vi.fn(),
      redoManuscript: vi.fn(),
      undoFigures: vi.fn(),
      redoFigures: vi.fn(),
      undoStoryboards: vi.fn(),
      redoStoryboards: vi.fn(),
      versionsAvailable,
    }),
  );
  const event = new KeyboardEvent("keydown", {
    key: "S",
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
    bubbles: true,
  });
  fireEvent(window, event);
  return { openOverlay, prevented: event.defaultPrevented };
}

describe("the save-version shortcut", () => {
  it("opens the versions dialog in a real world", () => {
    for (const versionsAvailable of [true, undefined]) {
      const { openOverlay } = pressSaveVersion(versionsAvailable);
      expect(openOverlay).toHaveBeenCalledWith("versions", { tab: "versions", focusNote: true });
      cleanup();
    }
  });

  it("opens nothing in an example preview, and still keeps the browser's own save away", () => {
    const { openOverlay, prevented } = pressSaveVersion(false);
    expect(openOverlay).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });
});
