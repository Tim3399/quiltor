import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveStatus } from "./SaveStatus";

afterEach(cleanup);

describe("SaveStatus", () => {
  it.each(["idle", "dirty", "saving", "saved"] as const)(
    "announces the %s phase politely",
    (phase) => {
      render(<SaveStatus phase={phase} label={`Status ${phase}`} />);
      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("data-phase", phase);
      expect(status).toHaveTextContent(`Status ${phase}`);
    },
  );

  it("announces errors assertively and exposes an optional retry", () => {
    const retry = vi.fn();
    const { container } = render(
      <SaveStatus
        phase="error"
        label="Nicht gespeichert"
        error="Verbindung unterbrochen"
        retryLabel="Erneut versuchen"
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Verbindung unterbrochen");
    expect(container.querySelector(".lucide-circle-alert")).not.toBeNull();
    expect(container.querySelector(".lucide-cloud-off")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("offers to sign in again before retry, and only in the error phase", () => {
    const signIn = vi.fn();
    const { rerender } = render(
      <SaveStatus
        phase="error"
        label="Nicht gespeichert"
        error="Deine Anmeldung ist abgelaufen."
        signInLabel="In neuem Tab anmelden"
        onSignIn={signIn}
        retryLabel="Erneut versuchen"
        onRetry={() => undefined}
      />,
    );
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["In neuem Tab anmelden", "Erneut versuchen"]);
    fireEvent.click(screen.getByRole("button", { name: "In neuem Tab anmelden" }));
    expect(signIn).toHaveBeenCalledOnce();

    rerender(
      <SaveStatus
        phase="saved"
        label="Gespeichert"
        signInLabel="In neuem Tab anmelden"
        onSignIn={signIn}
      />,
    );
    expect(screen.queryByRole("button", { name: "In neuem Tab anmelden" })).toBeNull();
  });

  it("shows a selectable error id only in the error phase and announces it", () => {
    const { container, rerender } = render(
      <SaveStatus
        phase="error"
        label="Nicht gespeichert"
        error="Ungültige Anfrage"
        errorId="k3f9q2m8x1c7v4za"
        errorIdLabel="Fehler-ID: k3f9q2m8x1c7v4za"
      />,
    );
    const value = container.querySelector(".save-status-component__error-id-value");
    expect(value).toHaveTextContent(/^k3f9q2m8x1c7v4za$/);
    expect(container.querySelector(".save-status-component__error-id")).toHaveTextContent(
      "Fehler-ID: k3f9q2m8x1c7v4za",
    );
    expect(container.querySelector(".save-status-component__detail")).toHaveTextContent(
      "Ungültige AnfrageFehler-ID: k3f9q2m8x1c7v4za",
    );
    rerender(<SaveStatus phase="saving" label="Speichert" errorId="k3f9q2m8x1c7v4za" />);
    expect(container.querySelector(".save-status-component__error-id")).toBeNull();
    expect(screen.getByRole("status")).not.toHaveTextContent("k3f9q2m8x1c7v4za");
  });

  it("exposes the attention-only label contract for compact status bars", () => {
    render(<SaveStatus phase="saving" label="Speichert" labelVisibility="attention" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-label-visibility", "attention");
    expect(status).toHaveAttribute("aria-busy", "true");
  });
});
