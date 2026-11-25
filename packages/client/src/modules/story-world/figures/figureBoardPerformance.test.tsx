import { act, renderHook } from "@testing-library/react";
import type { Edge, NodeProps } from "@xyflow/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { GRAPH_RELATIONSHIP_EDGE_TYPE, positionGraphRelationshipEdgeLabels } from "../../graph";
import type { FigureState } from "../model";
import { useFigureEdgeLabels } from "./FigureCanvas";
import { type FigureFlowNode, storyNodePropsEqual } from "./FigureNode";
import { useFigureCanvas } from "./useFigureCanvas";

const EMPTY: never[] = [];

function flowNode(id: string, x: number, extra: Partial<FigureFlowNode> = {}): FigureFlowNode {
  return {
    id,
    type: "story",
    position: { x, y: 0 },
    measured: { width: 200, height: 96 },
    data: {
      figure: { id, x, y: 0, name: id, type: "person" },
      deceased: false,
      guests: EMPTY,
      zoomTier: "detail",
    },
    ...extra,
  };
}

function labelled(id: string, source: string, target: string): Edge {
  return { id, source, target, type: GRAPH_RELATIONSHIP_EDGE_TYPE, label: "kennt" };
}

describe("figure board performance", () => {
  it("keeps the labels of edges away from the moved nodes and places only the others", () => {
    const nodes = [flowNode("a", 0), flowNode("b", 520), flowNode("c", 1040), flowNode("d", 1560)];
    const edges = [labelled("ab", "a", "b"), labelled("cd", "c", "d")];
    const settled = positionGraphRelationshipEdgeLabels(nodes, edges);

    const moved = nodes.map((node) =>
      node.id === "a" ? { ...node, position: { x: 40, y: 200 } } : node,
    );
    const next = positionGraphRelationshipEdgeLabels(moved, edges, {
      keep: { positioned: settled, movedNodeIds: new Set(["a"]) },
    });

    expect(next[1]).toBe(settled[1]);
    expect(next[0]).not.toBe(settled[0]);
    expect(next[0].data?.labelPlacement).not.toEqual(settled[0].data?.labelPlacement);
  });

  it("does not place the labels again when only selection or data of a node changes", () => {
    const edges = [labelled("ab", "a", "b")];
    const onSelectEdge = vi.fn();
    const { result, rerender } = renderHook(
      ({ nodes }) => useFigureEdgeLabels(nodes, edges, onSelectEdge),
      { initialProps: { nodes: [flowNode("a", 0), flowNode("b", 520)] } },
    );
    const first = result.current;

    rerender({ nodes: [flowNode("a", 0, { selected: true }), flowNode("b", 520)] });

    expect(result.current).toBe(first);
  });

  it("keeps unaffected labels while a card is dragged and settles all of them after", () => {
    const edges = [labelled("ab", "a", "b"), labelled("cd", "c", "d")];
    const onSelectEdge = vi.fn();
    const still = [flowNode("b", 520), flowNode("c", 1040), flowNode("d", 1560)];
    const { result, rerender } = renderHook(
      ({ nodes }) => useFigureEdgeLabels(nodes, edges, onSelectEdge),
      { initialProps: { nodes: [flowNode("a", 0), ...still] } },
    );
    const settledCd = result.current[1];

    rerender({ nodes: [flowNode("a", 60, { dragging: true }), ...still] });
    expect(result.current[1]).toBe(settledCd);

    rerender({ nodes: [flowNode("a", 60, { dragging: false }), ...still] });
    expect(result.current[1]).not.toBe(settledCd);
  });

  it("does not rebuild the cards for a zoom step inside the detail tier", () => {
    const state: FigureState = {
      nodes: [{ id: "a", x: 0, y: 0, name: "Ada", type: "person" }],
      edges: [],
    };
    const { result } = renderHook(
      () =>
        useFigureCanvas({
          state,
          onChange: vi.fn(),
          selected: null,
          timeline: EMPTY,
          presence: EMPTY,
          activeMomentId: null,
          journeyOverlayOpen: false,
          relationshipsVisible: true,
          selectedEdgeId: null,
          onSelectNode: vi.fn(),
          onSelectEdge: vi.fn(),
          onStopConnecting: vi.fn(),
          onEnsureRelationshipsVisible: vi.fn(),
          onConnectionError: vi.fn(),
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <I18nProvider>
            <ReactFlowProvider>{children}</ReactFlowProvider>
          </I18nProvider>
        ),
      },
    );
    const before = result.current.nodes;

    act(() => result.current.onMove({ x: 0, y: 0, zoom: 1.25 }));

    expect(result.current.nodes).toBe(before);
  });

  it("does not rebuild the cards for a zoom step inside the overview tier", () => {
    const state: FigureState = {
      nodes: [{ id: "a", x: 0, y: 0, name: "Ada", type: "person" }],
      edges: [],
    };
    const { result } = renderHook(
      () =>
        useFigureCanvas({
          state,
          onChange: vi.fn(),
          selected: null,
          timeline: EMPTY,
          presence: EMPTY,
          activeMomentId: null,
          journeyOverlayOpen: false,
          relationshipsVisible: true,
          selectedEdgeId: null,
          onSelectNode: vi.fn(),
          onSelectEdge: vi.fn(),
          onStopConnecting: vi.fn(),
          onEnsureRelationshipsVisible: vi.fn(),
          onConnectionError: vi.fn(),
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <I18nProvider>
            <ReactFlowProvider>{children}</ReactFlowProvider>
          </I18nProvider>
        ),
      },
    );
    act(() => result.current.onMove({ x: 0, y: 0, zoom: 0.19 }));
    const before = result.current;

    act(() => result.current.onMove({ x: 0, y: 0, zoom: 0.22 }));

    // Not even the board renders: the zoom inside a tier is no React state (T-372).
    expect(result.current).toBe(before);
    expect(result.current.zoomTier).toBe("overview");
  });

  it("skips rendering a card again when only its position or drag state changes", () => {
    const node = flowNode("a", 0);
    const props = {
      id: "a",
      data: node.data,
      selected: false,
      dragging: false,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as unknown as NodeProps<FigureFlowNode>;

    expect(
      storyNodePropsEqual(props, {
        ...props,
        dragging: true,
        positionAbsoluteX: 40,
        positionAbsoluteY: 12,
      }),
    ).toBe(true);
    expect(storyNodePropsEqual(props, { ...props, selected: true })).toBe(false);
  });
});
