import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { type Edge, type EdgeProps, Position } from "@xyflow/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const xyflow = vi.hoisted(() => ({
  baseEdge: vi.fn(),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...original,
    BaseEdge: (props: Record<string, unknown>) => {
      xyflow.baseEdge(props);
      return (
        <svg aria-hidden="true">
          <path data-testid="base-edge" />
        </svg>
      );
    },
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => (
      <div data-testid="edge-label-renderer">{children}</div>
    ),
  };
});

import { sampleGraphSmoothStepPath } from "./edgeLabelPlacement";
import { GRAPH_RELATIONSHIP_EDGE_TYPE } from "./edgePresentation";
import {
  GraphRelationshipEdge,
  type GraphRelationshipFlowEdge,
  graphEdgeLabelSize,
  positionGraphRelationshipEdgeLabels,
} from "./GraphRelationshipEdge";

function edgeProps(
  overrides: Partial<ComponentProps<typeof GraphRelationshipEdge>> = {},
): EdgeProps<GraphRelationshipFlowEdge> {
  return {
    id: "edge",
    source: "source",
    target: "target",
    sourceX: 0,
    sourceY: 0,
    targetX: 320,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    label: "führt zu",
    selected: false,
    data: {
      labelPlacement: { x: 180, y: 0 },
      labelSize: { width: 84, height: 24 },
      labelPathRatio: 0.5625,
      pathData: "M 0 0 L 320 0",
    },
    ...overrides,
  } as EdgeProps<GraphRelationshipFlowEdge>;
}

function distanceToPolyline(
  point: { x: number; y: number },
  path: readonly { x: number; y: number }[],
) {
  return path.slice(1).reduce((closest, end, index) => {
    const start = path[index];
    const delta = { x: end.x - start.x, y: end.y - start.y };
    const squaredLength = delta.x * delta.x + delta.y * delta.y;
    const ratio =
      squaredLength > 0
        ? Math.min(
            1,
            Math.max(
              0,
              ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) / squaredLength,
            ),
          )
        : 0;
    const projected = { x: start.x + delta.x * ratio, y: start.y + delta.y * ratio };
    return Math.min(closest, Math.hypot(point.x - projected.x, point.y - projected.y));
  }, Number.POSITIVE_INFINITY);
}

