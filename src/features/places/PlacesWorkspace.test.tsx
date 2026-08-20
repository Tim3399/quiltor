import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../language";
import type { FigureState } from "../../types";
import { PlacesWorkspace } from "./PlacesWorkspace";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    edges,
    minZoom,
    nodes,
    onMove,
  }: {
    edges: Array<{ id: string; label: string }>;
    minZoom: number;
    nodes: Array<{ id: string; data: { zoomTier: string } }>;
    onMove: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
  }) => (
    <div data-testid="places-flow" data-min-zoom={minZoom}>
      {nodes.map((node) => (
        <span data-testid="place-zoom-tier" key={node.id}>
          {node.data.zoomTier}
        </span>
      ))}
      {edges.map((edge) => (
        <span data-testid="distance-edge" key={edge.id}>
          {edge.label}
        </span>
      ))}
      <button type="button" onClick={() => onMove({}, { x: 0, y: 0, zoom: 0.2 })}>
        Testübersicht
      </button>
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Lines: "lines" },
  Position: { Bottom: "bottom", Top: "top" },
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  useUpdateNodeInternals: () => vi.fn(),
}));

afterEach(cleanup);

const state: FigureState = {
  nodes: [
    { id: "a", x: 0, y: 0, mapX: 0, mapY: 0, name: "A", type: "ort" },
    { id: "b", x: 300, y: 0, mapX: 300, mapY: 0, name: "B", type: "ort" },
    { id: "c", x: 0, y: 400, mapX: 0, mapY: 400, name: "C", type: "ort" },
  ],
  edges: [],
  mapScale: { unitsPer100px: 1, unitLabel: "km" },
};

describe("PlacesWorkspace map overlays", () => {
  it("shows every distance without selecting pairs and uses the figure zoom tiers", () => {
    render(
      <LanguageProvider>
        <PlacesWorkspace state={state} onChange={vi.fn()} onOpen={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByTestId("places-flow")).toHaveAttribute("data-min-zoom", "0.08");
    expect(screen.queryAllByTestId("distance-edge")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    expect(screen.getAllByTestId("distance-edge")).toHaveLength(3);
    expect(screen.getAllByTestId("distance-edge").map((edge) => edge.textContent)).toEqual([
      "3 km",
      "4 km",
      "5 km",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Testübersicht" }));
    expect(screen.getAllByTestId("place-zoom-tier")).toHaveLength(3);
    for (const tier of screen.getAllByTestId("place-zoom-tier"))
      expect(tier).toHaveTextContent("overview");
  });
});
