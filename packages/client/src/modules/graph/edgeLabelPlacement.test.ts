import { afterEach, describe, expect, it } from "vitest";
import {
  type GraphEdgeLabelRequest,
  type GraphRect,
  placeGraphEdgeLabels,
  sampleGraphSmoothStepPath,
} from "./edgeLabelPlacement";

const originalViewport = {
  width: Object.getOwnPropertyDescriptor(window, "innerWidth"),
  height: Object.getOwnPropertyDescriptor(window, "innerHeight"),
  devicePixelRatio: Object.getOwnPropertyDescriptor(window, "devicePixelRatio"),
};

afterEach(() => {
  for (const [property, descriptor] of Object.entries({
    innerWidth: originalViewport.width,
    innerHeight: originalViewport.height,
    devicePixelRatio: originalViewport.devicePixelRatio,
  })) {
    if (descriptor) Object.defineProperty(window, property, descriptor);
  }
});

function request(
  id: string,
  overrides: Partial<GraphEdgeLabelRequest> = {},
): GraphEdgeLabelRequest {
  return {
    id,
    source: { x: 0, y: 0 },
    target: { x: 320, y: 0 },
    idealCenter: { x: 160, y: 0 },
    size: { width: 96, height: 24 },
    pathPoints: [
      { x: 0, y: 0 },
      { x: 320, y: 0 },
    ],
    ...overrides,
  };
}

function overlaps(first: GraphRect, second: GraphRect, clearance = 0) {
  return (
    first.x < second.x + second.width + clearance &&
    first.x + first.width + clearance > second.x &&
    first.y < second.y + second.height + clearance &&
    first.y + first.height + clearance > second.y
  );
}

function stablePlacements(placements: ReturnType<typeof placeGraphEdgeLabels>) {
  return [...placements.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([id, placement]) => [id, placement] as const);
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
    const projection = { x: start.x + delta.x * ratio, y: start.y + delta.y * ratio };
    return Math.min(closest, Math.hypot(point.x - projection.x, point.y - projection.y));
  }, Number.POSITIVE_INFINITY);
}

