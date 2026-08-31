import { describe, expect, it } from "vitest";
import type { FigureEdge, FigureNode, TimelineMoment } from "../model";
import {
  alignNodesToGrid,
  connectionKind,
  figureIsDeceased,
  patchRelationship,
  relationshipConflicts,
  relationshipHandles,
  relationshipKey,
  relationshipLabelEditor,
  resolveRelationship,
  resolveRelationshipOverview,
  semanticZoomTier,
} from "./relationships";

const timeline: TimelineMoment[] = [
  { id: "before", title: "Vorher" },
  { id: "betrayal", title: "Verrat", date: "1420-03-12" },
  { id: "after", title: "Danach" },
];

describe("relationship timeline", () => {
  it("reduces detail in stable semantic zoom stages", () => {
    expect(semanticZoomTier(1)).toBe("detail");
    expect(semanticZoomTier(0.5)).toBe("compact");
    expect(semanticZoomTier(0.2)).toBe("overview");
  });
  it("aligns all elements to the coarse grid without changing their content", () => {
    const nodes: FigureNode[] = [
      { id: "n1", x: 73, y: -70, name: "A" },
      { id: "n2", x: 121, y: 167, name: "B" },
    ];
    expect(alignNodesToGrid(nodes)).toEqual([
      { id: "n1", x: 96, y: -48, name: "A" },
      { id: "n2", x: 144, y: 144, name: "B" },
    ]);
    expect(nodes[0]).toMatchObject({ x: 73, y: -70 });
  });
  it("distinguishes directed and centered undirected connectors", () => {
    expect(connectionKind("out", "in")).toBe("directed");
    expect(connectionKind("neutral-top", "neutral-bottom")).toBe("undirected");
    expect(connectionKind("out", "neutral-top")).toBeNull();
    expect(relationshipKey("a", "b", true)).not.toBe(relationshipKey("b", "a", true));
    expect(relationshipKey("a", "b", false)).toBe(relationshipKey("b", "a", false));
  });
  it("adapts undirected handles to the shortest, outward-facing route", () => {
    const nodes: FigureNode[] = [
      { id: "top-left", x: 0, y: 0, name: "A" },
      { id: "top-right", x: 300, y: 10, name: "B" },
      { id: "bottom", x: 150, y: 300, name: "C" },
    ];
    expect(
      relationshipHandles({ id: "e1", from: "top-left", to: "bottom", label: "" }, nodes),
    ).toEqual({ from: "neutral-bottom", to: "neutral-top" });
    expect(
      relationshipHandles(
        {
          id: "e2",
          from: "top-left",
          to: "top-right",
          label: "",
          fromHandle: "neutral-bottom",
          toHandle: "neutral-bottom",
        },
        nodes,
      ),
    ).toEqual({ from: "neutral-top", to: "neutral-top" });
  });
  it("uses the latest relationship version at a selected moment", () => {
    const edge: FigureEdge = {
      id: "e1",
      from: "a",
      to: "b",
      label: "Freunde",
      versions: [
        { momentId: "betrayal", label: "Feinde", active: true },
        { momentId: "after", label: "Versöhnt", active: true },
      ],
    };
    expect(resolveRelationship(edge, timeline, "before").label).toBe("Freunde");
    expect(resolveRelationship(edge, timeline, "betrayal").label).toBe("Feinde");
    expect(resolveRelationship(edge, timeline, "after").label).toBe("Versöhnt");
  });

  it("creates a version instead of overwriting the earlier relationship", () => {
    const edge: FigureEdge = { id: "e1", from: "a", to: "b", label: "Freunde" };
    const changed = patchRelationship(edge, timeline, "betrayal", { label: "Feinde" });
    expect(changed.label).toBe("Freunde");
    expect(resolveRelationship(changed, timeline, "betrayal").label).toBe("Feinde");
  });

  it("inherits and changes an edge color only from the selected moment onward", () => {
    const edge: FigureEdge = {
      id: "e1",
      from: "a",
      to: "b",
      color: "rose",
      versions: [{ momentId: "betrayal", color: "blue", active: true }],
    };

    const inherited = patchRelationship(edge, timeline, "after", { label: "Später" });
    expect(resolveRelationship(inherited, timeline, "before").color).toBe("rose");
    expect(resolveRelationship(inherited, timeline, "betrayal").color).toBe("blue");
    expect(resolveRelationship(inherited, timeline, "after").color).toBe("blue");

    const changed = patchRelationship(edge, timeline, "after", { color: "gold" });
    expect(resolveRelationship(changed, timeline, "betrayal").color).toBe("blue");
    expect(resolveRelationship(changed, timeline, "after").color).toBe("gold");
  });

  it("inherits line presentation and relationship meaning independently over time", () => {
    const edge: FigureEdge = {
      id: "e1",
      from: "a",
      to: "b",
      lineStyle: "dotted",
      relationshipKind: "kinship",
      versions: [
        {
          momentId: "betrayal",
          lineStyle: "dashed",
          relationshipKind: "general",
          active: true,
        },
      ],
    };

    const inherited = patchRelationship(edge, timeline, "after", { label: "Später" });
    expect(resolveRelationship(inherited, timeline, "before")).toMatchObject({
      lineStyle: "dotted",
      relationshipKind: "kinship",
    });
    expect(resolveRelationship(inherited, timeline, "after")).toMatchObject({
      lineStyle: "dashed",
      relationshipKind: "general",
    });

    const changed = patchRelationship(edge, timeline, "after", {
      lineStyle: "solid",
      relationshipKind: "kinship",
    });
    expect(resolveRelationship(changed, timeline, "betrayal")).toMatchObject({
      lineStyle: "dashed",
      relationshipKind: "general",
    });
    expect(resolveRelationship(changed, timeline, "after")).toMatchObject({
      lineStyle: "solid",
      relationshipKind: "kinship",
    });
  });

  it("migrates every legacy style dimension when a modern appearance field is edited", () => {
    const kinship = patchRelationship(
      { id: "blood", from: "a", to: "b", style: "blood" },
      timeline,
      null,
      { lineStyle: "dotted" },
    );
    expect(kinship).toMatchObject({
      lineStyle: "dotted",
      relationshipKind: "kinship",
      color: "auto",
    });
    expect(kinship).not.toHaveProperty("style");

    const dashed = patchRelationship(
      { id: "dashed", from: "a", to: "b", style: "dashed" },
      timeline,
      null,
      { relationshipKind: "general" },
    );
    expect(dashed).toMatchObject({
      lineStyle: "dashed",
      relationshipKind: "general",
      color: "auto",
    });
    expect(dashed).not.toHaveProperty("style");

    const gold = patchRelationship(
      { id: "gold", from: "a", to: "b", style: "gold" },
      timeline,
      null,
      { lineStyle: "solid" },
    );
    expect(gold).toMatchObject({
      lineStyle: "solid",
      relationshipKind: "general",
      color: "gold",
    });
    expect(gold).not.toHaveProperty("style");
  });

  it("materializes legacy gold as a modern color in new temporal states", () => {
    const changed = patchRelationship(
      { id: "gold", from: "a", to: "b", style: "gold" },
      timeline,
      "betrayal",
      { label: "Später" },
    );

    expect(changed.versions?.find((version) => version.momentId === "betrayal")).toMatchObject({
      lineStyle: "solid",
      relationshipKind: "general",
      color: "gold",
    });
    expect(changed.versions?.find((version) => version.momentId === "betrayal")).not.toHaveProperty(
      "style",
    );
  });

  it("inherits the previous label when the current timeline text is deleted", () => {
    const edge: FigureEdge = {
      id: "e1",
      from: "a",
      to: "b",
      label: "Freunde",
      versions: [
        { momentId: "betrayal", label: "Feinde", active: true },
        { momentId: "after", label: "Versöhnt", active: true },
      ],
    };
    const changed = patchRelationship(edge, timeline, "after", { label: "" });
    expect(changed.versions?.find((version) => version.momentId === "after")).not.toHaveProperty(
      "label",
    );
    expect(resolveRelationship(changed, timeline, "after").label).toBe("Feinde");
    expect(relationshipLabelEditor(changed, timeline, "after")).toEqual({
      value: "",
      inherited: "Feinde",
    });
    expect(resolveRelationship(changed, timeline, "betrayal").label).toBe("Feinde");
  });

  it("reverses a directed relationship only from the selected moment onward", () => {
    const edge: FigureEdge = { id: "e1", from: "a", to: "b", label: "Folgt", gerichtet: true };
    const changed = patchRelationship(edge, timeline, "betrayal", { from: "b", to: "a" });
    expect(changed).toMatchObject({ from: "a", to: "b" });
    expect(resolveRelationship(changed, timeline, "before")).toMatchObject({ from: "a", to: "b" });
    expect(resolveRelationship(changed, timeline, "betrayal")).toMatchObject({
      from: "b",
      to: "a",
    });
    expect(resolveRelationship(changed, timeline, "after")).toMatchObject({ from: "b", to: "a" });
    expect(changed.versions).toHaveLength(1);
  });

  it("detects duplicates against the resolved relationship state at the selected moment", () => {
    const edges: FigureEdge[] = [
      {
        id: "edited",
        from: "a",
        to: "b",
        gerichtet: true,
        versions: [{ momentId: "betrayal", from: "b", to: "a", gerichtet: true, active: true }],
      },
      {
        id: "other",
        from: "c",
        to: "b",
        gerichtet: true,
        versions: [{ momentId: "betrayal", from: "a", to: "b", gerichtet: true, active: true }],
      },
      {
        id: "inactive",
        from: "b",
        to: "a",
        gerichtet: true,
        active: false,
      },
    ];

    expect(
      relationshipConflicts(edges, timeline, "betrayal", "edited", {
        from: "a",
        to: "b",
        gerichtet: true,
      }),
    ).toBe(true);
    expect(
      relationshipConflicts(edges, timeline, "betrayal", "edited", {
        from: "b",
        to: "a",
        gerichtet: true,
      }),
    ).toBe(false);
  });

  it("preserves a reversed direction through later partial versions", () => {
    const edge: FigureEdge = {
      id: "e1",
      from: "a",
      to: "b",
      label: "Folgt",
      gerichtet: true,
      versions: [
        { momentId: "betrayal", from: "b", to: "a", label: "Jagt", active: true },
        { momentId: "after", label: "Meidet", active: true },
      ],
    };
    expect(resolveRelationship(edge, timeline, "after")).toMatchObject({
      from: "b",
      to: "a",
      label: "Meidet",
    });
  });

  it("shows every relationship and its label changes in the complete overview", () => {
    const edge: FigureEdge = {
      id: "e1",
      from: "a",
      to: "b",
      label: "Freunde",
      active: false,
      versions: [
        { momentId: "betrayal", label: "Feinde", active: true },
        { momentId: "after", label: "Versöhnt", active: true },
      ],
    };
    const overview = resolveRelationshipOverview(edge, timeline);
    expect(overview.active).toBe(true);
    expect(overview.label).toBe("Freunde → Feinde → Versöhnt");
  });

  it("marks a figure deceased from its death moment onward", () => {
    const figure: FigureNode = { id: "n1", x: 0, y: 0, name: "A", diedMomentId: "betrayal" };
    expect(figureIsDeceased(figure, timeline, "before")).toBe(false);
    expect(figureIsDeceased(figure, timeline, "betrayal")).toBe(true);
    expect(figureIsDeceased(figure, timeline, "after")).toBe(true);
  });
});
