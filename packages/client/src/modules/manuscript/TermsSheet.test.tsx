import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TermsSheet } from "./TermsSheet";
import { manuscript, TestProviders } from "./TextWorkspace.testSupport";

describe("TermsSheet", () => {
  afterEach(cleanup);

  it("adds, inserts and removes project terms through the standard sheet structure", () => {
    const onChange = vi.fn();
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(
      <TestProviders>
        <TermsSheet
          open
          manuscript={{ ...manuscript, words: [{ w: "Traumweberin", d: "" }] }}
          onChange={onChange}
          onInsert={onInsert}
          onClose={onClose}
        />
      </TestProviders>,
    );

    const dialog = within(screen.getByRole("dialog", { name: "Eigene Begriffe" }));
    expect(dialog.getByRole("heading", { name: "Eigene Begriffe", level: 2 })).toBeVisible();
    expect(dialog.getByText(/Grammatikprüfung/).closest(".ui-sheet__body")).toHaveClass(
      "terms-sheet",
    );

    const input = dialog.getByLabelText("Neuer Begriff");
    const form = input.closest("form");
    expect(form).toHaveClass("add-term");
    expect(dialog.getByRole("button", { name: "Begriff hinzufügen" })).toHaveAttribute(
      "type",
      "submit",
    );
    fireEvent.change(input, { target: { value: "Nachtarchiv" } });
    fireEvent.submit(form as HTMLFormElement);
    expect(onChange).toHaveBeenCalledWith({
      ...manuscript,
      words: [
        { w: "Traumweberin", d: "" },
        { w: "Nachtarchiv", d: "" },
      ],
    });

    fireEvent.click(dialog.getByRole("button", { name: "Traumweberin" }));
    expect(onInsert).toHaveBeenCalledWith("Traumweberin");
    fireEvent.click(dialog.getByRole("button", { name: "Traumweberin entfernen" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...manuscript, words: [] });
    fireEvent.click(dialog.getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not add the same term a second time, ignoring case", () => {
    const onChange = vi.fn();
    render(
      <TestProviders>
        <TermsSheet
          open
          manuscript={{ ...manuscript, words: [{ w: "Traumweberin", d: "" }] }}
          onChange={onChange}
          onInsert={vi.fn()}
          onClose={vi.fn()}
        />
      </TestProviders>,
    );

    const input = screen.getByLabelText("Neuer Begriff");
    fireEvent.change(input, { target: { value: "traumweberin" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });
});
