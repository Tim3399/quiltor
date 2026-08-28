import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { FigureInspector } from "./FigureInspector";

afterEach(cleanup);

const state: FigureState = {
  nodes: [
    {
      id: "ada",
      x: 0,
      y: 0,
      name: "Ada",
      type: "person",
      profile: { fields: [{ id: "age", key: "Alter", value: "" }] },
    },
    { id: "bela", x: 300, y: 0, name: "Bela", type: "person" },
  ],
  edges: [{ id: "friends", from: "ada", to: "bela", label: "Freunde" }],
};

describe("FigureInspector", () => {
  it("sizes its tabs by content so longer labels stay visible", () => {
    render(
      <I18nProvider>
        <FigureInspector
          figure={state.nodes[0]}
          state={state}
          activeMomentId={null}
          onPatch={vi.fn()}
          onState={vi.fn()}
          onDelete={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("tablist", { name: "Inspector" })).toHaveAttribute(
      "data-distribution",
      "content",
    );
  });

  it("renders every visible figure selector through the styled shared control", () => {
    const onPatch = vi.fn();
    const onState = vi.fn();
    const view = render(
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

    const kind = screen.getByRole("combobox", { name: "Art" });
    const accent = screen.getByRole("combobox", { name: "Akzent" });
    expect(kind.tagName).toBe("BUTTON");
    expect(accent.tagName).toBe("BUTTON");
    expect(kind).toHaveClass("ui-select-control");
    expect(accent).toHaveClass("ui-select-control");
    expect(view.container.querySelector("select")).toBeNull();

    fireEvent.click(kind);
    fireEvent.click(screen.getByRole("option", { name: "Tier" }));
    expect(onPatch).toHaveBeenCalledWith({ type: "tier" });

    fireEvent.click(accent);
    fireEvent.click(screen.getByRole("option", { name: "Gold" }));
    expect(onPatch).toHaveBeenCalledWith({ accent: "gold" });

    fireEvent.click(screen.getByRole("tab", { name: "Beziehungen" }));
    const lineStyle = screen.getByRole("combobox", { name: "Linienstil" });
    expect(lineStyle.tagName).toBe("BUTTON");
    expect(lineStyle).toHaveClass("ui-select-control");
    expect(view.container.querySelector("select")).toBeNull();

    fireEvent.click(lineStyle);
    fireEvent.click(screen.getByRole("option", { name: "Gestrichelt" }));
    expect(onState).toHaveBeenCalledWith({
      ...state,
      edges: [{ ...state.edges[0], style: "dashed" }],
    });
  });

  it("keeps the styled line selector disabled when the relationship is inactive", () => {
    const inactiveState: FigureState = {
      ...state,
      edges: [{ ...state.edges[0], active: false }],
    };
    render(
      <I18nProvider>
        <FigureInspector
          figure={inactiveState.nodes[0]}
          state={inactiveState}
          activeMomentId={null}
          onPatch={vi.fn()}
          onState={vi.fn()}
          onDelete={vi.fn()}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Beziehungen" }));
    const lineStyle = screen.getByRole("combobox", { name: "Linienstil" });
    expect(lineStyle).toBeDisabled();
    fireEvent.click(lineStyle);
    expect(screen.queryByRole("listbox", { name: "Linienstil" })).not.toBeInTheDocument();
  });

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
    fireEvent.change(screen.getByRole("textbox", { name: "Alter Inhalt" }), {
      target: { value: "31" },
    });
    expect(onPatch).toHaveBeenCalledWith({
      profile: { fields: [{ id: "age", key: "Alter", value: "31" }] },
    });

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
