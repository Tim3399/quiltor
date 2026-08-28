import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field } from "./Field";

afterEach(cleanup);

describe("Field", () => {
  it("connects its label and supporting text to the control", () => {
    render(
      <Field
        label="Arbeitstitel"
        description="Der Titel innerhalb des Projekts."
        hint="Kann später geändert werden."
        error="Ein Titel ist erforderlich."
      >
        <input />
      </Field>,
    );

    const control = screen.getByRole("textbox", { name: "Arbeitstitel" });
    const describedBy = control.getAttribute("aria-describedby")?.split(" ") ?? [];

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(describedBy).toHaveLength(3);
    expect(document.getElementById(describedBy[0])).toHaveTextContent(
      "Der Titel innerhalb des Projekts.",
    );
    expect(document.getElementById(describedBy[1])).toHaveTextContent(
      "Kann später geändert werden.",
    );
    expect(document.getElementById(describedBy[2])).toHaveTextContent(
      "Ein Titel ist erforderlich.",
    );
  });

  it("preserves external descriptions and accepts stable ids", () => {
    render(
      <>
        <p id="external-help">Externe Hilfe</p>
        <Field
          label="Name"
          controlId="project-name"
          description="Öffentlich sichtbarer Name."
          descriptionId="project-name-description"
          hint="Kurz halten."
          hintId="project-name-hint"
        >
          <input aria-describedby="external-help project-name-hint" />
        </Field>
      </>,
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "aria-describedby",
      "external-help project-name-hint project-name-description",
    );
  });

  it("can point its label at a nested focus target", () => {
    const activate = vi.fn();
    render(
      <Field
        label="Notiz"
        controlId="note-surface"
        labelTargetId="note-editor"
        onLabelClick={activate}
      >
        <div>
          <input id="note-editor" />
        </div>
      </Field>,
    );

    expect(screen.getByRole("textbox", { name: "Notiz" })).toHaveAttribute("id", "note-editor");
    expect(document.getElementById("note-surface")).toBeInTheDocument();
    expect(screen.getByText("Notiz", { selector: "label" })).toHaveAttribute("for", "note-editor");
    fireEvent.click(screen.getByText("Notiz", { selector: "label" }));
    expect(activate).toHaveBeenCalledOnce();
  });

  it("forwards native root props and its ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Field
        ref={ref}
        id="project-name-field"
        className="layout-field"
        data-testid="field"
        label="Name"
      >
        <input aria-invalid="grammar" />
      </Field>,
    );

    const field = screen.getByTestId("field");
    expect(ref.current).toBe(field);
    expect(field).toHaveAttribute("id", "project-name-field");
    expect(field).toHaveClass("ui-field", "layout-field");
    expect(field).toHaveAttribute("data-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "aria-invalid",
      "grammar",
    );
  });

  it("can keep a label accessible without reserving visual space", () => {
    render(
      <Field label="Search" labelHidden>
        <input />
      </Field>,
    );

    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("Search")).toHaveClass("sr-only");
  });

  it("reserves a header action beside the label instead of covering the control", () => {
    render(
      <Field label="Notiz" actions={<button type="button">Im Fokus öffnen</button>}>
        <textarea />
      </Field>,
    );

    const action = screen.getByRole("button", { name: "Im Fokus öffnen" });
    expect(action.parentElement).toHaveClass("ui-field__actions");
    expect(action.parentElement?.parentElement).toHaveClass("ui-field__header");
    expect(screen.getByRole("textbox", { name: "Notiz" })).toBeInTheDocument();
  });
});
