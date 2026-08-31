import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("uses safe native defaults and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Speichern</Button>);

    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass(
      "ui-button",
      "ui-button--secondary",
      "ui-button--neutral",
      "ui-button--regular",
    );
    expect(ref.current).toBe(button);
  });

  it("forwards native props and keeps a migration layout class", () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" className="dialog-save" name="intent" value="save" onClick={onClick}>
        Speichern
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("name", "intent");
    expect(button).toHaveAttribute("value", "save");
    expect(button).toHaveClass("dialog-save");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("models appearance, tone and size as explicit variants", () => {
    render(
      <Button appearance="primary" tone="danger" size="touch">
        Welt löschen
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Welt löschen" });
    expect(button).toHaveClass("ui-button--primary", "ui-button--danger", "ui-button--touch");
    expect(button).toHaveAttribute("data-appearance", "primary");
    expect(button).toHaveAttribute("data-tone", "danger");
    expect(button).toHaveAttribute("data-size", "touch");
  });

  it("forwards the native pressed state used by toggle actions", () => {
    render(
      <Button appearance="ghost" aria-pressed="true">
        Auswahl
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Auswahl" })).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves an explicitly supplied native busy state when not loading", () => {
    render(<Button aria-busy="true">Status prüfen</Button>);

    expect(screen.getByRole("button", { name: "Status prüfen" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders a decorative icon before or after its label", () => {
    const { rerender } = render(
      <Button icon={<svg data-testid="action-icon" />} iconPosition="start">
        Kapitel
      </Button>,
    );
    let button = screen.getByRole("button", { name: "Kapitel" });
    expect(button.firstElementChild).toHaveClass("ui-button__icon");
    expect(screen.getByTestId("action-icon").closest("span")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    rerender(
      <Button icon={<svg data-testid="action-icon-end" />} iconPosition="end">
        Kapitel
      </Button>,
    );
    button = screen.getByRole("button", { name: "Kapitel" });
    expect(button.lastElementChild).toHaveClass("ui-button__icon");
  });

  it("can expose composed label visuals without requiring a product CSS override", () => {
    render(
      <Button labelOverflow="visible">
        <span>Beziehung</span>
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Beziehung" })).toHaveAttribute(
      "data-label-overflow",
      "visible",
    );
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/design/primitives/Button/Button.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.ui-button\[data-label-overflow="visible"\]\s+\.ui-button__label\s*\{[^}]*overflow:\s*visible;/s,
    );
  });

  it("is natively disabled and announced as busy while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Wird gespeichert" onClick={onClick}>
        Speichern
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Wird gespeichert" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "true");
    expect(button.querySelector(".ui-button__spinner")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
