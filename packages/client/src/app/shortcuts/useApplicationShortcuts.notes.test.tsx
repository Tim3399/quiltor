import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../shared";
import { useApplicationShortcuts } from "./useApplicationShortcuts";

// T-177: undo in a note editor belongs to the family that holds the note, whichever workspace
// shows it. The editor names its owner in data-note-owner.

afterEach(cleanup);

function setup(workspace: Workspace) {
  const handlers = {
    undoManuscript: vi.fn(),
    redoManuscript: vi.fn(),
    undoFigures: vi.fn(),
    redoFigures: vi.fn(),
    undoStoryboards: vi.fn(),
    redoStoryboards: vi.fn(),
  };
  renderHook(() =>
    useApplicationShortcuts({
      focus: false,
      setFocus: vi.fn(),
      openOverlay: vi.fn(),
      flushAll: vi.fn().mockResolvedValue(undefined),
      workspace,
      ...handlers,
    }),
  );
  return handlers;
}

function noteEditor(owner: string) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-note-owner", owner);
  const content = document.createElement("div");
  content.contentEditable = "true";
  wrapper.append(content);
  document.body.append(wrapper);
  return { content, remove: () => wrapper.remove() };
}

describe("undo in a note editor follows the note's owner (T-177)", () => {
  it("undoes a chapter's note shown on a Storyboard card in the manuscript", () => {
    const handlers = setup("storyboard");
    const editor = noteEditor("chapter:k1");

    fireEvent.keyDown(editor.content, { key: "z", ctrlKey: true });
    fireEvent.keyDown(editor.content, { key: "z", ctrlKey: true, shiftKey: true });

    expect(handlers.undoManuscript).toHaveBeenCalledOnce();
    expect(handlers.redoManuscript).toHaveBeenCalledOnce();
    expect(handlers.undoStoryboards).not.toHaveBeenCalled();
    expect(handlers.redoStoryboards).not.toHaveBeenCalled();
    editor.remove();
  });

  it("undoes a free Storyboard card's note in the Storyboard", () => {
    const handlers = setup("storyboard");
    const editor = noteEditor("storyboard:n1");

    fireEvent.keyDown(editor.content, { key: "z", ctrlKey: true });

    expect(handlers.undoStoryboards).toHaveBeenCalledOnce();
    expect(handlers.undoManuscript).not.toHaveBeenCalled();
    editor.remove();
  });

  it.each(["entity:mira", "place:hafen", "timeline:t1"])(
    "undoes %s in the story world, even from the text workspace",
    (owner) => {
      const handlers = setup("text");
      const editor = noteEditor(owner);

      fireEvent.keyDown(editor.content, { key: "z", ctrlKey: true });

      expect(handlers.undoFigures).toHaveBeenCalledOnce();
      expect(handlers.undoManuscript).not.toHaveBeenCalled();
      editor.remove();
    },
  );

  it("keeps the workspace history outside a note editor", () => {
    const handlers = setup("storyboard");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(handlers.undoStoryboards).toHaveBeenCalledOnce();
    expect(handlers.undoManuscript).not.toHaveBeenCalled();
  });
});
