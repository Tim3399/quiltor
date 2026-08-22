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
  }) => (
    <div data-testid="figure-flow">
      {nodes.map((node) => (
        <output aria-label={`Kontext ${node.id}`} key={node.id}>
          {String(node.data.deceased)}:{node.data.zoomTier}
        </output>
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

describe("FigureWorkspace relationships", () => {
  it("keeps connection mode and edge visibility available beyond two relationships", () => {
    render(<FigureHarness />);

    const connectMode = screen.getByRole("button", { name: "Verbinden" });
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
});
