export type GraphPoint = { x: number; y: number };

export type GraphSize = { width: number; height: number };

/** Axis-aligned rectangle in React Flow's unscaled canvas coordinates. */
export type GraphRect = GraphPoint & GraphSize;

export type GraphEdgeLabelRequest = {
  id: string;
  source: GraphPoint;
  target: GraphPoint;
  /** Preferred center returned by the edge path helper. */
  idealCenter: GraphPoint;
  size: GraphSize;
  /** Exact M/L/Q SVG path rendered for this edge. */
  pathData?: string;
  /** Sampled compatibility form of the rendered path. */
  pathPoints?: readonly GraphPoint[];
};

export type GraphEdgeLabelPlacement = {
  id: string;
  center: GraphPoint;
  bounds: GraphRect;
  /** Index in the deterministic, midpoint-first candidate set. */
  candidateIndex: number;
  /** Arc-length ratio that anchors the label to the rendered path. */
  pathRatio: number;
  /** True when no collision-free position exists on the edge. */
  collides: boolean;
};

export type GraphEdgeLabelPlacementOptions = {
  clearance?: number;
  /** Legacy name: now controls the maximum candidate spacing along the path. */
  normalStep?: number;
};

type LineSegment = {
  kind: "line";
  from: GraphPoint;
  to: GraphPoint;
  length: number;
};

type CurveSample = { t: number; length: number; point: GraphPoint };

type QuadraticSegment = {
  kind: "quadratic";
  from: GraphPoint;
  control: GraphPoint;
  to: GraphPoint;
  length: number;
  samples: readonly CurveSample[];
};

type PathSegment = LineSegment | QuadraticSegment;
type PathGeometry = { segments: readonly PathSegment[]; length: number };

type CandidateScore = {
  collisions: number;
  overlapArea: number;
  displacementSquared: number;
  candidateIndex: number;
};

const DEFAULT_CLEARANCE = 8;
const DEFAULT_PATH_STEP = 18;
const MAX_CANDIDATES = 81;
const CURVE_SUBDIVISIONS = 24;
const PATH_TOKEN_PATTERN = /[MLQ]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/giu;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number, fallback: number): number {
  return Math.max(0, finiteOr(value, fallback));
}

