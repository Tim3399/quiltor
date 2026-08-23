import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { PLACE_COMPACT_MEDIA_QUERY, PlacesWorkspace } from "./PlacesWorkspace";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    edges,
    minZoom,
    nodes,
    onKeyDown,
    onMove,
    onNodeClick,
    onNodeDragStop,
  }: {
    edges: Array<{
      id: string;
      label: string;
      ariaLabel?: string;
      position: { x: number; y: number };
      className?: string;
      focusable?: boolean;
    }>;
    minZoom: number;
    nodes: Array<{
      id: string;
      draggable?: boolean;
      ariaLabel?: string;
      data: {
        zoomTier: string;
        place: { name: string; important?: boolean; pinned?: boolean };
      };
    }>;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    onMove: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
    onNodeClick: (event: unknown, node: { id: string }) => void;
    onNodeDragStop: (
      event: unknown,
      node: { id: string; position: { x: number; y: number } },
    ) => void;
  }) => (
    <div role="application" data-testid="places-flow" data-min-zoom={minZoom} onKeyDown={onKeyDown}>
      {nodes.map((node) => (
        <div key={node.id}>
          <button
            type="button"
            className="react-flow__node"
            data-id={node.id}
            aria-label={node.ariaLabel}
            data-testid={`place-node-${node.id}`}
            data-draggable={String(node.draggable !== false)}
            data-important={String(!!node.data.place.important)}
            onClick={() => onNodeClick({}, node)}
          >
            {node.data.place.name}
          </button>
          <span data-testid="place-zoom-tier">{node.data.zoomTier}</span>
          <button
            type="button"
            onClick={() => onNodeDragStop({}, { ...node, position: { x: 75, y: 85 } })}
          >
            Testziehen {node.data.place.name}
          </button>
        </div>
      ))}
      {edges.map((edge) => (
        <span
          role="img"
          aria-label={edge.ariaLabel}
          data-testid="distance-edge"
          data-edge-id={edge.id}
          data-class-name={edge.className}
          tabIndex={edge.focusable ? 0 : undefined}
          key={edge.id}
        >
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const state: FigureState = {
  nodes: [
    { id: "a", x: 0, y: 0, mapX: 0, mapY: 0, name: "A", type: "ort" },
    { id: "b", x: 300, y: 0, mapX: 300, mapY: 0, name: "B", type: "ort" },
    { id: "c", x: 0, y: 400, mapX: 0, mapY: 400, name: "C", type: "ort" },
  ],
  edges: [],
  mapScale: { unitsPer100px: 1, unitLabel: "km" },
};

const sixPlaces: FigureState = {
  nodes: [
    { id: "a", x: 0, y: 0, mapX: 0, mapY: 0, name: "A", type: "ort" },
    { id: "b", x: 10, y: 0, mapX: 10, mapY: 0, name: "B", type: "ort" },
    { id: "c", x: 20, y: 0, mapX: 20, mapY: 0, name: "C", type: "ort" },
    { id: "d", x: 1000, y: 0, mapX: 1000, mapY: 0, name: "D", type: "ort" },
    { id: "e", x: 1010, y: 0, mapX: 1010, mapY: 0, name: "E", type: "ort" },
    { id: "f", x: 1020, y: 0, mapX: 1020, mapY: 0, name: "F", type: "ort" },
  ],
  edges: [],
  mapScale: { unitsPer100px: 1, unitLabel: "km" },
};

function ControlledPlaces({
  initialState,
  onChange,
}: {
  initialState: FigureState;
  onChange: (state: FigureState) => void;
}) {
  const [value, setValue] = useState(initialState);
  return (
    <I18nProvider>
      <PlacesWorkspace
        state={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        onOpen={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("PlacesWorkspace map overlays", () => {
  it("matches the 820px canvas breakpoint so the inspector never becomes a second grid row", () => {
    const matchMediaMock = vi.fn((query: string) => ({
      matches: query === PLACE_COMPACT_MEDIA_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);

    const { container } = render(
      <I18nProvider>
        <PlacesWorkspace state={state} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>,
    );

    expect(PLACE_COMPACT_MEDIA_QUERY).toBe("(max-width: 820px)");
    expect(matchMediaMock).toHaveBeenCalledWith("(max-width: 820px)");
    expect(container.querySelector(".places-inspector")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("place-node-a"));
    expect(screen.getByRole("dialog", { name: "Orte-Inspector" })).toBeInTheDocument();
  });

  it("uses one centered empty state instead of duplicating it in the inspector", () => {
    const { container } = render(
      <I18nProvider>
        <PlacesWorkspace state={{ nodes: [], edges: [] }} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>,
    );

    expect(container.querySelector(".places-layout-empty")).toBeInTheDocument();
    expect(container.querySelectorAll(".places-manager-empty")).toHaveLength(1);
    expect(container.querySelector(".places-inspector")).not.toBeInTheDocument();
    expect(screen.queryByText("Ort auswählen")).not.toBeInTheDocument();
  });

  it("shows all available distances below four places and uses the figure zoom tiers", () => {
    render(
      <I18nProvider>
        <PlacesWorkspace state={state} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>,
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
    expect(screen.getByRole("img", { name: "A – B: 3 km" })).not.toHaveAttribute("tabindex");

    fireEvent.click(screen.getByRole("button", { name: "Testübersicht" }));
    expect(screen.getAllByTestId("place-zoom-tier")).toHaveLength(3);
    for (const tier of screen.getAllByTestId("place-zoom-tier"))
      expect(tier).toHaveTextContent("overview");
  });

  it("keeps distances stable when a place is favorited or the LOD changes", () => {
    const changes: FigureState[] = [];
    render(
      <ControlledPlaces
        initialState={{ ...state, nodes: state.nodes.slice(0, 2) }}
        onChange={(next) => changes.push(next)}
      />,
    );

    fireEvent.click(screen.getByTestId("place-node-b"));
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    expect(screen.getByTestId("distance-edge")).toHaveTextContent("3 km");

    fireEvent.click(screen.getByRole("button", { name: "Ort favorisieren" }));
    expect(screen.getByTestId("distance-edge")).toHaveTextContent("3 km");
    expect(changes[changes.length - 1].nodes[1]).toMatchObject({ important: true });

    fireEvent.click(screen.getByRole("button", { name: "Testübersicht" }));
    expect(screen.getByTestId("distance-edge")).toHaveTextContent("3 km");
    for (const tier of screen.getAllByTestId("place-zoom-tier"))
      expect(tier).toHaveTextContent("overview");
  });

  it("shows the deduplicated three-nearest graph and adds an arbitrary selected pair", () => {
    render(
      <I18nProvider>
        <PlacesWorkspace state={sixPlaces} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    const automatic = screen.getAllByTestId("distance-edge");
    expect(automatic).toHaveLength(11);
    expect(automatic.map((edge) => edge.dataset.edgeId)).not.toContain("distance:a:f");
    expect(new Set(automatic.map((edge) => edge.dataset.edgeId)).size).toBe(automatic.length);

    fireEvent.click(screen.getByTestId("place-node-a"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wähle den zweiten Ort für die gezielte Distanz.",
    );
    fireEvent.click(screen.getByTestId("place-node-f"));

    const withTarget = screen.getAllByTestId("distance-edge");
    expect(withTarget).toHaveLength(12);
    expect(new Set(withTarget.map((edge) => edge.dataset.edgeId)).size).toBe(withTarget.length);
    expect(withTarget.find((edge) => edge.dataset.edgeId === "distance:a:f")).toHaveAttribute(
      "data-class-name",
      "distance-edge is-targeted",
    );

    fireEvent.click(screen.getByTestId("place-node-b"));
    fireEvent.click(screen.getByTestId("place-node-c"));
    const targetedAutomaticPair = screen.getAllByTestId("distance-edge");
    expect(targetedAutomaticPair).toHaveLength(11);
    expect(
      targetedAutomaticPair.find((edge) => edge.dataset.edgeId === "distance:b:c"),
    ).toHaveAttribute("data-class-name", "distance-edge is-targeted");
  });

  it("keeps compact measurement on the map and opens the last place after measuring", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(
      <I18nProvider>
        <PlacesWorkspace state={sixPlaces} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    fireEvent.click(screen.getByTestId("place-node-a"));
    expect(screen.queryByRole("dialog", { name: "Orte-Inspector" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("place-node-f"));
    expect(screen.queryByRole("dialog", { name: "Orte-Inspector" })).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("distance-edge").find((edge) => edge.dataset.edgeId === "distance:a:f"),
    ).toHaveAttribute("data-class-name", "distance-edge is-targeted");

    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    expect(screen.getByRole("dialog", { name: "Orte-Inspector" })).toHaveTextContent("F");
  });

  it("selects and measures labeled place nodes with Enter and Space", () => {
    render(
      <I18nProvider>
        <PlacesWorkspace state={sixPlaces} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Ort: A" }), { key: "Enter" });
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Ort: A" }), { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wähle den zweiten Ort für die gezielte Distanz.",
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Ort: F" }), { key: " " });

    const targeted = screen
      .getAllByTestId("distance-edge")
      .find((edge) => edge.dataset.edgeId === "distance:a:f");
    expect(targeted).toHaveAttribute("data-class-name", "distance-edge is-targeted");
    for (const edge of screen.getAllByTestId("distance-edge"))
      expect(edge).not.toHaveAttribute("tabindex");
  });

  it("persists favorite and position lock flags and makes a locked place non-draggable", () => {
    const changes: FigureState[] = [];
    render(
      <ControlledPlaces
        initialState={{ ...state, nodes: [state.nodes[0]] }}
        onChange={(next) => changes.push(next)}
      />,
    );

    fireEvent.click(screen.getByTestId("place-node-a"));
    fireEvent.click(screen.getByRole("button", { name: "Testziehen A" }));
    expect(changes[changes.length - 1].nodes[0]).toMatchObject({ mapX: 75, mapY: 85 });

    fireEvent.click(screen.getByRole("button", { name: "Ort favorisieren" }));
    expect(screen.getByTestId("place-node-a")).toHaveAttribute("data-important", "true");
    expect(screen.getByRole("button", { name: "Favorit entfernen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Position fixieren" }));
    expect(screen.getByTestId("place-node-a")).toHaveAttribute("data-draggable", "false");
    expect(screen.getByRole("button", { name: "Position lösen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(changes[changes.length - 1].nodes[0]).toMatchObject({
      id: "a",
      important: true,
      pinned: true,
    });
  });
});
