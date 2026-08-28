import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { FigureWorkspace } from "./FigureWorkspace";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    edges,
    nodes,
    nodesConnectable,
    onConnect,
    onMove,
    onNodeClick,
  }: {
    edges: Array<{ id: string }>;
    nodes: Array<{ id: string; data: { deceased: boolean; zoomTier: string } }>;
    nodesConnectable: boolean;
    onConnect: (connection: {
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
    }) => void;
    onMove: (event: null, viewport: { x: number; y: number; zoom: number }) => void;
    onNodeClick: (event: null, node: { id: string }) => void;
  }) => (
    <div data-testid="figure-flow">
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
        <span data-testid="rendered-relationship" data-edge-id={edge.id} key={edge.id} />
      ))}
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
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MiniMap: () => null,
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

function EmptyFigureHarness() {
  const [state, setState] = useState<FigureState>({ nodes: [], edges: [] });
  return (
    <I18nProvider>
      <output aria-label="Gespeicherte Elemente">{state.nodes.length}</output>
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

  it("keeps connection mode and edge visibility available beyond two relationships", () => {
    render(<FigureHarness />);

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
