import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoRedoControls } from "./UndoRedoControls";

afterEach(cleanup);

describe("UndoRedoControls", () => {
  it("binds history availability to its two named actions", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(
      <UndoRedoControls
        label="Verlauf"
        undoLabel="Rückgängig"
        redoLabel="Wiederholen"
        onUndo={undo}
        onRedo={redo}
        canUndo
        canRedo={false}
      />,
    );
    const group = screen.getByRole("group", { name: "Verlauf" });
    expect(group).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeDisabled();
  });
});
