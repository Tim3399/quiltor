import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetBody, SheetHeader } from "./Sheet";

afterEach(cleanup);

describe("Sheet", () => {
  it("renders modal sheet semantics and standard chrome", () => {
    const close = vi.fn();
    render(
      <Sheet open label="Details" onClose={close} wide>
        <SheetHeader title="Kapitel" closeLabel="Schließen" onClose={close} />
        <SheetBody>Inhalt</SheetBody>
      </Sheet>,
    );

    const sheet = screen.getByRole("dialog", { name: "Details" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveClass("ui-sheet--wide");
    expect(screen.getByRole("heading", { name: "Kapitel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes from the backdrop but not from panel pointer input", () => {
    const close = vi.fn();
    const { container } = render(
      <Sheet open label="Details" onClose={close}>
        Inhalt
      </Sheet>,
    );
    const backdrop = container.querySelector<HTMLElement>(".ui-sheet-backdrop");
    expect(backdrop).not.toBeNull();
    if (!backdrop) return;
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Details" }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(backdrop);
    expect(close).toHaveBeenCalledOnce();
  });

  it("restores focus to the previous control", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Auslöser
          </button>
          <Sheet open={open} label="Details" onClose={() => setOpen(false)}>
            <button type="button" data-autofocus>
              Aktion
            </button>
          </Sheet>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Auslöser" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Aktion" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
