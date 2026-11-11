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

  it("names the shortcut in the tooltip but keeps the accessible name plain", () => {
    render(
      <UndoRedoControls
        label="Verlauf: Orte"
        undoLabel="Rückgängig"
        redoLabel="Wiederholen"
        undoShortcut={{ label: "Strg+Z", keys: "Control+Z" }}
        redoShortcut={{ label: "Strg+Umschalt+Z", keys: "Control+Shift+Z" }}
        onUndo={() => undefined}
        onRedo={() => undefined}
        canUndo
        canRedo
      />,
    );
    expect(screen.getByRole("group", { name: "Verlauf: Orte" })).toBeVisible();
    const undo = screen.getByRole("button", { name: "Rückgängig" });
    expect(undo).toHaveAttribute("title", "Rückgängig (Strg+Z)");
    expect(undo).toHaveAttribute("aria-keyshortcuts", "Control+Z");
    const redo = screen.getByRole("button", { name: "Wiederholen" });
    expect(redo).toHaveAttribute("title", "Wiederholen (Strg+Umschalt+Z)");
    expect(redo).toHaveAttribute("aria-keyshortcuts", "Control+Shift+Z");
  });

  it("falls back to the plain label as tooltip without a shortcut", () => {
    render(
      <UndoRedoControls
        label="Verlauf"
        undoLabel="Rückgängig"
        redoLabel="Wiederholen"
        onUndo={() => undefined}
        onRedo={() => undefined}
        canUndo
        canRedo
      />,
    );
    expect(screen.getByRole("button", { name: "Rückgängig" })).toHaveAttribute(
      "title",
      "Rückgängig",
    );
    expect(screen.getByRole("button", { name: "Rückgängig" })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });
});