function normalizedRect(rect: GraphRect): GraphRect {
  const x = finiteOr(rect.x, 0);
  const y = finiteOr(rect.y, 0);
  const width = finiteOr(rect.width, 0);
  const height = finiteOr(rect.height, 0);
  return {
    x: width >= 0 ? x : x + width,
    y: height >= 0 ? y : y + height,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function expandRect(rect: GraphRect, amount: number): GraphRect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function overlapArea(first: GraphRect, second: GraphRect): number {
  const width =
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const height =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function boundsAt(center: GraphPoint, size: GraphSize): GraphRect {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function distance(first: GraphPoint, second: GraphPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function linePoint(from: GraphPoint, to: GraphPoint, t: number): GraphPoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function quadraticPoint(
  from: GraphPoint,
  control: GraphPoint,
  to: GraphPoint,
  t: number,
): GraphPoint {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

function curveSamples(
  from: GraphPoint,
  control: GraphPoint,
  to: GraphPoint,
): readonly CurveSample[] {
  const result: CurveSample[] = [{ t: 0, length: 0, point: from }];
  let previous = from;
  let total = 0;
  for (let index = 1; index <= CURVE_SUBDIVISIONS; index += 1) {
    const t = index / CURVE_SUBDIVISIONS;
    const point = quadraticPoint(from, control, to, t);
    total += distance(previous, point);
    result.push({ t, length: total, point });
    previous = point;
  }
  return result;
}

function tokenNumber(tokens: readonly string[], index: number): number | undefined {
  const value = Number(tokens[index]);
  return Number.isFinite(value) ? value : undefined;
}

function parsePath(pathData: string): PathGeometry | null {
  const tokens = pathData.match(PATH_TOKEN_PATTERN) ?? [];
  const segments: PathSegment[] = [];
  let cursor: GraphPoint | null = null;
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index]?.toUpperCase();
    index += 1;
    if (command === "M" || command === "L") {
      const x = tokenNumber(tokens, index);
      const y = tokenNumber(tokens, index + 1);
      index += 2;
      if (x === undefined || y === undefined) return null;
      const point = { x, y };
      if (command === "M") cursor = point;
      else {
        if (!cursor) return null;
        const length = distance(cursor, point);
        if (length > 0) segments.push({ kind: "line", from: cursor, to: point, length });
        cursor = point;
      }
      continue;
    }
    if (command !== "Q" || !cursor) return null;
    const controlX = tokenNumber(tokens, index);
    const controlY = tokenNumber(tokens, index + 1);
    const targetX = tokenNumber(tokens, index + 2);
    const targetY = tokenNumber(tokens, index + 3);
    index += 4;
    if (
      controlX === undefined ||
      controlY === undefined ||
      targetX === undefined ||
      targetY === undefined
    ) {
      return null;
    }
    const control = { x: controlX, y: controlY };
    const to = { x: targetX, y: targetY };
    const samples = curveSamples(cursor, control, to);
    const length = samples.at(-1)?.length ?? 0;
    if (length > 0) {
      segments.push({ kind: "quadratic", from: cursor, control, to, length, samples });
    }
    cursor = to;
  }
  const length = segments.reduce((total, segment) => total + segment.length, 0);
  return length > 0 ? { segments, length } : null;
}

/**
 * Samples the M/L/Q subset emitted by XYFlow's Smooth-Step renderer.
 * Consumers that only understand polylines can therefore use the exact same
 * route without inventing a second edge geometry.
 */
export function sampleGraphSmoothStepPath(pathData: string): GraphPoint[] {
  const geometry = parsePath(pathData);
  if (!geometry?.segments.length) return [];
  const points: GraphPoint[] = [geometry.segments[0].from];
  for (const segment of geometry.segments) {
    if (segment.kind === "line") points.push(segment.to);
    else points.push(...segment.samples.slice(1).map((sample) => sample.point));
  }
  return points;
}

function pathDataFromPoints(points: readonly GraphPoint[] | undefined): string | undefined {
  if (!points || points.length < 2) return undefined;
  const finite = points.map((point) => ({
    x: finiteOr(point.x, 0),
    y: finiteOr(point.y, 0),
  }));
  return finite.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join("");
}

function segmentPointAt(segment: PathSegment, requestedDistance: number): GraphPoint {
  const offset = Math.min(Math.max(requestedDistance, 0), segment.length);
  if (segment.kind === "line") return linePoint(segment.from, segment.to, offset / segment.length);
  for (let index = 1; index < segment.samples.length; index += 1) {
    const before = segment.samples[index - 1];
    const after = segment.samples[index];
    if (!before || !after || after.length < offset) continue;
    const span = after.length - before.length;
    const ratio = span > 0 ? (offset - before.length) / span : 0;
    const t = before.t + (after.t - before.t) * ratio;
    return quadraticPoint(segment.from, segment.control, segment.to, t);
  }
  return segment.to;
}

function pathPointAt(geometry: PathGeometry, ratio: number): GraphPoint {
  let offset = Math.min(Math.max(ratio, 0), 1) * geometry.length;
  for (const segment of geometry.segments) {
    if (offset <= segment.length) return segmentPointAt(segment, offset);
    offset -= segment.length;
  }
  return geometry.segments.at(-1)?.to ?? { x: 0, y: 0 };
}

/** Resolve an arc-length ratio against the same M/L/Q path used by BaseEdge. */
export function graphPathPointAt(pathData: string, ratio: number): GraphPoint | null {
  const geometry = parsePath(pathData);
  return geometry ? pathPointAt(geometry, ratio) : null;
}

function nearestPathRatio(geometry: PathGeometry, point: GraphPoint): number {
  let traversed = 0;
  let nearestRatio = 0.5;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const segment of geometry.segments) {
    const samples: readonly CurveSample[] =
      segment.kind === "line"
        ? [
            { t: 0, length: 0, point: segment.from },
            { t: 1, length: segment.length, point: segment.to },
          ]
        : segment.samples;
    for (let index = 1; index < samples.length; index += 1) {
      const before = samples[index - 1];
      const after = samples[index];
      if (!before || !after) continue;
      const deltaX = after.point.x - before.point.x;
      const deltaY = after.point.y - before.point.y;
      const squaredLength = deltaX * deltaX + deltaY * deltaY;
      const projection =
        squaredLength > 0
          ? Math.min(
              Math.max(
                ((point.x - before.point.x) * deltaX + (point.y - before.point.y) * deltaY) /
                  squaredLength,
                0,
              ),
              1,
            )
          : 0;
      const projected = linePoint(before.point, after.point, projection);
      const squaredDistance = (point.x - projected.x) ** 2 + (point.y - projected.y) ** 2;
      if (squaredDistance >= nearestDistance) continue;
      nearestDistance = squaredDistance;
      nearestRatio =
        (traversed + before.length + (after.length - before.length) * projection) / geometry.length;
    }
    traversed += segment.length;
  }
  return nearestRatio;
}

function scoreCandidate(
  bounds: GraphRect,
  idealCenter: GraphPoint,
  obstacles: readonly GraphRect[],
  placedLabels: readonly GraphRect[],
  clearance: number,
  candidateIndex: number,
): CandidateScore {
  let collisions = 0;
  let totalOverlapArea = 0;
  for (const rect of [...obstacles, ...placedLabels]) {
    const area = overlapArea(bounds, expandRect(rect, clearance));
    if (area <= 0) continue;
    collisions += 1;
    totalOverlapArea += area;
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    collisions,
    overlapArea: totalOverlapArea,
    displacementSquared: (centerX - idealCenter.x) ** 2 + (centerY - idealCenter.y) ** 2,
    candidateIndex,
  };
}

function better(candidate: CandidateScore, current: CandidateScore): boolean {
  return (
    candidate.collisions < current.collisions ||
    (candidate.collisions === current.collisions &&
      (candidate.overlapArea < current.overlapArea ||
        (candidate.overlapArea === current.overlapArea &&
          (candidate.displacementSquared < current.displacementSquared ||
            (candidate.displacementSquared === current.displacementSquared &&
              candidate.candidateIndex < current.candidateIndex)))))
  );
}

function candidateRatios(
  geometry: PathGeometry,
  idealRatio: number,
  step: number,
): readonly number[] {
  const intervals = Math.min(
    MAX_CANDIDATES - 1,
    Math.max(2, Math.ceil(geometry.length / Math.max(step, 1))),
  );
  const ratios = [idealRatio];
  for (let index = 0; index <= intervals; index += 1) ratios.push(index / intervals);
  return [...new Set(ratios.map((ratio) => Math.round(ratio * 1_000_000) / 1_000_000))].sort(
    (first, second) =>
      Math.abs(first - idealRatio) - Math.abs(second - idealRatio) || first - second,
  );
}

function compareRects(first: GraphRect, second: GraphRect): number {
  return (
    first.x - second.x ||
    first.y - second.y ||
    first.width - second.width ||
    first.height - second.height
  );
}

/**
 * Places labels exclusively on their own rendered edge. If a dense graph has
 * no collision-free path point, the least-overlapping on-edge point wins and
 * is reported through `collides` rather than being detached from the edge.
 */
export function placeGraphEdgeLabels(
  requests: readonly GraphEdgeLabelRequest[],
  obstacles: readonly GraphRect[],
  options: GraphEdgeLabelPlacementOptions = {},
): ReadonlyMap<string, GraphEdgeLabelPlacement> {
  const clearance = nonNegative(options.clearance ?? DEFAULT_CLEARANCE, DEFAULT_CLEARANCE);
  const step = Math.max(1, nonNegative(options.normalStep ?? DEFAULT_PATH_STEP, DEFAULT_PATH_STEP));
  const normalizedObstacles = obstacles.map(normalizedRect).sort(compareRects);
  const placements = new Map<string, GraphEdgeLabelPlacement>();
  const placedBounds: GraphRect[] = [];

  for (const request of [...requests].sort((first, second) => first.id.localeCompare(second.id))) {
    if (placements.has(request.id)) throw new Error(`Duplicate graph edge label id: ${request.id}`);
    const source = { x: finiteOr(request.source.x, 0), y: finiteOr(request.source.y, 0) };
    const target = {
      x: finiteOr(request.target.x, source.x),
      y: finiteOr(request.target.y, source.y),
    };
    const idealCenter = {
      x: finiteOr(request.idealCenter.x, (source.x + target.x) / 2),
      y: finiteOr(request.idealCenter.y, (source.y + target.y) / 2),
    };
    const size = {
      width: nonNegative(request.size.width, 0),
      height: nonNegative(request.size.height, 0),
    };
    const fallbackPath = `M${source.x} ${source.y}L${target.x} ${target.y}`;
    const geometry =
      parsePath(request.pathData ?? pathDataFromPoints(request.pathPoints) ?? fallbackPath) ??
      parsePath(fallbackPath);
    if (!geometry) continue;
    const idealRatio = nearestPathRatio(geometry, idealCenter);
    let bestPlacement: GraphEdgeLabelPlacement | undefined;
    let bestScore: CandidateScore | undefined;
    candidateRatios(geometry, idealRatio, step).forEach((pathRatio, candidateIndex) => {
      const center = pathPointAt(geometry, pathRatio);
      const bounds = boundsAt(center, size);
      const score = scoreCandidate(
        bounds,
        idealCenter,
        normalizedObstacles,
        placedBounds,
        clearance,
        candidateIndex,
      );
      if (bestScore && !better(score, bestScore)) return;
      bestScore = score;
      bestPlacement = {
        id: request.id,
        center,
        bounds,
        candidateIndex,
        pathRatio,
        collides: score.collisions > 0,
      };
    });
    if (!bestPlacement) continue;
    placements.set(request.id, bestPlacement);
    placedBounds.push(bestPlacement.bounds);
  }
  return placements;
}
