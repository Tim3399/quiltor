import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);

describe("Select", () => {
  it("forwards its ref, native props and change events", () => {
    const ref = createRef<HTMLSelectElement>();
    const onChange = vi.fn();
    render(
      <Select
        ref={ref}
        fieldId="calendar-field"
        fieldClassName="calendar-layout"
        label="Kalender"
        name="calendar"
        required
        defaultValue="custom"
        className="calendar-select"
        onChange={onChange}
      >
        <option value="gregorian">Gregorianisch</option>
        <option value="custom">Eigener Kalender</option>
      </Select>,
    );

    const select = screen.getByRole("combobox", { name: "Kalender" });
    expect(ref.current).toBe(select);
    expect(select).toHaveAttribute("name", "calendar");
    expect(select).toBeRequired();
    expect(select).toHaveClass("calendar-select");
    expect(select).toHaveValue("custom");
    expect(document.getElementById("calendar-field")).toHaveClass("ui-field", "calendar-layout");

    fireEvent.change(select, { target: { value: "gregorian" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(select).toHaveValue("gregorian");
  });

  it("connects label, external help, description, hint and error", () => {
    render(
      <>
        <p id="external-time-help">Externe Hilfe</p>
        <Select
          id="time-system"
          label="Zeitsystem"
          description="Bestimmt die Datumsdarstellung."
          descriptionId="time-system-description"
          hint="Die kanonische Reihenfolge bleibt erhalten."
          hintId="time-system-hint"
          error="Ein Zeitsystem ist erforderlich."
          errorId="time-system-error"
          aria-describedby="external-time-help"
          defaultValue=""
        >
          <option value="">Bitte auswählen</option>
          <option value="relative">Relativ</option>
        </Select>
      </>,
    );

    const select = screen.getByRole("combobox", { name: "Zeitsystem" });
    expect(select).toHaveAttribute("id", "time-system");
    expect(select).toHaveAttribute(
      "aria-describedby",
      "external-time-help time-system-description time-system-hint time-system-error",
    );
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select.closest(".ui-field")).toHaveAttribute("data-invalid", "true");
  });

  it("keeps an explicit invalid state without requiring an error message", () => {
    render(
      <Select label="Status" aria-invalid="spelling">
        <option>Entwurf</option>
      </Select>,
    );

    const select = screen.getByRole("combobox", { name: "Status" });
    expect(select).toHaveAttribute("aria-invalid", "spelling");
    expect(select.closest(".ui-field")).toHaveAttribute("data-invalid", "true");
  });

  it("supports native disabled options and controls", () => {
    render(
      <Select label="Archiv" disabled defaultValue="locked">
        <option value="draft">Entwurf</option>
        <option value="locked" disabled>
          Archiviert
        </option>
      </Select>,
    );

    const select = screen.getByRole("combobox", { name: "Archiv" });
    expect(select).toBeDisabled();
    expect(select).toHaveValue("locked");
    expect(screen.getByRole("option", { name: "Archiviert" })).toBeDisabled();
  });
});
