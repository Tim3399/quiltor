import { render, waitFor } from "@testing-library/react";
import { EdgeText } from "@xyflow/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { graphRelationshipEdgePresentation } from "./edgePresentation";

const originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value(this: SVGElement) {
      return { x: 0, y: 0, width: (this.textContent?.length ?? 0) * 6, height: 10 };
    },
  });
});

afterAll(() => {
  if (originalGetBBox) {
    Object.defineProperty(SVGElement.prototype, "getBBox", originalGetBBox);
  } else {
    Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  }
});

function SharedEdgeLabel({ label }: { label: string }) {
  const presentation = graphRelationshipEdgePresentation({
    directed: true,
    sourceLabel: "Ada",
    targetLabel: "Bela",
    label,
  });
  return (
    <svg aria-hidden="true">
      <EdgeText
        x={50}
        y={50}
        label={label}
        labelStyle={presentation.labelStyle}
        labelShowBg={presentation.labelShowBg}
        labelBgStyle={presentation.labelBgStyle}
        labelBgPadding={presentation.labelBgPadding}
        labelBgBorderRadius={presentation.labelBgBorderRadius}
      />
    </svg>
  );
}

describe("shared graph edge label", () => {
  it("renders no card for an empty label and auto-sizes a compact card to its text", async () => {
    const { container, rerender } = render(<SharedEdgeLabel label="" />);
    expect(container.querySelector(".react-flow__edge-textbg")).toBeNull();

    rerender(<SharedEdgeLabel label="Kurz" />);
    const shortCard = container.querySelector(".react-flow__edge-textbg");
    await waitFor(() => expect(shortCard).toHaveAttribute("width", "34"));
    expect(shortCard).toHaveAttribute("rx", "4");
    expect(shortCard).toHaveStyle({
      fill: "var(--graph-edge-label-bg)",
      stroke: "var(--graph-edge-directed-stroke)",
    });

    rerender(<SharedEdgeLabel label="Deutlich länger" />);
    await waitFor(() =>
      expect(
        Number(container.querySelector(".react-flow__edge-textbg")?.getAttribute("width")),
      ).toBe(100),
    );
  });
});
