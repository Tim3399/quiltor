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
    render(
      <SaveStatus
        phase="error"
        label="Nicht gespeichert"
        error="Verbindung unterbrochen"
        retryLabel="Erneut versuchen"
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Verbindung unterbrochen");
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("exposes the attention-only label contract for compact status bars", () => {
    render(<SaveStatus phase="saving" label="Speichert" labelVisibility="attention" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-label-visibility", "attention");
    expect(status).toHaveAttribute("aria-busy", "true");
  });
});
