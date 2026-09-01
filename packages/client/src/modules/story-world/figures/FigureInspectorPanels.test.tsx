import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { NoteReferenceProvider } from "../../notes";
import type { WorldReferenceBacklinkIndex } from "../../world-references";
import type { FigureState } from "../model";
import { FigureCardPanel } from "./FigureCardPanel";
import { FigureProfilePanel } from "./FigureProfilePanel";
import { FigureRelationshipsPanel } from "./FigureRelationshipsPanel";

afterEach(cleanup);

const state: FigureState = {
  nodes: [
    {
      id: "ada",
      x: 0,
      y: 0,
      name: "Ada",
      type: "person",
      profile: {
        notizen: "Kennt den nördlichen Weg.",
        fields: [{ id: "age", key: "Alter", value: "" }],
      },
    },
    { id: "bela", x: 100, y: 0, name: "Bela", type: "person" },
  ],
  edges: [{ id: "friends", from: "ada", to: "bela", label: "Freunde" }],
};

describe("FigureInspector panels", () => {
  it("keeps relationship layout rules outside shared select and checkbox internals", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/FigureInspector.css"),
      "utf8",
    );

    expect(css).toMatch(/\.relationship-heading\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(
      /\.relation-list > div > \.graph-edge-line-style-select,[^{]*\.check-field\s*\{[^}]*grid-column:\s*1 \/ -1/s,
    );
    expect(css).not.toMatch(/\.relation-list > div > div\s*\{/);
    expect(css).not.toMatch(/\.relation-list span\s*\{/);
    expect(css).not.toMatch(/\.check-field\s*\{[^}]*display:\s*flex/s);
  });

  it("keeps alias actions touch-sized and uses the semantic focus roles", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/FigureInspector.css"),
      "utf8",
    );
    const aliasActionRule = css.match(/\.alias-add\s*\{([^}]*)\}/s)?.[1];
    const aliasFocusRule = css.match(/\.alias-add:focus-visible\s*\{([^}]*)\}/s)?.[1];

    expect(aliasActionRule).toBeDefined();
    expect(aliasActionRule).not.toMatch(/\bmin-height\s*:/);
    expect(aliasFocusRule).toContain("border-color: var(--focus-ring)");
    expect(aliasFocusRule).toContain("background: var(--focus-surface)");
    expect(aliasFocusRule).toContain("color: var(--ink)");
    expect(css).not.toMatch(/\.alias-input:focus-visible\s*\{/);
  });

  it("keeps card priority changes inside the card panel contract", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <FigureCardPanel
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onPatch={onPatch}
          onState={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Als wichtig markieren" }));
    expect(onPatch).toHaveBeenCalledWith({ important: true });
  });

  it("commits a completed figure rename once instead of patching every typed character", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <FigureCardPanel
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onPatch={onPatch}
          onState={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Ada");

    fireEvent.change(name, { target: { value: "A" } });
    fireEvent.change(name, { target: { value: "Ad" } });
    fireEvent.change(name, { target: { value: "Ada L" } });
    fireEvent.change(name, { target: { value: "Ada Lovelace" } });

    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: "Ada Lovelace" });
  });

  it("does not commit unchanged or cancelled figure names", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <FigureCardPanel
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onPatch={onPatch}
          onState={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    const name = screen.getByRole("textbox", { name: "Name" });

    name.focus();
    fireEvent.blur(name);
    expect(onPatch).not.toHaveBeenCalled();

    name.focus();
    fireEvent.change(name, { target: { value: "Ada Byron" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect(name).toHaveValue("Ada");
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("commits a figure rename through Enter exactly once", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <FigureCardPanel
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onPatch={onPatch}
          onState={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    const name = screen.getByRole("textbox", { name: "Name" });

    name.focus();
    fireEvent.change(name, { target: { value: "Ada Lovelace" } });
    fireEvent.keyDown(name, { key: "Enter" });
    name.blur();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: "Ada Lovelace" });
  });

  it("puts the large notes surface first and owns canonical profile field patches", () => {
    const onPatch = vi.fn();
    const view = render(
      <I18nProvider>
        <FigureProfilePanel figure={state.nodes[0]} onPatch={onPatch} />
      </I18nProvider>,
    );

    const notes = screen.getByRole("textbox", { name: "Notizen" });
    const age = screen.getByRole("textbox", { name: "Alter Inhalt" });
    expect(notes.compareDocumentPosition(age) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.container.querySelector(".figure-profile-notes-control")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Feldname: Alter" }), {
      target: { value: "31" },
    });
    expect(onPatch).toHaveBeenCalledWith({
      profile: {
        notizen: "Kennt den nördlichen Weg.",
        fields: [{ id: "age", key: "31", value: "" }],
      },
    });

    fireEvent.change(age, { target: { value: "31" } });
    expect(onPatch).toHaveBeenLastCalledWith({
      profile: {
        notizen: "Kennt den nördlichen Weg.",
        fields: [{ id: "age", key: "Alter", value: "31" }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Feld hinzufügen" }));
    expect(screen.getByRole("menuitem", { name: "Alter" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Aussehen" }));
    expect(onPatch).toHaveBeenLastCalledWith({
      profile: {
        notizen: "Kennt den nördlichen Weg.",
        fields: [
          { id: "age", key: "Alter", value: "" },
          { id: expect.stringMatching(/^pf/), key: "Aussehen", value: "" },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Feld „Alter“ entfernen" }));
    expect(onPatch).toHaveBeenLastCalledWith({
      profile: { notizen: "Kennt den nördlichen Weg.", fields: [] },
    });
  });

  it("normalizes legacy fixed and custom fields into deterministic canonical fields", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <FigureProfilePanel
          figure={{
            ...state.nodes[0],
            profile: {
              alter: "31",
              extra: [{ k: "Geheimnis", v: "Kennt den Weg" }],
            },
          }}
          onPatch={onPatch}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Alter Inhalt" }), {
      target: { value: "32" },
    });
    expect(onPatch).toHaveBeenCalledWith({
      profile: {
        fields: [
          {
            id: "profile-field:ada:legacy:alter",
            key: "Alter",
            value: "32",
          },
          {
            id: "profile-field:ada:extra:0",
            key: "Geheimnis",
            value: "Kennt den Weg",
          },
        ],
      },
    });
  });

  it("shows deterministic backlinks and opens their source from the profile", () => {
    const onOpenReference = vi.fn();
    const backlinks: WorldReferenceBacklinkIndex = new Map([
      [
        "entity:ada",
        [
          {
            id: "chapter-note:c1:ada:0",
            origin: "text",
            target: { kind: "entity", id: "ada" },
            source: {
              target: { kind: "chapter", id: "c1" },
              workspace: "text",
              label: "Die Ankunft",
              detail: "Akt I",
              kind: "chapter-note",
            },
            surface: "Ada",
            from: 4,
            to: 7,
          },
          {
            id: "storyboard-reference:reference-ada",
            origin: "card",
            target: { kind: "entity", id: "ada" },
            source: {
              target: { kind: "storyboard", id: "reference-ada" },
              workspace: "storyboard",
              label: "Begegnung im Garten",
              detail: "Akt I",
              kind: "storyboard-reference",
              boardId: "board-act-one",
              nodeId: "reference-ada",
            },
          },
        ],
      ],
    ]);
    render(
      <I18nProvider>
        <NoteReferenceProvider
          candidates={[]}
          backlinks={backlinks}
          onOpenReference={onOpenReference}
        >
          <FigureProfilePanel figure={state.nodes[0]} onPatch={vi.fn()} />
        </NoteReferenceProvider>
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Verweise" })).toBeVisible();
    const source = screen.getByRole("button", {
      name: "Kapitel – Die Ankunft – Akt I – Ada",
    });
    expect(source).toHaveTextContent("Die Ankunft");
    expect(source).toHaveTextContent("Kapitel");
    expect(source).toHaveTextContent("Akt I");
    expect(source).toHaveTextContent("„Ada“");

    fireEvent.click(source);
    expect(onOpenReference).toHaveBeenCalledWith({ kind: "chapter", id: "c1" });

    const storyboardSource = screen.getByRole("button", {
      name: "Storyboard – Begegnung im Garten – Akt I",
    });
    expect(storyboardSource).toHaveTextContent("Begegnung im Garten");
    expect(storyboardSource).toHaveTextContent("Storyboard");
    expect(storyboardSource).not.toHaveTextContent("„“");

    fireEvent.click(storyboardSource);
    expect(onOpenReference).toHaveBeenLastCalledWith({
      kind: "storyboard",
      id: "reference-ada",
    });
  });

  it("keeps the profile backlink empty state calm and explicit", () => {
    render(
      <I18nProvider>
        <NoteReferenceProvider candidates={[]} backlinks={new Map()} onOpenReference={vi.fn()}>
          <FigureProfilePanel figure={state.nodes[0]} onPatch={vi.fn()} />
        </NoteReferenceProvider>
      </I18nProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Noch keine Verweise auf dieses Element.");
  });

  it("owns relationship edits and delete requests", () => {
    const onState = vi.fn();
    const onRequestDelete = vi.fn();
    render(
      <I18nProvider>
        <FigureRelationshipsPanel
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onState={onState}
          onRequestDelete={onRequestDelete}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Beziehung zu Bela" }), {
      target: { value: "Rivalen" },
    });
    expect(onState).toHaveBeenCalledWith({
      ...state,
      edges: [{ ...state.edges[0], label: "Rivalen" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Beziehung löschen" }));
    expect(onRequestDelete).toHaveBeenCalledWith(state.edges[0], "Bela");
  });

  it("prevents duplicate relationships when changing or reversing direction", () => {
    const conflictState: FigureState = {
      ...state,
      edges: [
        { ...state.edges[0], gerichtet: true },
        { id: "reverse", from: "bela", to: "ada", label: "Rückweg", gerichtet: true },
        { id: "undirected", from: "ada", to: "bela", label: "Bekannt", gerichtet: false },
      ],
    };
    render(
      <I18nProvider>
        <FigureRelationshipsPanel
          figure={conflictState.nodes[0]}
          state={conflictState}
          activeMomentId={null}
          onState={vi.fn()}
          onRequestDelete={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getAllByRole("button", { name: /Richtung umkehren/ })[0]).toBeDisabled();
    expect(screen.getAllByRole("checkbox", { name: "Gerichtet" })[0]).toBeDisabled();
    expect(
      screen.getAllByText("Diese Beziehung existiert an diesem Zeitpunkt bereits."),
    ).not.toHaveLength(0);
  });
});
