import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("owns the modal name, close action and optional description relationship", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        title="Änderung bestätigen"
        closeLabel="Dialog schließen"
        role="alertdialog"
        describedById="dialog-description"
        onClose={onClose}
      >
        <p id="dialog-description">Diese Änderung kann nicht rückgängig gemacht werden.</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("alertdialog", { name: "Änderung bestätigen" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      "Diese Änderung kann nicht rückgängig gemacht werden.",
    );

    const close = screen.getByRole("button", { name: "Dialog schließen" });
    expect(close).toHaveAttribute("type", "button");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes only when pointer input lands on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Titel" closeLabel="Schließen" onClose={onClose}>
        <button type="button">Inhalt</button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = dialog.parentElement;
    if (!backdrop) throw new Error("Dialog backdrop is missing");
    fireEvent.pointerDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a typed size and an optional action footer", () => {
    render(
      <Dialog
        title="Titel"
        closeLabel="Schließen"
        size="wide"
        onClose={() => undefined}
        footer={<button type="button">Speichern</button>}
      >
        Inhalt
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("ui-dialog--wide");
    expect(screen.getByRole("button", { name: "Speichern" }).parentElement).toHaveClass(
      "ui-dialog__footer",
    );
  });

  it("does not mount or capture focus while closed", () => {
    render(
      <Dialog open={false} title="Titel" closeLabel="Schließen" onClose={() => undefined}>
        Inhalt
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preselects the explicitly marked safe action", async () => {
    render(
      <Dialog
        title="Titel"
        closeLabel="Schließen"
        onClose={() => undefined}
        footer={
          <button type="button" data-autofocus>
            Abbrechen
          </button>
        }
      >
        Inhalt
      </Dialog>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveFocus());
  });
});
