import { describe, expect, it } from "vitest";
import type { FigureState } from "../model";
import {
  applyFigureNodeContext,
  combineFigureFlowEdges,
  createFigureFlowNodes,
  createRelationshipFlowEdges,
} from "./figureCanvasModel";

const state: FigureState = {
  nodes: [
    { id: "a", x: 0, y: 0, name: "Ada", type: "person" },
    { id: "b", x: 300, y: 0, name: "Bela", type: "person", pinned: true },
    { id: "c", x: 150, y: 240, name: "Cora", type: "person" },
  ],
  edges: [
    { id: "e1", from: "a", to: "b", label: "Freunde" },
    {
      id: "e2",
      from: "a",
      to: "c",
      label: "Folgt",
      gerichtet: true,
      color: "blue",
      lineStyle: "dotted",
    },
    { id: "e3", from: "b", to: "c", label: "Familie", style: "blood" },
  ],
};

describe("figure canvas model", () => {
  it("keeps node persistence flags and semantic LOD in the flow projection", () => {
    const nodes = createFigureFlowNodes(state.nodes, "overview", 0.2);

    expect(nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 150, y: 240 },
    ]);
    expect(nodes[0].data).toMatchObject({ zoomTier: "overview", zoom: 0.2 });
    expect(nodes[1].draggable).toBe(false);

    const withGuests = applyFigureNodeContext(
      nodes,
      [],
      null,
      new Map([["c", [state.nodes[0], state.nodes[1]]]]),
    );
    expect(withGuests[2].data.guests.map((guest) => guest.id)).toEqual(["a", "b"]);
  });

  it("projects every relationship and hides only relationship edges when requested", () => {
    const relationships = createRelationshipFlowEdges(state, [], null, "e2");

    expect(relationships.map((edge) => edge.id)).toEqual(["e1", "e2", "e3"]);
    expect(relationships[1]).toMatchObject({
      data: { kind: "relationship" },
      source: "a",
      target: "c",
      sourceHandle: "out",
      targetHandle: "in",
      selected: true,
      className:
        "graph-relationship-edge edge-line-dotted edge-dotted edge-directed edge-color-blue",
      type: "graphRelationship",
      ariaLabel: "Ada → Cora — Folgt",
      labelBgStyle: { fill: "var(--graph-edge-label-bg)" },
      labelStyle: { fill: "var(--graph-edge-label-text)" },
      labelBgPadding: [5, 2],
      labelBgBorderRadius: 4,
      markerEnd: {
        type: "arrowclosed",
        color: "var(--graph-edge-color-blue)",
      },
    });
    expect(relationships[2]).toMatchObject({
      data: { kind: "relationship", labelBadges: ["kinship"] },
      className: expect.stringContaining("edge-line-solid"),
      ariaLabel: "Bela ↔ Cora — Familie · Kinship",
    });
    expect(relationships[2].animated).toBeUndefined();
    expect(relationships[0].selected).toBe(false);
    expect(combineFigureFlowEdges(relationships, [], false)).toEqual([]);
    expect(combineFigureFlowEdges(relationships, [], true)).toHaveLength(3);
  });

  it("reads legacy gold style as color only until an explicit color is stored", () => {
    const legacy = createRelationshipFlowEdges(
      { ...state, edges: [{ id: "legacy", from: "a", to: "b", style: "gold" }] },
      [],
      null,
    )[0];
    const explicitAuto = createRelationshipFlowEdges(
      {
        ...state,
        edges: [{ id: "modern", from: "a", to: "b", style: "gold", color: "auto" }],
      },
      [],
      null,
    )[0];

    expect(legacy.className).toContain("edge-color-gold");
    expect(legacy.labelBgStyle).toMatchObject({ stroke: "var(--graph-edge-color-gold)" });
    expect(explicitAuto.className).toContain("edge-color-auto");
    expect(explicitAuto.labelBgStyle).toMatchObject({
      stroke: "var(--graph-edge-undirected-stroke)",
    });
  });
});
