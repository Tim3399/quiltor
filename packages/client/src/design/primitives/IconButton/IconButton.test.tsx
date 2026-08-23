import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

afterEach(cleanup);

describe("IconButton", () => {
  it("requires an accessible label, uses safe defaults and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} label="Schließen" icon={<svg data-testid="close-icon" />} />);

    const button = screen.getByRole("button", { name: "Schließen" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass(
      "icon-button",
      "icon-button--ghost",
      "icon-button--neutral",
      "icon-button--compact",
    );
    expect(screen.getByTestId("close-icon").closest("span")).toHaveAttribute("aria-hidden", "true");
    expect(ref.current).toBe(button);
  });

  it("forwards native behavior and a migration layout class", () => {
    const onClick = vi.fn();
    render(
      <IconButton
        label="Öffnen"
        icon={<svg />}
        className="panel-open"
        name="panel"
        value="open"
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Öffnen" });
    expect(button).toHaveClass("panel-open");
    expect(button).toHaveAttribute("name", "panel");
    expect(button).toHaveAttribute("value", "open");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("models appearance, tone and size as explicit variants", () => {
    render(
      <IconButton
        label="Löschen"
        icon={<svg />}
        appearance="secondary"
        tone="danger"
        size="touch"
      />,
    );

    const button = screen.getByRole("button", { name: "Löschen" });
    expect(button).toHaveClass(
      "icon-button--secondary",
      "icon-button--danger",
      "icon-button--touch",
    );
    expect(button).toHaveAttribute("data-appearance", "secondary");
    expect(button).toHaveAttribute("data-tone", "danger");
    expect(button).toHaveAttribute("data-size", "touch");
  });

  it("forwards the native pressed state used by toggle actions", () => {
    render(<IconButton label="Fixieren" icon={<svg />} aria-pressed="true" />);

    expect(screen.getByRole("button", { name: "Fixieren" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("preserves an explicitly supplied native busy state when not loading", () => {
    render(<IconButton label="Status prüfen" icon={<svg />} aria-busy="true" />);

    expect(screen.getByRole("button", { name: "Status prüfen" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("is natively disabled and announces a loading label while busy", () => {
    const onClick = vi.fn();
    render(
      <IconButton
        label="Neu laden"
        loadingLabel="Wird neu geladen"
        icon={<svg data-testid="reload-icon" />}
        loading
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Wird neu geladen" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "true");
    expect(screen.queryByTestId("reload-icon")).not.toBeInTheDocument();
    expect(button.querySelector(".icon-button__spinner")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
