import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { PlacesWorkspace } from "./PlacesWorkspace";

// A drag in progress, driven the way React Flow drives it: drag start, then position
// changes through onNodesChange, which applyNodeChanges applies to the list it is given.
// PlacesWorkspace.test.tsx keeps its own lighter mock; this one only needs these paths.

type MockNode = { id: string; position: { x: number; y: number } };
type PositionChange = {
  type: "position";
  id: string;
  position?: { x: number; y: number };
  dragging?: boolean;
};
type FlowProps = {
  nodes: MockNode[];
  onNodeDragStart: (event: MouseEvent, node: MockNode) => void;
  onNodesChange: (changes: PositionChange[]) => void;
};

const flow = vi.hoisted(() => ({ props: null as FlowProps | null }));

vi.mock("./PlaceMapChromeOverlay", () => ({ PlaceMapChromeOverlay: () => null }));
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: (props: FlowProps) => {
    flow.props = props;
    return (
      <div data-testid="flow">
        {props.nodes.map((node) => (
          <span key={node.id} data-testid={`node-${node.id}`}>
            {node.position.x}
          </span>
        ))}
      </div>
    );
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Lines: "lines" },
  Position: { Bottom: "bottom", Top: "top" },
  applyNodeChanges: (changes: PositionChange[], nodes: MockNode[]) =>
    nodes.map((node) => {
      const change = changes.find(
        (item) => item.type === "position" && item.id === node.id && item.position,
      );
      return change?.position ? { ...node, position: change.position } : node;
    }),
  useUpdateNodeInternals: () => vi.fn(),
}));

afterEach(cleanup);

function props(): FlowProps {
  if (!flow.props) throw new Error("ReactFlow was not rendered");
  return flow.props;
}

function places(ids: string[]): FigureState {
  return {
    nodes: ids.map((id, index) => ({
      id,
      x: index * 100,
      y: 0,
      mapX: index * 100,
      mapY: 0,
      name: id.toUpperCase(),
      type: "ort" as const,
    })),
    edges: [],
  };
}

function content(state: FigureState) {
  return (
    <I18nProvider>
      <PlacesWorkspace state={state} onChange={vi.fn()} onOpen={vi.fn()} />
    </I18nProvider>
  );
}

function move(id: string, x: number) {
  act(() =>
    props().onNodesChange([{ type: "position", id, position: { x, y: 0 }, dragging: true }]),
  );
}

const pointer = { clientX: 10, clientY: 10 } as unknown as MouseEvent;

describe("PlacesWorkspace drag", () => {
  it("ends the preview and the drag when the dragged place vanishes", () => {
    const view = render(content(places(["a", "b"])));
    const dragged = props().nodes.find((node) => node.id === "a");
    if (!dragged) throw new Error("place a missing");
    act(() => props().onNodeDragStart(pointer, dragged));
    expect(document.querySelector(".place-drag-preview")).not.toBeNull();
    move("a", 50);
    expect(screen.getByTestId("node-a")).toHaveTextContent(/^50$/);

    view.rerender(content(places(["b"])));
    expect(document.querySelector(".place-drag-preview")).toBeNull();
    expect(screen.queryByTestId("node-a")).toBeNull();

    // Back by redo: the session was cancelled, so its position changes are dropped.
    view.rerender(content(places(["a", "b"])));
    move("a", 70);
    expect(screen.getByTestId("node-a")).toHaveTextContent(/^0$/);
  });

  it("builds a second position change before any render on the first", () => {
    render(content(places(["a", "b"])));
    act(() => {
      props().onNodesChange([
        { type: "position", id: "a", position: { x: 20, y: 0 }, dragging: true },
      ]);
      props().onNodesChange([
        { type: "position", id: "b", position: { x: 500, y: 0 }, dragging: true },
      ]);
    });
    expect(screen.getByTestId("node-a")).toHaveTextContent(/^20$/);
    expect(screen.getByTestId("node-b")).toHaveTextContent(/^500$/);
  });
});
