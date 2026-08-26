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

  it("keeps Escape and focus scoped to the topmost nested sheet", async () => {
    function Example() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>
            Äußeres Sheet öffnen
          </button>
          <Sheet open={outerOpen} label="Außen" onClose={() => setOuterOpen(false)}>
            <button type="button" onClick={() => setInnerOpen(true)}>
              Inneres Sheet öffnen
            </button>
          </Sheet>
          <Sheet open={innerOpen} label="Innen" onClose={() => setInnerOpen(false)}>
            <button type="button" data-autofocus>
              Innere Aktion
            </button>
          </Sheet>
        </>
      );
    }

    render(<Example />);
    const outerTrigger = screen.getByRole("button", { name: "Äußeres Sheet öffnen" });
    outerTrigger.focus();
    fireEvent.click(outerTrigger);
    const outerSheet = screen.getByRole("dialog", { name: "Außen" });
    const innerTrigger = screen.getByRole("button", { name: "Inneres Sheet öffnen" });
    innerTrigger.focus();
    fireEvent.click(innerTrigger);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Innere Aktion" })).toHaveFocus(),
    );
    expect(outerSheet).toHaveAttribute("aria-hidden", "true");
    expect(outerSheet).toHaveAttribute("inert");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Innen" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Außen" })).toBeVisible();
    expect(outerSheet).not.toHaveAttribute("aria-hidden");
    expect(outerSheet).not.toHaveAttribute("inert");
    expect(innerTrigger).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Außen" })).toBeNull());
    expect(outerTrigger).toHaveFocus();
  });
});
