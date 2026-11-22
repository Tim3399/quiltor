import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("sizes the grid to the slots present so an action without an icon sits in the last column", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/design/components/Alert/Alert.css"),
      "utf8",
    );
    // Without an icon the copy lands in column 1; the action must not share a flexible column with it.
    expect(css).toMatch(
      /\.design-alert--action\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
    );
    expect(css).not.toMatch(
      /\.design-alert\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/,
    );
    const { container, rerender } = render(<Alert action={<button>Undo</button>}>Moved.</Alert>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("design-alert--action");
    expect(root).not.toHaveClass("design-alert--icon");
    rerender(
      <Alert icon={<span />} action={<button>Undo</button>}>
        Moved.
      </Alert>,
    );
    expect(root).toHaveClass("design-alert--icon", "design-alert--action");
  });

  it("can expose non-urgent feedback as a status", () => {
    render(<Alert role="status">Synchronisiert.</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Synchronisiert.");
  });
});
