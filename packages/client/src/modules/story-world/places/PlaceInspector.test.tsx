import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { PlaceInspector } from "./PlaceInspector";

afterEach(cleanup);

const state: FigureState = {
  nodes: [
    { id: "p", x: 0, y: 0, name: "Hafen", type: "ort" },
    { id: "q", x: 100, y: 0, name: "Burg", type: "ort" },
    { id: "f", x: 0, y: 0, name: "Ada", type: "person" },
  ],
  edges: [],
  timeline: [{ id: "later", title: "Später" }],
  presence: [
    { id: "presence-base", elementId: "f", placeId: "p" },
    { id: "presence-later", elementId: "f", placeId: "q", momentId: "later" },
  ],
};

function noteView(textbox: HTMLElement) {
  const root = textbox.closest<HTMLElement>(".cm-editor");
  if (!root) throw new Error("CodeMirror root missing");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

describe("PlaceInspector", () => {
  it("keeps history rows inside their cards with compact, wrapping layout contracts", () => {
    const { container } = render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    const whoWasHere = screen.getByText("Wer war hier").closest("details");
    const chronicle = screen.getByText("Chronik").closest("details");
    expect(whoWasHere?.querySelector("summary > .places-section-heading")).toBeInTheDocument();
    expect(whoWasHere?.querySelector(".places-stay-row .places-stay-range")).toBeInTheDocument();
    expect(chronicle?.querySelector(".places-chronicle-entry")).toBeInTheDocument();
    const body = container.querySelector(".places-inspector-body");
    expect(body?.tagName).toBe("DIV");
    expect(body).toHaveClass("side-panel__body", "scroll-area", "places-inspector-body");
    expect(body).toHaveAttribute("data-axis", "y");
    expect(body).toHaveAttribute("data-gutter", "stable");
    expect(body).toHaveAttribute("data-overscroll", "auto");
    expect(body).toHaveAttribute("data-scrollbar", "thin");
    expect(body).toHaveAttribute("data-surface", "panel");

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/places/PlaceInspector.css"),
      "utf8",
    );
    expect(css).toMatch(/\.places-section-heading\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
    expect(css).toMatch(
      /\.places-stay-row\s*\{[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s,
    );
    expect(css).toMatch(
      /\.places-stay-range\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\);/s,
    );
    expect(css).toMatch(
      /\.places-stay-duration\s*\{[^}]*min-width:\s*max-content;[^}]*overflow-wrap:\s*normal;[^}]*white-space:\s*nowrap;/s,
    );
    expect(css).toMatch(/\.places-chronicle-entry\s*>\s*strong,[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(
      /\.places-inspector-body\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*0;/s,
    );
    expect(css).not.toMatch(
      /\.places-inspector-body(?:\s*\{|::)[^}]*(?:overflow|scrollbar|--scrollbar-surface)/s,
    );
    expect(css).not.toContain(".places-inspector-body::-webkit-scrollbar");
  });

  it("owns favorite/lock editing and cross-workspace history links", () => {
    const onPatch = vi.fn();
    const onOpen = vi.fn();
    render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={onPatch}
          onClose={vi.fn()}
          onOpen={onOpen}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ort favorisieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Position fixieren" }));
    expect(onPatch).toHaveBeenNthCalledWith(1, { important: true });
    expect(onPatch).toHaveBeenNthCalledWith(2, { pinned: true });

    fireEvent.click(screen.getAllByRole("button", { name: "Ada" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(onOpen).toHaveBeenNthCalledWith(1, { workspace: "figures", id: "f" });
    expect(onOpen).toHaveBeenNthCalledWith(2, { workspace: "timeline", id: "later" });
  });

  it("commits a completed place rename once instead of patching every typed character", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={onPatch}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Hafen");

    fireEvent.change(name, { target: { value: "N" } });
    fireEvent.change(name, { target: { value: "Nord" } });
    fireEvent.change(name, { target: { value: "Nordhafen" } });

    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: "Nordhafen" });
  });

  it("does not commit unchanged or cancelled place names", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={onPatch}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    const name = screen.getByRole("textbox", { name: "Name" });

    name.focus();
    fireEvent.blur(name);
    expect(onPatch).not.toHaveBeenCalled();

    name.focus();
    fireEvent.change(name, { target: { value: "Südhafen" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect(name).toHaveValue("Hafen");
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("commits a place rename through Enter exactly once", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={onPatch}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    const name = screen.getByRole("textbox", { name: "Name" });
    name.focus();
    fireEvent.change(name, { target: { value: "Nordhafen" } });
    fireEvent.keyDown(name, { key: "Enter" });
    name.blur();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: "Nordhafen" });
  });

  it("edits the shared place note without losing existing profile data", () => {
    const onPatch = vi.fn();
    const selected = {
      ...state.nodes[0],
      profile: { alter: "Alt", extra: [{ k: "Geruch", v: "Salz" }], notizen: "Nebel" },
    };
    render(
      <I18nProvider>
        <PlaceInspector
          selected={selected}
          state={state}
          onPatch={onPatch}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    const note = screen.getByRole("textbox", { name: "Notizen" });
    expect(noteView(note).state.doc.toString()).toBe("Nebel");
    expect(note.closest("[data-note-owner]")).toHaveAttribute("data-note-owner", "place:p");

    act(() =>
      noteView(note).dispatch({
        changes: { from: 0, to: 5, insert: "Salziger Nebel" },
        userEvent: "input",
      }),
    );
    expect(onPatch).toHaveBeenCalledWith({
      profile: {
        alter: "Alt",
        extra: [{ k: "Geruch", v: "Salz" }],
        notizen: "Salziger Nebel",
        noteReferences: [],
        noteMarks: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Notiz im Fokus öffnen" }));
    const focus = screen.getByRole("dialog", { name: "Notiz · Hafen" });
    expect(focus.querySelector("[data-note-owner]")).toHaveAttribute("data-note-owner", "place:p");
    expect(
      noteView(screen.getByRole("textbox", { name: "Notiz für Hafen" })).state.doc.toString(),
    ).toBe("Nebel");
  });

  it("renders the empty inspector without editable fields", () => {
    render(
      <I18nProvider>
        <PlaceInspector
          selected={null}
          state={state}
          onPatch={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Ort auswählen")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
