import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { quiltorClient } from "../../../platform";
import type { FigureState } from "../model";
import { PlaceMapChrome } from "./PlaceMapChrome";
import type { ActivePlaceMapChromeProps } from "./PlaceMapChromeOverlay";
import { PLACE_COMPACT_MEDIA_QUERY, PlacesWorkspace } from "./PlacesWorkspace";
import { DEFAULT_MAP_WIDTH } from "./placeCanvasModel";
import * as placeMapUpload from "./placeMapUpload";

// World/viewport projection has its own pure tests; this suite exercises the
// workspace's selection and persistence paths with an available screen area.
vi.mock("./PlaceMapChromeOverlay", () => ({
  PlaceMapChromeOverlay: ({ chrome }: { chrome: ActivePlaceMapChromeProps }) => (
    <PlaceMapChrome
      {...chrome}
      zoom={1}
      layout={{
        left: 10,
        width: 800,
        headerTop: 10,
        footerTop: 500,
        imageTop: 56,
        imageHeight: 444,
        frameHeight: 532,
      }}
    />
  ),
}));

const flowInstance = vi.hoisted(() => ({
  fitView: vi.fn(),
  getZoom: () => 1,
  setCenter: vi.fn(),
  setViewport: vi.fn(),
  screenToFlowPosition: (point: { x: number; y: number }) => point,
}));

// Like React Flow, hands the instance over once, on mount.
function FlowInit({ onInit }: { onInit?: (instance: typeof flowInstance) => void }) {
  const [initial] = useState(() => onInit);
  useEffect(() => initial?.(flowInstance), [initial]);
  return null;
}

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    edges,
    onInit,
    minZoom,
    nodes,
    onKeyDown,
    onMove,
    onNodeClick,
    onNodeDragStop,
    onPaneClick,
  }: {
    onInit?: (instance: typeof flowInstance) => void;
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
        onResize?: (place: unknown, box: unknown, gesture: unknown) => void;
      };
    }>;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    onMove: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
    onNodeClick: (event: unknown, node: { id: string }) => void;
    onPaneClick: (event: unknown) => void;
    onNodeDragStop: (
      event: unknown,
      node: { id: string; position: { x: number; y: number } },
    ) => void;
  }) => (
    <div role="application" data-testid="places-flow" data-min-zoom={minZoom} onKeyDown={onKeyDown}>
      <FlowInit onInit={onInit} />
      {nodes
        .filter((node) => node.data.place)
        .map((node) => (
          <div key={node.id}>
            <button
              type="button"
              className="react-flow__node"
              data-id={node.id}
              aria-label={node.ariaLabel}
              data-testid={`place-node-${node.id}`}
              data-draggable={String(node.draggable !== false)}
              data-important={String(!!node.data.place.important)}
              onClick={(event) => onNodeClick(event, node)}
            >
              {node.data.place.name}
            </button>
            <span data-testid="place-zoom-tier">{node.data.zoomTier}</span>
            {node.data.onResize ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    node.data.onResize?.(
                      node.data.place,
                      { x: 0, y: 0, width: 1800, height: 1200 },
                      { start: { x: 0, y: 0, width: 1500, height: 1000 }, free: false },
                    )
                  }
                >
                  Testgröße {node.data.place.name}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    node.data.onResize?.(
                      node.data.place,
                      { x: 0, y: 0, width: 1800, height: 1000 },
                      { start: { x: 0, y: 0, width: 1500, height: 1000 }, free: true },
                    )
                  }
                >
                  Testverzerrung {node.data.place.name}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    node.data.onResize?.(
                      node.data.place,
                      { x: 0, y: 0, width: 2002, height: 1334.67 },
                      // React Flow measures whole pixels: the drawn start is not the stored size.
                      { start: { x: 0, y: 0, width: 1501, height: 1001 }, free: false },
                    )
                  }
                >
                  Testmessgröße {node.data.place.name}
                </button>
              </>
            ) : null}
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
      <button type="button" onClick={(event) => onPaneClick(event)}>
        Testfläche
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

