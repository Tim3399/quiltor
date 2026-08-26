import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

afterEach(cleanup);

describe("Toast", () => {
  it("uses a polite status for ordinary transient feedback", () => {
    render(<Toast title="Gespeichert">Alle Änderungen sind sicher.</Toast>);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("requires an accessible dismiss action", () => {
    const dismiss = vi.fn();
    render(
      <Toast tone="danger" onDismiss={dismiss} dismissLabel="Meldung schließen">
        Speichern fehlgeschlagen.
      </Toast>,
    );
    expect(screen.getByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
