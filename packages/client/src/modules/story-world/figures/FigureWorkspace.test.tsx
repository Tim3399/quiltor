import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { FigureWorkspace } from "./FigureWorkspace";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    connectionLineType,
    defaultEdgeOptions,
    edges,
    nodes,
    nodesConnectable,
    children,
    onConnect,
    onEdgeClick,
    onMove,
    onNodeClick,
    onPaneClick,
  }: {
    connectionLineType?: string;
    defaultEdgeOptions?: { type?: string };
    edges: Array<{ id: string; data?: { kind?: string } }>;
    nodes: Array<{ id: string; data: { deceased: boolean; zoomTier: string } }>;
    nodesConnectable: boolean;
    children?: ReactNode;
    onConnect: (connection: {
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
    }) => void;
    onEdgeClick?: (event: null, edge: { id: string; data?: { kind?: string } }) => void;
    onMove: (event: null, viewport: { x: number; y: number; zoom: number }) => void;
    onNodeClick: (event: null, node: { id: string }) => void;
    onPaneClick?: () => void;
  }) => (
    <div
      data-testid="figure-flow"
      data-connection-line-type={connectionLineType}
      data-default-edge-type={defaultEdgeOptions?.type}
    >
      {nodes.map((node) => (
        <div key={node.id}>
          <output aria-label={`Kontext ${node.id}`}>
            {String(node.data.deceased)}:{node.data.zoomTier}
          </output>
          <button type="button" onClick={() => onNodeClick(null, node)}>
            Testauswahl {node.id}
          </button>
        </div>
      ))}
      {edges.map((edge) => (
        <button
          type="button"
          data-testid="rendered-relationship"
          data-edge-id={edge.id}
          key={edge.id}
          onClick={() => onEdgeClick?.(null, edge)}
        >
          Kante {edge.id}
        </button>
      ))}
      {children}
      <button
        type="button"
        disabled={!nodesConnectable}
        onClick={() =>
          onConnect({
            source: "a",
            target: "b",
            sourceHandle: "neutral-bottom",
            targetHandle: "neutral-top",
          })
        }
      >
        Testverbindung eins
      </button>
      <button
        type="button"
        disabled={!nodesConnectable}
        onClick={() =>
          onConnect({ source: "a", target: "c", sourceHandle: "out", targetHandle: "in" })
        }
      >
        Testverbindung zwei
      </button>
      <button
        type="button"
        disabled={!nodesConnectable}
        onClick={() =>
          onConnect({
            source: "b",
            target: "c",
            sourceHandle: "neutral-bottom",
            targetHandle: "neutral-top",
          })
        }
      >
        Testverbindung drei
      </button>
      <button type="button" onClick={() => onMove(null, { x: 0, y: 0, zoom: 0.2 })}>
        Testzoom
      </button>
      <button type="button" onClick={onPaneClick}>
        Leere Fläche
      </button>
    </div>
  ),
  Background: () => null,
  Controls: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Handle: () => null,
  MiniMap: () => <div data-testid="figure-minimap" />,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConnectionLineType: { SmoothStep: "smoothstep" },
  ConnectionMode: { Loose: "loose" },
  BackgroundVariant: { Lines: "lines" },
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  useUpdateNodeInternals: () => vi.fn(),
}));

afterEach(cleanup);

const initialState: FigureState = {
  nodes: [
    { id: "a", x: 0, y: 0, name: "Ada", type: "person" },
    { id: "b", x: 300, y: 0, name: "Bela", type: "person" },
    { id: "c", x: 150, y: 240, name: "Cora", type: "person" },
  ],
  edges: [],
};

function FigureHarness() {
  const [state, setState] = useState(initialState);
  return (
    <I18nProvider>
      <output aria-label="Gespeicherte Beziehungen">{state.edges.length}</output>
      <FigureWorkspace state={state} onChange={setState} />
    </I18nProvider>
  );
}

function EdgeInspectorHarness({ initial, targetId }: { initial: FigureState; targetId?: string }) {
  const [state, setState] = useState(initial);
  return (
    <I18nProvider>
      <output aria-label="Beziehungszustand">{JSON.stringify(state.edges)}</output>
      <FigureWorkspace state={state} onChange={setState} targetId={targetId} />
    </I18nProvider>
  );
}

function EmptyFigureHarness() {
  const [state, setState] = useState<FigureState>({ nodes: [], edges: [] });
  return (
    <I18nProvider>
      <output aria-label="Gespeicherte Elemente">{state.nodes.length}</output>
      <FigureWorkspace state={state} onChange={setState} />
    </I18nProvider>
  );
}