describe("GraphRelationshipEdge", () => {
  it("renders its label in the foreground portal and never delegates a duplicate SVG label", () => {
    xyflow.baseEdge.mockClear();
    const { container } = render(<GraphRelationshipEdge {...edgeProps({ selected: true })} />);

    expect(screen.getByTestId("edge-label-renderer")).toBeInTheDocument();
    const label = container.querySelector<HTMLElement>(".graph-edge-label");
    expect(label).toHaveTextContent("führt zu");
    expect(label).toHaveClass("is-selected");
    expect(label).toHaveStyle({
      width: "84px",
      height: "24px",
      transform: "translate(-50%, -50%) translate(180px, 0px)",
    });
    expect(xyflow.baseEdge).toHaveBeenCalledOnce();
    expect(xyflow.baseEdge.mock.calls[0]?.[0]).not.toHaveProperty("label");
    expect(xyflow.baseEdge.mock.calls[0]?.[0]).toHaveProperty("path", "M 0 0 L 320 0");
    expect(container.querySelector(".react-flow__edge-text")).toBeNull();
  });

  it("renders semantic badges without turning meaning into a line style", () => {
    const { container } = render(
      <GraphRelationshipEdge
        {...edgeProps({
          label: "",
          data: {
            labelBadges: ["kinship", "temporal"],
            labelTitle: "Verwandtschaft · Zeitlicher Verlauf",
          },
        })}
      />,
    );

    const label = container.querySelector<HTMLElement>(".graph-edge-label");
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute("title", "Verwandtschaft · Zeitlicher Verlauf");
    expect(label?.querySelectorAll("[data-edge-label-badge]")).toHaveLength(2);
    expect(label?.querySelector('[data-edge-label-badge="kinship"]')).toBeInTheDocument();
    expect(label?.querySelector('[data-edge-label-badge="temporal"]')).toBeInTheDocument();
    expect(graphEdgeLabelSize("", 2).width).toBeGreaterThan(graphEdgeLabelSize("", 0).width);
  });

  it("exposes an interactive edge label as a native keyboard button", () => {
    const onLabelClick = vi.fn();
    render(
      <GraphRelationshipEdge
        {...edgeProps({
          data: {
            labelTitle: "Beziehung öffnen",
            onLabelClick,
          },
        })}
      />,
    );

    screen.getByRole("button", { name: "Beziehung öffnen" }).click();
    expect(onLabelClick).toHaveBeenCalledWith("edge");
  });

  it("keeps the shared label portal above selected nodes and the connection preview", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphRelationshipEdge.css"),
      "utf8",
    );
    const tokens = readFileSync(
      join(process.cwd(), "packages/client/src/design/tokens.css"),
      "utf8",
    );
    const rendererRule = css.match(
      /\.graph-edge-surface\s+\.react-flow__edgelabel-renderer\s*\{(?<body>[^}]*)\}/s,
    );
    const token = rendererRule?.groups?.body.match(/z-index:\s*var\((?<name>--[a-z0-9-]+)\)/)
      ?.groups?.name;
    const tokenValue = token
      ? tokens.match(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(\\d+)`))?.[1]
      : undefined;

    expect(rendererRule).not.toBeNull();
    expect(token).toBe("--z-graph-edge-label");
    expect(Number(tokenValue)).toBeGreaterThan(1001);
    expect(css).toMatch(/\.graph-edge-label\s*\{[^}]*position:\s*absolute/s);
  });

  it("projects all relationship labels through one collision pass before rendering", () => {
    const nodes = [
      { id: "source", position: { x: 0, y: 0 }, measured: { width: 200, height: 96 } },
      { id: "target", position: { x: 520, y: 0 }, measured: { width: 200, height: 96 } },
      { id: "obstacle", position: { x: 300, y: 16 }, measured: { width: 120, height: 64 } },
    ];
    const edges: Edge[] = [
      {
        id: "parallel-b",
        source: "source",
        target: "target",
        type: GRAPH_RELATIONSHIP_EDGE_TYPE,
        label: "kennt",
      },
      {
        id: "parallel-a",
        source: "source",
        target: "target",
        type: GRAPH_RELATIONSHIP_EDGE_TYPE,
        label: "folgt",
      },
    ];

    const positioned = positionGraphRelationshipEdgeLabels(nodes, edges);
    const placements = positioned.map((edge) => edge.data?.labelPlacement);

    expect(placements.every(Boolean)).toBe(true);
    expect(placements[0]).not.toEqual(placements[1]);
    expect(positioned.every((edge) => edge.data?.labelCollisionFallback === false)).toBe(true);
    for (const edge of positioned) {
      const placement = edge.data?.labelPlacement;
      const pathData = edge.data?.pathData;
      expect(placement).toBeDefined();
      expect(pathData).toBeTypeOf("string");
      expect(edge.data?.labelPathRatio).toBeGreaterThanOrEqual(0);
      expect(edge.data?.labelPathRatio).toBeLessThanOrEqual(1);
      expect(
        distanceToPolyline(
          placement as { x: number; y: number },
          sampleGraphSmoothStepPath(pathData as string),
        ),
      ).toBeLessThanOrEqual(0.001);
    }
  });

  it("places an icon-only semantic label on its rendered edge path", () => {
    const nodes = [
      { id: "source", position: { x: 0, y: 0 }, measured: { width: 200, height: 96 } },
      { id: "target", position: { x: 520, y: 0 }, measured: { width: 200, height: 96 } },
    ];
    const edge: Edge = {
      id: "kinship",
      source: "source",
      target: "target",
      type: GRAPH_RELATIONSHIP_EDGE_TYPE,
      data: { labelBadges: ["kinship"] },
    };

    const positioned = positionGraphRelationshipEdgeLabels(nodes, [edge])[0];
    const placement = positioned.data?.labelPlacement;
    const pathData = positioned.data?.pathData;

    expect(placement).toBeDefined();
    expect(pathData).toBeTypeOf("string");
    expect(
      distanceToPolyline(
        placement as { x: number; y: number },
        sampleGraphSmoothStepPath(pathData as string),
      ),
    ).toBeLessThanOrEqual(0.001);
  });

  it("includes visible guest overflow in card obstacles", () => {
    const baseNodes = [
      {
        id: "source",
        position: { x: 0, y: 72 },
        measured: { width: 200, height: 96 },
        data: {},
      },
      {
        id: "target",
        position: { x: 520, y: 72 },
        measured: { width: 200, height: 96 },
        data: {},
      },
      {
        id: "place",
        position: { x: 300, y: 0 },
        measured: { width: 120, height: 96 },
        data: {},
      },
    ];
    const edge: Edge = {
      id: "presence-overflow",
      source: "source",
      target: "target",
      type: GRAPH_RELATIONSHIP_EDGE_TYPE,
      label: "kennt",
    };
    const withoutGuests = positionGraphRelationshipEdgeLabels(baseNodes, [edge])[0];
    const withGuests = positionGraphRelationshipEdgeLabels(
      baseNodes.map((node) =>
        node.id === "place" ? { ...node, data: { guests: [{ id: "guest" }] } } : node,
      ),
      [edge],
    )[0];

    expect(withoutGuests.data?.labelPlacement).toEqual({ x: 360, y: 120 });
    expect(withGuests.data?.labelPlacement).not.toEqual(withoutGuests.data?.labelPlacement);
    expect(withGuests.data?.labelCollisionFallback).toBe(false);
  });

  it("treats a Storyboard group as a container and avoids only its visible header", () => {
    const nodes = [
      {
        id: "source",
        position: { x: 0, y: 200 },
        measured: { width: 200, height: 96 },
        data: { item: { kind: "note" } },
      },
      {
        id: "target",
        position: { x: 520, y: 200 },
        measured: { width: 200, height: 96 },
        data: { item: { kind: "note" } },
      },
      {
        id: "group",
        position: { x: 300, y: 0 },
        measured: { width: 200, height: 360 },
        data: { item: { kind: "group" } },
      },
    ];
    const edge: Edge = {
      id: "inside-group",
      source: "source",
      target: "target",
      type: GRAPH_RELATIONSHIP_EDGE_TYPE,
      label: "innerhalb",
    };

    const positioned = positionGraphRelationshipEdgeLabels(nodes, [edge])[0];

    expect(positioned.data?.labelPlacement).toEqual({ x: 360, y: 248 });
    expect(positioned.data?.labelCollisionFallback).toBe(false);
  });

  it("is the shared label renderer and placement owner for Figures and Storyboard", () => {
    const figures = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/FigureCanvas.tsx"),
      "utf8",
    );
    const storyboard = readFileSync(
      join(process.cwd(), "packages/client/src/modules/storyboard/StoryboardWorkspace.tsx"),
      "utf8",
    );

    expect(figures).toContain("positionGraphRelationshipEdgeLabels(nodes, edges");
    expect(figures).toContain("edgeTypes: graphRelationshipEdgeTypes");
    expect(storyboard).toContain("positionGraphRelationshipEdgeLabels(");
    expect(storyboard).toContain("edgeTypes={graphRelationshipEdgeTypes}");
  });
});
