import type { Node, NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { NO_MEASURED_SIZES, rememberMeasured, withMeasured } from "./measuredNodes";

function node(id: string, extra: Partial<Node> = {}): Node {
  return { id, position: { x: 0, y: 0 }, data: {}, ...extra };
}

describe("rememberMeasured", () => {
  it("keeps the size React Flow reported", () => {
    const changes: NodeChange[] = [
      { id: "steg", type: "dimensions", dimensions: { width: 200, height: 96 } },
    ];

    expect(rememberMeasured(NO_MEASURED_SIZES, changes).get("steg")).toEqual({
      width: 200,
      height: 96,
    });
  });

  it("ignores everything that is not a measurement", () => {
    const changes: NodeChange[] = [
      { id: "steg", type: "position", position: { x: 4, y: 8 } },
      { id: "kran", type: "select", selected: true },
      { id: "leer", type: "dimensions", dimensions: { width: 0, height: 0 } },
    ];

    expect(rememberMeasured(NO_MEASURED_SIZES, changes).size).toBe(0);
  });

  it("returns the same map when nothing changed, so state does not churn", () => {
    const known = rememberMeasured(NO_MEASURED_SIZES, [
      { id: "steg", type: "dimensions", dimensions: { width: 200, height: 96 } },
    ]);

    const again = rememberMeasured(known, [
      { id: "steg", type: "dimensions", dimensions: { width: 200, height: 96 } },
    ]);

    expect(again).toBe(known);
  });
});

describe("withMeasured", () => {
  it("gives a derived node the size that was measured for it", () => {
    const known = rememberMeasured(NO_MEASURED_SIZES, [
      { id: "steg", type: "dimensions", dimensions: { width: 200, height: 96 } },
    ]);

    expect(withMeasured([node("steg")], known)[0].measured).toEqual({ width: 200, height: 96 });
  });

  it("leaves a node that states its own size alone", () => {
    const known = rememberMeasured(NO_MEASURED_SIZES, [
      { id: "karte", type: "dimensions", dimensions: { width: 10, height: 10 } },
    ]);
    const card = node("karte", { width: 800, height: 600 });

    expect(withMeasured([card], known)[0]).toBe(card);
  });

  it("leaves the list untouched when nothing was measured yet", () => {
    const nodes = [node("steg")];

    expect(withMeasured(nodes, NO_MEASURED_SIZES)).toBe(nodes);
  });
});
