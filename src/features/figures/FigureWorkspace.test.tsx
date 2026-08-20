import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../language";
import type { FigureState } from "../../types";
import { FigureWorkspace } from "./FigureWorkspace";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    edges,
    nodesConnectable,
    onConnect,
  }: {
    edges: Array<{ id: string }>;
    nodesConnectable: boolean;
    onConnect: (connection: {
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
    }) => void;
  }) => (
    <div data-testid="figure-flow">
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
    <LanguageProvider>
      <output aria-label="Gespeicherte Beziehungen">{state.edges.length}</output>
      <FigureWorkspace state={state} onChange={setState} />
    </LanguageProvider>
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
});
