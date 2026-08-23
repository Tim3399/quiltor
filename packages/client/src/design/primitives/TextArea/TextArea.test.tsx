import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TextArea } from "./TextArea";

afterEach(cleanup);

describe("TextArea", () => {
  it("connects description, hint and error to the textarea", () => {
    render(
      <TextArea
        id="chapter-note"
        label="Kapitelnotiz"
        description="Nur im Projekt sichtbar."
        hint="Kurze Stichpunkte genügen."
        error="Die Notiz ist zu lang."
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "Kapitelnotiz" });
    expect(textarea).toHaveAttribute(
      "aria-describedby",
      "chapter-note-description chapter-note-hint chapter-note-error",
    );
    expect(textarea).toHaveAttribute("aria-invalid", "true");
  });

  it("forwards its ref and native textarea props", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <TextArea
        ref={ref}
        fieldId="summary-field"
        fieldClassName="summary-layout"
        label="Zusammenfassung"
        name="summary"
        rows={6}
        maxLength={400}
        required
        defaultValue="Mara erreicht den Hafen."
        className="summary-input"
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "Zusammenfassung" });
    expect(ref.current).toBe(textarea);
    expect(textarea).toHaveAttribute("name", "summary");
    expect(textarea).toHaveAttribute("rows", "6");
    expect(textarea).toHaveAttribute("maxlength", "400");
    expect(textarea).toBeRequired();
    expect(textarea).toHaveClass("summary-input");
    expect(textarea).toHaveValue("Mara erreicht den Hafen.");
    expect(document.getElementById("summary-field")).toHaveClass("ui-field", "summary-layout");
  });

  it("generates a stable control id when none is supplied", () => {
    const { rerender } = render(<TextArea label="Notiz" hint="Optional" />);
    const initialId = screen.getByRole("textbox", { name: "Notiz" }).id;

    rerender(<TextArea label="Notiz" hint="Optional" />);

    expect(initialId).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Notiz" })).toHaveAttribute("id", initialId);
    expect(screen.getByText("Optional")).toHaveAttribute("id", `${initialId}-hint`);
  });
});
