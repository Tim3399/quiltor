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
    { id: "e2", from: "a", to: "c", label: "Folgt", gerichtet: true },
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
    const relationships = createRelationshipFlowEdges(state, [], null);

    expect(relationships.map((edge) => edge.id)).toEqual(["e1", "e2", "e3"]);
    expect(relationships[1]).toMatchObject({
      source: "a",
      target: "c",
      sourceHandle: "out",
      targetHandle: "in",
      className: "edge-solid edge-directed ",
    });
    expect(relationships[2]).toMatchObject({ animated: true });
    expect(combineFigureFlowEdges(relationships, [], false)).toEqual([]);
    expect(combineFigureFlowEdges(relationships, [], true)).toHaveLength(3);
  });
});
