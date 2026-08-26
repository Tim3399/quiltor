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
    { id: "ada", x: 0, y: 0, name: "Ada", type: "person", profile: { extra: [] } },
    { id: "bela", x: 100, y: 0, name: "Bela", type: "person" },
  ],
  edges: [{ id: "friends", from: "ada", to: "bela", label: "Freunde" }],
};

describe("FigureInspector panels", () => {
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

  it("owns profile field patches", () => {
    const onPatch = vi.fn();
    render(
      <I18nProvider>
        <FigureProfilePanel figure={state.nodes[0]} onPatch={onPatch} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Alter" }), {
      target: { value: "31" },
    });
    expect(onPatch).toHaveBeenCalledWith({ profile: { extra: [], alter: "31" } });
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
