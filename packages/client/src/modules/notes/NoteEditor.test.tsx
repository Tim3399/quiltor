import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { NoteReference } from "../../shared";
import type { WorldReferenceCandidate } from "../world-references";
import { NoteEditor } from "./NoteEditor";
import { NoteReferenceProvider } from "./NoteReferenceContext";

afterEach(cleanup);

const harbour: WorldReferenceCandidate = {
  id: "place:harbour",
  target: { kind: "place", id: "harbour" },
  label: "Hafen",
  detail: "Ort",
  keywords: [],
  workspace: "places",
  cardKind: "ort",
};
const castle: WorldReferenceCandidate = {
  id: "place:castle",
  target: { kind: "place", id: "castle" },
  label: "Burg",
  detail: "Ort",
  keywords: [],
  workspace: "places",
  cardKind: "ort",
};
const unnamed: WorldReferenceCandidate = {
  ...harbour,
  id: "place:unnamed",
  target: { kind: "place", id: "unnamed" },
  label: " ",
};

function renderNote(
  editor: React.ReactNode,
  candidates: readonly WorldReferenceCandidate[] = [],
  onOpenReference = vi.fn(),
) {
  return render(
    <I18nProvider>
      <NoteReferenceProvider candidates={candidates} onOpenReference={onOpenReference}>
        {editor}
      </NoteReferenceProvider>
    </I18nProvider>,
  );
}

function viewFor(textbox: HTMLElement) {
  const root = textbox.closest<HTMLElement>(".cm-editor");
  if (!root) throw new Error("CodeMirror root missing");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

function replaceText(view: EditorView, text: string) {
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      userEvent: "input",
    });
  });
}

