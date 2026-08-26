import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TextField } from "./TextField";

afterEach(cleanup);

describe("TextField", () => {
  it("provides stable accessible ids and merges external descriptions", () => {
    render(
      <>
        <p id="external-name-help">Externe Hilfe</p>
        <TextField
          id="figure-name"
          label="Figurenname"
          description="Der kanonische Name."
          descriptionId="figure-name-description"
          hint="Aliasnamen werden separat gepflegt."
          hintId="figure-name-hint"
          error="Der Name fehlt."
          errorId="figure-name-error"
          aria-describedby="external-name-help"
        />
      </>,
    );

    const input = screen.getByRole("textbox", { name: "Figurenname" });
    expect(input).toHaveAttribute("id", "figure-name");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "external-name-help figure-name-description figure-name-hint figure-name-error",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("forwards its ref and native input props", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <TextField
        ref={ref}
        fieldId="search-field"
        fieldClassName="search-layout"
        label="Suche"
        name="query"
        type="search"
        autoComplete="off"
        required
        readOnly
        defaultValue="Hafen"
        className="search-input"
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Suche" });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute("name", "query");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveClass("ui-text-field", "search-input");
    expect(input).toHaveValue("Hafen");
    expect(document.getElementById("search-field")).toHaveClass("ui-field", "search-layout");
  });

  it("keeps an explicitly invalid native state without requiring an error message", () => {
    render(<TextField label="Wort" aria-invalid="spelling" />);

    expect(screen.getByRole("textbox", { name: "Wort" })).toHaveAttribute(
      "aria-invalid",
      "spelling",
    );
  });

  it("owns number-control styling while preserving native numeric constraints", () => {
    render(<TextField label="Monatstage" type="number" min={1} step={1} defaultValue={30} />);

    const input = screen.getByRole("spinbutton", { name: "Monatstage" });
    expect(input).toHaveClass("ui-text-field");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("step", "1");
  });
});
