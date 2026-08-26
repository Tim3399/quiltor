import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../Dialog";
import { AdaptivePanel } from "./AdaptivePanel";

afterEach(cleanup);

describe("AdaptivePanel", () => {
  it("renders an inline complementary panel by default", () => {
    render(
      <AdaptivePanel
        open
        presentation="inline"
        label="Details"
        closeLabel="Details schließen"
        onClose={() => undefined}
      >
        Inhalt
      </AdaptivePanel>,
    );
    expect(screen.getByRole("complementary", { name: "Details" })).toHaveTextContent("Inhalt");
  });

  it("renders a modal overlay that closes on Escape and restores focus", async () => {
    const close = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Auslöser
          </button>
          <AdaptivePanel
            open={open}
            presentation="overlay"
            label="Details"
            closeLabel="Details schließen"
            onClose={() => {
              close();
              setOpen(false);
            }}
          >
            Inhalt
          </AdaptivePanel>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Auslöser" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Details" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Details schließen" })).toHaveFocus(),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("lets only the topmost nested modal consume Escape", () => {
    const closePanel = vi.fn();
    const closeDialog = vi.fn();
    render(
      <AdaptivePanel
        open
        presentation="overlay"
        label="Details"
        closeLabel="Details schließen"
        onClose={closePanel}
      >
        <Dialog title="Bestätigung" closeLabel="Dialog schließen" onClose={closeDialog}>
          Inhalt
        </Dialog>
      </AdaptivePanel>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(closePanel).not.toHaveBeenCalled();
  });

  it("allows product composition to inject either surface without importing it", () => {
    render(
      <AdaptivePanel
        open
        presentation="overlay"
        label="Details"
        closeLabel="Schließen"
        onClose={() => undefined}
        renderOverlay={({ children }) => <section aria-label="Eigene Fläche">{children}</section>}
      >
        Injizierter Inhalt
      </AdaptivePanel>,
    );
    expect(screen.getByRole("region", { name: "Eigene Fläche" })).toHaveTextContent(
      "Injizierter Inhalt",
    );
  });
});