function NewElementHarness() {
  const [state, setState] = useState<FigureState>({ nodes: [], edges: [] });
  return (
    <I18nProvider>
      <output aria-label="Rollen">{JSON.stringify(state.nodes.map((node) => node.label))}</output>
      <FigureWorkspace state={state} onChange={setState} />
    </I18nProvider>
  );
}

describe("FigureWorkspace relationships", () => {
  it("offers a useful first action instead of an empty grid", () => {
    render(<EmptyFigureHarness />);

    expect(screen.getByLabelText("Element erstellen")).toHaveTextContent(
      "Noch keine Figuren oder Tiere.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Neue Figur" }));

    expect(screen.getByLabelText("Gespeicherte Elemente")).toHaveTextContent("1");
    expect(screen.queryByLabelText("Element erstellen")).not.toBeInTheDocument();
  });

  it("gives a new element no role of its own, only its kind", () => {
    render(<NewElementHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Neue Figur" }));

    // The field caption used to be written into the world as the element's
    // role, which made a fresh animal read as "Art / Rolle" on its own card.
    expect(screen.getByLabelText("Rollen")).toHaveTextContent('[""]');
    expect(screen.getByLabelText("Rollen")).not.toHaveTextContent("Rolle");
  });

  it("marks the canvas when the timeline needs its own overlay zone", () => {
    const state: FigureState = {
      nodes: [],
      edges: [],
      timeline: [{ id: "arrival", title: "Ankunft" }],
    };
    const { container } = render(
      <I18nProvider>
        <FigureWorkspace state={state} onChange={vi.fn()} />
      </I18nProvider>,
    );

    expect(container.querySelector(".flow-area")).toHaveClass("has-timeline");
  });

  it("shows the minimap by default and keeps its toggle in the graph controls", () => {
    const { container } = render(<FigureHarness />);

    const flowArea = container.querySelector(".flow-area");
    expect(flowArea).toHaveClass("has-minimap");
    expect(screen.getByTestId("figure-minimap")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Übersichtskarte ausblenden" }));

    expect(flowArea).not.toHaveClass("has-minimap");
    expect(screen.queryByTestId("figure-minimap")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Übersichtskarte einblenden" })).toBeVisible();
  });

  it("keeps connection mode and edge visibility available beyond two relationships", () => {
    render(<FigureHarness />);

    expect(screen.getByTestId("figure-flow")).toHaveAttribute(
      "data-connection-line-type",
      "smoothstep",
    );
    expect(screen.getByTestId("figure-flow")).toHaveAttribute(
      "data-default-edge-type",
      "smoothstep",
    );
    const connectMode = screen.getByRole("button", { name: "Verbinden" });
    expect(screen.getByRole("button", { name: "Testverbindung eins" })).toBeEnabled();
    fireEvent.click(connectMode);
    fireEvent.click(screen.getByRole("button", { name: "Testverbindung eins" }));
    fireEvent.click(screen.getByRole("button", { name: "Testverbindung zwei" }));

    expect(connectMode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Testverbindung drei" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Testverbindung drei" }));

    expect(screen.getByLabelText("Gespeicherte Beziehungen")).toHaveTextContent("3");
    expect(screen.getAllByTestId("rendered-relationship")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Ansicht" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Beziehungen ausblenden" }));
    expect(screen.queryAllByTestId("rendered-relationship")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Ansicht" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Beziehungen einblenden" }));
    expect(screen.getAllByTestId("rendered-relationship")).toHaveLength(3);
  });

  it("opens the existing relationship inspector instead of creating a duplicate edge", () => {
    render(<FigureHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Testverbindung eins" }));
    fireEvent.click(screen.getByRole("button", { name: "Testverbindung eins" }));

    expect(screen.getByLabelText("Gespeicherte Beziehungen")).toHaveTextContent("1");
    expect(screen.getByRole("region", { name: "Beziehung" })).toHaveTextContent("Ada ↔ Bela");
    expect(
      screen.getByText("Diese Beziehung existiert bereits und wurde im Inspector geöffnet."),
    ).toBeVisible();
  });

  it("opens the shared edge inspector without replacing the selected node inspector", () => {
    render(
      <EdgeInspectorHarness
        initial={{
          ...initialState,
          edges: [{ id: "bond", from: "a", to: "b", label: "Freunde", style: "gold" }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Testauswahl a" }));
    fireEvent.click(screen.getByRole("button", { name: "Kante bond" }));

    expect(screen.getByRole("region", { name: "Beziehung" })).toHaveTextContent("Ada ↔ Bela");
    expect(document.querySelector(".flow-area")).toHaveClass("has-edge-inspector");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
    fireEvent.change(screen.getByRole("textbox", { name: "Beziehung benennen" }), {
      target: { value: "Verbündete" },
    });
    const color = screen.getByRole("combobox", { name: "Kantenfarbe" });
    expect(color).toHaveTextContent("Gold");
    fireEvent.click(color);
    fireEvent.click(screen.getByRole("option", { name: "Blau" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Linienart" }));
    fireEvent.click(screen.getByRole("option", { name: "Gepunktet" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Verwandtschaft" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gerichtet" }));
    fireEvent.click(screen.getByRole("button", { name: "Richtung umkehren" }));

    expect(
      JSON.parse(screen.getByLabelText("Beziehungszustand").textContent ?? "[]"),
    ).toContainEqual(
      expect.objectContaining({
        from: "b",
        to: "a",
        label: "Verbündete",
        gerichtet: true,
        color: "blue",
        lineStyle: "dotted",
        relationshipKind: "kinship",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Leere Fläche" }));
    expect(screen.queryByRole("region", { name: "Beziehung" })).not.toBeInTheDocument();
  });

  it("distinguishes an explicit automatic color from the legacy gold line style", () => {
    render(
      <EdgeInspectorHarness
        initial={{
          ...initialState,
          edges: [
            {
              id: "legacy-gold-auto",
              from: "a",
              to: "b",
              style: "gold",
              color: "auto",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kante legacy-gold-auto" }));
    expect(screen.getByRole("combobox", { name: "Kantenfarbe" })).toHaveTextContent(
      "Automatisch (nach Richtung)",
    );
  });

  it("edits the selected temporal version and blocks resolved duplicate directions", () => {
    const timeline = [
      { id: "before", title: "Vorher" },
      { id: "betrayal", title: "Verrat" },
    ];
    render(
      <EdgeInspectorHarness
        targetId="betrayal"
        initial={{
          ...initialState,
          timeline,
          edges: [
            {
              id: "bond",
              from: "a",
              to: "b",
              label: "Freunde",
              versions: [{ momentId: "betrayal", label: "Feinde", active: true }],
            },
            {
              id: "directed-duplicate",
              from: "a",
              to: "b",
              gerichtet: true,
              active: true,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kante bond" }));
    const label = screen.getByRole("textbox", { name: "Beziehung benennen" });
    expect(label).toHaveValue("Feinde");
    fireEvent.change(label, { target: { value: "Erzfeinde" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Kantenfarbe" }));
    fireEvent.click(screen.getByRole("option", { name: "Moos" }));

    expect(screen.getByRole("checkbox", { name: "Gerichtet" })).toBeDisabled();
    expect(
      screen.getByText("Diese Beziehung existiert an diesem Zeitpunkt bereits."),
    ).toBeVisible();
    const saved = JSON.parse(screen.getByLabelText("Beziehungszustand").textContent ?? "[]");
    expect(saved[0]).toMatchObject({ label: "Freunde" });
    expect(saved[0].color).toBeUndefined();
    expect(saved[0].versions).toContainEqual(
      expect.objectContaining({ momentId: "betrayal", label: "Erzfeinde", color: "moss" }),
    );
  });

  it("preserves timeline context when semantic zoom reprojects the nodes", () => {
    const state: FigureState = {
      nodes: [{ id: "a", x: 0, y: 0, name: "Ada", type: "person", diedMomentId: "t1" }],
      edges: [],
      timeline: [{ id: "t1", title: "Später" }],
    };
    render(
      <I18nProvider>
        <FigureWorkspace state={state} onChange={vi.fn()} targetId="t1" />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Kontext a")).toHaveTextContent("true:detail");
    fireEvent.click(screen.getByRole("button", { name: "Testzoom" }));
    expect(screen.getByLabelText("Kontext a")).toHaveTextContent("true:overview");
  });

  it("reselects a repeated navigation target after an internal selection", () => {
    const view = render(
      <I18nProvider>
        <FigureWorkspace state={initialState} onChange={vi.fn()} targetId="a" targetRequestId={1} />
      </I18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
    fireEvent.click(screen.getByRole("button", { name: "Testauswahl b" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Bela");

    view.rerender(
      <I18nProvider>
        <FigureWorkspace state={initialState} onChange={vi.fn()} targetId="a" targetRequestId={2} />
      </I18nProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
  });
});