function pngBlob(size = 8): Blob {
  const header = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([header, new Uint8Array(Math.max(0, size - header.length))]);
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
      "Wähle den zweiten Ort oder einen Punkt auf der Karte.",
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
      "Wähle den zweiten Ort oder einen Punkt auf der Karte.",
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

  it("adds two places before the next render without losing the first", () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <PlacesWorkspace state={state} onChange={onChange} onOpen={vi.fn()} />
      </I18nProvider>,
    );
    const add = screen.getByRole("button", { name: "Neuer Ort" });
    act(() => {
      add.click();
      add.click();
    });
    expect(onChange.mock.calls.at(-1)?.[0].nodes).toHaveLength(state.nodes.length + 2);
  });

  it("centers the view on a navigation target", async () => {
    flowInstance.setCenter.mockClear();
    render(
      <I18nProvider>
        <PlacesWorkspace
          state={state}
          onChange={vi.fn()}
          onOpen={vi.fn()}
          targetId="b"
          targetRequestId={1}
        />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(flowInstance.setCenter).toHaveBeenCalledWith(300, 0, expect.anything()),
    );
  });

  it("reselects a repeated navigation target after an internal selection", () => {
    const view = render(
      <I18nProvider>
        <PlacesWorkspace
          state={state}
          onChange={vi.fn()}
          onOpen={vi.fn()}
          targetId="a"
          targetRequestId={1}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("A");
    fireEvent.click(screen.getByTestId("place-node-b"));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("B");

    view.rerender(
      <I18nProvider>
        <PlacesWorkspace
          state={state}
          onChange={vi.fn()}
          onOpen={vi.fn()}
          targetId="a"
          targetRequestId={2}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("A");
  });
});