describe("NoteEditor", () => {
  const focus = {
    openLabel: "Im Fokus öffnen",
    title: "Notiz · Hafen",
    closeLabel: "Zurück zum Hafen",
    editorLabel: "Notiz für Hafen",
  };

  it("edits the author-owned string without creating a second document", () => {
    const onChange = vi.fn();
    renderNote(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value="Bestehender Gedanke"
        onChange={onChange}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Notiz" });
    const view = viewFor(editor);
    expect(view.state.doc.toString()).toBe("Bestehender Gedanke");
    replaceText(view, "Weitergedacht");
    expect(onChange).toHaveBeenCalledWith("Weitergedacht", []);
    expect(editor.closest("[data-note-owner]")).toHaveAttribute("data-note-owner", "chapter:c1");
    fireEvent.click(screen.getByText("Notiz", { selector: "label" }));
    expect(editor).toHaveFocus();
  });

  it("requests focus for the same stable owner", () => {
    const onFocusRequest = vi.fn();
    renderNote(
      <NoteEditor
        owner={{ kind: "place", id: "harbour" }}
        label="Notiz"
        value=""
        onChange={vi.fn()}
        focus={focus}
        onFocusRequest={onFocusRequest}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Im Fokus öffnen" });
    expect(trigger.querySelector(".lucide-focus")).toBeInTheDocument();
    expect(trigger.querySelector(".lucide-maximize-2")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(onFocusRequest).toHaveBeenCalledWith({ kind: "place", id: "harbour" });
  });

  it("edits the same controlled note in a nearly full focus surface", async () => {
    function ControlledNote() {
      const [value, setValue] = useState("Alter Gedanke");
      const [references, setReferences] = useState<NoteReference[]>([]);
      return (
        <NoteEditor
          owner={{ kind: "place", id: "harbour" }}
          label="Notiz"
          value={value}
          references={references}
          onChange={(nextValue, nextReferences) => {
            setValue(nextValue);
            setReferences(nextReferences);
          }}
          focus={focus}
        />
      );
    }

    renderNote(<ControlledNote />);
    fireEvent.click(screen.getByRole("button", { name: "Im Fokus öffnen" }));

    const dialog = screen.getByRole("dialog", { name: "Notiz · Hafen" });
    expect(dialog).toHaveClass("ui-dialog--focus");
    expect(screen.getAllByRole("button", { name: "Zurück zum Hafen" })).toHaveLength(1);
    expect(dialog.querySelector("[data-note-owner]")).toHaveAttribute(
      "data-note-owner",
      "place:harbour",
    );
    const focusedEditor = screen.getByRole("textbox", { name: "Notiz für Hafen" });
    expect(viewFor(focusedEditor).state.doc.toString()).toBe("Alter Gedanke");
    replaceText(viewFor(focusedEditor), "Neuer Gedanke");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    await waitFor(() =>
      expect(viewFor(screen.getByRole("textbox", { name: "Notiz" })).state.doc.toString()).toBe(
        "Neuer Gedanke",
      ),
    );
  });

  it("keeps focus-mode reference completion inside the modal accessibility tree", async () => {
    renderNote(
      <NoteEditor
        owner={{ kind: "place", id: "harbour" }}
        label="Notiz"
        value=""
        onChange={vi.fn()}
        focus={focus}
      />,
      [harbour],
    );
    fireEvent.click(screen.getByRole("button", { name: "Im Fokus öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Notiz · Hafen" });
    const editor = screen.getByRole("textbox", { name: "Notiz für Hafen" });
    const view = viewFor(editor);
    act(() => view.focus());
    replaceText(view, "@Haf");

    expect(dialog).toContainElement(
      await screen.findByRole("listbox", { name: "Referenz auswählen" }),
    );
  });

  it("closes with Escape and restores focus to the owning note action", async () => {
    renderNote(
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

  it("offers world references by keyboard and inserts text plus a stable ID range", async () => {
    const onChange = vi.fn();
    renderNote(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value=""
        onChange={onChange}
      />,
      [unnamed, harbour, castle],
    );
    const textbox = screen.getByRole("textbox", { name: "Notiz" });
    const view = viewFor(textbox);
    act(() => view.focus());
    replaceText(view, "@");
    expect(await screen.findByRole("listbox", { name: "Referenz auswählen" })).toBeVisible();

    fireEvent.keyDown(textbox, { key: "ArrowDown" });
    fireEvent.keyDown(textbox, { key: "Enter" });

    expect(view.state.doc.toString()).toBe("Burg");
    expect(onChange).toHaveBeenLastCalledWith("Burg", [
      expect.objectContaining({
        id: expect.any(String),
        target: { kind: "place", id: "castle" },
        from: 0,
        to: 4,
        surface: "Burg",
      }),
    ]);
    expect(screen.queryByRole("listbox", { name: "Referenz auswählen" })).not.toBeInTheDocument();
  });

  it("closes reference completion with Escape without changing the note", async () => {
    renderNote(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value=""
        onChange={vi.fn()}
      />,
      [harbour],
    );
    const textbox = screen.getByRole("textbox", { name: "Notiz" });
    const view = viewFor(textbox);
    act(() => view.focus());
    replaceText(view, "@Haf");
    expect(await screen.findByRole("option", { name: /Hafen/ })).toBeVisible();
    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Referenz auswählen" })).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe("@Haf");
  });

  it("uses local option IDs when a valid imported target ID contains whitespace", async () => {
    const imported = {
      ...harbour,
      id: "place:harbour east",
      target: { kind: "place" as const, id: "harbour east" },
    };
    renderNote(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value=""
        onChange={vi.fn()}
      />,
      [imported],
    );
    const textbox = screen.getByRole("textbox", { name: "Notiz" });
    const view = viewFor(textbox);
    act(() => view.focus());
    replaceText(view, "@Haf");

    const option = await screen.findByRole("option", { name: /Hafen/ });
    expect(option.id).toMatch(/-option-0$/);
    expect(option.id).not.toContain("harbour east");
    expect(textbox).not.toHaveAttribute("aria-expanded");
    expect(textbox).toHaveAttribute("aria-controls", option.closest('[role="listbox"]')?.id);
    expect(textbox).toHaveAttribute("aria-activedescendant", option.id);
  });

  it("invalidates a reference edited inside its visible surface", () => {
    const onChange = vi.fn();
    const reference: NoteReference = {
      id: "ref-1",
      target: harbour.target,
      from: 0,
      to: 5,
      surface: "Hafen",
    };
    renderNote(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value="Hafen"
        references={[reference]}
        onChange={onChange}
      />,
      [harbour],
    );
    const view = viewFor(screen.getByRole("textbox", { name: "Notiz" }));
    act(() =>
      view.dispatch({
        changes: { from: 2, insert: "x" },
        selection: { anchor: 3 },
        userEvent: "input",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith("Haxfen", []);
  });

  it("keeps the author text but resolves a renamed target by its stable ID", () => {
    const onOpenReference = vi.fn();
    const renamed = { ...harbour, label: "Nordhafen" };
    renderNote(
      <NoteEditor
        owner={{ kind: "chapter", id: "c1" }}
        label="Notiz"
        value="Hafen"
        references={[{ id: "ref-1", target: harbour.target, from: 0, to: 5, surface: "Hafen" }]}
        onChange={vi.fn()}
      />,
      [renamed],
      onOpenReference,
    );
    expect(viewFor(screen.getByRole("textbox", { name: "Notiz" })).state.doc.toString()).toBe(
      "Hafen",
    );
    fireEvent.click(screen.getByRole("button", { name: "Nordhafen" }));
    expect(onOpenReference).toHaveBeenCalledWith({ kind: "place", id: "harbour" });
  });

  it("keeps externally updated reference metadata on the next text edit", () => {
    const onChange = vi.fn();
    function MetadataNote() {
      const [value, setValue] = useState("Hafen");
      const [references, setReferences] = useState<NoteReference[]>([
        {
          id: "ref-1",
          target: harbour.target,
          from: 0,
          to: 5,
          surface: "Hafen",
          source: "old",
        },
      ]);
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setReferences((current) =>
                current.map((reference) => ({ ...reference, source: "new" })),
              )
            }
          >
            Metadaten aktualisieren
          </button>
          <NoteEditor
            owner={{ kind: "chapter", id: "c1" }}
            label="Notiz"
            value={value}
            references={references}
            onChange={(nextValue, nextReferences) => {
              onChange(nextValue, nextReferences);
              setValue(nextValue);
              setReferences(nextReferences);
            }}
          />
        </>
      );
    }

    renderNote(<MetadataNote />, [harbour]);
    fireEvent.click(screen.getByRole("button", { name: "Metadaten aktualisieren" }));
    const view = viewFor(screen.getByRole("textbox", { name: "Notiz" }));
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "!" },
        userEvent: "input",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith("Hafen!", [
      expect.objectContaining({ id: "ref-1", source: "new" }),
    ]);
  });

  it("keeps reference completion above the modal focus surface", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/notes/NoteEditor.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.note-reference-popover\s*\{[^}]*z-index:\s*calc\(var\(--z-modal\) \+ var\(--z-local\)\);/s,
    );
  });

  it("keeps long inline notes scrollable and fills a vertically resized editor", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/notes/NoteEditor.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.note-editor__control\s*\{[^}]*height:\s*var\(--space-48\);[^}]*overflow:\s*hidden;[^}]*resize:\s*vertical;/s,
    );
    expect(css).toMatch(
      /\.note-editor--comfortable \.note-editor__control\s*\{[^}]*height:\s*var\(--space-88\);/s,
    );
    expect(css).toMatch(/\.note-editor__control \.cm-editor\s*\{[^}]*height:\s*100%;/s);
    expect(css).toMatch(/\.note-editor__control \.cm-content\s*\{[^}]*min-height:\s*100%;/s);
  });
});
