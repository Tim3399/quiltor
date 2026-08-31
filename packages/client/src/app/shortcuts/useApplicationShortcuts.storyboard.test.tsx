import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApplicationShortcuts } from "./useApplicationShortcuts";

afterEach(cleanup);

describe("Storyboard application shortcuts", () => {
  it("routes undo and redo to the active Storyboard history only", () => {
    const undoManuscript = vi.fn();
    const redoManuscript = vi.fn();
    const undoFigures = vi.fn();
    const redoFigures = vi.fn();
    const undoStoryboards = vi.fn();
    const redoStoryboards = vi.fn();
    renderHook(() =>
      useApplicationShortcuts({
        focus: false,
        setFocus: vi.fn(),
        openOverlay: vi.fn(),
        flushAll: vi.fn().mockResolvedValue(undefined),
        workspace: "storyboard",
        undoManuscript,
        redoManuscript,
        undoFigures,
        redoFigures,
        undoStoryboards,
        redoStoryboards,
      }),
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });

    expect(undoStoryboards).toHaveBeenCalledOnce();
    expect(redoStoryboards).toHaveBeenCalledOnce();
    expect(undoManuscript).not.toHaveBeenCalled();
    expect(redoManuscript).not.toHaveBeenCalled();
    expect(undoFigures).not.toHaveBeenCalled();
    expect(redoFigures).not.toHaveBeenCalled();
  });

  it("keeps Storyboard editing fields in charge of their own undo stack", () => {
    const undoStoryboards = vi.fn();
    const redoStoryboards = vi.fn();
    renderHook(() =>
      useApplicationShortcuts({
        focus: false,
        setFocus: vi.fn(),
        openOverlay: vi.fn(),
        flushAll: vi.fn().mockResolvedValue(undefined),
        workspace: "storyboard",
        undoManuscript: vi.fn(),
        redoManuscript: vi.fn(),
        undoFigures: vi.fn(),
        redoFigures: vi.fn(),
        undoStoryboards,
        redoStoryboards,
      }),
    );
    const field = document.createElement("textarea");
    document.body.append(field);

    fireEvent.keyDown(field, { key: "z", ctrlKey: true });

    expect(undoStoryboards).not.toHaveBeenCalled();
    expect(redoStoryboards).not.toHaveBeenCalled();
    field.remove();
  });
});
