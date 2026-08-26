import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../../primitives/Button";
import { UndoRedoControls } from "../UndoRedoControls";
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "./WorkspaceToolbar";

afterEach(cleanup);

describe("WorkspaceToolbar", () => {
  it("provides a named toolbar with composable title and groups", () => {
    render(
      <WorkspaceToolbar label="Kapitelwerkzeuge">
        <WorkspaceToolbarTitle title="Kapitel 1" detail="120 Wörter" />
        <WorkspaceToolbarActions>
          <WorkspaceToolbarGroup label="Bearbeiten">
            <Button>Speichern</Button>
          </WorkspaceToolbarGroup>
        </WorkspaceToolbarActions>
      </WorkspaceToolbar>,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Kapitelwerkzeuge" });
    expect(within(toolbar).getByText("Kapitel 1")).toBeVisible();
    expect(within(toolbar).getByRole("group", { name: "Bearbeiten" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Speichern" })).toBeEnabled();
  });

  it("accepts a semantic composite fieldset as a direct action group", () => {
    render(
      <WorkspaceToolbar label="Kapitelwerkzeuge">
        <WorkspaceToolbarActions>
          <WorkspaceToolbarGroup label="Erstellen">
            <Button>Neu</Button>
          </WorkspaceToolbarGroup>
          <UndoRedoControls
            label="Verlauf"
            undoLabel="Rückgängig"
            redoLabel="Wiederholen"
            onUndo={() => undefined}
            onRedo={() => undefined}
            canUndo
            canRedo={false}
          />
          <WorkspaceToolbarGroup label="Ausgabe">
            <Button>Exportieren</Button>
          </WorkspaceToolbarGroup>
        </WorkspaceToolbarActions>
      </WorkspaceToolbar>,
    );

    const actions = screen.getByRole("toolbar", { name: "Kapitelwerkzeuge" });
    expect(within(actions).getByRole("group", { name: "Verlauf" })).toHaveClass(
      "undo-redo-controls",
    );
    expect(within(actions).getByRole("button", { name: "Rückgängig" })).toBeEnabled();
    expect(within(actions).getByRole("button", { name: "Wiederholen" })).toBeDisabled();
  });
});
