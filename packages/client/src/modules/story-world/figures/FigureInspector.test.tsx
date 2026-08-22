import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { FigureInspector } from "./FigureInspector";

afterEach(cleanup);

const state: FigureState = {
  nodes: [
    { id: "ada", x: 0, y: 0, name: "Ada", type: "person", profile: { extra: [] } },
    { id: "bela", x: 300, y: 0, name: "Bela", type: "person" },
  ],
  edges: [{ id: "friends", from: "ada", to: "bela", label: "Freunde" }],
};

describe("FigureInspector", () => {
  it("keeps profile and relationship editing behind their owned tabs", () => {
    const onPatch = vi.fn();
    const onState = vi.fn();
    render(
      <I18nProvider>
        <FigureInspector
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onPatch={onPatch}
          onState={onState}
          onDelete={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Steckbrief" }));
    fireEvent.change(screen.getByLabelText("Alter"), { target: { value: "31" } });
    expect(onPatch).toHaveBeenCalledWith({ profile: { extra: [], alter: "31" } });

    fireEvent.click(screen.getByRole("tab", { name: "Beziehungen" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Beziehung zu Bela" }), {
      target: { value: "Rivalen" },
    });
    expect(onState).toHaveBeenCalledWith({
      ...state,
      edges: [{ ...state.edges[0], label: "Rivalen" }],
    });
  });
});
