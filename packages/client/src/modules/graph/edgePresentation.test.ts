import { describe, expect, it } from "vitest";
import { graphRelationshipEdgePresentation } from "./edgePresentation";

describe("graph relationship edge presentation", () => {
  it.each(["solid", "dashed", "dotted"] as const)(
    "publishes the shared edge-line-%s class",
    (variant) => {
      const presentation = graphRelationshipEdgePresentation({
        directed: false,
        variant,
        sourceLabel: "Ada",
        targetLabel: "Bela",
      });

      expect(presentation.className.split(" ")).toContain(`edge-line-${variant}`);
      expect(presentation.className).not.toContain("edge-blood");
    },
  );

  it("projects an undirected relationship with the shared moss label card", () => {
    expect(
      graphRelationshipEdgePresentation({
        directed: false,
        sourceLabel: "Ada",
        targetLabel: "Bela",
        label: "Freunde",
      }),
    ).toEqual({
      type: "graphRelationship",
      className:
        "graph-relationship-edge edge-line-solid edge-solid edge-undirected edge-color-auto",
      ariaLabel: "Ada ↔ Bela — Freunde",
      labelBgStyle: {
        fill: "var(--graph-edge-label-bg)",
        stroke: "var(--graph-edge-undirected-stroke)",
        strokeWidth: 0.8,
      },
      labelStyle: {
        fill: "var(--graph-edge-label-text)",
        fontFamily: "var(--ui)",
        fontSize: "var(--font-size-2)",
        fontWeight: 500,
      },
      labelShowBg: true,
      labelBgPadding: [5, 2],
      labelBgBorderRadius: 4,
      markerEnd: undefined,
    });
  });

  it("owns direction, temporal weight, existing variants, and matching arrow markers", () => {
    expect(
      graphRelationshipEdgePresentation({
        directed: true,
        variant: "dotted",
        temporal: true,
        sourceLabel: "Ada",
        targetLabel: "Bela",
        annotations: ["Temporal history"],
      }),
    ).toMatchObject({
      type: "graphRelationship",
      className:
        "graph-relationship-edge edge-line-dotted edge-dotted edge-directed edge-color-auto edge-temporal",
      ariaLabel: "Ada → Bela — Temporal history",
      labelBgStyle: { stroke: "var(--graph-edge-directed-stroke)" },
      labelStyle: { fontWeight: 600 },
      markerEnd: {
        type: "arrowclosed",
        color: "var(--graph-edge-directed-stroke)",
      },
    });
  });

  it.each([
    ["ink", "var(--graph-edge-color-ink)"],
    ["gold", "var(--graph-edge-color-gold)"],
    ["rose", "var(--graph-edge-color-rose)"],
    ["moss", "var(--graph-edge-color-moss)"],
    ["blue", "var(--graph-edge-color-blue)"],
  ] as const)("projects the explicit %s color onto path, label, and marker", (color, token) => {
    const result = graphRelationshipEdgePresentation({
      directed: true,
      color,
      sourceLabel: "Ada",
      targetLabel: "Bela",
    });

    expect(result.className).toContain(`edge-color-${color}`);
    expect(result.labelBgStyle.stroke).toBe(token);
    expect(result.markerEnd).toMatchObject({ color: token });
  });
});
