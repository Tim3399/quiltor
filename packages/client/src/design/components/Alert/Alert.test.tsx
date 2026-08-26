import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Alert } from "./Alert";

afterEach(cleanup);

describe("Alert", () => {
  it("announces urgent inline feedback with its semantic tone", () => {
    render(
      <Alert tone="danger" title="Nicht gespeichert">
        Die Verbindung wurde unterbrochen.
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-tone", "danger");
    expect(alert).toHaveTextContent("Nicht gespeichert");
  });

  it("can expose non-urgent feedback as a status", () => {
    render(<Alert role="status">Synchronisiert.</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Synchronisiert.");
  });
});