describe("graph edge label placement", () => {
  it("moves a label away from a card that occupies its ideal edge center", () => {
    const card: GraphRect = { x: 108, y: -32, width: 104, height: 64 };
    const placement = placeGraphEdgeLabels([request("edge")], [card], {
      clearance: 10,
      normalStep: 36,
    }).get("edge");

    expect(placement).toBeDefined();
    expect(placement?.candidateIndex).toBeGreaterThan(0);
    expect(placement?.collides).toBe(false);
    expect(overlaps(placement?.bounds as GraphRect, card, 10)).toBe(false);
    expect(placement?.bounds).toEqual({
      x: (placement?.center.x ?? 0) - 48,
      y: (placement?.center.y ?? 0) - 12,
      width: 96,
      height: 24,
    });
  });

  it("keeps a label on the exact sampled Smooth-Step route", () => {
    const pathPoints = sampleGraphSmoothStepPath(
      "M 0 0 L 120 0 Q 132 0 132 12 L 132 188 Q 132 200 144 200 L 320 200",
    );
    const placement = placeGraphEdgeLabels(
      [
        request("routed", {
          target: { x: 320, y: 200 },
          idealCenter: { x: 132, y: 100 },
          pathPoints,
        }),
      ],
      [{ x: 110, y: 70, width: 44, height: 60 }],
    ).get("routed");

    expect(pathPoints.length).toBeGreaterThan(4);
    expect(placement).toBeDefined();
    expect(placement?.pathRatio).toBeGreaterThanOrEqual(0);
    expect(placement?.pathRatio).toBeLessThanOrEqual(1);
    expect(
      distanceToPolyline(placement?.center as { x: number; y: number }, pathPoints),
    ).toBeLessThanOrEqual(0.001);
  });

  it("stays on its route and reports a collision when the complete route is blocked", () => {
    const card: GraphRect = { x: -1_000, y: -1_000, width: 2_000, height: 2_000 };
    const placement = placeGraphEdgeLabels([request("boxed-in")], [card], {
      clearance: 10,
      normalStep: 28,
    }).get("boxed-in");

    expect(placement).toBeDefined();
    expect(placement?.candidateIndex).toBe(0);
    expect(placement?.pathRatio).toBe(0.5);
    expect(placement?.collides).toBe(true);
    expect(overlaps(placement?.bounds as GraphRect, card, 10)).toBe(true);
    expect(placement?.center).toEqual({ x: 160, y: 0 });
  });

  it("moves along a routed vertical edge and ignores distant obstacles", () => {
    const verticalEdge = request("vertical", {
      source: { x: 0, y: 0 },
      target: { x: 0, y: 320 },
      idealCenter: { x: 0, y: 160 },
      pathPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 320 },
      ],
    });
    const localBlocker: GraphRect = { x: -120, y: 100, width: 240, height: 120 };
    const distantBlocker: GraphRect = {
      x: -10_000,
      y: 1_000,
      width: 20_000,
      height: 100,
    };

    const placement = placeGraphEdgeLabels([verticalEdge], [localBlocker, distantBlocker], {
      clearance: 8,
      normalStep: 28,
    }).get("vertical");

    expect(placement?.candidateIndex).toBeGreaterThan(0);
    expect(placement?.collides).toBe(false);
    expect(placement?.center.x).toBe(0);
    expect(overlaps(placement?.bounds as GraphRect, localBlocker, 8)).toBe(false);
    expect(placement?.center.y).toBeLessThan(100);
  });

  it("gives parallel edges separate, collision-free label cards", () => {
    const placements = placeGraphEdgeLabels(
      [request("parallel-b"), request("parallel-a"), request("parallel-c")],
      [],
      { clearance: 8, normalStep: 32 },
    );
    const ordered = ["parallel-a", "parallel-b", "parallel-c"].map((id) => placements.get(id));

    expect(ordered.every((placement) => placement?.collides === false)).toBe(true);
    expect(new Set(ordered.map((placement) => JSON.stringify(placement?.center))).size).toBe(3);
    expect(ordered.every((placement) => placement?.center.y === 0)).toBe(true);
    for (let first = 0; first < ordered.length; first += 1) {
      for (let second = first + 1; second < ordered.length; second += 1) {
        expect(
          overlaps(ordered[first]?.bounds as GraphRect, ordered[second]?.bounds as GraphRect, 8),
        ).toBe(false);
      }
    }
  });

  it("is deterministic regardless of persisted edge order", () => {
    const requests = [
      request("z-edge"),
      request("a-edge"),
      request("m-edge", {
        source: { x: 320, y: 0 },
        target: { x: 0, y: 0 },
      }),
    ];
    const obstacle = { x: 120, y: -20, width: 80, height: 40 };

    const forward = placeGraphEdgeLabels(requests, [obstacle]);
    const reversed = placeGraphEdgeLabels([...requests].reverse(), [obstacle]);

    expect(stablePlacements(reversed)).toEqual(stablePlacements(forward));
  });

  it("prefers visible edge ownership over leaving a densely occupied route", () => {
    const occupiedBand: GraphRect = { x: -1_000, y: -120, width: 2_000, height: 240 };
    const placement = placeGraphEdgeLabels([request("dense-edge")], [occupiedBand], {
      clearance: 8,
      normalStep: 32,
    }).get("dense-edge");

    expect(placement).toBeDefined();
    expect(placement?.collides).toBe(true);
    expect(placement?.center.y).toBe(0);
    expect(overlaps(placement?.bounds as GraphRect, occupiedBand, 8)).toBe(true);
  });

  it("uses only flow coordinates, independent of mobile viewport size and browser zoom", () => {
    const requests = [request("one"), request("two")];
    const obstacles = [{ x: 120, y: -24, width: 80, height: 48 }];
    const desktop = placeGraphEdgeLabels(requests, obstacles);

    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 390 },
      innerHeight: { configurable: true, value: 844 },
      devicePixelRatio: { configurable: true, value: 2.75 },
    });
    const mobileZoomed = placeGraphEdgeLabels(requests, obstacles);

    expect(stablePlacements(mobileZoomed)).toEqual(stablePlacements(desktop));
  });
});
