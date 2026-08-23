import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("uses its visible label as the accessible name", () => {
    const { rerender } = render(
      <Checkbox
        label="Automatische Sicherungen"
        description="Erstellt regelmäßig lokale Sicherungspunkte."
        hint="Kann später geändert werden."
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Automatische Sicherungen" });
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox.id).toBeTruthy();
    expect(screen.getByText("Automatische Sicherungen").closest("label")).toHaveAttribute(
      "for",
      checkbox.id,
    );

    const generatedId = checkbox.id;
    rerender(
      <Checkbox
        label="Automatische Sicherungen"
        description="Erstellt regelmäßig lokale Sicherungspunkte."
        hint="Kann später geändert werden."
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Automatische Sicherungen" })).toHaveAttribute(
      "id",
      generatedId,
    );
  });

  it("forwards its ref and native input props with uncontrolled change semantics", () => {
    const ref = createRef<HTMLInputElement>();
    const changes: boolean[] = [];
    render(
      <Checkbox
        ref={ref}
        label="Im Manuskript anzeigen"
        name="visible"
        value="yes"
        required
        defaultChecked
        className="native-checkbox"
        containerId="visibility-option"
        containerClassName="settings-option"
        onChange={(event) => changes.push(event.currentTarget.checked)}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Im Manuskript anzeigen" });
    expect(ref.current).toBe(checkbox);
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeRequired();
    expect(checkbox).toHaveAttribute("name", "visible");
    expect(checkbox).toHaveAttribute("value", "yes");
    expect(checkbox).toHaveClass("ui-checkbox__control", "native-checkbox");
    expect(document.getElementById("visibility-option")).toHaveClass(
      "ui-checkbox",
      "settings-option",
    );

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(changes).toEqual([false]);
  });

  it("preserves controlled checked and onChange behavior", () => {
    const onChange = vi.fn();

    function ControlledCheckbox() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox
          label="Kanonisch"
          checked={checked}
          onChange={(event) => {
            onChange(event.currentTarget.checked);
            setChecked(event.currentTarget.checked);
          }}
        />
      );
    }

    render(<ControlledCheckbox />);
    const checkbox = screen.getByRole("checkbox", { name: "Kanonisch" });
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
  });

  it("merges external descriptions with stable custom ids", () => {
    const { rerender } = render(
      <>
        <span id="external-help">Externe Hilfe</span>
        <Checkbox
          id="world-sync"
          label="Welt synchronisieren"
          description="Überträgt Änderungen auf verbundene Geräte."
          descriptionId="world-sync-description"
          hint="Nur bei bestehender Verbindung."
          hintId="world-sync-hint"
          aria-describedby="external-help world-sync-hint"
        />
      </>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Welt synchronisieren" });
    expect(checkbox).toHaveAttribute("id", "world-sync");
    expect(checkbox).toHaveAttribute(
      "aria-describedby",
      "external-help world-sync-hint world-sync-description",
    );

    rerender(
      <Checkbox
        id="world-sync"
        label="Welt synchronisieren"
        description="Überträgt Änderungen auf verbundene Geräte."
        descriptionId="world-sync-description"
        hint="Nur bei bestehender Verbindung."
        hintId="world-sync-hint"
        aria-describedby="external-help world-sync-hint"
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Welt synchronisieren" })).toHaveAttribute(
      "id",
      "world-sync",
    );
  });

  it("marks the native checkbox invalid and describes its error", () => {
    render(
      <Checkbox
        id="licence-confirmation"
        label="Lizenzbedingungen akzeptieren"
        error="Die Zustimmung ist erforderlich."
        errorId="licence-confirmation-error"
        aria-invalid={false}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Lizenzbedingungen akzeptieren" });
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox).toHaveAttribute("aria-describedby", "licence-confirmation-error");
    expect(document.getElementById("licence-confirmation-error")).toHaveTextContent(
      "Die Zustimmung ist erforderlich.",
    );
    expect(checkbox.closest(".ui-checkbox")).toHaveAttribute("data-invalid", "true");
  });

  it("keeps supporting text connected when disabled", () => {
    render(
      <Checkbox
        label="Von der Plattform verwaltet"
        hint="Diese Einstellung kann hier nicht geändert werden."
        disabled
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Von der Plattform verwaltet" });
    const hint = screen.getByText("Diese Einstellung kann hier nicht geändert werden.");
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAttribute("aria-describedby", hint.id);
    expect(checkbox.closest(".ui-checkbox")).toHaveAttribute("data-disabled", "true");
  });
});
