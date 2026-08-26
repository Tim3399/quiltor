import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "./NoteEditor";

afterEach(cleanup);

describe("NoteEditor", () => {
  const focus = {
    openLabel: "Im Fokus öffnen",
    title: "Notiz · Hafen",
    closeLabel: "Zurück zum Hafen",
    editorLabel: "Notiz für Hafen",
  };

  it("edits the author-owned string without creating a second document", () => {
    const onChange = vi.fn();
    render(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value="Bestehender Gedanke"
        onChange={onChange}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Notiz" });
    expect(editor).toHaveValue("Bestehender Gedanke");
    fireEvent.change(editor, { target: { value: "Weitergedacht" } });
    expect(onChange).toHaveBeenCalledWith("Weitergedacht");
    expect(editor.closest("[data-note-owner]")).toHaveAttribute("data-note-owner", "chapter:c1");
  });

  it("requests focus for the same stable owner", () => {
    const onFocusRequest = vi.fn();
    render(
      <NoteEditor
        owner={{ kind: "place", id: "harbour" }}
        label="Notiz"
        value=""
        onChange={vi.fn()}
        focus={focus}
        onFocusRequest={onFocusRequest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Im Fokus öffnen" }));
    expect(onFocusRequest).toHaveBeenCalledWith({ kind: "place", id: "harbour" });
  });

  it("edits the same controlled note in a nearly full focus surface", () => {
    function ControlledNote() {
      const [value, setValue] = useState("Alter Gedanke");
      return (
        <NoteEditor
          owner={{ kind: "place", id: "harbour" }}
          label="Notiz"
          value={value}
          onChange={setValue}
          focus={focus}
        />
      );
    }

    render(<ControlledNote />);
    fireEvent.click(screen.getByRole("button", { name: "Im Fokus öffnen" }));

    const dialog = screen.getByRole("dialog", { name: "Notiz · Hafen" });
    expect(dialog).toHaveClass("ui-dialog--focus");
    expect(screen.getAllByRole("button", { name: "Zurück zum Hafen" })).toHaveLength(1);
    expect(dialog.querySelector("[data-note-owner]")).toHaveAttribute(
      "data-note-owner",
      "place:harbour",
    );
    const focusedEditor = screen.getByRole("textbox", { name: "Notiz für Hafen" });
    expect(focusedEditor).toHaveValue("Alter Gedanke");
    fireEvent.change(focusedEditor, { target: { value: "Neuer Gedanke" } });
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Notiz" })).toHaveValue("Neuer Gedanke");
  });

  it("closes with Escape and restores focus to the owning note action", async () => {
    render(
      <NoteEditor
        owner={{ kind: "place", id: "harbour" }}
        label="Notiz"
        value=""
        onChange={vi.fn()}
        focus={focus}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Im Fokus öffnen" });
    expect(trigger.closest(".ui-field__header")).toContainElement(
      screen.getByText("Notiz", { selector: "label" }),
    );
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Notiz für Hafen" })).toHaveFocus(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Notiz · Hafen" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
