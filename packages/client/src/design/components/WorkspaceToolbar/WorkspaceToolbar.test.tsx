import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../primitives/Button";
import { UndoRedoControls } from "../UndoRedoControls";
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
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
    expect(toolbar.querySelector(".workspace-toolbar__actions")).toMatchObject({
      dataset: expect.objectContaining({
        axis: "x",
        gutter: "auto",
        layout: "scroll",
        surface: "panel",
      }),
    });
  });

  it("offers a wrapping action layout without a horizontal scroll container", () => {
    render(
      <WorkspaceToolbar label="Zeitstrahlwerkzeuge">
        <WorkspaceToolbarActions layout="wrap" data-testid="actions">
          <WorkspaceToolbarGroup label="Erstellen">
            <Button>Neu</Button>
          </WorkspaceToolbarGroup>
        </WorkspaceToolbarActions>
      </WorkspaceToolbar>,
    );

    const actions = screen.getByTestId("actions");
    expect(actions).toHaveAttribute("data-layout", "wrap");
    expect(actions).not.toHaveClass("scroll-area");
    expect(actions).not.toHaveAttribute("data-axis");
    expect(actions).not.toHaveAttribute("data-scrollbar");
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

  it("owns the visual and responsive contract for top-level create actions", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <WorkspaceToolbarCreateButton
        ref={ref}
        label="Neues Kapitel"
        className="product-layout-hook"
        aria-haspopup="menu"
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Neues Kapitel" });
    expect(button).toBe(ref.current);
    expect(button).toHaveClass(
      "ui-button",
      "ui-button--primary",
      "ui-button--regular",
      "ui-toolbar-button",
      "workspace-toolbar__create-button",
      "product-layout-hook",
    );
    expect(button).toHaveAttribute("data-workspace-action", "create");
    expect(button).toHaveAttribute("data-label-mode", "responsive");
    expect(button).toHaveAttribute("data-collapse-at", "compact");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button.querySelector(".ui-button__icon svg")).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
