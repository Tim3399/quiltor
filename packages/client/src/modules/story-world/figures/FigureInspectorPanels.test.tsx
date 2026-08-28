import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
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
});
