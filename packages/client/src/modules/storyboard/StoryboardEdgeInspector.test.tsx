import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { GraphEdgeColor, GraphEdgeLineStyle } from "../graph";
import type { StoryboardEdge } from "./model";
import { StoryboardEdgeInspector } from "./StoryboardEdgeInspector";

afterEach(cleanup);

function renderInspector(
  edge: StoryboardEdge,
  overrides: Partial<{
    toggleConflict: boolean;
    reverseConflict: boolean;
    onLabelChange: (label: string) => void;
    onDirectedChange: (directed: boolean) => void;
    onLineStyleChange: (lineStyle: GraphEdgeLineStyle) => void;
    onColorChange: (color: GraphEdgeColor) => void;
    onReverse: () => void;
  }> = {},
) {
  const callbacks = {
    onLabelChange: vi.fn(),
    onDirectedChange: vi.fn(),
    onLineStyleChange: vi.fn(),
    onColorChange: vi.fn(),
    onReverse: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <StoryboardEdgeInspector
        edge={edge}
        sourceLabel="Anfang"
        targetLabel="Ende"
        toggleConflict={overrides.toggleConflict ?? false}
        reverseConflict={overrides.reverseConflict ?? false}
        {...callbacks}
      />
    </I18nProvider>,
  );
  return callbacks;
}

const edge: StoryboardEdge = {
  id: "edge-one",
  boardId: "main-storyboard",
  sourceNodeId: "start",
  targetNodeId: "end",
  label: "Auslöser",
};

describe("StoryboardEdgeInspector", () => {
  it("edits an undirected edge without offering a meaningless reverse action", () => {
    const callbacks = renderInspector(edge);

    expect(screen.getByRole("region", { name: "Verbindung" })).toHaveTextContent("Anfang ↔ Ende");
    const label = screen.getByRole("textbox", { name: "Beschriftung" });
    expect(label).toHaveValue("Auslöser");
    fireEvent.change(label, { target: { value: "Konsequenz" } });
    expect(callbacks.onLabelChange).toHaveBeenCalledWith("Konsequenz");

    const directed = screen.getByRole("checkbox", { name: "Gerichtet" });
    expect(directed).not.toBeChecked();
    fireEvent.click(directed);
    expect(callbacks.onDirectedChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: "Richtung umkehren" })).not.toBeInTheDocument();

    const color = screen.getByRole("combobox", { name: "Kantenfarbe" });
    expect(color).toHaveTextContent("Automatisch (nach Richtung)");
    fireEvent.click(color);
    fireEvent.click(screen.getByRole("option", { name: "Gold" }));
    expect(callbacks.onColorChange).toHaveBeenCalledWith("gold");

    const lineStyle = screen.getByRole("combobox", { name: "Linienart" });
    expect(lineStyle).toHaveTextContent("Durchgezogen");
    fireEvent.click(lineStyle);
    fireEvent.click(screen.getByRole("option", { name: "Gepunktet" }));
    expect(callbacks.onLineStyleChange).toHaveBeenCalledWith("dotted");
  });

  it("reverses a directed edge and explains deterministic duplicate conflicts", () => {
    const callbacks = renderInspector(
      { ...edge, directed: true },
      { toggleConflict: true, reverseConflict: true },
    );

    expect(screen.getByRole("region", { name: "Verbindung" })).toHaveTextContent("Anfang → Ende");
    expect(screen.getByRole("checkbox", { name: "Gerichtet" })).toBeDisabled();
    const reverse = screen.getByRole("button", { name: "Richtung umkehren" });
    expect(reverse).toBeDisabled();
    expect(screen.getAllByText("Diese Verbindung existiert bereits.")).toHaveLength(2);
    fireEvent.click(reverse);
    expect(callbacks.onReverse).not.toHaveBeenCalled();
  });

  it("delegates direction reversal when no opposite edge exists", () => {
    const callbacks = renderInspector({ ...edge, directed: true });

    fireEvent.click(screen.getByRole("button", { name: "Richtung umkehren" }));
    expect(callbacks.onReverse).toHaveBeenCalledTimes(1);
  });
});
