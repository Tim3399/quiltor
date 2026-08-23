import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionCard } from "./SelectionCard";

afterEach(cleanup);

describe("SelectionCard", () => {
  it("exposes one safe native selection action and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    const onSelect = vi.fn();
    render(
      <SelectionCard
        ref={ref}
        label="Welt öffnen"
        title="Die Stadt aus Papier"
        description="Zuletzt geändert heute"
        leading={<svg data-testid="leading" />}
        indicator={<svg data-testid="indicator" />}
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole("button", { name: "Welt öffnen" });
    expect(button).toHaveAttribute("type", "button");
    expect(ref.current).toBe(button);
    expect(screen.getByText("Die Stadt aus Papier")).toHaveClass("selection-card__title");
    expect(screen.getByText("Zuletzt geändert heute")).toHaveClass("selection-card__description");
    expect(screen.getByTestId("leading").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("indicator").parentElement).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("keeps independent trailing actions outside the selection button", () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(
      <SelectionCard
        label="Welt öffnen"
        title="Welt"
        onSelect={onSelect}
        actionsLabel="Aktionen für Welt"
        actions={
          <button type="button" onClick={onAction}>
            Löschen
          </button>
        }
      />,
    );

    const selection = screen.getByRole("button", { name: "Welt öffnen" });
    const action = screen.getByRole("button", { name: "Löschen" });
    expect(selection).not.toContainElement(action);
    expect(screen.getByRole("group", { name: "Aktionen für Welt" })).toContainElement(action);

    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("models selected and disabled states without replacing native semantics", () => {
    const onSelect = vi.fn();
    render(
      <SelectionCard selected disabled label="Welt öffnen" title="Welt" onSelect={onSelect} />,
    );

    const button = screen.getByRole("button", { name: "Welt öffnen" });
    const card = button.closest(".selection-card");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-current", "true");
    expect(card).toHaveAttribute("data-selected", "true");
    expect(card).toHaveAttribute("data-disabled", "true");
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