describe("adding a map", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("keeps the map it just made", async () => {
    // The regression this pins: creating the place and then patching it read two
    // different copies of the state, and the patch landed on one that had never
    // heard of the place -- dropping it again, so choosing a file did nothing.
    vi.spyOn(placeMapUpload, "askForMapImage").mockResolvedValue(pngBlob());
    vi.spyOn(placeMapUpload, "prepareMapImage").mockImplementation(async (file) => file);
    vi.spyOn(quiltorClient.application.placeMaps, "store").mockResolvedValue({
      id: "sha-of-the-map",
      mime: "image/png",
      width: 800,
      height: 400,
      byteSize: 4096,
    });

    const changes: FigureState[] = [];
    render(
      <ControlledPlaces
        initialState={{ nodes: [], edges: [] }}
        onChange={(next) => changes.push(next)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Neue Karte" }));
    await waitFor(() => expect(changes.length).toBeGreaterThan(0));

    const latest = changes[changes.length - 1];
    const map = latest.nodes.find((node) => node.mapImageId === "sha-of-the-map");
    expect(map).toBeDefined();
    expect(map).toMatchObject({ type: "ort", mapExpanded: true, mapWidth: DEFAULT_MAP_WIDTH });
    // Whatever the default width is, the picture keeps the shape it arrived in.
    expect(map?.mapHeight).toBe(DEFAULT_MAP_WIDTH / 2);
  });

  it("says so when the upload is refused instead of doing nothing", async () => {
    vi.spyOn(placeMapUpload, "askForMapImage").mockResolvedValue(pngBlob());
    vi.spyOn(placeMapUpload, "prepareMapImage").mockImplementation(async (file) => file);
    vi.spyOn(quiltorClient.application.placeMaps, "store").mockRejectedValue(new Error("nope"));

    render(<ControlledPlaces initialState={{ nodes: [], edges: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Neue Karte" }));

    // A danger toast announces assertively, so it is an alert rather than a status.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it.each([
    [
      "an image over the prepared limit",
      () => pngBlob(placeMapUpload.MAX_MAP_IMAGE_BYTES + 1),
      "Das Bild ist nach der Verarbeitung noch größer als 10 MiB. Wähle ein kleineres Bild.",
    ],
    [
      "unsupported prepared bytes",
      () => new Blob(["not-an-image"]),
      "Dieses Bildformat wird nicht unterstützt. Wähle eine PNG-, JPEG- oder WebP-Datei.",
    ],
  ])("rejects %s before upload", async (_name, prepared, message) => {
    vi.spyOn(placeMapUpload, "askForMapImage").mockResolvedValue(pngBlob());
    vi.spyOn(placeMapUpload, "prepareMapImage").mockImplementation(async () => prepared());
    const store = vi.spyOn(quiltorClient.application.placeMaps, "store");

    render(<ControlledPlaces initialState={{ nodes: [], edges: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Neue Karte" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(store).not.toHaveBeenCalled();
  });
});

describe("deleting places", () => {
  const map = {
    id: "map",
    type: "ort" as const,
    name: "Weltkarte",
    x: 0,
    y: 0,
    mapImageId: "bild",
  };
  const child = {
    id: "harbor",
    type: "ort" as const,
    name: "Hafen",
    x: 0,
    y: 0,
    parentPlaceId: map.id,
  };

  const requestDeletion = async (placeId: string) => {
    fireEvent.click(screen.getByTestId(`place-node-${placeId}`));
    fireEvent.click(screen.getByRole("button", { name: "Ortsaktionen" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ort löschen" }));
  };

  const useCompactLayout = () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === PLACE_COMPACT_MEDIA_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  };

  it("closes the compact inspector and announces why an occupied map is protected", async () => {
    useCompactLayout();
    const onChange = vi.fn();
    render(
      <ControlledPlaces initialState={{ nodes: [map, child], edges: [] }} onChange={onChange} />,
    );

    const mapNode = screen.getByTestId("place-node-map");
    mapNode.focus();
    fireEvent.click(mapNode);
    expect(screen.getByRole("dialog", { name: "Orte-Inspector" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ort löschen" }));

    expect(screen.queryByRole("dialog", { name: "Orte-Inspector" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: "Ort löschen" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "„Weltkarte“ kann noch nicht gelöscht werden.",
    );
    await waitFor(() => expect(mapNode).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves compact deletion from the inspector into a focused confirmation", async () => {
    useCompactLayout();
    const onChange = vi.fn();
    render(<ControlledPlaces initialState={{ nodes: [map], edges: [] }} onChange={onChange} />);

    const mapNode = screen.getByTestId("place-node-map");
    mapNode.focus();
    fireEvent.click(mapNode);
    fireEvent.click(screen.getByRole("button", { name: "Ort löschen" }));

    expect(screen.queryByRole("dialog", { name: "Orte-Inspector" })).not.toBeInTheDocument();
    const confirmation = screen.getByRole("alertdialog", { name: "Ort löschen" });
    const cancel = screen.getByRole("button", { name: "Abbrechen" });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Ort löschen" }));
    expect(confirmation).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [], edges: [], presence: [] }),
    );
  });

  it("keeps an occupied map and its nested places reachable", async () => {
    const onChange = vi.fn();
    const grandchild = {
      id: "dock",
      type: "ort" as const,
      name: "Kai",
      x: 0,
      y: 0,
      parentPlaceId: child.id,
    };
    render(
      <ControlledPlaces
        initialState={{ nodes: [map, child, grandchild], edges: [] }}
        onChange={onChange}
      />,
    );

    await requestDeletion(map.id);

    expect(screen.queryByRole("alertdialog", { name: "Ort löschen" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "„Weltkarte“ kann noch nicht gelöscht werden.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Darin befindet sich 1 weiterer Ort. Verschiebe oder lösche ihn zuerst.",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rechecks current contents before confirming a deletion", async () => {
    const onChange = vi.fn();
    const renderWorkspace = (value: FigureState) => (
      <I18nProvider>
        <PlacesWorkspace state={value} onChange={onChange} onOpen={vi.fn()} />
      </I18nProvider>
    );
    const initial = { nodes: [map], edges: [] };
    const { rerender } = render(renderWorkspace(initial));

    await requestDeletion(map.id);
    expect(screen.getByRole("alertdialog", { name: "Ort löschen" })).toBeInTheDocument();

    rerender(renderWorkspace({ nodes: [map, child], edges: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Ort löschen" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "Ort löschen" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Darin befindet sich 1 weiterer Ort. Verschiebe oder lösche ihn zuerst.",
    );
  });

  it("still deletes an empty place and cleans up its references", async () => {
    const onChange = vi.fn();
    const other = { id: "other", type: "ort" as const, name: "Anderswo", x: 10, y: 10 };
    const figure = { id: "figure", type: "person" as const, name: "Ada", x: 20, y: 20 };
    render(
      <I18nProvider>
        <PlacesWorkspace
          state={{
            nodes: [map, other, figure],
            edges: [
              { id: "map-edge", from: map.id, to: other.id },
              {
                id: "other-edge",
                from: other.id,
                to: figure.id,
                versions: [
                  { momentId: "then", from: map.id, to: figure.id, active: true },
                  { momentId: "now", from: other.id, to: figure.id, active: true },
                ],
              },
            ],
            timeline: [
              { id: "then", title: "Damals" },
              { id: "now", title: "Heute" },
            ],
            presence: [
              { id: "at-map", elementId: "figure", placeId: map.id },
              { id: "map-as-element", elementId: map.id, placeId: other.id },
              { id: "elsewhere", elementId: "figure", placeId: other.id },
            ],
          }}
          onChange={onChange}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    await requestDeletion(map.id);
    fireEvent.click(screen.getByRole("button", { name: "Ort löschen" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [other, figure],
        edges: [
          {
            id: "other-edge",
            from: other.id,
            to: figure.id,
            versions: [{ momentId: "now", from: other.id, to: figure.id, active: true }],
          },
        ],
        presence: [{ id: "elsewhere", elementId: "figure", placeId: other.id }],
      }),
    );
  });
});

describe("active expanded map chrome", () => {
  const map = {
    id: "weltkarte",
    type: "ort" as const,
    name: "Weltkarte",
    x: 0,
    y: 0,
    mapImageId: "bild",
    mapExpanded: true,
    mapWidth: 1600,
    mapHeight: 900,
    mapScale: { unitsPer100px: 25, unitLabel: "km" },
  };
  const child = {
    id: "hafen",
    type: "ort" as const,
    name: "Hafen",
    x: 0,
    y: 0,
    parentPlaceId: map.id,
    mapU: 0.4,
    mapV: 0.5,
  };
  const second = { ...map, id: "seekarte", name: "Seekarte", mapX: 1800 };

  it("keeps map identity while selecting a child and clearing canvas selection", () => {
    const { container } = render(
      <ControlledPlaces initialState={{ nodes: [map, child], edges: [] }} onChange={vi.fn()} />,
    );
    const chrome = () => container.querySelector(".place-map-chrome");
    expect(chrome()).toHaveAttribute("data-map-id", map.id);
    fireEvent.click(screen.getByTestId("place-node-hafen"));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Hafen");
    expect(chrome()).toHaveAttribute("data-map-id", map.id);
    fireEvent.click(screen.getByRole("button", { name: "Testfläche" }));
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(chrome()).toHaveAttribute("data-map-id", map.id);
  });

  it("switches one chrome between expanded maps and their direct children", () => {
    const { container } = render(
      <ControlledPlaces
        initialState={{ nodes: [map, second, child], edges: [] }}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector(".place-map-chrome")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("place-node-weltkarte"));
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-map-id", map.id);
    fireEvent.click(screen.getByTestId("place-node-seekarte"));
    expect(container.querySelectorAll(".place-map-chrome")).toHaveLength(1);
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-map-id", second.id);
    fireEvent.click(screen.getByTestId("place-node-hafen"));
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-map-id", map.id);
  });

  it("keeps crop on the active surface and reuses the map persistence paths", () => {
    const changes: FigureState[] = [];
    const { container } = render(
      <ControlledPlaces
        initialState={{ nodes: [map, child], edges: [] }}
        onChange={(next) => changes.push(next)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Bild in Weltkarte anpassen" }));
    fireEvent.click(screen.getByTestId("place-node-hafen"));
    expect(
      screen.getByRole("button", { name: "Bild in Weltkarte fertig anpassen" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bild vergrößern" }));
    expect(changes.at(-1)?.nodes[0].mapImageZoom).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Bild in Weltkarte fertig anpassen" }));
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte feststellen" }));
    expect(changes.at(-1)?.nodes[0].pinned).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Maßstab von Weltkarte" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Maßstab" }), {
      target: { value: "50" },
    });
    expect(changes.at(-1)?.nodes[0].mapScale).toEqual({ unitsPer100px: 50, unitLabel: "km" });
    expect(changes.at(-1)?.nodes[0]).toMatchObject({ mapWidth: 1600, mapHeight: 900 });
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-map-id", map.id);
  });

  it("collapses to card controls and activates the map when expanded again", () => {
    const changes: FigureState[] = [];
    const { container } = render(
      <ControlledPlaces
        initialState={{ nodes: [map, child], edges: [] }}
        onChange={(next) => changes.push(next)}
      />,
    );
    fireEvent.click(screen.getByTestId("place-node-hafen"));
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte einklappen" }));
    expect(container.querySelector(".place-map-chrome")).not.toBeInTheDocument();
    expect(changes.at(-1)?.nodes[0].mapExpanded).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte aufklappen" }));
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-map-id", map.id);
    expect(changes.at(-1)?.nodes[0].mapExpanded).toBe(true);
  });

  it("ends crop with Escape even without a visible done action and respects consumed Escape", () => {
    render(
      <ControlledPlaces initialState={{ nodes: [map, child], edges: [] }} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Bild in Weltkarte anpassen" }));
    const consumed = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    fireEvent(document, consumed);
    expect(
      screen.getByRole("button", { name: "Bild in Weltkarte fertig anpassen" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Bild in Weltkarte anpassen" })).toBeInTheDocument();
  });

  it("clears removed identities before undo restores multiple maps", () => {
    const content = (nodes: FigureState["nodes"]) => (
      <I18nProvider>
        <PlacesWorkspace state={{ nodes, edges: [] }} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>
    );
    const view = render(content([map, second, child]));
    fireEvent.click(screen.getByTestId("place-node-weltkarte"));
    view.rerender(content([]));
    expect(view.container.querySelector(".place-map-chrome")).not.toBeInTheDocument();
    view.rerender(content([map, second, child]));
    expect(view.container.querySelector(".place-map-chrome")).not.toBeInTheDocument();
  });

  it("applies two map changes made before the next render to the same map", () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <PlacesWorkspace
          state={{ nodes: [map, child], edges: [] }}
          onChange={onChange}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );
    const pin = screen.getByRole("button", { name: "Weltkarte feststellen" });
    const collapse = screen.getByRole("button", { name: "Weltkarte einklappen" });
    act(() => {
      pin.click();
      collapse.click();
    });
    expect(onChange.mock.calls.at(-1)?.[0].nodes[0]).toMatchObject({
      id: map.id,
      pinned: true,
      mapExpanded: false,
    });
  });

  it("fits the view once the level it enters has been handed to the flow", async () => {
    flowInstance.fitView.mockClear();
    render(
      <ControlledPlaces initialState={{ nodes: [map, child], edges: [] }} onChange={vi.fn()} />,
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(flowInstance.fitView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Weltkarte öffnen" }));
    await waitFor(() => expect(flowInstance.fitView).toHaveBeenCalledOnce());
    expect(flowInstance.fitView.mock.calls[0][0]).toMatchObject({ padding: 0.12, maxZoom: 1 });

    fireEvent.click(screen.getByTestId("place-node-hafen"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(flowInstance.fitView).toHaveBeenCalledOnce();
  });

  it("falls back to the root when the open level disappears", () => {
    const content = (nodes: FigureState["nodes"]) => (
      <I18nProvider>
        <PlacesWorkspace state={{ nodes, edges: [] }} onChange={vi.fn()} onOpen={vi.fn()} />
      </I18nProvider>
    );
    const view = render(content([map, child]));
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte öffnen" }));
    expect(screen.getByRole("navigation", { name: "Pfad durch die Orte" })).toBeInTheDocument();

    view.rerender(content([child]));
    expect(
      screen.queryByRole("navigation", { name: "Pfad durch die Orte" }),
    ).not.toBeInTheDocument();
    view.rerender(content([map, child]));
    expect(
      screen.queryByRole("navigation", { name: "Pfad durch die Orte" }),
    ).not.toBeInTheDocument();
  });

  it("ends cropping when another map becomes the active surface", () => {
    render(
      <ControlledPlaces
        initialState={{ nodes: [map, second, child], edges: [] }}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("place-node-weltkarte"));
    fireEvent.click(screen.getByRole("button", { name: "Bild in Weltkarte anpassen" }));
    fireEvent.click(screen.getByTestId("place-node-seekarte"));
    expect(screen.getByRole("button", { name: "Bild in Seekarte anpassen" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("place-node-weltkarte"));
    expect(screen.getByRole("button", { name: "Bild in Weltkarte anpassen" })).toBeInTheDocument();
  });

  it("measures two places on a map in that map's scale, also after the scale changes", () => {
    const north = { ...child, id: "nord", name: "Nord", mapU: 0.25, mapV: 0.5 };
    const south = { ...child, id: "sued", name: "Süd", mapU: 0.75, mapV: 0.5 };
    const content = (scale: number) => (
      <I18nProvider>
        <PlacesWorkspace
          state={{
            nodes: [{ ...map, mapScale: { unitsPer100px: scale, unitLabel: "km" } }, north, south],
            edges: [],
            mapScale: { unitsPer100px: 1, unitLabel: "m" },
          }}
          onChange={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>
    );
    const view = render(content(25));
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    const label = () =>
      screen.getByRole("img", { name: /Nord – Süd/ }).getAttribute("aria-label") ?? "";
    const before = label();
    expect(before).toMatch(/km/);

    view.rerender(content(50));
    const after = label();
    expect(after).toMatch(/km/);
    expect(Number.parseFloat(after.replace(/[^0-9,.]/g, "").replace(",", "."))).toBeCloseTo(
      2 * Number.parseFloat(before.replace(/[^0-9,.]/g, "").replace(",", ".")),
    );
  });

  it("removes the previous level's chrome when entering its map", () => {
    const { container } = render(
      <ControlledPlaces initialState={{ nodes: [map, child], edges: [] }} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte öffnen" }));
    expect(container.querySelector(".place-map-chrome")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pfad durch die Orte" })).toBeInTheDocument();
  });
});

describe("place patches against the latest state (T-180)", () => {
  // Two inspector patches in one React batch: each must build on the other, not on the
  // render-time `state` prop.
  it("keeps a favourite and a note that land in the same batch", () => {
    const changes: FigureState[] = [];
    const { container } = render(
      <ControlledPlaces
        initialState={{ ...state, nodes: [state.nodes[0]] }}
        onChange={(next) => changes.push(next)}
      />,
    );
    fireEvent.click(screen.getByTestId("place-node-a"));
    const root = container.querySelector<HTMLElement>('[data-note-owner="place:a"] .cm-editor');
    if (!root) throw new Error("place note editor missing");
    const note = EditorView.findFromDOM(root);
    if (!note) throw new Error("place note view missing");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Ort favorisieren" }));
      note.dispatch({ changes: { from: 0, insert: "Hafen" }, userEvent: "input" });
    });
    expect(changes.at(-1)?.nodes[0]).toMatchObject({
      important: true,
      profile: expect.objectContaining({ notes: "Hafen" }),
    });
  });
});

describe("measuring to a free point", () => {
  const map = {
    id: "weltkarte",
    type: "ort" as const,
    name: "Weltkarte",
    x: 0,
    y: 0,
    mapImageId: "bild",
    mapExpanded: true,
    mapWidth: 1600,
    mapHeight: 900,
    mapScale: { unitsPer100px: 25, unitLabel: "km" },
  };
  const pin = {
    id: "hafen",
    type: "ort" as const,
    name: "Hafen",
    x: 0,
    y: 0,
    parentPlaceId: map.id,
    mapU: 0.4,
    mapV: 0.5,
  };
  const targeted = () =>
    screen
      .getAllByTestId("distance-edge")
      .find((edge) => edge.dataset.className === "distance-edge is-targeted");

  it("takes a click on the map as a point, not as the map's middle", () => {
    const onChange = vi.fn();
    render(
      <ControlledPlaces initialState={{ nodes: [map, pin], edges: [] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));

    fireEvent.click(screen.getByTestId("place-node-weltkarte"), { clientX: 100, clientY: 100 });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wähle den zweiten Ort oder einen Punkt auf der Karte.",
    );
    fireEvent.click(screen.getByTestId("place-node-weltkarte"), { clientX: 400, clientY: 500 });

    // 500 flow units on a map of 25 km per 100 px.
    expect(targeted()).toHaveAttribute("aria-label", "Punkt – Punkt: 125 km");
    // A point is never a place: it reaches neither the inspector nor the document.
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    for (const [state] of onChange.mock.calls as [FigureState][])
      expect(state.nodes.some((node) => node.id.startsWith("measure-point:"))).toBe(false);
  });

  it("measures from a pin to a point in the map's units", () => {
    render(<ControlledPlaces initialState={{ nodes: [map, pin], edges: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    fireEvent.click(screen.getByTestId("place-node-hafen"));
    fireEvent.click(screen.getByTestId("place-node-weltkarte"), { clientX: 100, clientY: 100 });

    expect(targeted()).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^Hafen – Punkt: [\d.]+ km$/),
    );
  });

  it("sets a point beside the map, read in the level's units", () => {
    render(<ControlledPlaces initialState={{ nodes: [map, pin], edges: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    fireEvent.click(screen.getByRole("button", { name: "Testfläche" }), {
      clientX: 1700,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Testfläche" }), {
      clientX: 1700,
      clientY: 400,
    });

    expect(targeted()).toHaveAttribute(
      "aria-label",
      "Punkt – Punkt: 300 Einheiten (kein Maßstab gesetzt)",
    );
  });

  it("forgets its points when measuring stops", () => {
    render(<ControlledPlaces initialState={{ nodes: [map, pin], edges: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));
    fireEvent.click(screen.getByTestId("place-node-weltkarte"), { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByTestId("place-node-weltkarte"), { clientX: 400, clientY: 500 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Distanz messen" }));

    expect(
      screen
        .queryAllByTestId("distance-edge")
        .some((edge) => edge.dataset.className?.includes("is-targeted")),
    ).toBe(false);
  });
});

describe("resizing a map with a scale", () => {
  const harbour = {
    id: "nordhafen",
    type: "ort" as const,
    name: "Nordhafen",
    x: 0,
    y: 0,
    mapImageId: "bild",
    mapExpanded: true,
    mapWidth: 1500,
    mapHeight: 1000,
    mapScale: { unitsPer100px: 0.15, unitLabel: "km" },
  };

  // One step per change, the way the app's history records a single write; undo goes back
  // one step. The frame of the map is shown so the state after undo can be read directly.
  function HistoryPlaces({ onChange }: { onChange: (state: FigureState) => void }) {
    const [past, setPast] = useState<FigureState[]>([]);
    const [value, setValue] = useState<FigureState>({ nodes: [harbour], edges: [] });
    const map = value.nodes[0];
    return (
      <I18nProvider>
        <output data-testid="frame">
          {`${map.mapWidth}x${map.mapHeight}@${map.mapScale?.unitsPer100px}`}
        </output>
        <PlacesWorkspace
          state={value}
          onChange={(next) => {
            setPast((steps) => [...steps, value]);
            setValue(next);
            onChange(next);
          }}
          onOpen={vi.fn()}
          onUndo={() => {
            const previous = past.at(-1);
            if (!previous) return;
            setPast(past.slice(0, -1));
            setValue(previous);
          }}
          canUndo={past.length > 0}
        />
      </I18nProvider>
    );
  }
  const stored = (onChange: ReturnType<typeof vi.fn>) => {
    const last = onChange.mock.calls.at(-1);
    if (!last) throw new Error("Nothing was written.");
    return (last[0] as FigureState).nodes[0];
  };

  it("writes size and recomputed scale in one change, and one undo takes both back", () => {
    const onChange = vi.fn();
    render(<HistoryPlaces onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Testgröße Nordhafen" }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(stored(onChange)).toMatchObject({ mapWidth: 1800, mapHeight: 1200 });
    expect(stored(onChange).mapScale?.unitsPer100px).toBeCloseTo(0.125, 10);
    expect(screen.queryByText("Maßstab neu messen?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Orte rückgängig" }));
    expect(screen.getByTestId("frame")).toHaveTextContent("1500x1000@0.15");
  });

  it("takes the factor from the drawn start of the gesture, not from the stored size", () => {
    const onChange = vi.fn();
    render(<HistoryPlaces onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Testmessgröße Nordhafen" }));
    expect(stored(onChange).mapScale?.unitsPer100px).toBeCloseTo(0.15 / (2002 / 1501), 8);
  });

  it("keeps the scale of a distorted map and asks to measure again", () => {
    const onChange = vi.fn();
    render(<HistoryPlaces onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Testverzerrung Nordhafen" }));
    expect(stored(onChange).mapScale?.unitsPer100px).toBe(0.15);
    expect(screen.getByText("Maßstab neu messen?")).toBeInTheDocument();
    expect(
      screen.getByText("Nordhafen wurde verzerrt. Der Maßstab passt nicht mehr sicher."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Neu messen" }));
    expect(screen.queryByText("Maßstab neu messen?")).not.toBeInTheDocument();
    expect(screen.getByText("Maßstab messen: Setze den Anfang der Strecke.")).toBeInTheDocument();
  });

  it("lets the hint be closed", () => {
    render(<HistoryPlaces onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Testverzerrung Nordhafen" }));
    fireEvent.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByText("Maßstab neu messen?")).not.toBeInTheDocument();
  });

  it("takes the hint away with the size when the distortion is undone", () => {
    render(<HistoryPlaces onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Testverzerrung Nordhafen" }));
    expect(screen.getByText("Maßstab neu messen?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Orte rückgängig" }));
    expect(screen.getByTestId("frame")).toHaveTextContent("1500x1000@0.15");
    expect(screen.queryByText("Maßstab neu messen?")).not.toBeInTheDocument();
  });
});
