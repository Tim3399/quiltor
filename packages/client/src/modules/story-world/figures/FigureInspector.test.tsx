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

  it("adds, edits and removes aliases without losing extension fields", () => {
    const onPatch = vi.fn();
    const figure = {
      ...state.nodes[0],
      aliases: [
        {
          alias: "Die Kartographin",
          source: "import" as const,
          futureField: { kept: true },
        },
      ],
    };
    render(
      <I18nProvider>
        <FigureInspector
          figure={figure}
          state={{ ...state, nodes: [figure, state.nodes[1]] }}
          activeMomentId={null}
          onPatch={onPatch}
          onState={vi.fn()}
          onDelete={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Alias hinzufügen" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Neuer Alias" }), {
      target: { value: "Ada Venn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Alias speichern" }));
    expect(onPatch).toHaveBeenCalledWith({
      aliases: [...figure.aliases, { alias: "Ada Venn", source: "manual" }],
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Alias „Die Kartographin“ bearbeiten" }), {
      target: { value: "Die Zeichnerin" },
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Alias „Die Kartographin“ bearbeiten" }));
    expect(onPatch).toHaveBeenCalledWith({
      aliases: [
        {
          alias: "Die Zeichnerin",
          source: "import",
          futureField: { kept: true },
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Alias „Die Kartographin“ entfernen" }));
    expect(onPatch).toHaveBeenCalledWith({ aliases: [] });
  });

  it("keeps empty, canonical-name and normalized duplicate aliases out of state", () => {
    const onPatch = vi.fn();
    const figure = {
      ...state.nodes[0],
      aliases: [{ alias: "Die Kartographin", source: "manual" as const }],
    };
    render(
      <I18nProvider>
        <FigureInspector
          figure={figure}
          state={{ ...state, nodes: [figure, state.nodes[1]] }}
          activeMomentId={null}
          onPatch={onPatch}
          onState={vi.fn()}
          onDelete={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Alias hinzufügen" }));
    const input = screen.getByRole("textbox", { name: "Neuer Alias" });
    fireEvent.click(screen.getByRole("button", { name: "Alias speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Gib einen Namen ein.");

    fireEvent.change(input, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Alias speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Der Alias entspricht bereits dem Hauptnamen.",
    );

    fireEvent.change(input, { target: { value: "Die-Kartographin" } });
    fireEvent.click(screen.getByRole("button", { name: "Alias speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Dieser Alias ist bereits vorhanden.");
    expect(onPatch).not.toHaveBeenCalled();
  });
});
